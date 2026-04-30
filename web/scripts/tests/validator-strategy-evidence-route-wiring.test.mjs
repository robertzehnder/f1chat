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
const pitStintsValidatorSourcePath = path.resolve(
  webRoot,
  "src/lib/validators/pitStintsValidator.ts"
);
const sectorConsistencyValidatorSourcePath = path.resolve(
  webRoot,
  "src/lib/validators/sectorConsistencyValidator.ts"
);
const gridFinishValidatorSourcePath = path.resolve(
  webRoot,
  "src/lib/validators/gridFinishValidator.ts"
);
const strategyEvidenceValidatorSourcePath = path.resolve(
  webRoot,
  "src/lib/validators/strategyEvidenceValidator.ts"
);

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
const state = { generate: null, repair: null, synthesize: null, synthesizeStream: null };
export function __setGenerateSqlImpl(fn) { state.generate = fn; }
export function __setRepairSqlImpl(fn) { state.repair = fn; }
export function __setSynthesizeImpl(fn) { state.synthesize = fn; }
export function __setSynthesizeStreamImpl(fn) { state.synthesizeStream = fn; }
export function __resetAnthropic() { state.generate = null; state.repair = null; state.synthesize = null; state.synthesizeStream = null; }
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
export async function* synthesizeAnswerStream(input) {
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

async function loadRouteWithRealValidators() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-validator-strategy-evidence-route-"));

  const transpile = (src) =>
    ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText;

  const pitStintsTranspiled = transpile(await readFile(pitStintsValidatorSourcePath, "utf8"));
  const sectorConsistencyTranspiled = transpile(
    await readFile(sectorConsistencyValidatorSourcePath, "utf8")
  );
  const gridFinishTranspiled = transpile(await readFile(gridFinishValidatorSourcePath, "utf8"));
  const strategyEvidenceTranspiled = transpile(
    await readFile(strategyEvidenceValidatorSourcePath, "utf8")
  );

  const answerCacheSrc = await readFile(answerCacheSourcePath, "utf8");
  const answerCacheStubbed = answerCacheSrc
    .replace(/from\s+["']\.\.\/queries["']/g, `from "./queries.stub.mjs"`)
    .replace(/from\s+["']\.\.\/anthropic["']/g, `from "./anthropic.stub.mjs"`);
  const answerCacheTranspiled = transpile(answerCacheStubbed);

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
    .replace(/from\s+["']@\/lib\/contracts\/factContract["']/g, `from "./factContract.stub.mjs"`)
    .replace(
      /from\s+["']@\/lib\/validators\/pitStintsValidator["']/g,
      `from "./pitStintsValidator.mjs"`
    )
    .replace(
      /from\s+["']@\/lib\/validators\/sectorConsistencyValidator["']/g,
      `from "./sectorConsistencyValidator.mjs"`
    )
    .replace(
      /from\s+["']@\/lib\/validators\/gridFinishValidator["']/g,
      `from "./gridFinishValidator.mjs"`
    )
    .replace(
      /from\s+["']@\/lib\/validators\/strategyEvidenceValidator["']/g,
      `from "./strategyEvidenceValidator.mjs"`
    );
  const routeTranspiled = transpile(routeStubbed);

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
  await writeFile(path.join(dir, "pitStintsValidator.mjs"), pitStintsTranspiled, "utf8");
  await writeFile(
    path.join(dir, "sectorConsistencyValidator.mjs"),
    sectorConsistencyTranspiled,
    "utf8"
  );
  await writeFile(path.join(dir, "gridFinishValidator.mjs"), gridFinishTranspiled, "utf8");
  await writeFile(
    path.join(dir, "strategyEvidenceValidator.mjs"),
    strategyEvidenceTranspiled,
    "utf8"
  );
  await writeFile(path.join(dir, "answerCache.mjs"), answerCacheTranspiled, "utf8");
  await writeFile(path.join(dir, "route.mjs"), routeTranspiled, "utf8");

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
  const loaded = await loadRouteWithRealValidators();
  try {
    await run(loaded);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

function makeFakeRuntime({ sessionKey, driverNumbers, year } = {}) {
  return {
    questionType: "pit_strategy_review",
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
      selectedDriverNumbers: driverNumbers ?? [1],
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
      requiredTables: ["core.strategy_summary"],
      tableChecks: [],
      warnings: [],
      fallbackOptions: []
    },
    grain: { grain: "driver", expectedRowVolume: "small", recommendedTables: [] },
    queryPlan: { resolved_entities: {}, primary_tables: ["core.strategy_summary"] },
    stageLogs: [],
    durationMs: 1
  };
}

function buildPostRequest(message) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      debug: { trace: true }
    })
  });
}

async function postChat(loaded, message) {
  const before = loaded.serverLog.__getJsonLogCalls().length;
  const req = buildPostRequest(message);
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

const VERSTAPPEN_ROW = {
  driver_name: "Max Verstappen",
  driver_number: 1,
  team_name: "Red Bull",
  pit_laps: [18, 41],
  pit_stop_count: 2,
  strategy_type: "Two-stop strategy",
  compounds_used: ["MEDIUM", "HARD", "HARD"],
  total_pit_duration_seconds: 45.123
};

const HAMILTON_ROW = {
  driver_name: "Lewis Hamilton",
  driver_number: 44,
  team_name: "Mercedes",
  pit_laps: [22],
  pit_stop_count: 1,
  strategy_type: "One-stop strategy",
  compounds_used: ["HARD", "MEDIUM"],
  total_pit_duration_seconds: 22.5
};

async function runStrategyCase(loaded, { rows, answerText, message }) {
  resetAll(loaded);
  loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => null);
  loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
    makeFakeRuntime({ sessionKey: 9839, driverNumbers: [1, 44], year: 2025 })
  );
  loaded.anthropic.__setGenerateSqlImpl(async () => ({
    sql: "SELECT * FROM core.strategy_summary WHERE session_key = 9839",
    reasoning: "stub-llm-reasoning",
    model: "stub-anthropic-model"
  }));
  loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => ({
    sql,
    rows,
    rowCount: rows.length,
    elapsedMs: 1,
    truncated: false
  });
  loaded.answerCache.__answerCacheTestHooks.synthesize = async () => ({
    answer: answerText,
    reasoning: "stub-synth-reasoning"
  });
  return await postChat(loaded, message);
}

test("route wires validateStrategyEvidence after synthesis and surfaces validators.strategyEvidence in chat_query_trace.jsonl (failure case: unsupported strategy claim)", async () => {
  await withRoute(async (loaded) => {
    const failAnswer = "Verstappen ran a three-stop strategy, pitting on lap 25.";
    const result = await runStrategyCase(loaded, {
      rows: [VERSTAPPEN_ROW],
      answerText: failAnswer,
      message: "What strategy did Verstappen run in this race?"
    });
    assert.equal(result.status, 200);

    const lastTrace = result.traceEntries.at(-1);
    assert.ok(lastTrace, "expected at least one chat_query_trace.jsonl entry");
    assert.ok(
      lastTrace.validators &&
        Object.prototype.hasOwnProperty.call(lastTrace.validators, "pitStints"),
      `trace.validators must still include 'pitStints'; got=${JSON.stringify(lastTrace.validators)}`
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(lastTrace.validators, "sectorConsistency"),
      `trace.validators must still include 'sectorConsistency'; got=${JSON.stringify(lastTrace.validators)}`
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(lastTrace.validators, "gridFinish"),
      `trace.validators must still include 'gridFinish'; got=${JSON.stringify(lastTrace.validators)}`
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(lastTrace.validators, "strategyEvidence"),
      `trace.validators must include 'strategyEvidence'; got=${JSON.stringify(lastTrace.validators)}`
    );
    const v = lastTrace.validators.strategyEvidence;
    assert.notEqual(v, null, "strategyEvidence validation result must not be null on the LLM-synthesis path");
    assert.equal(v.ok, false, `expected ok=false for the unsupported strategy claim; got=${JSON.stringify(v)}`);
    assert.ok(
      Array.isArray(v.reasons) && v.reasons.length > 0,
      `expected non-empty reasons; got=${JSON.stringify(v)}`
    );

    // Non-blocking behavior: HTTP 200, unchanged answer, no validator leak.
    assert.equal(
      typeof result.body.answer,
      "string",
      "validator failure must not break the response payload's answer field"
    );
    assert.equal(
      result.body.answer,
      failAnswer,
      "validator failure must not alter or strip the answer text"
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(result.body, "validators"),
      "validator output must not leak into the user-facing response payload"
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(result.body, "strategyEvidence"),
      "strategyEvidence must not appear at any level of the user-facing response payload"
    );
  });
});

test("route wires validateStrategyEvidence on the LLM-synthesis happy path (validator passes, ok=true)", async () => {
  await withRoute(async (loaded) => {
    const passAnswer = "Verstappen ran a two-stop strategy, pitting on laps 18 and 41.";
    const passResult = await runStrategyCase(loaded, {
      rows: [VERSTAPPEN_ROW],
      answerText: passAnswer,
      message: "What strategy did Verstappen run in this race?"
    });
    assert.equal(passResult.status, 200);

    const lastTrace = passResult.traceEntries.at(-1);
    assert.ok(lastTrace.validators, "validators block must be present on success path");
    const v = lastTrace.validators.strategyEvidence;
    assert.equal(v.ok, true, `expected ok=true on a consistent answer; got=${JSON.stringify(v)}`);
    assert.deepEqual(v.reasons, []);
    assert.equal(passResult.body.answer, passAnswer);
    assert.ok(!Object.prototype.hasOwnProperty.call(passResult.body, "validators"));
  });
});

test("route emits null validators.strategyEvidence in trace when no synthesisContract was built (zero-row path)", async () => {
  await withRoute(async (loaded) => {
    // Force the synthesis-bypass null-contract branch: the SQL execution
    // returns zero rows, so the route never enters the LLM-synthesis block
    // where `synthesisContract` is assigned. The route should still emit a
    // chat_query_trace.jsonl entry whose validators.strategyEvidence is null
    // (mirroring the route's `synthesisContract ? ... : null` guard) and
    // return HTTP 200 with the synthesized "no rows" answer unchanged.
    resetAll(loaded);
    loaded.deterministic.__setBuildDeterministicSqlTemplateImpl(() => null);
    loaded.chatRuntime.__setBuildChatRuntimeImpl(async () =>
      makeFakeRuntime({ sessionKey: 9839, driverNumbers: [1], year: 2025 })
    );
    loaded.anthropic.__setGenerateSqlImpl(async () => ({
      sql: "SELECT * FROM core.strategy_summary WHERE session_key = 9839",
      reasoning: "stub",
      model: "stub-model"
    }));
    loaded.answerCache.__answerCacheTestHooks.runSql = async (sql) => ({
      sql,
      rows: [],
      rowCount: 0,
      elapsedMs: 1,
      truncated: false
    });
    // Synthesis stub is intentionally unconfigured: the zero-row branch in
    // route.ts skips synthesis entirely and produces a hardcoded "no rows"
    // answer, so synthesisContract stays null.

    const result = await postChat(loaded, "What strategy did Verstappen run in this race?");
    assert.equal(result.status, 200, "route must still return HTTP 200 on the zero-row path");

    const lastTrace = result.traceEntries.at(-1);
    assert.ok(lastTrace, "expected at least one chat_query_trace.jsonl entry");
    assert.ok(
      lastTrace.validators &&
        Object.prototype.hasOwnProperty.call(lastTrace.validators, "strategyEvidence"),
      `trace.validators must include 'strategyEvidence'; got=${JSON.stringify(lastTrace.validators)}`
    );
    assert.equal(
      lastTrace.validators.strategyEvidence,
      null,
      `expected null strategyEvidence when synthesisContract is null; got=${JSON.stringify(
        lastTrace.validators.strategyEvidence
      )}`
    );

    // The route's hardcoded zero-row answer must be returned unchanged.
    assert.equal(
      typeof result.body.answer,
      "string",
      "zero-row path must still produce a string answer"
    );
    assert.ok(
      result.body.answer.startsWith("No rows matched"),
      `expected the route's zero-row hardcoded answer; got="${result.body.answer}"`
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(result.body, "validators"),
      "validator output must not leak into the user-facing response payload"
    );
  });
});

test("route surfaces driver-binding mismatch in trace (Hamilton claim backed only by Verstappen's row → ok=false)", async () => {
  await withRoute(async (loaded) => {
    const misAttributedAnswer = "Hamilton ran a two-stop strategy, pitting on laps 18 and 41.";
    const result = await runStrategyCase(loaded, {
      rows: [VERSTAPPEN_ROW, HAMILTON_ROW],
      answerText: misAttributedAnswer,
      message: "What strategy did each driver run in this race?"
    });
    assert.equal(result.status, 200);

    const lastTrace = result.traceEntries.at(-1);
    assert.ok(lastTrace, "expected at least one chat_query_trace.jsonl entry");
    const v = lastTrace.validators.strategyEvidence;
    assert.notEqual(v, null);
    assert.equal(
      v.ok,
      false,
      `expected ok=false when Hamilton's claim is backed only by Verstappen's row; got=${JSON.stringify(v)}`
    );
    assert.ok(
      Array.isArray(v.reasons) && v.reasons.length > 0,
      `expected non-empty reasons; got=${JSON.stringify(v)}`
    );
    assert.ok(
      v.reasons.some((r) => r.includes("Hamilton")),
      `expected at least one reason naming the Hamilton driverToken; got=${JSON.stringify(v.reasons)}`
    );

    // Non-blocking: HTTP 200, answer unchanged.
    assert.equal(result.body.answer, misAttributedAnswer);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.body, "validators"));
  });
});
