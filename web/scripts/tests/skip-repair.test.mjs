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
const zeroLlmGuardSourcePath = path.resolve(webRoot, "src/lib/zeroLlmGuard.ts");

const DETERMINISTIC_KEYS = [
  "abu_dhabi_weekend_smallest_spread_and_comparison",
  "canonical_id_lookup_abu_dhabi_2025_race",
  "fastest_lap_by_driver"
];

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
const state = { counter: 0, generate: null, repair: null, synthesize: null, synthesizeStream: null };
export function __getAnthropicCounter() { return state.counter; }
export function __resetAnthropicCounter() { state.counter = 0; }
export function __setGenerateSqlImpl(fn) { state.generate = fn; }
export function __setRepairSqlImpl(fn) { state.repair = fn; }
export function __setSynthesizeImpl(fn) { state.synthesize = fn; }
export function __setSynthesizeStreamImpl(fn) { state.synthesizeStream = fn; }
export function __resetAnthropic() {
  state.generate = null; state.repair = null; state.synthesize = null; state.synthesizeStream = null; state.counter = 0;
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

const FACT_CONTRACT_STUB = `
export function serializeRowsToFactContract(input) {
  const result = {
    contractName: input.contractName,
    grain: input.grain,
    keys: input.keys,
    rows: input.rows,
    rowCount: input.rows.length
  };
  if (input.coverage !== undefined) result.coverage = input.coverage;
  return Object.freeze(result);
}
`;

async function loadRouteHarness() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-skip-repair-"));

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
    .replace(/from\s+["']@\/lib\/zeroLlmGuard["']/g, `from "./zeroLlmGuard.stub.mjs"`)
    .replace(/from\s+["']@\/lib\/contracts\/factContract["']/g, `from "./factContract.stub.mjs"`);
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
  await writeFile(path.join(dir, "factContract.stub.mjs"), FACT_CONTRACT_STUB, "utf8");
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

async function loadGuardModule() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-skip-repair-guard-"));
  const src = await readFile(zeroLlmGuardSourcePath, "utf8");
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "zeroLlmGuard.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "zeroLlmGuard.mjs"));
  return { dir, mod };
}

async function withGuardModule(run) {
  const loaded = await loadGuardModule();
  try {
    await run(loaded.mod);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

let runtimeCounter = 0;
function makeFakeRuntime({ sessionKey = 9839, driverNumbers = [1, 16], year = 2025 } = {}) {
  runtimeCounter += 1;
  return {
    questionType: "comparison_analysis",
    followUp: false,
    resolution: {
      status: "ok",
      requiresSession: true,
      needsClarification: false,
      sessionCandidates: [],
      selectedSession: { sessionKey, score: 1, matchedOn: ["stub"] },
      driverCandidates: [],
      selectedDriverNumbers: driverNumbers,
      selectedDriverLabels: [],
      extracted: { year, driverNumberMentions: [], venueHints: [] }
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
    queryPlan: { resolved_entities: {}, primary_tables: ["core.laps_enriched"] },
    stageLogs: [],
    durationMs: runtimeCounter
  };
}

function buildPostRequest(message = "Compare Max and Charles in Abu Dhabi 2025") {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message })
  });
}

async function postChat(loaded, args = {}) {
  const req = buildPostRequest(args.message);
  const response = await loaded.route.POST(req);
  const body = await response.json();
  return { status: response.status, body };
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

test("deterministic SQL exec failure falls back to heuristic without invoking LLM repair", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);

    loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
      templateKey: DETERMINISTIC_KEYS[0],
      sql: "SELECT 1 FROM core.sessions WHERE session_key = 9839"
    }));
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 9839 })
    );

    // The route's post-recovery synthesize path runs for `heuristic_after_template_failure`.
    // Route the synth call through answerCache's DI hook so it does not increment the anthropic
    // counter, leaving the counter as a clean signal for repair/generate calls only.
    loaded.answerCache.__answerCacheTestHooks.synthesize = async () => ({
      answer: "no-llm synth stub",
      reasoning: "no-llm synth stub"
    });

    let runCallCount = 0;
    loaded.queries.__setRunReadOnlySqlImpl(async (sql) => {
      runCallCount += 1;
      if (runCallCount === 1) {
        throw new Error("simulated SQL exec failure");
      }
      return {
        sql,
        rows: [{ stub_col: 1 }],
        rowCount: 1,
        elapsedMs: 1,
        truncated: false
      };
    });

    const { status, body } = await withNodeEnv("production", async () => postChat(loaded));

    assert.equal(status, 200);
    assert.equal(body.generationSource, "heuristic_after_template_failure");
    assert.equal(
      loaded.anthropic.__getAnthropicCounter(),
      0,
      `expected zero LLM calls on deterministic-source failure path, got ${loaded.anthropic.__getAnthropicCounter()}`
    );
  });
});

test("anthropic SQL exec failure invokes LLM repair (positive control)", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);

    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 100 })
    );
    loaded.anthropic.__setGenerateSqlImpl(async () => ({
      sql: "SELECT 1 FROM core.sessions WHERE session_key = 100",
      reasoning: "stub",
      model: "stub-anthropic-model"
    }));
    loaded.anthropic.__setRepairSqlImpl(async () => ({
      sql: "SELECT 1 FROM core.sessions WHERE session_key = 100",
      reasoning: "stub-repair",
      model: "stub-anthropic-model"
    }));
    loaded.anthropic.__setSynthesizeImpl(async () => ({
      answer: "stub",
      reasoning: "stub"
    }));

    let runCallCount = 0;
    loaded.queries.__setRunReadOnlySqlImpl(async (sql) => {
      runCallCount += 1;
      if (runCallCount === 1) {
        throw new Error("simulated SQL exec failure");
      }
      return {
        sql,
        rows: [{ stub_col: 1 }],
        rowCount: 1,
        elapsedMs: 1,
        truncated: false
      };
    });

    const { status, body } = await withNodeEnv("production", async () => postChat(loaded));

    assert.equal(status, 200);
    assert.equal(body.generationSource, "anthropic_repaired");
    assert.ok(
      loaded.anthropic.__getAnthropicCounter() >= 2,
      `expected counter >= 2 (generate + repair), got ${loaded.anthropic.__getAnthropicCounter()}`
    );
  });
});

test("dev-throw — assertNoLlmForDeterministic blocks repairSqlWithAnthropic callSite under NODE_ENV=development", async () => {
  await withGuardModule(async (mod) => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const templateKey = "any-key";
      assert.throws(
        () =>
          mod.assertNoLlmForDeterministic({
            generationSource: "deterministic_template",
            templateKey,
            callSite: "repairSqlWithAnthropic"
          }),
        (err) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.match(err.message, /zero-llm-path/, `message must include "zero-llm-path" (got: ${err.message})`);
          assert.ok(
            err.message.includes("repairSqlWithAnthropic"),
            `message must include callSite "repairSqlWithAnthropic" (got: ${err.message})`
          );
          assert.ok(
            err.message.includes(templateKey),
            `message must include templateKey "${templateKey}" (got: ${err.message})`
          );
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
