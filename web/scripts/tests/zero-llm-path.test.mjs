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

// Cross-checked against `templateKey: "..."` literals in
// `web/src/lib/deterministicSql.ts`. Drift gate enforces equality.
export const DETERMINISTIC_KEYS = [
  "abu_dhabi_weekend_smallest_spread_and_comparison",
  "canonical_id_lookup_abu_dhabi_2025_race",
  "fastest_lap_by_driver",
  "max_leclerc_avg_clean_lap_pace",
  "max_leclerc_common_lap_window_pace",
  "max_leclerc_compounds_used",
  "max_leclerc_fastest_lap_per_driver",
  "max_leclerc_fastest_lap_telemetry_window",
  "max_leclerc_final_third_pace",
  "max_leclerc_fresh_vs_used_tires",
  "max_leclerc_lap_consistency",
  "max_leclerc_lap_degradation_by_stint",
  "max_leclerc_lap_pace_summary",
  "max_leclerc_opening_closing_stint_lengths",
  "max_leclerc_pit_laps",
  "max_leclerc_pit_stop_count",
  "max_leclerc_position_change_around_pit_cycle",
  "max_leclerc_positions_gained_or_lost",
  "max_leclerc_post_pit_pace",
  "max_leclerc_pre_post_pit_pace",
  "max_leclerc_qualifying_improvement",
  "max_leclerc_running_order_progression",
  "max_leclerc_sector_comparison",
  "max_leclerc_shortest_pit_stop",
  "max_leclerc_stint_lengths",
  "max_leclerc_stint_pace_vs_tire_age",
  "max_leclerc_strategy_type",
  "max_leclerc_top_speed",
  "max_leclerc_total_pit_time",
  "practice_laps_vs_race_pace_same_meeting",
  "sessions_most_complete_downstream_coverage",
  "top10_fastest_laps_overall"
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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-zero-llm-"));

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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-zero-llm-guard-"));
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

function withNodeEnv(value, fn) {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = original;
  }
}

test("cold deterministic path under NODE_ENV=production: zero LLM calls for every DETERMINISTIC_KEYS template", async () => {
  await withRoute(async (loaded) => {
    for (const templateKey of DETERMINISTIC_KEYS) {
      resetAll(loaded);

      loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
        templateKey,
        sql: `SELECT 1 AS stub FROM core.sessions WHERE session_key = 9839 -- ${templateKey}`
      }));
      loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
        makeFakeRuntime({ sessionKey: 9839, driverNumbers: [1, 16], year: 2025 })
      );
      loaded.queries.__setRunReadOnlySqlImpl(async (sql) => ({
        sql,
        rows: [{ stub_col: 1 }],
        rowCount: 1,
        elapsedMs: 1,
        truncated: false
      }));

      const { status, body } = await withNodeEnv("production", () => postChat(loaded));

      assert.equal(status, 200, `template ${templateKey}: expected HTTP 200`);
      assert.equal(
        body.generationSource,
        "deterministic_template",
        `template ${templateKey}: must take deterministic_template path`
      );
      assert.equal(
        loaded.anthropic.__getAnthropicCounter(),
        0,
        `template ${templateKey}: zero LLM calls expected, got ${loaded.anthropic.__getAnthropicCounter()}`
      );
    }
  });
});

test("warm answer-cache hit: identical deterministic request stays at zero LLM calls", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    const templateKey = DETERMINISTIC_KEYS[0];
    loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => ({
      templateKey,
      sql: "SELECT 1 AS stub FROM core.sessions WHERE session_key = 9839"
    }));
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 9839, driverNumbers: [1, 16], year: 2025 })
    );
    loaded.queries.__setRunReadOnlySqlImpl(async (sql) => ({
      sql,
      rows: [{ stub_col: 1 }],
      rowCount: 1,
      elapsedMs: 1,
      truncated: false
    }));

    await withNodeEnv("production", async () => {
      const first = await postChat(loaded);
      const second = await postChat(loaded);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.body.generationSource, "deterministic_template");
      assert.equal(second.body.generationSource, "deterministic_template");
      assert.equal(
        loaded.anthropic.__getAnthropicCounter(),
        0,
        "warm answer-cache hit must keep LLM counter at 0"
      );
    });
  });
});

test("LLM-required negative control: non-template prompt drives the LLM stub (counter > 0)", async () => {
  await withRoute(async (loaded) => {
    resetAll(loaded);
    // deterministic returns null → route falls through to generateSqlWithAnthropic
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 100, driverNumbers: [1], year: 2025 })
    );
    loaded.anthropic.__setGenerateSqlImpl(async () => ({
      sql: "SELECT 1 AS bypass FROM core.sessions WHERE session_key = 100",
      reasoning: "stub-llm-reasoning",
      model: "stub-anthropic-model"
    }));
    loaded.anthropic.__setSynthesizeImpl(async () => ({
      answer: "non-deterministic answer",
      reasoning: "stub-synth-reasoning"
    }));
    loaded.queries.__setRunReadOnlySqlImpl(async (sql) => ({
      sql,
      rows: [{ a: 1 }],
      rowCount: 1,
      elapsedMs: 1,
      truncated: false
    }));

    const { status, body } = await withNodeEnv("production", () => postChat(loaded));

    assert.equal(status, 200);
    assert.equal(body.generationSource, "anthropic", "non-deterministic prompt must take the anthropic path");
    assert.ok(
      loaded.anthropic.__getAnthropicCounter() > 0,
      `negative control: expected LLM counter > 0, got ${loaded.anthropic.__getAnthropicCounter()}`
    );
  });
});

test("dev-throw — assertNoLlmForDeterministic throws for each callSite under NODE_ENV=development", async () => {
  await withGuardModule(async (mod) => {
    withNodeEnv("development", () => {
      for (const callSite of [
        "generateSqlWithAnthropic",
        "repairSqlWithAnthropic",
        "cachedSynthesize"
      ]) {
        const templateKey = DETERMINISTIC_KEYS[0];
        assert.throws(
          () =>
            mod.assertNoLlmForDeterministic({
              generationSource: "deterministic_template",
              templateKey,
              callSite
            }),
          (err) => {
            assert.ok(err instanceof Error, `callSite=${callSite}: must throw an Error`);
            assert.match(err.message, /zero-llm-path/, `callSite=${callSite}: message must include "zero-llm-path"`);
            assert.ok(
              err.message.includes(callSite),
              `callSite=${callSite}: message must include callSite (got: ${err.message})`
            );
            assert.ok(
              err.message.includes(templateKey),
              `callSite=${callSite}: message must include templateKey (got: ${err.message})`
            );
            return true;
          }
        );
      }
    });
  });
});

test("dev no-throw — assertNoLlmForDeterministic does NOT throw for non-deterministic generationSource under NODE_ENV=development", async () => {
  await withGuardModule(async (mod) => {
    withNodeEnv("development", () => {
      assert.doesNotThrow(() =>
        mod.assertNoLlmForDeterministic({
          generationSource: "llm_generated",
          templateKey: undefined,
          callSite: "cachedSynthesize"
        })
      );
      assert.doesNotThrow(() =>
        mod.assertNoLlmForDeterministic({
          generationSource: "anthropic",
          callSite: "generateSqlWithAnthropic"
        })
      );
    });
  });
});

test("production no-throw — assertNoLlmForDeterministic does NOT throw under NODE_ENV=production even for deterministic_template", async () => {
  await withGuardModule(async (mod) => {
    withNodeEnv("production", () => {
      for (const callSite of [
        "generateSqlWithAnthropic",
        "repairSqlWithAnthropic",
        "cachedSynthesize"
      ]) {
        assert.doesNotThrow(() =>
          mod.assertNoLlmForDeterministic({
            generationSource: "deterministic_template",
            templateKey: DETERMINISTIC_KEYS[0],
            callSite
          })
        );
      }
    });
  });
});
