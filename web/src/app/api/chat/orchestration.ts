import { NextResponse } from "next/server";
import {
  generateSqlWithAnthropic,
  repairSqlWithAnthropic,
  synthesizeAnswerStream,
  formatColumnValidationHint
} from "@/lib/anthropic";
import { validateColumnExistence } from "@/lib/sqlValidation/columnExistenceCheck";
import { validateJoinPatterns } from "@/lib/sqlValidation/joinPatternsCheck";
import { extractSessionKeyLiterals } from "@/lib/sqlValidation/sessionKeyExtraction";
import { getSchemaCatalog } from "@/lib/schemaCatalog";
import { buildHeuristicSql, runReadOnlySql } from "@/lib/queries";
import { warmPool } from "@/lib/db";
import { buildDeterministicSqlTemplate } from "@/lib/deterministicSql";
import { pickInsightShape } from "@/lib/chatRuntime/insightShape";
import {
  buildChatRuntime,
  type ChatRuntimeProceed,
  type ChatRuntimeResult
} from "@/lib/chatRuntime";
import { assessChatQuality } from "@/lib/chatQuality";
import { applyAnswerSanityGuards } from "@/lib/answerSanity";
import { buildStructuredSummaryFromRows } from "@/lib/answerSanity/countList";
import { appendJsonLog, logServer } from "@/lib/serverLog";
import { startSpan, flushTrace, type Span, type SpanRecord } from "@/lib/perfTrace";
import {
  buildAnswerCacheKey,
  cachedRunSql,
  cachedSynthesize,
  getAnswerCacheEntry,
  setAnswerCacheEntry,
  type AnswerCacheSubset
} from "@/lib/cache/answerCache";
import { assertNoLlmForDeterministic } from "@/lib/zeroLlmGuard";
import { buildPitCycleInsight } from "@/lib/synthesis/pitCycleInsight";
import { buildPaceCliffInsight } from "@/lib/synthesis/paceCliffInsight";
import { buildInferredOvertakesInsight } from "@/lib/synthesis/inferredOvertakesInsight";
import { buildMinisectorDominanceInsight } from "@/lib/synthesis/minisectorDominanceInsight";
import { buildStintDeltaInsight } from "@/lib/synthesis/stintDeltaInsight";
import { buildStrategySplitInsight } from "@/lib/synthesis/strategySplitInsight";
import { buildPerformanceRadarInsight } from "@/lib/synthesis/performanceRadarInsight";
import { buildRaceControlIncidentsInsight } from "@/lib/synthesis/raceControlIncidentsInsight";
import { buildTelemetryWeatherGapInsight } from "@/lib/synthesis/telemetryWeatherGapInsight";
import { buildLap1PositionsInsight } from "@/lib/synthesis/lap1PositionsInsight";
import { buildWetCrossoverInsight } from "@/lib/synthesis/wetCrossoverInsight";
import { buildBrakeZonesInsight } from "@/lib/synthesis/brakeZonesInsight";
import { buildCornerDeltaInsight } from "@/lib/synthesis/cornerDeltaInsight";
import { buildSectorDominanceInsight } from "@/lib/synthesis/sectorDominanceInsight";
import { buildSpeedMapInsight } from "@/lib/synthesis/speedMapInsight";
import { buildRaceTraceInsight } from "@/lib/synthesis/raceTraceInsight";
import { buildDegradationCurveInsight } from "@/lib/synthesis/degradationCurveInsight";
import { buildPositionChangesInsight } from "@/lib/synthesis/positionChangesInsight";
import { buildTelemetryOverlayInsight } from "@/lib/synthesis/telemetryOverlayInsight";
import {
  serializeRowsToFactContract,
  type FactContract,
  type FactContractGrain,
  type FactContractRow
} from "@/lib/contracts/factContract";
import {
  validatePitStints,
  type ValidationResult as PitStintsValidationResult
} from "@/lib/validators/pitStintsValidator";
import {
  validateSectorConsistency,
  type SectorConsistencyValidationResult
} from "@/lib/validators/sectorConsistencyValidator";
import {
  validateGridFinish,
  type GridFinishValidationResult
} from "@/lib/validators/gridFinishValidator";
import {
  validateStrategyEvidence,
  type StrategyEvidenceValidationResult
} from "@/lib/validators/strategyEvidenceValidator";
import {
  validateCountListParity,
  type CountListParityValidationResult
} from "@/lib/validators/countListParityValidator";

function mapToFactContractGrain(grain: ChatRuntimeProceed["grain"]["grain"]): FactContractGrain {
  switch (grain) {
    case "session":
      return "session";
    case "lap":
      return "lap";
    case "stint":
      return "stint";
    case "driver_session":
      return "driver";
    default:
      return "other";
  }
}

function filterScalarKeys(
  entities: ChatRuntimeProceed["queryPlan"]["resolved_entities"]
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(entities)) {
    if (v === null || typeof v === "string" || typeof v === "number") {
      out[k] = v;
    }
  }
  return out;
}

function buildSynthesisContract(args: {
  runtime: ChatRuntimeProceed;
  rows: Record<string, unknown>[];
}): FactContract {
  const { runtime, rows } = args;
  return serializeRowsToFactContract({
    contractName: runtime.queryPlan.primary_tables[0] ?? "unknown_contract",
    grain: mapToFactContractGrain(runtime.grain.grain),
    keys: filterScalarKeys(runtime.queryPlan.resolved_entities),
    rows: rows as ReadonlyArray<FactContractRow>,
    ...(runtime.completeness.warnings.length > 0
      ? { coverage: { warnings: runtime.completeness.warnings } }
      : {})
  });
}

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// SSE frame contract (binding for the client wired in 07-streaming-synthesis-
// client-wiring). The route emits SSE only when the request carries
// `Accept: text/event-stream`; otherwise it returns today's JSON unchanged.
//
//   event: answer_delta
//   data: {"text": "..."}
//
//   event: reasoning_delta
//   data: {"text": "..."}
//
//   event: final
//   data: <full response payload, byte-identical to the JSON the same branch
//          would return without SSE>
//
//   event: error
//   data: {"message": "...", "code": "..."}
//
// Non-LLM exit branches (validation error, clarification, completeness-blocked,
// answer-cache hit, deterministic-template, transient-DB) emit a single `final`
// frame whose data equals their non-SSE JSON. Only thrown errors caught by the
// generic handler emit `error`.
// ---------------------------------------------------------------------------

const SSE_RESPONSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no"
} as const;

// Single-driver templates whose empty result deserves a factual "what IS
// recorded" no-data message (lap/pit record counts) rather than a bare
// "no rows matched" — see Fix 5 in the zero-row branch below.
const NO_DATA_ENRICH_TEMPLATES = new Set<string>([
  "single_driver_pit_cycle",
  "single_driver_pace_cliff",
  "single_driver_speed_map",
]);

function wantsSse(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.toLowerCase().includes("text/event-stream");
}

type SseDeltaKind = "answer_delta" | "reasoning_delta";

/**
 * Phases the orchestration emits as it runs. Maps to the client-side
 * activity log. The client treats unknown kinds as no-ops, so adding a
 * new kind here is non-breaking.
 */
export type StageKind =
  | "intake_complete"
  | "resolve_complete"
  | "resolve_timeout"
  | "plan_complete"
  | "sql_start"
  | "sql_complete"
  | "synthesis_start";

export type StagePayload = {
  kind: StageKind;
  /** Optional human-readable detail (e.g. "2025 British GP · drivers 4, 81"). */
  detail?: string;
  /** Server-side milliseconds elapsed since request start, for client diagnostics. */
  elapsedMs?: number;
};

type RouteCtx = {
  sseRequested: boolean;
  emitDelta: (kind: SseDeltaKind, text: string) => void;
  emitStage: (payload: StagePayload) => void;
  /** Phase 2: emit the synthesis-time structured InsightFields as an
   *  `event: insight` SSE frame so the client can populate the card
   *  before the `final` frame lands. `null` means no fields extracted. */
  emitInsight: (fields: import("@/lib/chatTypes").InsightFields | null) => void;
};

type RouteOutcome = {
  payload: Record<string, unknown>;
  status: number;
  // When set, an SSE-opted request emits an `error` frame instead of `final`.
  // Non-SSE requests always render `payload` as JSON with `status`.
  asError?: { message: string; code: string };
};

type ChatBody = {
  message?: string;
  context?: {
    sessionKey?: number;
    driverNumber?: number;
  };
  debug?: {
    trace?: boolean;
    benchmark?: boolean;
    questionId?: number;
    runId?: string;
    attempt?: string;
  };
};

function isTrueLike(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
}

function traceEnabledForRequest(body: ChatBody): boolean {
  return isTrueLike(process.env.OPENF1_CHAT_TRACE) || isTrueLike(body.debug?.trace);
}

function isTransientDatabaseAvailabilityError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("database system is in recovery mode") ||
    message.includes("database system is not yet accepting connections") ||
    message.includes("the database system is starting up") ||
    message.includes("terminating connection due to administrator command") ||
    message.includes("connection terminated unexpectedly")
  );
}

function buildFallbackAnswer(args: {
  question: string;
  rowCount: number;
  rows: Record<string, unknown>[];
  caveatText: string;
}): string {
  if (args.rowCount === 0) {
    return `No rows matched this question with the current context.${args.caveatText}`;
  }
  const summary = buildStructuredSummaryFromRows({
    question: args.question,
    rows: args.rows,
    rowCount: args.rowCount
  });
  return `${summary}${args.caveatText}`;
}

function enforcePinnedSessionKeyInSql(sql: string, pinnedSessionKey?: number): {
  sql: string;
  changed: boolean;
  foundSessionKeys: number[];
  note: string | null;
} {
  if (!Number.isFinite(Number(pinnedSessionKey))) {
    return {
      sql,
      changed: false,
      foundSessionKeys: [],
      note: null
    };
  }

  const normalizedPinnedKey = Math.trunc(Number(pinnedSessionKey));
  const foundSessionKeys = extractSessionKeyLiterals(sql);
  if (!foundSessionKeys.length) {
    return {
      sql,
      changed: false,
      foundSessionKeys,
      note: `session_pin_unverifiable_no_literal_session_key_predicate(session_key=${normalizedPinnedKey})`
    };
  }

  const rewrittenSql = sql.replace(
    /(\bsession_key\s*=\s*)(\d+)\b/gi,
    (_fullMatch, prefix: string) => `${prefix}${normalizedPinnedKey}`
  );
  const changed = rewrittenSql !== sql;
  if (!changed) {
    return {
      sql: rewrittenSql,
      changed,
      foundSessionKeys,
      note: `session_pin_verified(session_key=${normalizedPinnedKey})`
    };
  }
  return {
    sql: rewrittenSql,
    changed,
    foundSessionKeys,
    note: `session_pin_rewrite(${foundSessionKeys.join(",")}=>${normalizedPinnedKey})`
  };
}

export async function POST(request: Request): Promise<Response> {
  const sseRequested = wantsSse(request);

  // Non-SSE callers (the benchmark runner, other server-to-server calls)
  // get a no-op stage emitter — staging only makes sense over SSE.
  if (!sseRequested) {
    const outcome = await runChatRoute(request, {
      sseRequested: false,
      emitDelta: () => {},
      emitStage: () => {},
      emitInsight: () => {}
    });
    return NextResponse.json(outcome.payload, { status: outcome.status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeFrame = (event: string, data: unknown): void => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };
      try {
        const outcome = await runChatRoute(request, {
          sseRequested: true,
          emitDelta: (kind, text) => writeFrame(kind, { text }),
          emitStage: (payload) => writeFrame("stage", payload),
          emitInsight: (fields) => writeFrame("insight", { insight: fields })
        });
        if (outcome.asError) {
          writeFrame("error", outcome.asError);
        } else {
          writeFrame("final", outcome.payload);
        }
      } catch (err) {
        writeFrame("error", {
          message: err instanceof Error ? err.message : String(err),
          code: "internal"
        });
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
}

async function runChatRoute(request: Request, ctx: RouteCtx): Promise<RouteOutcome> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const traceRecords: SpanRecord[] = [];
  const openSpans = new Set<Span>();
  const startTrackedSpan = (span: Span): Span => {
    openSpans.add(span);
    return span;
  };
  const endTrackedSpan = (span: Span): void => {
    if (openSpans.delete(span)) {
      traceRecords.push(span.end());
    }
  };

  let totalSpan: Span | null = null;

  let body: ChatBody = {};
  let runtime: ChatRuntimeResult | undefined;
  let generatedSqlForTrace: string | null = null;
  let generationSourceForTrace: string | null = null;
  let templateKeyForTrace: string | null = null;
  let modelForTrace: string | null = null;
  let autoResolutionNoteForTrace: string | null = null;
  let lastSqlElapsedMsForTrace: number | null = null;
  let sessionPinKeyForTrace: number | null = null;
  let sessionPinNoteForTrace: string | null = null;
  // Phase 18-B: hoisted before the outer try so the outer finally's
  // flushTrace(..., { forceFlush: traceEnabled }) call is in scope and
  // TypeScript-clean. Default false preserves production sampling on any
  // path that throws before body-parse completes.
  let traceEnabled = false;

  try {
    totalSpan = startTrackedSpan(startSpan("total"));
    await logServer("INFO", "chat_request_received", { requestId });

    // Phase 17-B: idempotent pool warmup. First request per process pays the
    // SELECT 1 here instead of paying it inside resolver SQL on the hot path.
    await warmPool();

    const intakeSpan = startTrackedSpan(startSpan("request_intake"));

    try {
      body = await request.json();
    } catch {
      await logServer("WARN", "chat_invalid_json", { requestId });
      return {
        payload: { error: "Invalid JSON body", requestId },
        status: 400
      };
    }

    const message = body.message?.trim();
    if (!message) {
      await logServer("WARN", "chat_missing_message", { requestId });
      return {
        payload: { error: "message is required", requestId },
        status: 400
      };
    }

    endTrackedSpan(intakeSpan);
    ctx.emitStage({ kind: "intake_complete", elapsedMs: Date.now() - startedAt });

    traceEnabled = traceEnabledForRequest(body);
    const benchmarkQuestionId = Number.isFinite(Number(body.debug?.questionId))
      ? Math.trunc(Number(body.debug?.questionId))
      : null;
    const traceRunId = body.debug?.runId ? String(body.debug.runId) : null;
    const traceAttempt = body.debug?.attempt ? String(body.debug.attempt) : null;

    const appendQueryTrace = async (payload: Record<string, unknown>) => {
      if (!traceEnabled) {
        return;
      }
      await appendJsonLog("chat_query_trace.jsonl", {
        requestId,
        benchmarkQuestionId,
        traceRunId,
        traceAttempt,
        message,
        ...payload
      });
    };

    try {
      // Phase 2 (roadmap_to_A_grade): hard cap on the resolver, default 30s via
      // OPENF1_RESOLVE_DEADLINE_MS. The F08 probe fix (raw-table populated-checks
      // instead of core-view probes) cut typical cold resolution to ~3.7s, so the
      // prior 150s cap was ~40× the typical p99 — a degraded Neon endpoint could
      // hang a single request for 2.5 minutes. 30s is ~8× typical with margin and
      // sits under the 90s TOTAL_REQUEST_BUDGET_MS, so a genuinely-hung resolver
      // now rejects to an honest clarification an order of magnitude faster. We
      // don't cancel the in-flight query (Postgres-side cancel is brittle); we
      // reject the JS promise so the route returns a clarification.
      const RESOLVE_DEADLINE_MS = Number(process.env.OPENF1_RESOLVE_DEADLINE_MS ?? "30000");
      let resolveTimer: ReturnType<typeof setTimeout> | undefined;
      const resolvePromise = buildChatRuntime({
        message,
        context: body.context,
        recordSpan: (record) => {
          traceRecords.push(record);
        }
      });
      try {
        runtime = await Promise.race([
          resolvePromise,
          new Promise<ChatRuntimeResult>((_resolve, reject) => {
            resolveTimer = setTimeout(
              () => reject(new Error("chat_resolve_timeout")),
              RESOLVE_DEADLINE_MS
            );
          })
        ]);
        // Emit stage AFTER timeout window closes — detail surfaces the
        // resolved session/driver so the client activity log shows
        // "2025 British GP · drivers 4, 81" instead of the generic phase.
        // ChatRuntimeNoDataRefusal lacks `.resolution` so guard with `in`.
        const detailBits: string[] = [];
        if (runtime && "resolution" in runtime) {
          const resolved = runtime.resolution;
          if (resolved?.selectedSession?.label) detailBits.push(resolved.selectedSession.label);
          else if (resolved?.selectedSession?.sessionKey != null) detailBits.push(`session ${resolved.selectedSession.sessionKey}`);
          if (resolved?.selectedDriverNumbers?.length) detailBits.push(`drivers ${resolved.selectedDriverNumbers.join(", ")}`);
        }
        ctx.emitStage({
          kind: "resolve_complete",
          detail: detailBits.join(" · ") || undefined,
          elapsedMs: Date.now() - startedAt
        });
      } catch (err) {
        if (err instanceof Error && err.message === "chat_resolve_timeout") {
          ctx.emitStage({ kind: "resolve_timeout", elapsedMs: Date.now() - startedAt });
          await logServer("WARN", "chat_resolve_timeout", {
            requestId,
            deadlineMs: RESOLVE_DEADLINE_MS
          });
          const answer =
            "I couldn't resolve session/driver references within the time budget. Please rephrase or include explicit session_key / driver_number.";
          const quality = assessChatQuality({
            question: message,
            answer,
            generationSource: "runtime_clarification"
          });
          await appendJsonLog("chat_transcript.jsonl", {
            requestId,
            question: message,
            answer,
            adequacyGrade: quality.grade,
            adequacyReason: quality.reason,
            responseGrade: quality.grade,
            gradeReason: quality.reason,
            generationSource: "runtime_clarification",
            resolveTimedOut: true
          });
          await appendQueryTrace({
            status: "resolve_db_timeout",
            timeout: true,
            error: "chat_resolve_timeout",
            questionType: null,
            resolutionStatus: "timeout",
            queryPath: "runtime_clarification",
            templateKey: null,
            generationSource: "runtime_clarification",
            model: null,
            sql: null,
            sqlElapsedMs: null,
            sessionPinKey: null,
            sessionPinNote: null,
            totalRequestMs: Date.now() - startedAt,
            runtimeMs: null,
            autoResolutionNote: null
          });
          return {
            payload: {
              requestId,
              answer,
              adequacyGrade: quality.grade,
              adequacyReason: quality.reason,
              responseGrade: quality.grade,
              gradeReason: quality.reason,
              generationSource: "runtime_clarification",
              model: null,
              generationNotes: "resolve_db_timeout",
              sql: "-- query not executed (resolve timeout)",
              resolveTimedOut: true,
              resolutionStatus: "timeout"
            },
            status: 200
          };
        }
        throw err;
      } finally {
        if (resolveTimer) clearTimeout(resolveTimer);
      }

      // Phase 19-A (rev3 + rev4): typed `no_data_refusal` arm. The
      // PROPRIETARY_NO_DATA_TOPICS keyword guard fired in chatRuntime —
      // short-circuit BEFORE any Anthropic call, BEFORE template
      // matching, BEFORE SQL execution. Returns a templated
      // INSUFFICIENT_DATA answer with `generationSource:
      // "no_data_refusal"` so the Phase 19-A grader branch can award
      // A on `expected_outcome: "insufficient_data"` questions.
      if (runtime.kind === "no_data_refusal") {
        await logServer("INFO", "chat_no_data_refusal", {
          requestId,
          matchedKeyword: runtime.matchedKeyword,
          questionType: runtime.questionType,
          runtimeMs: runtime.durationMs
        });
        const answer = `INSUFFICIENT_DATA: ${runtime.refusalReason}`;
        const quality = assessChatQuality({
          question: message,
          answer,
          generationSource: "no_data_refusal"
        });
        await appendJsonLog("chat_transcript.jsonl", {
          requestId,
          question: message,
          answer,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason,
          generationSource: "no_data_refusal",
          matchedKeyword: runtime.matchedKeyword
        });
        await appendQueryTrace({
          status: "no_data_refusal",
          timeout: false,
          error: null,
          questionType: runtime.questionType,
          resolutionStatus: null,
          queryPath: "no_data_refusal",
          templateKey: null,
          generationSource: "no_data_refusal",
          model: null,
          sql: null,
          sqlElapsedMs: null,
          sessionPinKey: null,
          sessionPinNote: null,
          totalRequestMs: Date.now() - startedAt,
          runtimeMs: runtime.durationMs,
          autoResolutionNote: null,
          matchedKeyword: runtime.matchedKeyword
        });
        return {
          payload: {
            requestId,
            answer,
            adequacyGrade: quality.grade,
            adequacyReason: quality.reason,
            responseGrade: quality.grade,
            gradeReason: quality.reason,
            generationSource: "no_data_refusal",
            model: null,
            generationNotes: `proprietary_no_data:${runtime.matchedKeyword}`,
            sql: "-- query not executed (proprietary no-data refusal)",
            matchedKeyword: runtime.matchedKeyword
          },
          status: 200
        };
      }

      let autoResolutionNote: string | undefined;
      autoResolutionNoteForTrace = autoResolutionNote ?? null;

      await logServer("INFO", "chat_runtime_ready", {
        requestId,
        questionType: runtime.questionType,
        followUp: runtime.followUp,
        resolutionStatus: runtime.resolution.status,
        needsClarification: runtime.resolution.needsClarification,
        selectedSessionKey: runtime.resolution.selectedSession?.sessionKey ?? null,
        selectedDriverNumbers: runtime.resolution.selectedDriverNumbers,
        requiredTables: runtime.completeness.requiredTables,
        completenessWarnings: runtime.completeness.warnings,
        autoResolutionNote: autoResolutionNote ?? null,
        runtimeMs: runtime.durationMs
      });

      if (runtime.resolution.needsClarification) {
        const answer =
          runtime.resolution.clarificationPrompt ??
          "I need a little more detail to resolve the right session before running SQL.";
        const quality = assessChatQuality({
          question: message,
          answer,
          generationSource: "runtime_clarification",
          runtime
        });
        await logServer("INFO", "chat_clarification_required", { requestId });
        await appendJsonLog("chat_transcript.jsonl", {
          requestId,
          question: message,
          answer,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason,
          generationSource: "runtime_clarification",
          runtime
        });
        await appendQueryTrace({
          status: "clarification_required",
          timeout: false,
          error: null,
          questionType: runtime.questionType,
          resolutionStatus: runtime.resolution.status,
          resolvedSessionKey: runtime.resolution.selectedSession?.sessionKey ?? null,
          resolvedDriverNumbers: runtime.resolution.selectedDriverNumbers,
          sessionCandidates: runtime.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
            sessionKey: candidate.sessionKey,
            score: candidate.score,
            matchedOn: candidate.matchedOn
          })),
          queryPath: "runtime_clarification",
          templateKey: null,
          generationSource: "runtime_clarification",
          model: null,
          sql: null,
          sqlElapsedMs: null,
          sessionPinKey: sessionPinKeyForTrace,
          sessionPinNote: sessionPinNoteForTrace,
          totalRequestMs: Date.now() - startedAt,
          runtimeMs: runtime.durationMs,
          autoResolutionNote: autoResolutionNoteForTrace
        });
        return {
          payload: {
            requestId,
            answer,
            adequacyGrade: quality.grade,
            adequacyReason: quality.reason,
            responseGrade: quality.grade,
            gradeReason: quality.reason,
            generationSource: "runtime_clarification",
            model: null,
            generationNotes: [autoResolutionNote, "clarification_required"].filter(Boolean).join(" | "),
            sql: "-- query not executed (clarification required)",
            runtime
          },
          status: 200
        };
      }

      if (!runtime.completeness.available && !runtime.completeness.canProceedWithFallback) {
        const answer = [
          "I could not execute this request safely because required data is unavailable.",
          runtime.completeness.warnings.length ? `Details: ${runtime.completeness.warnings.join(" ")}` : ""
        ]
          .filter(Boolean)
          .join(" ");
        const quality = assessChatQuality({
          question: message,
          answer,
          generationSource: "runtime_unavailable",
          runtime
        });

        await logServer("WARN", "chat_unavailable_due_to_completeness", {
          requestId,
          warnings: runtime.completeness.warnings
        });
        await appendJsonLog("chat_transcript.jsonl", {
          requestId,
          question: message,
          answer,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason,
          generationSource: "runtime_unavailable",
          runtime
        });
        await appendQueryTrace({
          status: "completeness_blocked",
          timeout: false,
          error: null,
          questionType: runtime.questionType,
          resolutionStatus: runtime.resolution.status,
          resolvedSessionKey: runtime.resolution.selectedSession?.sessionKey ?? null,
          resolvedDriverNumbers: runtime.resolution.selectedDriverNumbers,
          sessionCandidates: runtime.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
            sessionKey: candidate.sessionKey,
            score: candidate.score,
            matchedOn: candidate.matchedOn
          })),
          queryPath: "runtime_unavailable",
          templateKey: null,
          generationSource: "runtime_unavailable",
          model: null,
          sql: null,
          sqlElapsedMs: null,
          sessionPinKey: sessionPinKeyForTrace,
          sessionPinNote: sessionPinNoteForTrace,
          totalRequestMs: Date.now() - startedAt,
          runtimeMs: runtime.durationMs,
          autoResolutionNote: autoResolutionNoteForTrace
        });

        return {
          payload: {
            requestId,
            answer,
            adequacyGrade: quality.grade,
            adequacyReason: quality.reason,
            responseGrade: quality.grade,
            gradeReason: quality.reason,
            generationSource: "runtime_unavailable",
            model: null,
            generationNotes: [autoResolutionNote, "completeness_blocked_execution"]
              .filter(Boolean)
              .join(" | "),
            sql: "-- query not executed (completeness blocked)",
            runtime
          },
          status: 200
        };
      }

      const resolvedContext = {
        sessionKey: runtime.resolution.requiresSession
          ? runtime.resolution.selectedSession?.sessionKey ?? body.context?.sessionKey
          : body.context?.sessionKey,
        driverNumber:
          runtime.resolution.selectedDriverNumbers[0] !== undefined
            ? runtime.resolution.selectedDriverNumbers[0]
            : body.context?.driverNumber,
        // F07: heuristic fallback SQL must honor ALL resolved drivers —
        // two-driver comparisons were returning one driver's laps.
        driverNumbers: runtime.resolution.selectedDriverNumbers
      };
      const pinnedSessionKey =
        runtime.resolution.requiresSession && Number.isFinite(Number(resolvedContext.sessionKey))
          ? Math.trunc(Number(resolvedContext.sessionKey))
          : undefined;
      sessionPinKeyForTrace = pinnedSessionKey ?? null;

      let generatedSql: string;
      let generationSource = "anthropic";
      let model: string | undefined;
      let generationNotes: string | undefined = autoResolutionNote;
      let selectedTemplateKey: string | null = null;
      let sqlAttemptCount = 0;

      const templateMatchSpan = startTrackedSpan(startSpan("template_match"));
      let deterministic: ReturnType<typeof buildDeterministicSqlTemplate>;
      try {
        deterministic = buildDeterministicSqlTemplate(message, {
          sessionKey: resolvedContext.sessionKey,
          driverNumbers: runtime.resolution.selectedDriverNumbers
        });
      } finally {
        endTrackedSpan(templateMatchSpan);
      }

      if (deterministic) {
        generatedSql = deterministic.sql;
        generationSource = "deterministic_template";
        selectedTemplateKey = deterministic.templateKey;
        generationNotes = [autoResolutionNote, `template=${deterministic.templateKey}`]
          .filter(Boolean)
          .join(" | ");
      } else {
        assertNoLlmForDeterministic({
          generationSource,
          templateKey: selectedTemplateKey ?? undefined,
          callSite: "generateSqlWithAnthropic"
        });
        const sqlgenSpan = startTrackedSpan(startSpan("sqlgen_llm"));
        try {
          const llm = await generateSqlWithAnthropic({
            question: message,
            context: resolvedContext,
            runtime: {
              questionType: runtime.questionType,
              grain: runtime.grain.grain,
              resolvedEntities: runtime.queryPlan.resolved_entities,
              queryPlan: runtime.queryPlan as unknown as Record<string, unknown>,
              requiredTables: runtime.completeness.requiredTables,
              completenessWarnings: runtime.completeness.warnings
            }
          });
          generatedSql = llm.sql;
          model = llm.model;
          generationNotes = llm.reasoning;
        } catch (error) {
          // F01: heuristic may decline (null) — leave SQL empty; the
          // pipeline converts that into an honest heuristic_unavailable
          // failure instead of executing an off-topic catch-all.
          const heuristicSql = buildHeuristicSql(message, resolvedContext);
          generatedSql = heuristicSql ?? "";
          generationSource = heuristicSql ? "heuristic_fallback" : "heuristic_unavailable";
          generationNotes =
            error instanceof Error
              ? `SQL generation failed; ${heuristicSql ? "heuristic fallback applied" : "no safe heuristic fallback exists"}: ${error.message}`
              : `SQL generation failed; ${heuristicSql ? "heuristic fallback applied." : "no safe heuristic fallback exists."}`;
          await logServer("WARN", "chat_anthropic_fallback", {
            requestId,
            heuristicAvailable: Boolean(heuristicSql),
            error: error instanceof Error ? error.message : String(error)
          });
        } finally {
          endTrackedSpan(sqlgenSpan);
        }
      }
      generatedSqlForTrace = generatedSql;
      generationSourceForTrace = generationSource;
      templateKeyForTrace = selectedTemplateKey;
      modelForTrace = model ?? null;
      const runtimeForTrace = runtime;

      const sortedDriverNumbersForCache = [...runtime.resolution.selectedDriverNumbers]
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.trunc(n))
        .sort((a, b) => a - b);
      const answerCacheKey = buildAnswerCacheKey({
        templateKey: selectedTemplateKey,
        sessionKey: pinnedSessionKey,
        sortedDriverNumbers: sortedDriverNumbersForCache,
        year: runtime.resolution.extracted.year
      });
      const cachedAnswer: AnswerCacheSubset | undefined = answerCacheKey
        ? getAnswerCacheEntry(answerCacheKey)
        : undefined;

      if (cachedAnswer) {
        const hitResult = {
          sql: cachedAnswer.result.sql,
          rows: cachedAnswer.result.rows,
          rowCount: cachedAnswer.result.rowCount,
          truncated: cachedAnswer.result.truncated,
          elapsedMs: 0
        };
        generatedSqlForTrace = cachedAnswer.sql;
        generationSourceForTrace = cachedAnswer.generationSource;
        modelForTrace = cachedAnswer.model ?? null;

        await logServer("INFO", "chat_query_success", {
          requestId,
          generationSource: cachedAnswer.generationSource,
          model: cachedAnswer.model ?? null,
          questionType: runtime.questionType,
          resolutionStatus: runtime.resolution.status,
          selectedSessionKey: runtime.resolution.selectedSession?.sessionKey ?? null,
          rowCount: hitResult.rowCount,
          elapsedMs: hitResult.elapsedMs,
          adequacyGrade: cachedAnswer.adequacyGrade,
          hasAnswerReasoning: Boolean(cachedAnswer.answerReasoning),
          sessionPinKey: sessionPinKeyForTrace,
          sessionPinNote: sessionPinNoteForTrace,
          totalRequestMs: Date.now() - startedAt,
          cache_hit: true
        });
        await appendJsonLog("chat_transcript.jsonl", {
          requestId,
          question: message,
          answer: cachedAnswer.answer,
          answerReasoning: cachedAnswer.answerReasoning ?? null,
          adequacyGrade: cachedAnswer.adequacyGrade,
          adequacyReason: cachedAnswer.adequacyReason,
          responseGrade: cachedAnswer.responseGrade,
          gradeReason: cachedAnswer.gradeReason,
          generationSource: cachedAnswer.generationSource,
          model: cachedAnswer.model ?? null,
          sql: cachedAnswer.sql,
          result: {
            rowCount: hitResult.rowCount,
            elapsedMs: hitResult.elapsedMs,
            truncated: hitResult.truncated
          },
          runtime,
          cache_hit: true
        });
        await appendQueryTrace({
          status: "success",
          cache_hit: true,
          timeout: false,
          error: null,
          questionType: runtime.questionType,
          resolutionStatus: runtime.resolution.status,
          resolvedSessionKey:
            runtime.resolution.selectedSession?.sessionKey ?? resolvedContext.sessionKey ?? null,
          resolvedDriverNumbers: runtime.resolution.selectedDriverNumbers,
          sessionCandidates: runtime.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
            sessionKey: candidate.sessionKey,
            score: candidate.score,
            matchedOn: candidate.matchedOn
          })),
          queryPath: cachedAnswer.generationSource,
          templateKey: selectedTemplateKey,
          generationSource: cachedAnswer.generationSource,
          model: cachedAnswer.model ?? null,
          sql: cachedAnswer.sql,
          sqlElapsedMs: hitResult.elapsedMs,
          rowCount: hitResult.rowCount,
          sessionPinKey: sessionPinKeyForTrace,
          sessionPinNote: sessionPinNoteForTrace,
          totalRequestMs: Date.now() - startedAt,
          runtimeMs: runtime.durationMs,
          autoResolutionNote: autoResolutionNoteForTrace
        });

        // Re-emit the cached insight on the SSE channel so a streaming client
        // gets the full card on a cache hit, exactly like the first run.
        if (ctx.sseRequested && cachedAnswer.insight) {
          ctx.emitInsight(cachedAnswer.insight);
        }
        return {
          payload: {
            requestId,
            answer: cachedAnswer.answer,
            answerReasoning: cachedAnswer.answerReasoning,
            adequacyGrade: cachedAnswer.adequacyGrade,
            adequacyReason: cachedAnswer.adequacyReason,
            responseGrade: cachedAnswer.responseGrade,
            gradeReason: cachedAnswer.gradeReason,
            generationSource: cachedAnswer.generationSource,
            model: cachedAnswer.model,
            generationNotes: cachedAnswer.generationNotes,
            sql: cachedAnswer.sql,
            insight: cachedAnswer.insight ?? undefined,
            result: hitResult,
            runtime
          },
          status: 200
        };
      }

      const executeSqlWithTrace = async (
        sql: string,
        queryPath: string,
        attemptLabel: string,
        timeoutMs?: number
      ) => {
        sqlAttemptCount += 1;
        const enforcedSessionSql = enforcePinnedSessionKeyInSql(sql, pinnedSessionKey);
        const sqlToExecute = enforcedSessionSql.sql;
        sessionPinNoteForTrace = enforcedSessionSql.note ?? sessionPinNoteForTrace;
        if (enforcedSessionSql.changed) {
          await logServer("WARN", "chat_session_pin_rewrite", {
            requestId,
            pinnedSessionKey: pinnedSessionKey ?? null,
            foundSessionKeys: enforcedSessionSql.foundSessionKeys
          });
        }
        const sqlStartedAt = Date.now();
        // Stage events frame the orchestration's two distinct DB phases:
        // sql_start (query about to run) → sql_complete (rows back).
        ctx.emitStage({ kind: "sql_start", elapsedMs: sqlStartedAt - startedAt });
        const execDbSpan = startTrackedSpan(startSpan("execute_db"));
        try {
          // Deterministic templates control their own row volume and some
          // (race trace, position changes) legitimately return one row per
          // driver-lap — the 200-row preview cap silently truncated them
          // to the first ~3 drivers. LLM-generated SQL keeps the tight cap.
          // F04: hand-audited deterministic templates get their own,
          // higher statement-timeout budget (they legitimately run 8–13s
          // against unmaterialized core.* views and had near-zero headroom
          // under the shared 15s cap). LLM SQL keeps the tight 15s default.
          // An explicit timeoutMs (the retry's remaining-budget cap) wins.
          const templateTimeoutMs =
            queryPath === "deterministic_template"
              ? Number(process.env.OPENF1_TEMPLATE_TIMEOUT_MS ?? "25000")
              : undefined;
          const effectiveTimeoutMs = timeoutMs ?? templateTimeoutMs;
          const executed = await cachedRunSql(sqlToExecute, {
            preview: true,
            maxRows: queryPath === "deterministic_template" ? 1500 : undefined,
            ...(effectiveTimeoutMs !== undefined ? { timeoutMs: effectiveTimeoutMs } : {})
          });
          endTrackedSpan(execDbSpan);
          generatedSqlForTrace = executed.sql;
          lastSqlElapsedMsForTrace = executed.elapsedMs ?? Date.now() - sqlStartedAt;
          ctx.emitStage({
            kind: "sql_complete",
            detail: `${executed.rowCount} row${executed.rowCount === 1 ? "" : "s"} · ${lastSqlElapsedMsForTrace}ms`,
            elapsedMs: Date.now() - startedAt
          });
          await appendQueryTrace({
            status: "sql_attempt",
            sqlAttemptNumber: sqlAttemptCount,
            sqlAttemptLabel: attemptLabel,
            timeout: false,
            error: null,
            questionType: runtimeForTrace.questionType,
            resolutionStatus: runtimeForTrace.resolution.status,
            resolvedSessionKey:
              runtimeForTrace.resolution.selectedSession?.sessionKey ?? resolvedContext.sessionKey ?? null,
            resolvedDriverNumbers: runtimeForTrace.resolution.selectedDriverNumbers,
            queryPath,
            templateKey: templateKeyForTrace,
            generationSource: queryPath,
            model: modelForTrace,
            sql: executed.sql,
            sqlElapsedMs: lastSqlElapsedMsForTrace,
            rowCount: executed.rowCount,
            sessionPinKey: sessionPinKeyForTrace,
            sessionPinNote: sessionPinNoteForTrace,
            totalRequestMs: Date.now() - startedAt,
            runtimeMs: runtimeForTrace.durationMs,
            autoResolutionNote: autoResolutionNoteForTrace
          });
          return executed;
        } catch (sqlError) {
          endTrackedSpan(execDbSpan);
          const errorMessage = sqlError instanceof Error ? sqlError.message : String(sqlError);
          lastSqlElapsedMsForTrace = Date.now() - sqlStartedAt;
          await appendQueryTrace({
            status: "sql_attempt",
            sqlAttemptNumber: sqlAttemptCount,
            sqlAttemptLabel: attemptLabel,
            timeout: errorMessage.toLowerCase().includes("statement timeout"),
            error: errorMessage,
            questionType: runtimeForTrace.questionType,
            resolutionStatus: runtimeForTrace.resolution.status,
            resolvedSessionKey:
              runtimeForTrace.resolution.selectedSession?.sessionKey ?? resolvedContext.sessionKey ?? null,
            resolvedDriverNumbers: runtimeForTrace.resolution.selectedDriverNumbers,
            queryPath,
            templateKey: templateKeyForTrace,
            generationSource: queryPath,
            model: modelForTrace,
            sql: sqlToExecute,
            sqlElapsedMs: lastSqlElapsedMsForTrace,
            rowCount: null,
            sessionPinKey: sessionPinKeyForTrace,
            sessionPinNote: sessionPinNoteForTrace,
            totalRequestMs: Date.now() - startedAt,
            runtimeMs: runtimeForTrace.durationMs,
            autoResolutionNote: autoResolutionNoteForTrace
          });
          throw sqlError;
        }
      };

      // Phase 17-C/D: pre-execute validation + bounded repair loop.
      // - Validate column existence on the LLM-gen path before sending the
      //   query to Postgres. On validator miss, skip exec and go straight
      //   to repair with the missing-column list spliced into the prompt.
      // - 60s wall-clock budget across sqlgen + validate + exec + repair.
      // - At most 1 repair attempt; on exhaustion, return a structured
      //   honest error (no more "recent sessions" heuristic).
      const SQL_REPAIR_BUDGET_MS = Number(process.env.OPENF1_SQL_REPAIR_BUDGET_MS ?? "60000");
      // F09 (golden-set audit 2026-07-02): anchor the SQL budget at
      // SQL-PIPELINE ENTRY, not request start. Charging a 41s cold
      // resolution against the 60s SQL budget left ~19s — one 15s timeout
      // then the deadline was blown and the repair/retry path was
      // unreachable (M09 shipped a doubled "couldn't construct…" sentence).
      // A separate total-request cap keeps re-anchoring from producing
      // 100s requests.
      const sqlPipelineStartedAt = Date.now();
      const TOTAL_REQUEST_BUDGET_MS = Number(process.env.OPENF1_TOTAL_REQUEST_BUDGET_MS ?? "90000");
      const remainingTotalMs = TOTAL_REQUEST_BUDGET_MS - (sqlPipelineStartedAt - startedAt);
      const sqlBudgetMs = Math.max(35000, Math.min(SQL_REPAIR_BUDGET_MS, remainingTotalMs));
      const sqlPipelineDeadline = sqlPipelineStartedAt + sqlBudgetMs;
      const isTimeoutError = (err: unknown): boolean =>
        (err instanceof Error ? err.message : String(err))
          .toLowerCase()
          .includes("statement timeout");
      // Capture runtime in a const so the inner closures don't re-narrow the
      // outer `let runtime: ChatRuntimeResult | undefined` to undefined.
      const runtimeNarrow = runtime;

      let result: Awaited<ReturnType<typeof runReadOnlySql>> | undefined;
      let sqlPipelineError: { message: string; code: string } | null = null;

      // Pre-execute column-existence validation on the LLM-gen path.
      let preExecMissing:
        | Awaited<ReturnType<typeof validateColumnExistence>>
        | null = null;
      if (generationSource === "anthropic") {
        try {
          preExecMissing = await validateColumnExistence(generatedSql);
        } catch {
          preExecMissing = null;
        }
      }

      // Phase 19 outcome-fix Fix 3: pre-execute JOIN-pattern validation.
      // Catches the raw.car_data × raw.location timestamp-proximity
      // anti-pattern BEFORE SQL hits Postgres so the 15s timeout path
      // is structurally bypassed. If both validators flag misses, the
      // column-existence misses take precedence in the repair hint
      // (the LLM is more likely to fix a hallucinated column on first
      // attempt than a JOIN-shape choice).
      if (
        generationSource === "anthropic" &&
        (!preExecMissing || preExecMissing.ok === true)
      ) {
        try {
          const joinPatternResult = await validateJoinPatterns(generatedSql);
          if (joinPatternResult.ok === false) {
            // Project into the same `preExecMissing` shape the existing
            // repair branch consumes. The synthetic
            // `joinPatternViolation: true` flag distinguishes from real
            // column misses if the repair hint formatter wants to know.
            preExecMissing = {
              ok: false,
              missing: joinPatternResult.missing.map((v) => ({
                table: v.table,
                column: v.column,
                sourceRef: v.sourceRef
              }))
            };
          }
        } catch {
          // Fail-safe: if validator throws, let the SQL run and the
          // existing 15s timeout path catches it.
        }
      }

      const initialFailureSnapshot = {
        sql: generatedSql,
        validatorMissing:
          preExecMissing && preExecMissing.ok === false ? preExecMissing.missing : null,
        execError: null as string | null
      };

      // F01: buildHeuristicSql is now nullable — when SQL generation failed
      // AND no safe topical fallback exists, take the honest structured
      // failure path instead of executing anything.
      if (!generatedSql || !generatedSql.trim()) {
        sqlPipelineError = {
          message:
            "SQL generation failed for this question and no safe fallback query exists.",
          code: "heuristic_unavailable"
        };
      }

      const tryRepairAndExecute = async (failingSql: string, dbError: string, validatorHint: string) => {
        assertNoLlmForDeterministic({
          generationSource,
          templateKey: selectedTemplateKey ?? undefined,
          callSite: "repairSqlWithAnthropic"
        });
        const repairSpan = startTrackedSpan(startSpan("repair_llm"));
        let repaired: Awaited<ReturnType<typeof repairSqlWithAnthropic>>;
        try {
          repaired = await repairSqlWithAnthropic({
            question: message,
            failingSql,
            dbError,
            columnValidationHint: validatorHint || undefined,
            context: resolvedContext,
            runtime: {
              questionType: runtimeNarrow.questionType,
              grain: runtimeNarrow.grain.grain,
              resolvedEntities: runtimeNarrow.queryPlan.resolved_entities,
              queryPlan: runtimeNarrow.queryPlan as unknown as Record<string, unknown>,
              requiredTables: runtimeNarrow.completeness.requiredTables,
              completenessWarnings: runtimeNarrow.completeness.warnings
            }
          });
        } finally {
          endTrackedSpan(repairSpan);
        }
        generatedSql = repaired.sql;
        generatedSqlForTrace = generatedSql;
        generationNotes = [generationNotes, repaired.reasoning, "auto_repair_applied"]
          .filter(Boolean)
          .join(" | ");
        generationSource = "anthropic_repaired";
        generationSourceForTrace = generationSource;
        model = repaired.model;
        modelForTrace = model ?? null;
        return executeSqlWithTrace(generatedSql, generationSource, "repair_retry");
      };

      try {
        if (sqlPipelineError) {
          // Honest failure already decided (heuristic_unavailable) — skip
          // execution entirely; the sqlPipelineError block below responds.
        } else if (preExecMissing && preExecMissing.ok === false) {
          await appendQueryTrace({
            status: "column_validation_failed",
            sqlAttemptNumber: sqlAttemptCount,
            sqlAttemptLabel: "pre_exec_validation",
            timeout: false,
            error: null,
            missingColumns: preExecMissing.missing,
            questionType: runtime.questionType,
            resolutionStatus: runtime.resolution.status,
            queryPath: generationSource,
            templateKey: selectedTemplateKey,
            generationSource,
            model: model ?? null,
            sql: generatedSql,
            sqlElapsedMs: 0,
            sessionPinKey: sessionPinKeyForTrace,
            sessionPinNote: sessionPinNoteForTrace,
            totalRequestMs: Date.now() - startedAt,
            runtimeMs: runtime.durationMs,
            autoResolutionNote: autoResolutionNoteForTrace
          });
          await logServer("WARN", "chat_query_first_attempt_failed", {
            requestId,
            generationSource,
            model: model ?? null,
            sql: generatedSql,
            error: "column_validation_failed",
            missing: preExecMissing.missing
          });
          if (Date.now() > sqlPipelineDeadline) {
            throw new Error("sql_pipeline_budget_exhausted");
          }
          const catalog = await getSchemaCatalog().catch(() => new Map<string, string[]>());
          const hint = formatColumnValidationHint(preExecMissing.missing, catalog);
          const dbError = `Pre-execution validation: missing columns ${preExecMissing.missing
            .map((m) => m.sourceRef)
            .join(", ")}`;
          initialFailureSnapshot.execError = dbError;
          result = await tryRepairAndExecute(generatedSql, dbError, hint);
        } else {
          result = await executeSqlWithTrace(generatedSql, generationSource, "initial");
        }
      } catch (execOrValidationError) {
        const errorMessage =
          execOrValidationError instanceof Error
            ? execOrValidationError.message
            : String(execOrValidationError);
        if (errorMessage === "sql_pipeline_budget_exhausted") {
          sqlPipelineError = {
            message:
              "I couldn't construct a valid SQL query for this question within the time budget.",
            code: "sql_repair_timeout"
          };
        } else {
          await logServer("WARN", "chat_query_first_attempt_failed", {
            requestId,
            generationSource,
            model: model ?? null,
            sql: generatedSql,
            error: errorMessage
          });

          if (generationSource === "anthropic" || generationSource === "anthropic_repaired") {
            // Already attempted repair above (preExecMissing path) — only the
            // initial-exec branch falls here. Fire the one allowed repair.
            if (Date.now() > sqlPipelineDeadline) {
              sqlPipelineError = {
                message:
                  "I couldn't construct a valid SQL query for this question within the time budget.",
                code: "sql_repair_timeout"
              };
            } else {
              try {
                initialFailureSnapshot.execError = errorMessage;
                result = await tryRepairAndExecute(generatedSql, errorMessage, "");
              } catch (repairError) {
                const repairErrorMessage =
                  repairError instanceof Error ? repairError.message : String(repairError);
                await logServer("WARN", "chat_query_repair_failed", {
                  requestId,
                  error: repairErrorMessage
                });
                if (isTimeoutError(repairError) || isTimeoutError(execOrValidationError)) {
                  // Phase 17-D: timeouts keep the heuristic fallback —
                  // syntactically valid SQL that ran too long is a different
                  // class of failure than column-hallucination. F01: the
                  // heuristic may decline (null) — honest failure then.
                  const timeoutHeuristic = buildHeuristicSql(message, resolvedContext);
                  if (!timeoutHeuristic) {
                    sqlPipelineError = {
                      message:
                        "The query timed out and no safe fallback query exists for this question.",
                      code: "heuristic_unavailable"
                    };
                  } else {
                    generatedSql = timeoutHeuristic;
                    generationSource = "heuristic_after_sql_timeout";
                    generatedSqlForTrace = generatedSql;
                    generationSourceForTrace = generationSource;
                    templateKeyForTrace = null;
                    generationNotes = [generationNotes, "repair_failed_heuristic_used_timeout"]
                      .filter(Boolean)
                      .join(" | ");
                    result = await executeSqlWithTrace(
                      generatedSql,
                      generationSource,
                      "heuristic_after_timeout"
                    );
                  }
                } else {
                  // Phase 17-D: exhaustion on column / SQL errors → honest
                  // structured failure, NOT a heuristic that returns
                  // unrelated rows.
                  sqlPipelineError = {
                    message: repairErrorMessage,
                    code: "sql_generation_failed"
                  };
                }
              }
            }
          } else if (generationSource === "deterministic_template") {
            // F05 (golden-set audit 2026-07-02): this branch used to swap in
            // buildHeuristicSql on ANY exec error — off-topic rows that
            // synthesis turned into fabricated "not in dataset" claims.
            // Policy now mirrors Phase 17-D: transient Neon timeouts get ONE
            // same-SQL retry (a re-fire of the identical template SQL was
            // observed succeeding warm); everything else — and a failed
            // retry — is an honest structured failure.
            // Only retry when enough budget remains for a full attempt to be
            // meaningful; cap the retry's statement_timeout to what's left so
            // a cold-start + double-timeout can't overrun the 60s wall clock.
            const remainingBudgetMs = sqlPipelineDeadline - Date.now();
            const RETRY_MIN_BUDGET_MS = 3000;
            if (isTimeoutError(execOrValidationError) && remainingBudgetMs >= RETRY_MIN_BUDGET_MS) {
              try {
                result = await executeSqlWithTrace(
                  generatedSql,
                  generationSource,
                  "template_retry_after_timeout",
                  Math.min(Number(process.env.OPENF1_TEMPLATE_TIMEOUT_MS ?? "25000"), remainingBudgetMs)
                );
                generationNotes = [generationNotes, "template_timeout_retry_succeeded"]
                  .filter(Boolean)
                  .join(" | ");
              } catch (retryError) {
                await logServer("WARN", "chat_template_retry_failed", {
                  requestId,
                  error: retryError instanceof Error ? retryError.message : String(retryError)
                });
                sqlPipelineError = {
                  message:
                    "The optimized query for this question timed out twice against the warehouse.",
                  code: "template_exec_timeout"
                };
              }
            } else if (isTimeoutError(execOrValidationError)) {
              // Timed out with too little budget left to retry meaningfully.
              sqlPipelineError = {
                message:
                  "The optimized query for this question timed out against the warehouse.",
                code: "template_exec_timeout"
              };
            } else {
              // Permanent failure class (column / SQL error).
              sqlPipelineError = {
                message: errorMessage,
                code: "template_exec_failed"
              };
            }
          } else {
            // F04/F05 (GPT review #4): heuristic_fallback / heuristic_after_sql_timeout
            // exec failures used to `throw` here and surface as a raw 500. A
            // failed fallback is an honest structured failure, not a crash.
            sqlPipelineError = {
              message: errorMessage,
              code: "fallback_exec_failed"
            };
          }
        }
      }

      if (sqlPipelineError) {
        const sqlErrorDetail = sqlPipelineError.message;
        const validatorMissing = initialFailureSnapshot.validatorMissing;
        // If a required table is empty, the SQL error is a downstream symptom
        // of a real data gap. Surface a clean "Not in dataset" refusal citing
        // the empty table(s) instead of leaking the SQL error to the user.
        const emptyTables = runtime.completeness.tableChecks
          .filter((c) => c.status === "globally_empty" || c.status === "session_empty")
          .map((c) => c.table);
        const isDataGap = emptyTables.length > 0;
        const failureSource = isDataGap ? "no_data_refusal" : "sql_generation_failed";
        const dataGapInsight: import("@/lib/chatTypes").InsightFields | undefined = isDataGap
          ? {
              title: "Not in dataset",
              what_we_have: runtime.completeness.fallbackOptions.length
                ? runtime.completeness.fallbackOptions
                : ["Lap times and sector times", "Pit stops and stint data", "Per-lap track positions"]
            }
          : undefined;
        const userFacing = isDataGap
          ? `INSUFFICIENT_DATA: This can't be answered from the current data — ${emptyTables.join(", ")} ${emptyTables.length === 1 ? "is" : "are"} empty in this warehouse, so there are no rows to analyse.`
          : validatorMissing
            ? `I couldn't construct a valid SQL query for this question. The query referenced columns that don't exist on the targeted contract: ${validatorMissing
                .map((m) => `${m.sourceRef} (no such column on ${m.table})`)
                .join("; ")}.`
            // F09: don't double the generic sentence when sqlErrorDetail is
            // itself already the generic "couldn't construct…" message.
            : /^I couldn't construct a valid SQL query for this question/i.test(sqlErrorDetail)
              ? sqlErrorDetail
              : "I couldn't construct a valid SQL query for this question. " + sqlErrorDetail;
        const honestAnswer = userFacing;
        const quality = assessChatQuality({
          question: message,
          answer: honestAnswer,
          generationSource: failureSource,
          runtime,
          error: sqlErrorDetail
        });
        await logServer("WARN", "chat_query_sql_pipeline_exhausted", {
          requestId,
          code: sqlPipelineError.code,
          error: sqlErrorDetail,
          missing: validatorMissing
        });
        await appendJsonLog("chat_transcript.jsonl", {
          requestId,
          question: message,
          answer: honestAnswer,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason,
          generationSource: failureSource,
          sqlError: sqlErrorDetail,
          missingColumns: validatorMissing,
          model: modelForTrace,
          sql: initialFailureSnapshot.sql,
          runtime
        });
        await appendQueryTrace({
          status: failureSource,
          timeout: false,
          error: sqlErrorDetail,
          missingColumns: validatorMissing,
          questionType: runtime.questionType,
          resolutionStatus: runtime.resolution.status,
          resolvedSessionKey: runtime.resolution.selectedSession?.sessionKey ?? resolvedContext.sessionKey ?? null,
          resolvedDriverNumbers: runtime.resolution.selectedDriverNumbers,
          sessionCandidates: runtime.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
            sessionKey: candidate.sessionKey,
            score: candidate.score,
            matchedOn: candidate.matchedOn
          })),
          queryPath: failureSource,
          templateKey: templateKeyForTrace,
          generationSource: failureSource,
          model: modelForTrace,
          sql: initialFailureSnapshot.sql,
          sqlElapsedMs: lastSqlElapsedMsForTrace,
          rowCount: null,
          sessionPinKey: sessionPinKeyForTrace,
          sessionPinNote: sessionPinNoteForTrace,
          totalRequestMs: Date.now() - startedAt,
          runtimeMs: runtime.durationMs,
          autoResolutionNote: autoResolutionNoteForTrace
        });
        return {
          payload: {
            requestId,
            answer: honestAnswer,
            adequacyGrade: quality.grade,
            adequacyReason: quality.reason,
            responseGrade: quality.grade,
            gradeReason: quality.reason,
            generationSource: failureSource,
            model: modelForTrace,
            generationNotes: [generationNotes, isDataGap ? `empty_tables:${emptyTables.join(",")}` : sqlPipelineError.code]
              .filter(Boolean)
              .join(" | "),
            sql: initialFailureSnapshot.sql,
            sqlError: sqlErrorDetail,
            missingColumns: validatorMissing,
            insight: dataGapInsight,
            runtime
          },
          status: 200
        };
      }

      if (!result) {
        // Defensive narrow: every successful path assigns `result`; we only
        // get here if the catch block fell through without setting either
        // `result` or `sqlPipelineError`. Treat as honest failure.
        sqlPipelineError = {
          message: "SQL pipeline produced no result",
          code: "sql_pipeline_no_result"
        };
        throw new Error("sql_pipeline_no_result_unreachable");
      }

      const caveatText = runtime.completeness.warnings.length
        ? ` Caveats: ${runtime.completeness.warnings.join(" ")}`
        : "";
      let answerReasoning: string | undefined;
      let answer =
        result.rowCount === 0
          ? `No rows matched this question with the current context.${caveatText}`
          : "";

      // Fix 5 (chart-audit 2026-07-03): DNF-aware no-data. A bare "no rows
      // matched" is honest but unhelpful when a single-driver question resolves
      // fine yet the driver simply has no data for it (e.g. asking Tsunoda's
      // first-stop lap at Jeddah 2025, where he retired on lap 2 and never
      // pitted). Probe what IS recorded and state ONLY observed facts — record
      // counts — never inferring "retired" (that needs classification evidence
      // we don't have). Must never fabricate absence or break the response.
      if (
        result.rowCount === 0 &&
        generationSource === "deterministic_template" &&
        NO_DATA_ENRICH_TEMPLATES.has(selectedTemplateKey ?? "") &&
        runtime.resolution.selectedSession?.sessionKey != null &&
        runtime.resolution.selectedDriverNumbers.length === 1
      ) {
        const sKey = Math.trunc(Number(runtime.resolution.selectedSession.sessionKey));
        const dNum = Math.trunc(Number(runtime.resolution.selectedDriverNumbers[0]));
        if (Number.isFinite(sKey) && Number.isFinite(dNum)) {
          try {
            const probe = await cachedRunSql(
              `SELECT
                 (SELECT COUNT(*) FROM core.laps_enriched WHERE session_key = ${sKey} AND driver_number = ${dNum}) AS lap_records,
                 (SELECT COUNT(*) FROM raw.pit WHERE session_key = ${sKey} AND driver_number = ${dNum}) AS pit_records,
                 (SELECT MAX(driver_name) FROM core.laps_enriched WHERE session_key = ${sKey} AND driver_number = ${dNum}) AS driver_name`,
              { preview: true, maxRows: 1, timeoutMs: 5000 }
            );
            const row = probe.rows?.[0] as
              | { lap_records?: number | string; pit_records?: number | string; driver_name?: string | null }
              | undefined;
            if (row) {
              const laps = Number(row.lap_records ?? 0);
              const pits = Number(row.pit_records ?? 0);
              const who = row.driver_name ? String(row.driver_name) : "this driver";
              if (laps === 0) {
                answer = `No lap data is recorded for ${who} in this session, so there is nothing to report here.${caveatText}`;
              } else if (pits === 0) {
                answer = `No pit stop is recorded for ${who} in this race — only ${laps} lap record${laps === 1 ? "" : "s"} exist, so there is no stop lap to report.${caveatText}`;
              }
              // pits > 0 but the specific template still matched nothing: keep the
              // generic message rather than guess at the reason.
            }
          } catch {
            // Probe failure keeps the honest generic no-data message.
          }
        }
      }
      let synthesisContract: FactContract | null = null;
      // Phase 2: insight fields extracted from synthesis JSON. Stays
      // null on cached / template / refusal paths and on parse
      // failures — body-only fallback in the UI.
      let synthesisInsight: import("@/lib/chatTypes").InsightFields | null = null;

      if (result.rowCount > 0) {
        if (generationSource === "deterministic_template") {
          // Some deterministic templates build a full insight (title /
          // verdict / metric tiles / takeaways / chips) deterministically —
          // no LLM — so their card matches the rich visualization rather
          // than the generic "top visible row" fallback. Others keep the
          // plain fallback answer.
          const deterministicInsight =
            selectedTemplateKey === "single_driver_pit_cycle"
              ? buildPitCycleInsight(result.rows)
              : selectedTemplateKey === "single_driver_pace_cliff"
                ? buildPaceCliffInsight(result.rows)
                : selectedTemplateKey === "inferred_overtakes"
                  ? buildInferredOvertakesInsight(result.rows)
                  : selectedTemplateKey === "minisector_dominance"
                    ? buildMinisectorDominanceInsight(result.rows)
                    : selectedTemplateKey === "driver_pair_stint_delta"
                      ? buildStintDeltaInsight(result.rows)
                      : selectedTemplateKey === "driver_pair_strategy_split"
                        ? buildStrategySplitInsight(result.rows)
                        : selectedTemplateKey === "driver_pair_performance_radar"
                          ? buildPerformanceRadarInsight(result.rows)
                          : selectedTemplateKey === "session_race_control_incidents"
                            ? buildRaceControlIncidentsInsight(result.rows)
                            : selectedTemplateKey === "sessions_telemetry_without_weather"
                              ? buildTelemetryWeatherGapInsight(result.rows)
                              : selectedTemplateKey === "driver_pair_lap1_positions"
                                ? buildLap1PositionsInsight(result.rows)
                                : selectedTemplateKey === "driver_pair_wet_crossover"
                                  ? buildWetCrossoverInsight(result.rows)
                                  : selectedTemplateKey === "driver_pair_brake_zones"
                                    ? buildBrakeZonesInsight(result.rows)
                                    : selectedTemplateKey === "driver_pair_corner_delta"
                                      ? buildCornerDeltaInsight(result.rows)
                                    : selectedTemplateKey === "driver_pair_sector_dominance"
                                      ? buildSectorDominanceInsight(result.rows)
                                      : selectedTemplateKey === "single_driver_speed_map"
                                        ? buildSpeedMapInsight(result.rows)
                                        : selectedTemplateKey === "session_race_trace"
                                          ? buildRaceTraceInsight(result.rows)
                                          : selectedTemplateKey === "compound_degradation_curve"
                                            ? buildDegradationCurveInsight(result.rows)
                                            : selectedTemplateKey === "race_position_changes"
                                              ? buildPositionChangesInsight(result.rows)
                                              : selectedTemplateKey === "driver_telemetry_overlay"
                                                ? buildTelemetryOverlayInsight(result.rows)
                                                : null;
          if (deterministicInsight) {
            answer = caveatText
              ? `${deterministicInsight.answer}${caveatText}`
              : deterministicInsight.answer;
            synthesisInsight = deterministicInsight.insight;
            if (ctx.sseRequested) {
              ctx.emitInsight(synthesisInsight);
            }
          } else {
            answer = buildFallbackAnswer({
              question: message,
              rowCount: result.rowCount,
              rows: result.rows,
              caveatText
            });
          }
        } else {
          assertNoLlmForDeterministic({
            generationSource,
            templateKey: selectedTemplateKey ?? undefined,
            callSite: "cachedSynthesize"
          });
          const synthSpan = startTrackedSpan(startSpan("synthesize_llm"));
          try {
            let synthAnswer: string;
            let synthReasoning: string | undefined;
            try {
              const contract = buildSynthesisContract({ runtime, rows: result.rows });
              synthesisContract = contract;
              // Phase 3: pick the shape template before kicking off
              // synthesis so the LLM sees few-shot examples matched
              // to the question type.
              const insightShape = pickInsightShape({
                message,
                questionType: runtime.questionType,
                generationSource
              });
              // F01 honesty clamp: a high-confidence pinned session is
              // authoritative — synthesis must never declare it absent.
              const resolvedSessionForSynthesis =
                runtime.resolution.selectedSession &&
                runtime.resolution.selectedSession.confidence >= 0.9
                  ? {
                      sessionKey: runtime.resolution.selectedSession.sessionKey,
                      label: runtime.resolution.selectedSession.label
                    }
                  : undefined;
              if (ctx.sseRequested) {
                ctx.emitStage({ kind: "synthesis_start", elapsedMs: Date.now() - startedAt });
                let streamedAnswer = "";
                let streamedReasoning: string | undefined;
                let streamedInsight: import("@/lib/chatTypes").InsightFields | null = null;
                for await (const chunk of synthesizeAnswerStream({
                  question: message,
                  sql: result.sql,
                  contract,
                  shape: insightShape,
                  resolvedSession: resolvedSessionForSynthesis
                })) {
                  if (chunk.kind === "answer_delta") {
                    ctx.emitDelta("answer_delta", chunk.text);
                  } else if (chunk.kind === "reasoning_delta") {
                    ctx.emitDelta("reasoning_delta", chunk.text);
                  } else if (chunk.kind === "final") {
                    streamedAnswer = chunk.answer;
                    streamedReasoning = chunk.reasoning;
                    streamedInsight = chunk.insight;
                  }
                }
                synthAnswer = streamedAnswer;
                synthReasoning = streamedReasoning;
                synthesisInsight = streamedInsight;
                // Emit insight as its own SSE frame so the client can
                // populate the card before the `final` frame lands.
                ctx.emitInsight(streamedInsight);
              } else {
                const synthesis = await cachedSynthesize({
                  question: message,
                  sql: result.sql,
                  contract,
                  shape: insightShape,
                  resolvedSession: resolvedSessionForSynthesis
                });
                synthAnswer = synthesis.answer;
                synthReasoning = synthesis.reasoning;
                // Non-SSE callers (benchmark) get insight only via
                // ChatApiResponse.insight — no SSE channel to emit on.
                synthesisInsight = synthesis.insight ?? null;
              }
              answer = synthAnswer;
              if (caveatText) {
                answer = `${answer}${caveatText}`;
              }
              answerReasoning = synthReasoning;
            } catch {
              answer = buildFallbackAnswer({
                question: message,
                rowCount: result.rowCount,
                rows: result.rows,
                caveatText
              });
            }
          } finally {
            endTrackedSpan(synthSpan);
          }
        }
      }

      if (result.rowCount > 0) {
        const sanitySpan = startTrackedSpan(startSpan("sanity_check"));
        let sanity: ReturnType<typeof applyAnswerSanityGuards>;
        try {
          sanity = applyAnswerSanityGuards({
            question: message,
            answer,
            rows: result.rows
          });
        } finally {
          endTrackedSpan(sanitySpan);
        }
        answer = sanity.answer;
        if (sanity.notes.length) {
          answerReasoning = [answerReasoning, ...sanity.notes].filter(Boolean).join(" | ");
        }
      }

      const quality = assessChatQuality({
        question: message,
        answer,
        generationSource,
        result,
        runtime
      });

      await logServer("INFO", "chat_query_success", {
        requestId,
        generationSource,
        model: model ?? null,
        questionType: runtime.questionType,
        resolutionStatus: runtime.resolution.status,
        selectedSessionKey: runtime.resolution.selectedSession?.sessionKey ?? null,
        rowCount: result.rowCount,
        elapsedMs: result.elapsedMs,
        adequacyGrade: quality.grade,
        hasAnswerReasoning: Boolean(answerReasoning),
        sessionPinKey: sessionPinKeyForTrace,
        sessionPinNote: sessionPinNoteForTrace,
        totalRequestMs: Date.now() - startedAt
      });
      await appendJsonLog("chat_transcript.jsonl", {
        requestId,
        question: message,
        answer,
        answerReasoning: answerReasoning ?? null,
        adequacyGrade: quality.grade,
        adequacyReason: quality.reason,
        responseGrade: quality.grade,
        gradeReason: quality.reason,
        generationSource,
        model: model ?? null,
        sql: result.sql,
        result: {
          rowCount: result.rowCount,
          elapsedMs: result.elapsedMs,
          truncated: result.truncated
        },
        runtime
      });
      const pitStintsValidation: PitStintsValidationResult | null = synthesisContract
        ? validatePitStints(answer, synthesisContract)
        : null;
      const sectorConsistencyValidation: SectorConsistencyValidationResult | null = synthesisContract
        ? validateSectorConsistency(answer, synthesisContract)
        : null;
      const gridFinishValidation: GridFinishValidationResult | null = synthesisContract
        ? validateGridFinish(answer, synthesisContract)
        : null;
      const strategyEvidenceValidation: StrategyEvidenceValidationResult | null = synthesisContract
        ? validateStrategyEvidence(answer, synthesisContract)
        : null;
      const countListParityValidation: CountListParityValidationResult | null = synthesisContract
        ? validateCountListParity(answer, synthesisContract)
        : null;

      // Phase 4 (roadmap_to_A_grade): answer-consistency validators GATE the
      // grade — they used to be trace-only. A validator that flags an
      // inconsistency between the answer's claims and the returned rows
      // (wrong pit count, contradicted sector/grid claim, count-vs-list
      // mismatch, …) caps adequacy at C and surfaces the reason, so a
      // factually-inconsistent answer can never ship as A/B.
      const answerValidators: ReadonlyArray<readonly [string, { ok: boolean; reasons: string[] } | null]> = [
        ["pit/stint consistency", pitStintsValidation],
        ["sector consistency", sectorConsistencyValidation],
        ["grid/finish consistency", gridFinishValidation],
        ["strategy evidence", strategyEvidenceValidation],
        ["count-vs-list parity", countListParityValidation]
      ];
      const failedValidators = answerValidators.filter(([, v]) => v !== null && !v.ok);
      if (failedValidators.length > 0) {
        const validatorReasons = failedValidators.flatMap(([name, v]) =>
          (v!.reasons.length ? v!.reasons : ["flagged an inconsistency"]).map((r) => `${name}: ${r}`)
        );
        if (quality.grade === "A" || quality.grade === "B") {
          quality.grade = "C";
        }
        quality.reason = [quality.reason, `answer-consistency validators flagged: ${validatorReasons.join("; ")}`]
          .filter(Boolean)
          .join(" | ");
        answerReasoning = [answerReasoning, `Consistency check flagged: ${validatorReasons.join("; ")}`]
          .filter(Boolean)
          .join(" | ");
      }

      await appendQueryTrace({
        status: "success",
        cache_hit: false,
        timeout: false,
        error: null,
        questionType: runtime.questionType,
        resolutionStatus: runtime.resolution.status,
        resolvedSessionKey: runtime.resolution.selectedSession?.sessionKey ?? resolvedContext.sessionKey ?? null,
        resolvedDriverNumbers: runtime.resolution.selectedDriverNumbers,
        sessionCandidates: runtime.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
          sessionKey: candidate.sessionKey,
          score: candidate.score,
          matchedOn: candidate.matchedOn
        })),
        queryPath: generationSourceForTrace ?? generationSource,
        templateKey: templateKeyForTrace,
        generationSource: generationSourceForTrace ?? generationSource,
        model: modelForTrace,
        sql: result.sql,
        sqlElapsedMs: result.elapsedMs,
        rowCount: result.rowCount,
        sessionPinKey: sessionPinKeyForTrace,
        sessionPinNote: sessionPinNoteForTrace,
        totalRequestMs: Date.now() - startedAt,
        runtimeMs: runtime.durationMs,
        autoResolutionNote: autoResolutionNoteForTrace,
        validators: { pitStints: pitStintsValidation, sectorConsistency: sectorConsistencyValidation, gridFinish: gridFinishValidation, strategyEvidence: strategyEvidenceValidation, countListParity: countListParityValidation }
      });

      const finalGenerationNotes = [generationNotes, sessionPinNoteForTrace]
        .filter(Boolean)
        .join(" | ");

      if (answerCacheKey && generationSource === "deterministic_template") {
        setAnswerCacheEntry(answerCacheKey, {
          answer,
          answerReasoning,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason,
          generationSource,
          model,
          generationNotes: finalGenerationNotes,
          sql: result.sql,
          insight: synthesisInsight,
          result: {
            sql: result.sql,
            rows: result.rows,
            rowCount: result.rowCount,
            truncated: result.truncated
          }
        });
      }

      return {
        payload: {
          requestId,
          answer,
          answerReasoning,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason,
          generationSource,
          model,
          generationNotes: finalGenerationNotes,
          sql: result.sql,
          result,
          runtime,
          // Phase 2: structured InsightFields. Null on cached / template /
          // refusal paths and on parse failures. Non-SSE clients consume
          // via this field; SSE clients also receive it via event: insight.
          insight: synthesisInsight
        },
        status: 200
      };
    } catch (error) {
      // Phase 19-A (rev4): narrow `runtime` to its proceed arm for the
      // catch's trace fields. The no_data_refusal arm returns early
      // before any of the SQL paths that can throw, so reaching here
      // with `runtime.kind === "no_data_refusal"` is unreachable, but
      // TS doesn't know that — the cast keeps the trace payload typed
      // without an exhaustive switch on every field access.
      const proceedRuntime: ChatRuntimeProceed | undefined =
        runtime && runtime.kind === "proceed" ? runtime : undefined;
      if (isTransientDatabaseAvailabilityError(error)) {
        const answer =
          "I could not query data right now because the database is temporarily unavailable (startup/recovery). Please retry in a moment.";
        const quality = assessChatQuality({
          question: message,
          answer,
          error: error instanceof Error ? error.message : String(error)
        });
        await logServer("WARN", "chat_query_temporarily_unavailable", {
          requestId,
          error: error instanceof Error ? error.message : String(error),
          totalRequestMs: Date.now() - startedAt
        });
        await appendJsonLog("chat_transcript.jsonl", {
          requestId,
          question: message,
          answer,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason,
          generationSource: "runtime_transient_db_unavailable",
          error: error instanceof Error ? error.message : String(error)
        });
        await appendQueryTrace({
          status: "transient_db_unavailable",
          timeout: false,
          error: error instanceof Error ? error.message : String(error),
          questionType: proceedRuntime?.questionType ?? null,
          resolutionStatus: proceedRuntime?.resolution.status ?? null,
          resolvedSessionKey: proceedRuntime?.resolution.selectedSession?.sessionKey ?? body.context?.sessionKey ?? null,
          resolvedDriverNumbers:
            proceedRuntime?.resolution.selectedDriverNumbers ??
            (body.context?.driverNumber !== undefined ? [body.context.driverNumber] : []),
          sessionCandidates: proceedRuntime?.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
            sessionKey: candidate.sessionKey,
            score: candidate.score,
            matchedOn: candidate.matchedOn
          })),
          queryPath: generationSourceForTrace ?? "runtime_transient_db_unavailable",
          templateKey: templateKeyForTrace,
          generationSource: generationSourceForTrace ?? "runtime_transient_db_unavailable",
          model: modelForTrace,
          sql: generatedSqlForTrace,
          sqlElapsedMs: lastSqlElapsedMsForTrace,
          rowCount: null,
          sessionPinKey: sessionPinKeyForTrace,
          sessionPinNote: sessionPinNoteForTrace,
          totalRequestMs: Date.now() - startedAt,
          runtimeMs: runtime?.durationMs ?? null,
          autoResolutionNote: autoResolutionNoteForTrace
        });
        return {
          payload: {
            requestId,
            answer,
            adequacyGrade: quality.grade,
            adequacyReason: quality.reason,
            responseGrade: quality.grade,
            gradeReason: quality.reason,
            generationSource: "runtime_transient_db_unavailable",
            model: null,
            sql: "-- query not executed (database temporarily unavailable)"
          },
          status: 200
        };
      }

      const quality = assessChatQuality({
        question: message,
        answer: "",
        error: error instanceof Error ? error.message : String(error)
      });
      await logServer("ERROR", "chat_query_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        totalRequestMs: Date.now() - startedAt
      });
      await appendJsonLog("chat_transcript.jsonl", {
        requestId,
        question: message,
        answer: null,
        adequacyGrade: quality.grade,
        adequacyReason: quality.reason,
        responseGrade: quality.grade,
        gradeReason: quality.reason,
        error: error instanceof Error ? error.message : String(error)
      });
      const errorMessage = error instanceof Error ? error.message : String(error);
      await appendQueryTrace({
        status: "error",
        timeout: errorMessage.toLowerCase().includes("statement timeout"),
        error: errorMessage,
        questionType: proceedRuntime?.questionType ?? null,
        resolutionStatus: proceedRuntime?.resolution.status ?? null,
        resolvedSessionKey: proceedRuntime?.resolution.selectedSession?.sessionKey ?? body.context?.sessionKey ?? null,
        resolvedDriverNumbers:
          proceedRuntime?.resolution.selectedDriverNumbers ??
          (body.context?.driverNumber !== undefined ? [body.context.driverNumber] : []),
        sessionCandidates: proceedRuntime?.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
          sessionKey: candidate.sessionKey,
          score: candidate.score,
          matchedOn: candidate.matchedOn
        })),
        queryPath: generationSourceForTrace ?? "runtime_failed_before_sql",
        templateKey: templateKeyForTrace,
        generationSource: generationSourceForTrace,
        model: modelForTrace,
        sql: generatedSqlForTrace,
        sqlElapsedMs: lastSqlElapsedMsForTrace,
        rowCount: null,
        sessionPinKey: sessionPinKeyForTrace,
        sessionPinNote: sessionPinNoteForTrace,
        totalRequestMs: Date.now() - startedAt,
        runtimeMs: runtime?.durationMs ?? null,
        autoResolutionNote: autoResolutionNoteForTrace
      });
      return {
        payload: {
          error: error instanceof Error ? error.message : "Chat query failed",
          requestId,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason
        },
        status: 400,
        asError: {
          message: error instanceof Error ? error.message : "Chat query failed",
          code: "chat_query_failed"
        }
      };
    }
  } finally {
    if (totalSpan) {
      openSpans.delete(totalSpan);
    }
    for (const span of openSpans) {
      traceRecords.push(span.end());
    }
    openSpans.clear();
    if (totalSpan) {
      traceRecords.push(totalSpan.end());
    }
    try {
      // Phase 18-B: forceFlush=traceEnabled so requests with debug.trace=true
      // always get the spans line written, regardless of production sampling.
      await flushTrace(requestId, traceRecords, { forceFlush: traceEnabled });
    } catch (flushErr) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "ERROR",
          event: "trace_flush_failed",
          requestId,
          error: flushErr instanceof Error ? flushErr.message : String(flushErr)
        })
      );
    }
  }
}
