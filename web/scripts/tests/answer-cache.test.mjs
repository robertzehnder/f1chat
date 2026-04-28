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

const ANTHROPIC_STUB = `
const state = { generate: null, repair: null, synthesize: null };
export function __setGenerateSqlImpl(fn) { state.generate = fn; }
export function __setRepairSqlImpl(fn) { state.repair = fn; }
export function __setSynthesizeImpl(fn) { state.synthesize = fn; }
export function __resetAnthropic() { state.generate = null; state.repair = null; state.synthesize = null; }
export async function generateSqlWithAnthropic(input) {
  if (state.generate) return state.generate(input);
  throw new Error("anthropic stub: generateSqlWithAnthropic not configured");
}
export async function repairSqlWithAnthropic(input) {
  if (state.repair) return state.repair(input);
  throw new Error("anthropic stub: repairSqlWithAnthropic not configured");
}
export async function synthesizeAnswerWithAnthropic(input) {
  if (state.synthesize) return state.synthesize(input);
  throw new Error("anthropic stub: synthesizeAnswerWithAnthropic not configured");
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

async function loadRouteAndCacheModule() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-answer-cache-"));

  // Transpile answerCache.ts and rewrite its relative imports to local stubs.
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

  // Transpile route.ts and rewrite all `@/lib/...` imports + `next/server` to local stubs / the real answerCache.
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
    .replace(/from\s+["']@\/lib\/perfTrace["']/g, `from "./perfTrace.stub.mjs"`);
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
  await writeFile(path.join(dir, "answerCache.mjs"), answerCacheTranspiled.outputText, "utf8");
  await writeFile(path.join(dir, "route.mjs"), routeTranspiled.outputText, "utf8");

  const route = await import(path.join(dir, "route.mjs"));
  const answerCache = await import(path.join(dir, "answerCache.mjs"));
  const queries = await import(path.join(dir, "queries.stub.mjs"));
  const anthropic = await import(path.join(dir, "anthropic.stub.mjs"));
  const deterministic = await import(path.join(dir, "deterministicSql.stub.mjs"));
  const chatRuntime = await import(path.join(dir, "chatRuntime.stub.mjs"));
  const serverLog = await import(path.join(dir, "serverLog.stub.mjs"));

  return {
    dir,
    route,
    answerCache,
    queries,
    anthropic,
    deterministic,
    chatRuntime,
    serverLog
  };
}

async function withRoute(run) {
  const loaded = await loadRouteAndCacheModule();
  try {
    await run(loaded);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

async function loadAnswerCacheOnly() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-answer-cache-only-"));
  const sourceText = await readFile(answerCacheSourcePath, "utf8");
  const stubbedSource = sourceText
    .replace(/from\s+["']\.\.\/queries["']/g, `from "./queries.stub.mjs"`)
    .replace(/from\s+["']\.\.\/anthropic["']/g, `from "./anthropic.stub.mjs"`);
  const transpiled = ts.transpileModule(stubbedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "queries.stub.mjs"), QUERIES_STUB, "utf8");
  await writeFile(path.join(dir, "anthropic.stub.mjs"), ANTHROPIC_STUB, "utf8");
  await writeFile(path.join(dir, "answerCache.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "answerCache.mjs"));
  return { dir, mod };
}

async function withAnswerCacheOnly(run) {
  const loaded = await loadAnswerCacheOnly();
  try {
    await run(loaded.mod);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

const DETERMINISTIC_TEMPLATE = "max_leclerc_lap_pace_summary";
const DETERMINISTIC_SQL =
  "SELECT pace_ms FROM core.laps_enriched WHERE session_key = 9839 AND driver_number IN (1, 16)";

let runtimeCounter = 0;
function makeFakeRuntime({ sessionKey, driverNumbers, year } = {}) {
  runtimeCounter += 1;
  return {
    questionType: "comparison_analysis",
    followUp: false,
    resolution: {
      status: "ok",
      requiresSession: true,
      needsClarification: false,
      sessionCandidates: [],
      selectedSession: {
        sessionKey: sessionKey ?? 9839,
        score: 1,
        matchedOn: ["stub"]
      },
      driverCandidates: [],
      selectedDriverNumbers: driverNumbers ?? [1, 16],
      selectedDriverLabels: [],
      extracted: {
        year: year ?? 2025,
        driverNumberMentions: [],
        venueHints: []
      }
    },
    completeness: {
      available: true,
      canProceedWithFallback: true,
      requiredTables: ["core.laps_enriched"],
      tableChecks: [],
      warnings: [],
      fallbackOptions: []
    },
    grain: { grain: "lap", expectedRowVolume: "small", recommendedTables: [] },
    queryPlan: { resolved_entities: {} },
    stageLogs: [],
    durationMs: runtimeCounter // unique per-call value so deep-equality detects regeneration
  };
}

function configureDeterministicHappyPath(loaded, opts = {}) {
  const sessionKey = opts.sessionKey ?? 9839;
  const driverNumbers = opts.driverNumbers ?? [1, 16];
  const year = opts.year ?? 2025;
  loaded.deterministic.__resetDeterministic();
  loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
    templateKey: opts.templateKey ?? DETERMINISTIC_TEMPLATE,
    sql: opts.sql ?? DETERMINISTIC_SQL
  }));
  loaded.chatRuntime.__resetChatRuntime();
  loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
    makeFakeRuntime({ sessionKey, driverNumbers, year })
  );
}

function buildPostRequest(message = "Compare Max and Charles in Abu Dhabi 2025") {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, debug: { trace: true } })
  });
}

function pickResponseSubset(response) {
  const subset = {
    answer: response.answer,
    answerReasoning: response.answerReasoning,
    adequacyGrade: response.adequacyGrade,
    adequacyReason: response.adequacyReason,
    responseGrade: response.responseGrade,
    gradeReason: response.gradeReason,
    generationSource: response.generationSource,
    model: response.model,
    generationNotes: response.generationNotes,
    sql: response.sql
  };
  if (response.result && typeof response.result === "object") {
    const { sql, rows, rowCount, truncated } = response.result;
    subset.result = { sql, rows, rowCount, truncated };
  }
  return subset;
}

function pickPerRequestMeta(response) {
  return {
    requestId: response.requestId,
    runtime: response.runtime,
    elapsedMs: response.result ? response.result.elapsedMs : undefined
  };
}

function findCacheHitTraceEntries(serverLog) {
  return serverLog
    .__getJsonLogCalls()
    .filter((call) => call.filename === "chat_query_trace.jsonl")
    .map((call) => ({
      status: call.payload && call.payload.status,
      cache_hit: call.payload && call.payload.cache_hit
    }));
}

async function postChat(loaded, args = {}) {
  const before = loaded.serverLog.__getJsonLogCalls().length;
  const req = buildPostRequest(args.message);
  const response = await loaded.route.POST(req);
  const body = await response.json();
  const newJsonCalls = loaded.serverLog.__getJsonLogCalls().slice(before);
  const traceEntries = newJsonCalls
    .filter((call) => call.filename === "chat_query_trace.jsonl")
    .map((call) => call.payload);
  return { status: response.status, body, traceEntries };
}

function resetAll(loaded) {
  loaded.answerCache.__resetAnswerCacheForTests();
  loaded.queries.__resetQueries();
  loaded.anthropic.__resetAnthropic();
  loaded.deterministic.__resetDeterministic();
  loaded.chatRuntime.__resetChatRuntime();
  loaded.serverLog.__resetServerLog();
}

test("two identical deterministic requests via real route: SQL spy = 1, synth spy <= 1, second response's deterministic subset deep-equals first, per-request metadata regenerated, top-level keys identical, second trace emits cache_hit=true", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    configureDeterministicHappyPath(loaded);

    let runSqlCalls = 0;
    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql, options) => {
      runSqlCalls += 1;
      return {
        sql,
        rows: [{ pace_ms: 81234 }],
        rowCount: 1,
        elapsedMs: 13 + runSqlCalls,
        truncated: false
      };
    };
    let synthCalls = 0;
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => {
      synthCalls += 1;
      return { answer: "Max averaged 81.234s", reasoning: "synth-reasoning" };
    };

    const first = await postChat(loaded);
    const second = await postChat(loaded);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(
      runSqlCalls,
      1,
      "real route's cachedRunSql must invoke the SQL stub exactly once across two identical deterministic-template requests (the second hits the cache)"
    );
    assert.ok(
      synthCalls <= 1,
      "real route's cachedSynthesize must invoke the synthesis stub at most once across the pair"
    );

    assert.deepEqual(
      pickResponseSubset(second.body),
      pickResponseSubset(first.body),
      "deterministic-derived response subset must deep-equal between miss and hit when produced by the real route"
    );

    const firstMeta = pickPerRequestMeta(first.body);
    const secondMeta = pickPerRequestMeta(second.body);
    assert.notEqual(firstMeta.requestId, secondMeta.requestId, "requestId must be regenerated by the real route on hit");
    assert.notDeepEqual(firstMeta.runtime, secondMeta.runtime, "runtime must be regenerated by the real route on hit");
    assert.notEqual(
      firstMeta.elapsedMs,
      secondMeta.elapsedMs,
      "result.elapsedMs must be regenerated on hit (real route resets to 0; never replayed from miss)"
    );

    const firstKeys = Object.keys(first.body).sort();
    const secondKeys = Object.keys(second.body).sort();
    assert.deepEqual(secondKeys, firstKeys, "real route's miss and hit responses must have identical top-level key sets");

    const cache_hit_emissions = [first, second].map((r) =>
      r.traceEntries.length ? r.traceEntries[r.traceEntries.length - 1].cache_hit : null
    );
    assert.deepEqual(
      cache_hit_emissions,
      [false, true],
      "real route's appendQueryTrace must emit cache_hit=false then cache_hit=true on the second identical request"
    );
  });
});

test("trace assertion via real route: first call's appendQueryTrace emits cache_hit=false; identical second call emits cache_hit=true", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    configureDeterministicHappyPath(loaded, { sessionKey: 100, driverNumbers: [1] });

    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => ({
      sql,
      rows: [{ a: 1 }],
      rowCount: 1,
      elapsedMs: 4,
      truncated: false
    });
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => ({
      answer: "an",
      reasoning: "r"
    });

    const first = await postChat(loaded);
    const second = await postChat(loaded);
    assert.equal(first.traceEntries.at(-1).cache_hit, false);
    assert.equal(second.traceEntries.at(-1).cache_hit, true);
  });
});

test("key distinctness via real route: differing sessionKey / sortedDriverNumbers / year all produce two misses (SQL spy = 2 per pairing)", async () => {
  // pairing A: differs only in sessionKey
  await withRoute(async (loaded) => {
    resetAll(loaded);
    let runSqlCalls = 0;
    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => {
      runSqlCalls += 1;
      return { sql, rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
    };
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => ({
      answer: "a",
      reasoning: "r"
    });
    loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
      templateKey: DETERMINISTIC_TEMPLATE,
      sql: DETERMINISTIC_SQL
    }));
    let nextSession = 1000;
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: nextSession, driverNumbers: [1, 16], year: 2025 })
    );
    await postChat(loaded);
    nextSession = 1001;
    await postChat(loaded);
    assert.equal(
      runSqlCalls,
      2,
      "different sessionKey must occupy distinct cache slots → two SQL invocations through the real route"
    );
  });

  // pairing B: differs only in sortedDriverNumbers
  await withRoute(async (loaded) => {
    resetAll(loaded);
    let runSqlCalls = 0;
    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => {
      runSqlCalls += 1;
      return { sql, rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
    };
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => ({
      answer: "a",
      reasoning: "r"
    });
    loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
      templateKey: DETERMINISTIC_TEMPLATE,
      sql: DETERMINISTIC_SQL
    }));
    let nextDrivers = [1, 16];
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 9000, driverNumbers: nextDrivers, year: 2025 })
    );
    await postChat(loaded);
    nextDrivers = [4, 81];
    await postChat(loaded);
    assert.equal(
      runSqlCalls,
      2,
      "different sortedDriverNumbers must occupy distinct cache slots → two SQL invocations through the real route"
    );
  });

  // pairing C: differs only in year
  await withRoute(async (loaded) => {
    resetAll(loaded);
    let runSqlCalls = 0;
    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => {
      runSqlCalls += 1;
      return { sql, rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
    };
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => ({
      answer: "a",
      reasoning: "r"
    });
    loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
      templateKey: DETERMINISTIC_TEMPLATE,
      sql: DETERMINISTIC_SQL
    }));
    let nextYear = 2024;
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 9000, driverNumbers: [1, 16], year: nextYear })
    );
    await postChat(loaded);
    nextYear = 2025;
    await postChat(loaded);
    assert.equal(
      runSqlCalls,
      2,
      "different year must occupy distinct cache slots → two SQL invocations through the real route (year is part of the cache key)"
    );
  });
});

test("sortedDriverNumbers order-insensitivity (unit-level via buildAnswerCacheKey): [16,1] and [1,16] collapse to the same key", async () => {
  await withAnswerCacheOnly(async (mod) => {
    const k1 = mod.buildAnswerCacheKey({
      templateKey: DETERMINISTIC_TEMPLATE,
      sessionKey: 7000,
      sortedDriverNumbers: [16, 1],
      year: 2025
    });
    const k2 = mod.buildAnswerCacheKey({
      templateKey: DETERMINISTIC_TEMPLATE,
      sessionKey: 7000,
      sortedDriverNumbers: [1, 16],
      year: 2025
    });
    assert.equal(k1, k2, "[16,1] and [1,16] must collapse to the same cache key (normalizer sorts defensively)");
  });
});

test("TTL expiry via real route: same key re-misses after fake-time advance past 10min; SQL spy increments again; trace re-emits cache_hit=false then cache_hit=true on follow-up", async (t) => {
  await withRoute(async (loaded) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
    try {
      resetAll(loaded);
      configureDeterministicHappyPath(loaded, { sessionKey: 555, driverNumbers: [1, 16], year: 2025 });

      let runSqlCalls = 0;
      loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => {
        runSqlCalls += 1;
        return { sql, rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
      };
      let synthCalls = 0;
      loaded.answerCache.__answerCacheTestHooks.synthesize = async () => {
        synthCalls += 1;
        return { answer: "a", reasoning: "r" };
      };

      const first = await postChat(loaded);
      assert.equal(first.traceEntries.at(-1).cache_hit, false);
      assert.equal(runSqlCalls, 1);

      // within TTL — still hits
      t.mock.timers.tick(5 * 60 * 1000);
      const within = await postChat(loaded);
      assert.equal(within.traceEntries.at(-1).cache_hit, true);
      assert.equal(runSqlCalls, 1, "lookup within TTL must not re-invoke the real route's cachedRunSql");

      // past TTL — must re-miss
      t.mock.timers.tick(6 * 60 * 1000); // total advance ~ 11min
      const afterExpiry = await postChat(loaded);
      assert.equal(
        afterExpiry.traceEntries.at(-1).cache_hit,
        false,
        "post-TTL request must re-emit cache_hit=false through the real route's appendQueryTrace"
      );
      assert.equal(runSqlCalls, 2, "post-TTL miss must re-invoke the SQL spy");
      assert.ok(synthCalls >= 2, "post-TTL miss must re-invoke synthesize at least once more");

      // follow-up identical → hit again
      const followUp = await postChat(loaded);
      assert.equal(followUp.traceEntries.at(-1).cache_hit, true, "follow-up after re-miss must hit");
    } finally {
      t.mock.timers.reset();
    }
  });
});

test("non-deterministic bypass via real route: requests with no templateKey neither read nor write the cache (SQL spy increments every call; no cache_hit=true emitted)", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    // deterministic returns null → non-deterministic path
    loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => null);
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 100, driverNumbers: [1], year: 2025 })
    );
    // route falls through to generateSqlWithAnthropic on non-deterministic
    loaded.anthropic.__setGenerateSqlImpl(async () => ({
      sql: "SELECT 1 AS bypass FROM core.sessions WHERE session_key = 100",
      reasoning: "stub-llm-reasoning",
      model: "stub-anthropic-model"
    }));

    let runSqlCalls = 0;
    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => {
      runSqlCalls += 1;
      return { sql, rows: [{ a: 1 }], rowCount: 1, elapsedMs: 1, truncated: false };
    };
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => ({
      answer: "non-det answer",
      reasoning: "r"
    });

    const first = await postChat(loaded);
    const second = await postChat(loaded);
    const third = await postChat(loaded);

    assert.equal(runSqlCalls, 3, "non-deterministic real-route requests must invoke SQL on every call");
    for (const r of [first, second, third]) {
      assert.notEqual(
        r.traceEntries.at(-1).cache_hit,
        true,
        "real route must never emit cache_hit=true for non-deterministic requests"
      );
    }

    // also assert: buildAnswerCacheKey returns null for missing templateKey (the predicate the route relies on)
    assert.equal(
      loaded.answerCache.buildAnswerCacheKey({
        templateKey: null,
        sessionKey: 100,
        sortedDriverNumbers: [1],
        year: 2025
      }),
      null,
      "buildAnswerCacheKey must return null when templateKey is missing"
    );
  });
});

test("failed-deterministic / heuristic-fallback bypass via real route: throwing runSql triggers the route's heuristic_after_template_failure branch; no cache write; subsequent identical request still misses; once the deterministic-success path completes, the cache populates and the next identical request hits", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    configureDeterministicHappyPath(loaded, { sessionKey: 9999, driverNumbers: [1, 16], year: 2025 });

    // runSql throws on the first deterministic attempt, succeeds otherwise
    let runSqlCalls = 0;
    let runSqlMode = "throw_on_deterministic";
    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => {
      runSqlCalls += 1;
      if (runSqlMode === "throw_on_deterministic" && /core\.laps_enriched/.test(sql)) {
        throw new Error("simulated postgres failure for deterministic SQL");
      }
      return {
        sql,
        rows: [{ a: 1 }],
        rowCount: 1,
        elapsedMs: 4,
        truncated: false
      };
    };
    let synthCalls = 0;
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => {
      synthCalls += 1;
      return { answer: "real-or-fallback", reasoning: "r" };
    };

    // 1) deterministic SQL fails → real route falls into heuristic_after_template_failure
    const fallbackResp = await postChat(loaded);
    assert.equal(
      fallbackResp.body.generationSource,
      "heuristic_after_template_failure",
      "real route must flip generationSource to heuristic_after_template_failure when deterministic SQL throws"
    );
    assert.equal(fallbackResp.traceEntries.at(-1).cache_hit, false);
    assert.equal(runSqlCalls, 2, "real route invokes runSql twice on the deterministic-failure → heuristic-success path");

    // 2) follow-up identical request must still miss (no entry was written, because gate is generationSource === 'deterministic_template')
    const followMiss = await postChat(loaded);
    assert.equal(
      followMiss.body.generationSource,
      "heuristic_after_template_failure",
      "follow-up identical request still flips to heuristic_after_template_failure (deterministic SQL still throws)"
    );
    assert.equal(
      followMiss.traceEntries.at(-1).cache_hit,
      false,
      "real route must re-emit cache_hit=false on the follow-up since no entry was written"
    );
    assert.equal(runSqlCalls, 4, "SQL spy increments by two more (det-throw + heuristic-success) on the follow-up");

    // 3) Now make the deterministic SQL succeed; deterministic-success path populates the cache
    runSqlMode = "ok";
    const successResp = await postChat(loaded);
    assert.equal(successResp.body.generationSource, "deterministic_template");
    assert.equal(runSqlCalls, 5, "deterministic-success run invokes the SQL spy exactly once more");
    assert.equal(successResp.traceEntries.at(-1).cache_hit, false, "first deterministic-success is still a miss");

    // 4) follow-up identical → hit
    const finalHit = await postChat(loaded);
    assert.equal(finalHit.traceEntries.at(-1).cache_hit, true, "real route must emit cache_hit=true on the follow-up");
    assert.equal(runSqlCalls, 5, "real route's cachedRunSql must NOT be re-invoked on the follow-up cache hit");
    const synthCallsAtFinalHit = synthCalls;
    void synthCallsAtFinalHit; // synth invocation parity with miss/hit is enforced by criterion-1 test above
  });
});

test("buildAnswerCacheKey collapses for templateKey-only inputs (Abu-Dhabi-baked templates): undefined sessionKey/sortedDriverNumbers/year produce stable placeholder segments", async () => {
  await withAnswerCacheOnly(async (mod) => {
    const baseline = mod.buildAnswerCacheKey({
      templateKey: "canonical_id_lookup_abu_dhabi_2025_race"
    });
    const repeated = mod.buildAnswerCacheKey({
      templateKey: "canonical_id_lookup_abu_dhabi_2025_race"
    });
    assert.equal(baseline, repeated, "templateKey-only inputs must produce a stable key");
    assert.match(baseline, /canonical_id_lookup_abu_dhabi_2025_race/);
    assert.match(baseline, /_no_session/);
    assert.match(baseline, /_no_drivers/);
    assert.match(baseline, /_no_year/);
  });
});

test("__answerCacheConfig exposes 10-min TTL and 500-entry max, matching the slice spec", async () => {
  await withAnswerCacheOnly(async (mod) => {
    assert.equal(mod.__answerCacheConfig.ttlMs, 10 * 60 * 1000);
    assert.equal(mod.__answerCacheConfig.max, 500);
  });
});
