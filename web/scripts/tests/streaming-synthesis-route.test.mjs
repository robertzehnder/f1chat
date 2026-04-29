import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const routeSourcePath = path.resolve(webRoot, "src/app/api/chat/route.ts");
const answerCacheSourcePath = path.resolve(webRoot, "src/lib/cache/answerCache.ts");

const NEXT_SERVER_STUB = `
export const NextResponse = {
  json(body, init = {}) {
    return {
      __isNextResponse: true,
      status: (init && init.status) || 200,
      _body: body,
      json: async () => body
    };
  }
};
`;

// Stub mirrors the real anthropic.ts exports the route imports. The new
// __setSynthesizeStreamImpl hook + synthesizeAnswerStream async-generator are
// required by step 6a of slice 07-streaming-synthesis-route-sse: chunks must
// match the real StreamChunk type at web/src/lib/anthropic.ts:520-523, whose
// discriminant is `kind` (NOT `type`) and whose final-chunk shape is
// { kind: "final", answer, reasoning?, model, rawText }. Using `type` here
// would produce tests that pass internally yet fail against the real stream.
const ANTHROPIC_STUB = `
const state = {
  counter: 0,
  generate: null,
  repair: null,
  synthesize: null,
  synthesizeStream: null
};
export function __getAnthropicCounter() { return state.counter; }
export function __resetAnthropicCounter() { state.counter = 0; }
export function __setGenerateSqlImpl(fn) { state.generate = fn; }
export function __setRepairSqlImpl(fn) { state.repair = fn; }
export function __setSynthesizeImpl(fn) { state.synthesize = fn; }
export function __setSynthesizeStreamImpl(fn) { state.synthesizeStream = fn; }
export function __resetAnthropic() {
  state.generate = null;
  state.repair = null;
  state.synthesize = null;
  state.synthesizeStream = null;
  state.counter = 0;
}
export async function generateSqlWithAnthropic(input) {
  state.counter += 1;
  if (state.generate) return state.generate(input);
  throw new Error("anthropic stub: generateSqlWithAnthropic not configured");
}
export async function repairSqlWithAnthropic(input) {
  state.counter += 1;
  if (state.repair) return state.repair(input);
  throw new Error("anthropic stub: repairSqlWithAnthropic not configured");
}
export async function synthesizeAnswerWithAnthropic(input) {
  state.counter += 1;
  if (state.synthesize) return state.synthesize(input);
  throw new Error("anthropic stub: synthesizeAnswerWithAnthropic not configured");
}
export async function* synthesizeAnswerStream(input) {
  state.counter += 1;
  if (!state.synthesizeStream) {
    throw new Error("anthropic stub: synthesizeAnswerStream not configured");
  }
  const iterable = state.synthesizeStream(input);
  for await (const chunk of iterable) {
    yield chunk;
  }
}
`;

const QUERIES_STUB = `
const state = { runImpl: null };
export function __setRunReadOnlySqlImpl(fn) { state.runImpl = fn; }
export function __resetQueries() { state.runImpl = null; }
export async function runReadOnlySql(sql, options) {
  if (state.runImpl) return state.runImpl(sql, options);
  throw new Error("queries stub: runReadOnlySql not configured");
}
export function buildHeuristicSql(message, ctx) {
  const sessionPart = (ctx && Number.isFinite(Number(ctx.sessionKey))) ? Math.trunc(Number(ctx.sessionKey)) : null;
  return sessionPart != null
    ? "SELECT 1 AS heuristic FROM core.sessions WHERE session_key = " + sessionPart
    : "SELECT 1 AS heuristic FROM core.sessions LIMIT 1";
}
`;

const DETERMINISTIC_SQL_STUB = `
const state = { impl: null };
export function __setBuildDeterministicSqlTemplateImpl(fn) { state.impl = fn; }
export function __resetDeterministic() { state.impl = null; }
export function buildDeterministicSqlTemplate(message, ctx) {
  if (state.impl) return state.impl(message, ctx);
  return null;
}
`;

const CHAT_RUNTIME_STUB = `
const state = { impl: null };
export function __setBuildChatRuntimeImpl(fn) { state.impl = fn; }
export function __resetChatRuntime() { state.impl = null; }
export async function buildChatRuntime(args) {
  if (state.impl) return state.impl(args);
  throw new Error("chatRuntime stub: buildChatRuntime not configured");
}
`;

const CHAT_QUALITY_STUB = `
export function assessChatQuality(args) {
  return { grade: "A", reason: "stubbed quality assessment" };
}
`;

const ANSWER_SANITY_STUB = `
export function applyAnswerSanityGuards(args) {
  return { answer: args.answer, notes: [] };
}
export function buildStructuredSummaryFromRows(args) {
  return "structured-summary-stub:" + (args && args.rowCount);
}
`;

const SERVER_LOG_STUB = `
const state = { server: [], json: [] };
export function __getServerLogCalls() { return state.server; }
export function __getJsonLogCalls() { return state.json; }
export function __resetServerLog() { state.server.length = 0; state.json.length = 0; }
export async function logServer(level, event, payload) {
  state.server.push({ level, event, payload });
}
export async function appendJsonLog(filename, payload) {
  state.json.push({ filename, payload });
}
`;

const PERF_TRACE_STUB = `
export function startSpan(name) {
  const startedAt = Date.now();
  return {
    name,
    end() {
      const endedAt = Date.now();
      return { name, startedAt, endedAt, durationMs: endedAt - startedAt };
    }
  };
}
export async function flushTrace(requestId, records) {
  return null;
}
`;

const ZERO_LLM_GUARD_STUB = `
export function assertNoLlmForDeterministic(args) {
  if (process.env.NODE_ENV === "production") return;
  if (args.generationSource !== "deterministic_template") return;
  throw new Error(
    "zero-llm-path violation: callSite=" + args.callSite +
    " templateKey=" + (args.templateKey == null ? "<unknown>" : args.templateKey)
  );
}
`;

async function loadRouteHarness() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-streaming-synthesis-route-"));

  const answerCacheSrc = await readFile(answerCacheSourcePath, "utf8");
  const answerCacheStubbed = answerCacheSrc
    .replace(/from\s+["']\.\.\/queries["']/g, `from "./queries.stub.mjs"`)
    .replace(/from\s+["']\.\.\/anthropic["']/g, `from "./anthropic.stub.mjs"`);
  const answerCacheTranspiled = ts.transpileModule(answerCacheStubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });

  const routeSrc = await readFile(routeSourcePath, "utf8");
  const routeStubbed = routeSrc
    .replace(/from\s+["']next\/server["']/g, `from "./next-server.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/cache\/answerCache["']/g, `from "./answerCache.mjs"`)
    .replace(/from\s+["']@\/lib\/anthropic["']/g, `from "./anthropic.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/queries["']/g, `from "./queries.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/deterministicSql["']/g, `from "./deterministicSql.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/chatRuntime["']/g, `from "./chatRuntime.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/chatQuality["']/g, `from "./chatQuality.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/answerSanity["']/g, `from "./answerSanity.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/serverLog["']/g, `from "./serverLog.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/perfTrace["']/g, `from "./perfTrace.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/zeroLlmGuard["']/g, `from "./zeroLlmGuard.stub.mjs"`);
  const routeTranspiled = ts.transpileModule(routeStubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });

  await writeFile(path.join(dir, "next-server.stub.mjs"), NEXT_SERVER_STUB, "utf8");
  await writeFile(path.join(dir, "anthropic.stub.mjs"), ANTHROPIC_STUB, "utf8");
  await writeFile(path.join(dir, "queries.stub.mjs"), QUERIES_STUB, "utf8");
  await writeFile(path.join(dir, "deterministicSql.stub.mjs"), DETERMINISTIC_SQL_STUB, "utf8");
  await writeFile(path.join(dir, "chatRuntime.stub.mjs"), CHAT_RUNTIME_STUB, "utf8");
  await writeFile(path.join(dir, "chatQuality.stub.mjs"), CHAT_QUALITY_STUB, "utf8");
  await writeFile(path.join(dir, "answerSanity.stub.mjs"), ANSWER_SANITY_STUB, "utf8");
  await writeFile(path.join(dir, "serverLog.stub.mjs"), SERVER_LOG_STUB, "utf8");
  await writeFile(path.join(dir, "perfTrace.stub.mjs"), PERF_TRACE_STUB, "utf8");
  await writeFile(path.join(dir, "zeroLlmGuard.stub.mjs"), ZERO_LLM_GUARD_STUB, "utf8");
  await writeFile(path.join(dir, "answerCache.mjs"), answerCacheTranspiled.outputText, "utf8");
  await writeFile(path.join(dir, "route.mjs"), routeTranspiled.outputText, "utf8");

  const route = await import(path.join(dir, "route.mjs"));
  const answerCache = await import(path.join(dir, "answerCache.mjs"));
  const queries = await import(path.join(dir, "queries.stub.mjs"));
  const anthropic = await import(path.join(dir, "anthropic.stub.mjs"));
  const deterministic = await import(path.join(dir, "deterministicSql.stub.mjs"));
  const chatRuntime = await import(path.join(dir, "chatRuntime.stub.mjs"));
  const serverLog = await import(path.join(dir, "serverLog.stub.mjs"));

  return { dir, route, answerCache, queries, anthropic, deterministic, chatRuntime, serverLog };
}

async function withRoute(run) {
  const loaded = await loadRouteHarness();
  try {
    await run(loaded);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

let runtimeCounter = 0;
function makeFakeRuntime({
  sessionKey = 9839,
  driverNumbers = [1, 16],
  year = 2025,
  needsClarification = false,
  clarificationPrompt,
  completenessAvailable = true,
  canProceedWithFallback = true,
  warnings = []
} = {}) {
  runtimeCounter += 1;
  return {
    questionType: "comparison_analysis",
    followUp: false,
    resolution: {
      status: "ok",
      requiresSession: true,
      needsClarification,
      clarificationPrompt,
      sessionCandidates: [],
      selectedSession: { sessionKey, score: 1, matchedOn: ["stub"] },
      driverCandidates: [],
      selectedDriverNumbers: driverNumbers,
      selectedDriverLabels: [],
      extracted: { year, driverNumberMentions: [], venueHints: [] }
    },
    completeness: {
      available: completenessAvailable,
      canProceedWithFallback,
      requiredTables: ["core.laps_enriched"],
      tableChecks: [],
      warnings,
      fallbackOptions: []
    },
    grain: { grain: "lap", expectedRowVolume: "small", recommendedTables: [] },
    queryPlan: { resolved_entities: {} },
    stageLogs: [],
    durationMs: runtimeCounter
  };
}

function buildPostRequest({ message, sse, rawBody } = {}) {
  const headers = { "content-type": "application/json" };
  if (sse) {
    headers["accept"] = "text/event-stream";
  }
  const body =
    rawBody !== undefined
      ? rawBody
      : JSON.stringify({ message: message ?? "Compare Max and Charles in Abu Dhabi 2025" });
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers,
    body
  });
}

// Step 6b: parse `text/event-stream` records using the option-(a) reader. Each
// SSE record is separated by the canonical `\n\n` terminator. For each block
// we collect `event:` and `data:` lines and JSON-parse the joined data.
function parseSseFrames(text) {
  const frames = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "";
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) {
        event = line.slice("event: ".length);
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.slice("data: ".length));
      }
    }
    let data = null;
    if (dataLines.length) {
      const joined = dataLines.join("\n");
      try {
        data = JSON.parse(joined);
      } catch {
        data = joined;
      }
    }
    frames.push({ event, data });
  }
  return frames;
}

async function postJson(loaded, args = {}) {
  const req = buildPostRequest({ ...args, sse: false });
  const response = await loaded.route.POST(req);
  const body = await response.json();
  return { status: response.status, body };
}

async function postSse(loaded, args = {}) {
  const req = buildPostRequest({ ...args, sse: true });
  const response = await loaded.route.POST(req);
  const text = await response.text();
  const frames = parseSseFrames(text);
  return { status: response.status, frames, text, contentType: response.headers.get("content-type") };
}

function resetAll(loaded) {
  loaded.answerCache.__resetAnswerCacheForTests();
  loaded.queries.__resetQueries();
  loaded.anthropic.__resetAnthropic();
  loaded.deterministic.__resetDeterministic();
  loaded.chatRuntime.__resetChatRuntime();
  loaded.serverLog.__resetServerLog();
}

async function withNodeEnv(value, fn) {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = original;
  }
}

// Strip per-call dynamic fields so SSE final-frame data can be deep-compared
// against the equivalent non-SSE JSON body (modulo whitespace, per slice plan).
// `requestId` is generated via crypto.randomUUID() per request, and the test
// stub increments runtime.durationMs per call, so neither is byte-equal across
// two separate invocations of the same logical branch.
function normalize(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  delete clone.requestId;
  if (clone.runtime && typeof clone.runtime === "object") {
    delete clone.runtime.durationMs;
  }
  return clone;
}

function expectSingleFinalFrame(frames) {
  const finalFrames = frames.filter((f) => f.event === "final");
  assert.equal(finalFrames.length, 1, `expected exactly 1 final frame, got ${finalFrames.length}`);
  const otherEvents = frames.filter((f) => f.event !== "final" && f.event !== "");
  assert.deepEqual(
    otherEvents.map((f) => f.event),
    [],
    `expected no non-final events on a non-LLM exit branch, got ${JSON.stringify(otherEvents.map((f) => f.event))}`
  );
  return finalFrames[0];
}

// ---------------------------------------------------------------------------
// Validation-error branch: invalid JSON body
// ---------------------------------------------------------------------------
test("validation-error (invalid JSON body) — non-SSE returns HTTP 400 JSON; SSE emits single final frame with same payload", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    const jsonResp = await loaded.route.POST(buildPostRequest({ rawBody: "{not-json", sse: false }));
    const jsonBody = await jsonResp.json();
    assert.equal(jsonResp.status, 400);
    assert.equal(jsonBody.error, "Invalid JSON body");

    resetAll(loaded);
    const sse = await postSse(loaded, { rawBody: "{not-json" });
    const finalFrame = expectSingleFinalFrame(sse.frames);
    assert.equal(finalFrame.data.error, "Invalid JSON body");
    assert.deepEqual(normalize(finalFrame.data), normalize(jsonBody));
    assert.match(sse.contentType ?? "", /text\/event-stream/);
  });
});

// ---------------------------------------------------------------------------
// Validation-error branch: missing message
// ---------------------------------------------------------------------------
test("validation-error (missing message) — non-SSE returns HTTP 400 JSON; SSE emits single final frame with same payload", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    const jsonResp = await loaded.route.POST(buildPostRequest({ rawBody: JSON.stringify({}), sse: false }));
    const jsonBody = await jsonResp.json();
    assert.equal(jsonResp.status, 400);
    assert.equal(jsonBody.error, "message is required");

    resetAll(loaded);
    const sse = await postSse(loaded, { rawBody: JSON.stringify({}) });
    const finalFrame = expectSingleFinalFrame(sse.frames);
    assert.equal(finalFrame.data.error, "message is required");
    assert.deepEqual(normalize(finalFrame.data), normalize(jsonBody));
  });
});

// ---------------------------------------------------------------------------
// Clarification branch
// ---------------------------------------------------------------------------
test("clarification branch — non-SSE JSON body matches SSE single final frame", async () => {
  await withRoute(async (loaded) => {
    const setup = (l) => {
      l.chatRuntime.__setBuildChatRuntimeImpl(async () =>
        makeFakeRuntime({
          needsClarification: true,
          clarificationPrompt: "Which session do you mean?"
        })
      );
    };

    resetAll(loaded);
    setup(loaded);
    const json = await postJson(loaded);
    assert.equal(json.status, 200);
    assert.equal(json.body.generationSource, "runtime_clarification");

    resetAll(loaded);
    setup(loaded);
    const sse = await postSse(loaded);
    const finalFrame = expectSingleFinalFrame(sse.frames);
    assert.equal(finalFrame.data.generationSource, "runtime_clarification");
    assert.deepEqual(normalize(finalFrame.data), normalize(json.body));
  });
});

// ---------------------------------------------------------------------------
// Completeness-blocked branch
// ---------------------------------------------------------------------------
test("completeness-blocked branch — non-SSE JSON body matches SSE single final frame", async () => {
  await withRoute(async (loaded) => {
    const setup = (l) => {
      l.chatRuntime.__setBuildChatRuntimeImpl(async () =>
        makeFakeRuntime({
          completenessAvailable: false,
          canProceedWithFallback: false,
          warnings: ["table missing"]
        })
      );
    };

    resetAll(loaded);
    setup(loaded);
    const json = await postJson(loaded);
    assert.equal(json.status, 200);
    assert.equal(json.body.generationSource, "runtime_unavailable");

    resetAll(loaded);
    setup(loaded);
    const sse = await postSse(loaded);
    const finalFrame = expectSingleFinalFrame(sse.frames);
    assert.equal(finalFrame.data.generationSource, "runtime_unavailable");
    assert.deepEqual(normalize(finalFrame.data), normalize(json.body));
  });
});

// ---------------------------------------------------------------------------
// Deterministic-template branch (cold, post 07-zero-llm-path-tighten)
// ---------------------------------------------------------------------------
test("deterministic-template branch (cold) — non-SSE JSON body matches SSE single final frame; no deltas emitted", async () => {
  await withRoute(async (loaded) => {
    const setup = (l) => {
      l.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
        templateKey: "fastest_lap_by_driver",
        sql: "SELECT 1 AS stub FROM core.sessions WHERE session_key = 9839"
      }));
      l.chatRuntime.__setBuildChatRuntimeImpl(async () => makeFakeRuntime());
      l.queries.__setRunReadOnlySqlImpl(async (sql) => ({
        sql,
        rows: [{ stub: 1 }],
        rowCount: 1,
        elapsedMs: 1,
        truncated: false
      }));
    };

    resetAll(loaded);
    setup(loaded);
    const json = await withNodeEnv("production", () => postJson(loaded));
    assert.equal(json.status, 200);
    assert.equal(json.body.generationSource, "deterministic_template");

    resetAll(loaded);
    setup(loaded);
    const sse = await withNodeEnv("production", () => postSse(loaded));
    const finalFrame = expectSingleFinalFrame(sse.frames);
    assert.equal(finalFrame.data.generationSource, "deterministic_template");
    assert.deepEqual(normalize(finalFrame.data), normalize(json.body));
    // No answer_delta / reasoning_delta on the deterministic-template path.
    assert.equal(
      sse.frames.filter((f) => f.event === "answer_delta").length,
      0,
      "deterministic-template path must not emit answer_delta frames"
    );
  });
});

// ---------------------------------------------------------------------------
// Answer-cache hit (warm) — pre-populate cache, then re-issue request
// ---------------------------------------------------------------------------
test("answer-cache hit (warm) — non-SSE JSON body matches SSE single final frame", async () => {
  await withRoute(async (loaded) => {
    const templateKey = "fastest_lap_by_driver";
    const setup = (l) => {
      l.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
        templateKey,
        sql: "SELECT 1 AS stub FROM core.sessions WHERE session_key = 9839"
      }));
      l.chatRuntime.__setBuildChatRuntimeImpl(async () => makeFakeRuntime());
      l.queries.__setRunReadOnlySqlImpl(async (sql) => ({
        sql,
        rows: [{ stub: 1 }],
        rowCount: 1,
        elapsedMs: 1,
        truncated: false
      }));
    };

    // First, warm the cache with a non-SSE request and capture the cache-hit body.
    resetAll(loaded);
    setup(loaded);
    await withNodeEnv("production", () => postJson(loaded)); // populates cache
    const jsonHit = await withNodeEnv("production", () => postJson(loaded)); // hits cache
    assert.equal(jsonHit.status, 200);
    assert.equal(jsonHit.body.generationSource, "deterministic_template");
    // cache hit's elapsedMs is forced to 0 by the route
    assert.equal(jsonHit.body.result.elapsedMs, 0);

    // Now re-warm and issue an SSE request that hits the cache.
    resetAll(loaded);
    setup(loaded);
    await withNodeEnv("production", () => postJson(loaded)); // populates cache
    const sse = await withNodeEnv("production", () => postSse(loaded));
    const finalFrame = expectSingleFinalFrame(sse.frames);
    assert.equal(finalFrame.data.generationSource, "deterministic_template");
    assert.equal(finalFrame.data.result.elapsedMs, 0);
    assert.deepEqual(normalize(finalFrame.data), normalize(jsonHit.body));
  });
});

// ---------------------------------------------------------------------------
// Synthesis (LLM) path — SSE emits ≥2 answer_delta + 1 final; non-SSE matches
// ---------------------------------------------------------------------------
test("synthesis path — SSE emits >=2 answer_delta + 1 final; non-SSE JSON identical to final-frame data", async () => {
  await withRoute(async (loaded) => {
    const ANSWER_PARTS = ["Lewis ", "Hamilton ", "won."];
    const REASONING_PARTS = ["He ", "had the ", "fastest pace."];
    const fullAnswer = ANSWER_PARTS.join("");
    const fullReasoning = REASONING_PARTS.join("");

    const setup = (l) => {
      // No deterministic template → falls through to anthropic SQL gen
      l.chatRuntime.__setBuildChatRuntimeImpl(async () =>
        makeFakeRuntime({ sessionKey: 100, driverNumbers: [1] })
      );
      l.anthropic.__setGenerateSqlImpl(async () => ({
        sql: "SELECT 1 AS stub FROM core.sessions WHERE session_key = 100",
        reasoning: "stub-llm-reasoning",
        model: "stub-anthropic-model"
      }));
      l.queries.__setRunReadOnlySqlImpl(async (sql) => ({
        sql,
        rows: [{ a: 1 }],
        rowCount: 1,
        elapsedMs: 1,
        truncated: false
      }));
      l.anthropic.__setSynthesizeImpl(async () => ({
        answer: fullAnswer,
        reasoning: fullReasoning
      }));
      // StreamChunk discriminant is `kind` (NOT `type`) per anthropic.ts:520-523.
      l.anthropic.__setSynthesizeStreamImpl(async function* () {
        for (const text of ANSWER_PARTS) {
          yield { kind: "answer_delta", text };
        }
        for (const text of REASONING_PARTS) {
          yield { kind: "reasoning_delta", text };
        }
        yield {
          kind: "final",
          answer: fullAnswer,
          reasoning: fullReasoning,
          model: "stub-anthropic-model",
          rawText: JSON.stringify({ answer: fullAnswer, reasoning: fullReasoning })
        };
      });
    };

    resetAll(loaded);
    setup(loaded);
    const json = await withNodeEnv("production", () => postJson(loaded));
    assert.equal(json.status, 200);
    assert.equal(json.body.generationSource, "anthropic");
    assert.equal(json.body.answer, fullAnswer);

    resetAll(loaded);
    setup(loaded);
    const sse = await withNodeEnv("production", () => postSse(loaded));

    const answerDeltas = sse.frames.filter((f) => f.event === "answer_delta");
    const reasoningDeltas = sse.frames.filter((f) => f.event === "reasoning_delta");
    const finals = sse.frames.filter((f) => f.event === "final");
    assert.ok(
      answerDeltas.length >= 2,
      `expected >=2 answer_delta frames, got ${answerDeltas.length}`
    );
    assert.ok(
      reasoningDeltas.length >= 1,
      `expected >=1 reasoning_delta frames, got ${reasoningDeltas.length}`
    );
    assert.equal(finals.length, 1, `expected exactly 1 final frame, got ${finals.length}`);

    // delta texts concatenate to the answer/reasoning the route emits in `final`.
    assert.equal(
      answerDeltas.map((f) => f.data.text).join(""),
      fullAnswer,
      "answer_delta texts must concatenate to the final answer"
    );
    assert.equal(
      reasoningDeltas.map((f) => f.data.text).join(""),
      fullReasoning,
      "reasoning_delta texts must concatenate to the streamed reasoning"
    );

    // SSE final frame data must equal non-SSE JSON body (modulo dynamic fields).
    assert.deepEqual(normalize(finals[0].data), normalize(json.body));
  });
});

// ---------------------------------------------------------------------------
// Transient-DB-unavailable branch — runReadOnlySql throws a startup/recovery
// error that isTransientDatabaseAvailabilityError() recognizes. Caller-visible
// final-response branch (status 200, generationSource =
// runtime_transient_db_unavailable) — must emit a single SSE final frame whose
// data equals the non-SSE JSON body.
// ---------------------------------------------------------------------------
test("transient-db-unavailable branch — non-SSE JSON body matches SSE single final frame", async () => {
  await withRoute(async (loaded) => {
    const setup = (l) => {
      l.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
        templateKey: "fastest_lap_by_driver",
        sql: "SELECT 1 AS stub FROM core.sessions WHERE session_key = 9839"
      }));
      l.chatRuntime.__setBuildChatRuntimeImpl(async () => makeFakeRuntime());
      // Throw a recognizable transient-DB error on every SQL call. The
      // template-path retry falls back to the heuristic SQL, which also
      // throws, so the error propagates to the outer transient-DB catch.
      l.queries.__setRunReadOnlySqlImpl(async () => {
        throw new Error("the database system is starting up");
      });
    };

    resetAll(loaded);
    setup(loaded);
    const json = await withNodeEnv("production", () => postJson(loaded));
    assert.equal(json.status, 200);
    assert.equal(json.body.generationSource, "runtime_transient_db_unavailable");
    assert.equal(json.body.model, null);
    assert.equal(json.body.sql, "-- query not executed (database temporarily unavailable)");

    resetAll(loaded);
    setup(loaded);
    const sse = await withNodeEnv("production", () => postSse(loaded));
    const finalFrame = expectSingleFinalFrame(sse.frames);
    assert.equal(finalFrame.data.generationSource, "runtime_transient_db_unavailable");
    assert.equal(finalFrame.data.model, null);
    assert.equal(finalFrame.data.sql, "-- query not executed (database temporarily unavailable)");
    assert.deepEqual(normalize(finalFrame.data), normalize(json.body));
    assert.match(sse.contentType ?? "", /text\/event-stream/);
  });
});

// ---------------------------------------------------------------------------
// Error path — generic catch (e.g. runtime build throws)
// ---------------------------------------------------------------------------
test("error path — non-SSE returns HTTP 4xx JSON; SSE emits error frame (no final)", async () => {
  await withRoute(async (loaded) => {
    const setup = (l) => {
      l.chatRuntime.__setBuildChatRuntimeImpl(async () => {
        throw new Error("simulated runtime failure");
      });
    };

    resetAll(loaded);
    setup(loaded);
    const jsonResp = await loaded.route.POST(buildPostRequest({ sse: false }));
    const jsonBody = await jsonResp.json();
    assert.equal(jsonResp.status, 400);
    assert.equal(jsonBody.error, "simulated runtime failure");

    resetAll(loaded);
    setup(loaded);
    const sse = await postSse(loaded);
    const errorFrames = sse.frames.filter((f) => f.event === "error");
    const finalFrames = sse.frames.filter((f) => f.event === "final");
    assert.equal(errorFrames.length, 1, `expected exactly 1 error frame, got ${errorFrames.length}`);
    assert.equal(finalFrames.length, 0, "error path must not emit a final frame");
    assert.equal(errorFrames[0].data.message, "simulated runtime failure");
    assert.equal(typeof errorFrames[0].data.code, "string");
    assert.ok(errorFrames[0].data.code.length > 0, "error frame must include a non-empty code");
  });
});

// ---------------------------------------------------------------------------
// SSE detection — Accept header drives the branching, not the body
// ---------------------------------------------------------------------------
test("Accept header gating — same body without Accept: text/event-stream returns JSON; with header streams SSE", async () => {
  await withRoute(async (loaded) => {
    const setup = (l) => {
      l.chatRuntime.__setBuildChatRuntimeImpl(async () =>
        makeFakeRuntime({ needsClarification: true, clarificationPrompt: "Clarify?" })
      );
    };

    resetAll(loaded);
    setup(loaded);
    const jsonResp = await loaded.route.POST(buildPostRequest({ sse: false }));
    assert.ok(jsonResp.__isNextResponse, "non-SSE response must be a NextResponse mock");

    resetAll(loaded);
    setup(loaded);
    const sseResp = await loaded.route.POST(buildPostRequest({ sse: true }));
    assert.match(
      sseResp.headers.get("content-type") ?? "",
      /text\/event-stream/,
      "SSE-opted response must carry text/event-stream content-type"
    );
  });
});
