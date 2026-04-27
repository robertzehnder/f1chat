import { NextResponse } from "next/server";
import {
  generateSqlWithAnthropic,
  repairSqlWithAnthropic,
  synthesizeAnswerWithAnthropic
} from "@/lib/anthropic";
import { buildHeuristicSql, runReadOnlySql } from "@/lib/queries";
import { buildDeterministicSqlTemplate } from "@/lib/deterministicSql";
import { buildChatRuntime, type ChatRuntimeResult } from "@/lib/chatRuntime";
import { assessChatQuality } from "@/lib/chatQuality";
import { applyAnswerSanityGuards, buildStructuredSummaryFromRows } from "@/lib/answerSanity";
import { appendJsonLog, logServer } from "@/lib/serverLog";
import { startSpan, flushTrace, type Span, type SpanRecord } from "@/lib/perfTrace";

export const dynamic = "force-dynamic";

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

function extractSessionKeyLiterals(sql: string): number[] {
  const values = new Set<number>();
  const pattern = /\bsession_key\s*=\s*(\d+)\b/gi;
  for (const match of sql.matchAll(pattern)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      values.add(Math.trunc(parsed));
    }
  }
  return Array.from(values).sort((a, b) => a - b);
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

export async function POST(request: Request) {
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

  try {
    totalSpan = startTrackedSpan(startSpan("total"));
    await logServer("INFO", "chat_request_received", { requestId });

    const intakeSpan = startTrackedSpan(startSpan("request_intake"));

    let body: ChatBody = {};
    try {
      body = await request.json();
    } catch {
      await logServer("WARN", "chat_invalid_json", { requestId });
      return NextResponse.json({ error: "Invalid JSON body", requestId }, { status: 400 });
    }

    const message = body.message?.trim();
    if (!message) {
      await logServer("WARN", "chat_missing_message", { requestId });
      return NextResponse.json({ error: "message is required", requestId }, { status: 400 });
    }

    endTrackedSpan(intakeSpan);

    const traceEnabled = traceEnabledForRequest(body);
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

    let runtime: ChatRuntimeResult | undefined;
    let generatedSqlForTrace: string | null = null;
    let generationSourceForTrace: string | null = null;
    let templateKeyForTrace: string | null = null;
    let modelForTrace: string | null = null;
    let autoResolutionNoteForTrace: string | null = null;
    let lastSqlElapsedMsForTrace: number | null = null;
    let sessionPinKeyForTrace: number | null = null;
    let sessionPinNoteForTrace: string | null = null;

    try {
      runtime = await buildChatRuntime({
        message,
        context: body.context,
        recordSpan: (record) => {
          traceRecords.push(record);
        }
      });
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
        return NextResponse.json({
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
        });
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

        return NextResponse.json({
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
        });
      }

      const resolvedContext = {
        sessionKey: runtime.resolution.requiresSession
          ? runtime.resolution.selectedSession?.sessionKey ?? body.context?.sessionKey
          : body.context?.sessionKey,
        driverNumber:
          runtime.resolution.selectedDriverNumbers[0] !== undefined
            ? runtime.resolution.selectedDriverNumbers[0]
            : body.context?.driverNumber
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
          generatedSql = buildHeuristicSql(message, resolvedContext);
          generationSource = "heuristic_fallback";
          generationNotes =
            error instanceof Error
              ? `SQL generation failed; heuristic fallback applied: ${error.message}`
              : "SQL generation failed; heuristic fallback applied.";
          await logServer("WARN", "chat_anthropic_fallback", {
            requestId,
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

      const executeSqlWithTrace = async (sql: string, queryPath: string, attemptLabel: string) => {
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
        const execDbSpan = startTrackedSpan(startSpan("execute_db"));
        try {
          const executed = await runReadOnlySql(sqlToExecute, { preview: true });
          endTrackedSpan(execDbSpan);
          generatedSqlForTrace = executed.sql;
          lastSqlElapsedMsForTrace = executed.elapsedMs ?? Date.now() - sqlStartedAt;
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

      let result: Awaited<ReturnType<typeof runReadOnlySql>>;
      try {
        result = await executeSqlWithTrace(generatedSql, generationSource, "initial");
      } catch (execError) {
        await logServer("WARN", "chat_query_first_attempt_failed", {
          requestId,
          generationSource,
          model: model ?? null,
          sql: generatedSql,
          error: execError instanceof Error ? execError.message : String(execError)
        });

        if (generationSource === "anthropic") {
          try {
            const repairSpan = startTrackedSpan(startSpan("repair_llm"));
            let repaired: Awaited<ReturnType<typeof repairSqlWithAnthropic>>;
            try {
              repaired = await repairSqlWithAnthropic({
                question: message,
                failingSql: generatedSql,
                dbError: execError instanceof Error ? execError.message : String(execError),
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
            result = await executeSqlWithTrace(generatedSql, generationSource, "repair_retry");
          } catch (repairError) {
            await logServer("WARN", "chat_query_repair_failed", {
              requestId,
              error: repairError instanceof Error ? repairError.message : String(repairError)
            });
            generatedSql = buildHeuristicSql(message, resolvedContext);
            generationSource = "heuristic_after_sql_failure";
            generatedSqlForTrace = generatedSql;
            generationSourceForTrace = generationSource;
            templateKeyForTrace = null;
            generationNotes = [generationNotes, "repair_failed_heuristic_used"].filter(Boolean).join(" | ");
            result = await executeSqlWithTrace(generatedSql, generationSource, "heuristic_after_repair_failure");
          }
        } else if (generationSource === "deterministic_template") {
          generatedSql = buildHeuristicSql(message, resolvedContext);
          generationSource = "heuristic_after_template_failure";
          generatedSqlForTrace = generatedSql;
          generationSourceForTrace = generationSource;
          templateKeyForTrace = null;
          generationNotes = [generationNotes, "template_failed_heuristic_used"].filter(Boolean).join(" | ");
          result = await executeSqlWithTrace(generatedSql, generationSource, "heuristic_after_template_failure");
        } else {
          throw execError;
        }
      }

      const caveatText = runtime.completeness.warnings.length
        ? ` Caveats: ${runtime.completeness.warnings.join(" ")}`
        : "";
      let answerReasoning: string | undefined;
      let answer =
        result.rowCount === 0
          ? `No rows matched this question with the current context.${caveatText}`
          : "";

      if (result.rowCount > 0) {
        const synthSpan = startTrackedSpan(startSpan("synthesize_llm"));
        try {
          const synthesis = await synthesizeAnswerWithAnthropic({
            question: message,
            sql: result.sql,
            rows: result.rows,
            rowCount: result.rowCount,
            runtime: {
              questionType: runtime.questionType,
              grain: runtime.grain.grain,
              resolvedEntities: runtime.queryPlan.resolved_entities,
              completenessWarnings: runtime.completeness.warnings
            }
          });
          answer = synthesis.answer;
          if (caveatText) {
            answer = `${answer}${caveatText}`;
          }
          answerReasoning = synthesis.reasoning;
        } catch {
          answer = buildFallbackAnswer({
            question: message,
            rowCount: result.rowCount,
            rows: result.rows,
            caveatText
          });
        } finally {
          endTrackedSpan(synthSpan);
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
      await appendQueryTrace({
        status: "success",
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
        autoResolutionNote: autoResolutionNoteForTrace
      });

      return NextResponse.json({
        requestId,
        answer,
        answerReasoning,
        adequacyGrade: quality.grade,
        adequacyReason: quality.reason,
        responseGrade: quality.grade,
        gradeReason: quality.reason,
        generationSource,
        model,
        generationNotes: [generationNotes, sessionPinNoteForTrace].filter(Boolean).join(" | "),
        sql: result.sql,
        result,
        runtime
      });
    } catch (error) {
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
          questionType: runtime?.questionType ?? null,
          resolutionStatus: runtime?.resolution.status ?? null,
          resolvedSessionKey: runtime?.resolution.selectedSession?.sessionKey ?? body.context?.sessionKey ?? null,
          resolvedDriverNumbers:
            runtime?.resolution.selectedDriverNumbers ??
            (body.context?.driverNumber !== undefined ? [body.context.driverNumber] : []),
          sessionCandidates: runtime?.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
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
        return NextResponse.json(
          {
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
          { status: 200 }
        );
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
        questionType: runtime?.questionType ?? null,
        resolutionStatus: runtime?.resolution.status ?? null,
        resolvedSessionKey: runtime?.resolution.selectedSession?.sessionKey ?? body.context?.sessionKey ?? null,
        resolvedDriverNumbers:
          runtime?.resolution.selectedDriverNumbers ??
          (body.context?.driverNumber !== undefined ? [body.context.driverNumber] : []),
        sessionCandidates: runtime?.resolution.sessionCandidates.slice(0, 5).map((candidate) => ({
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
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Chat query failed",
          requestId,
          adequacyGrade: quality.grade,
          adequacyReason: quality.reason,
          responseGrade: quality.grade,
          gradeReason: quality.reason
        },
        { status: 400 }
      );
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
      await flushTrace(requestId, traceRecords);
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
