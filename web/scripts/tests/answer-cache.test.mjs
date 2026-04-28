import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const answerCacheSourcePath = path.resolve(webRoot, "src/lib/cache/answerCache.ts");

const QUERIES_STUB = `
export async function runReadOnlySql() {
  throw new Error("default queries stub: tests must override runSql via __answerCacheTestHooks");
}
`;
const ANTHROPIC_STUB = `
export async function synthesizeAnswerWithAnthropic() {
  throw new Error("default anthropic stub: tests must override synthesize via __answerCacheTestHooks");
}
`;

async function loadAnswerCacheModule() {
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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-answer-cache-"));
  await writeFile(path.join(dir, "queries.stub.mjs"), QUERIES_STUB, "utf8");
  await writeFile(path.join(dir, "anthropic.stub.mjs"), ANTHROPIC_STUB, "utf8");
  const outFile = path.join(dir, "answerCache.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

async function withAnswerCacheModule(run) {
  const loaded = await loadAnswerCacheModule();
  try {
    await run(loaded.mod);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

const SUBSET_FIELDS = [
  "answer",
  "answerReasoning",
  "adequacyGrade",
  "adequacyReason",
  "responseGrade",
  "gradeReason",
  "generationSource",
  "model",
  "generationNotes",
  "sql",
  "result"
];

function pickSubset(response) {
  const subset = {};
  for (const key of SUBSET_FIELDS) {
    subset[key] = response[key];
  }
  // result subset excludes elapsedMs (which is per-request)
  if (subset.result && typeof subset.result === "object") {
    const { sql, rows, rowCount, truncated } = subset.result;
    subset.result = { sql, rows, rowCount, truncated };
  }
  return subset;
}

function pickPerRequestMeta(response) {
  return {
    requestId: response.requestId,
    runtime: response.runtime,
    elapsedMs: response.result ? response.result.elapsedMs : undefined,
    timestamp: response.timestamp
  };
}

let requestIdCounter = 0;
function nextRequestId() {
  requestIdCounter += 1;
  return `req-${requestIdCounter}`;
}

let elapsedTickCounter = 0;
function nextElapsedTick() {
  elapsedTickCounter += 1;
  return elapsedTickCounter * 7; // arbitrary varying number
}

function makeRuntimeForRequest() {
  return { built: nextElapsedTick() };
}

function makeQuality() {
  return {
    adequacyGrade: "A",
    adequacyReason: "ok",
    responseGrade: "A",
    gradeReason: "ok"
  };
}

// Simulator that mirrors the route.ts cache boundary: check cache, on hit
// regenerate per-request metadata and skip runSql/synthesize; on miss run
// runSql, optionally synthesize, then conditionally cache the deterministic
// subset based on the success-gate (generationSource === "deterministic_template").
async function simulateChatRequest(mod, args) {
  const {
    templateKey = null,
    sessionKey,
    sortedDriverNumbers,
    year,
    forceRunSqlError = false,
    forceFallback = false,
    rowCount = 1,
    answerText = "deterministic answer text",
    sqlText = "SELECT 1 AS pace_ms"
  } = args;

  const cacheKey = mod.buildAnswerCacheKey({
    templateKey,
    sessionKey,
    sortedDriverNumbers,
    year
  });

  const traceLog = [];
  const requestId = nextRequestId();
  const runtime = makeRuntimeForRequest();
  const timestamp = nextElapsedTick();

  if (cacheKey) {
    const cached = mod.getAnswerCacheEntry(cacheKey);
    if (cached) {
      traceLog.push({ cache_hit: true, status: "success" });
      return {
        response: {
          requestId,
          runtime,
          timestamp,
          answer: cached.answer,
          answerReasoning: cached.answerReasoning,
          adequacyGrade: cached.adequacyGrade,
          adequacyReason: cached.adequacyReason,
          responseGrade: cached.responseGrade,
          gradeReason: cached.gradeReason,
          generationSource: cached.generationSource,
          model: cached.model,
          generationNotes: cached.generationNotes,
          sql: cached.sql,
          result: {
            sql: cached.result.sql,
            rows: cached.result.rows,
            rowCount: cached.result.rowCount,
            truncated: cached.result.truncated,
            elapsedMs: 0
          }
        },
        traceLog,
        cacheHit: true
      };
    }
  }

  let result;
  let generationSource = templateKey ? "deterministic_template" : "anthropic";
  try {
    result = await mod.cachedRunSql("SELECT * FROM ...", { preview: true });
  } catch (err) {
    if (forceFallback) {
      // simulate route.ts heuristic fallback path
      generationSource = "heuristic_after_template_failure";
      result = {
        sql: "-- heuristic fallback",
        rows: [{ heuristic: true }],
        rowCount: 1,
        elapsedMs: 0,
        truncated: false
      };
    } else {
      traceLog.push({ cache_hit: false, status: "error", error: String(err.message) });
      throw err;
    }
  }

  let answer = answerText;
  let answerReasoning;
  if (result.rowCount > 0 && !forceFallback) {
    const synth = await mod.cachedSynthesize({
      question: "q",
      sql: result.sql,
      rows: result.rows,
      rowCount: result.rowCount,
      runtime
    });
    answer = synth.answer;
    answerReasoning = synth.reasoning;
  }
  if (forceRunSqlError && !forceFallback) {
    // forced error already thrown above; this branch is unreachable
    void answer;
  }

  const quality = makeQuality();
  const subset = {
    answer,
    answerReasoning,
    adequacyGrade: quality.adequacyGrade,
    adequacyReason: quality.adequacyReason,
    responseGrade: quality.responseGrade,
    gradeReason: quality.gradeReason,
    generationSource,
    model: undefined,
    generationNotes: `template=${templateKey ?? "none"} | session_pin_verified`,
    sql: result.sql,
    result: {
      sql: result.sql,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated
    }
  };

  const shouldCache = generationSource === "deterministic_template";
  if (cacheKey && shouldCache) {
    mod.setAnswerCacheEntry(cacheKey, subset);
  }

  traceLog.push({ cache_hit: false, status: "success" });

  return {
    response: {
      requestId,
      runtime,
      timestamp,
      answer: subset.answer,
      answerReasoning: subset.answerReasoning,
      adequacyGrade: subset.adequacyGrade,
      adequacyReason: subset.adequacyReason,
      responseGrade: subset.responseGrade,
      gradeReason: subset.gradeReason,
      generationSource: subset.generationSource,
      model: subset.model,
      generationNotes: subset.generationNotes,
      sql: subset.sql,
      result: {
        sql: subset.result.sql,
        rows: subset.result.rows,
        rowCount: subset.result.rowCount,
        truncated: subset.result.truncated,
        elapsedMs: result.elapsedMs
      }
    },
    traceLog,
    cacheHit: false
  };
}

function installRunSqlSpy(mod, impl) {
  mod.__answerCacheTestHooks.runSql = impl;
}

function installSynthesizeSpy(mod, impl) {
  mod.__answerCacheTestHooks.synthesize = impl;
}

const DETERMINISTIC_TEMPLATE = "max_leclerc_lap_pace_summary";

test("two identical deterministic requests: first miss, second hit; sql exec spy = 1; synth spy <= 1; subset deep-equal; metadata regenerated; key sets match", async () => {
  await withAnswerCacheModule(async (mod) => {
    mod.__resetAnswerCacheForTests();
    let runSqlCalls = 0;
    installRunSqlSpy(mod, async () => {
      runSqlCalls += 1;
      return {
        sql: "SELECT pace_ms FROM core.laps_enriched WHERE session_key = 9839",
        rows: [{ pace_ms: 81234 }],
        rowCount: 1,
        elapsedMs: 13 + runSqlCalls,
        truncated: false
      };
    });
    let synthesizeCalls = 0;
    installSynthesizeSpy(mod, async () => {
      synthesizeCalls += 1;
      return { answer: "Max averaged 81.234s", reasoning: "row reasoning" };
    });

    const args = {
      templateKey: DETERMINISTIC_TEMPLATE,
      sessionKey: 9839,
      sortedDriverNumbers: [1, 16],
      year: 2025
    };

    const first = await simulateChatRequest(mod, args);
    const second = await simulateChatRequest(mod, args);

    assert.equal(runSqlCalls, 1, "runReadOnlySql spy must record exactly one invocation across both identical deterministic requests");
    assert.ok(synthesizeCalls <= 1, "synthesize spy must record at most one invocation across both requests");
    assert.equal(first.cacheHit, false, "first request is a cache miss");
    assert.equal(second.cacheHit, true, "second identical request is a cache hit");

    assert.deepEqual(
      pickSubset(second.response),
      pickSubset(first.response),
      "deterministic-derived subset must deep-equal between miss and hit"
    );

    const firstMeta = pickPerRequestMeta(first.response);
    const secondMeta = pickPerRequestMeta(second.response);
    assert.notEqual(firstMeta.requestId, secondMeta.requestId, "requestId must be regenerated on hit");
    assert.notDeepEqual(firstMeta.runtime, secondMeta.runtime, "runtime must be regenerated on hit");
    assert.notEqual(firstMeta.timestamp, secondMeta.timestamp, "timestamp must be regenerated on hit");
    assert.notEqual(firstMeta.elapsedMs, secondMeta.elapsedMs, "result.elapsedMs must be regenerated on hit (never replayed from miss)");

    const firstKeys = Object.keys(first.response).sort();
    const secondKeys = Object.keys(second.response).sort();
    assert.deepEqual(secondKeys, firstKeys, "miss and hit responses must have identical top-level key sets");

    assert.equal(first.traceLog.at(-1).cache_hit, false);
    assert.equal(second.traceLog.at(-1).cache_hit, true);
  });
});

test("trace assertion: first call emits cache_hit=false, second identical call emits cache_hit=true", async () => {
  await withAnswerCacheModule(async (mod) => {
    mod.__resetAnswerCacheForTests();
    installRunSqlSpy(mod, async () => ({
      sql: "SELECT 1",
      rows: [{ a: 1 }],
      rowCount: 1,
      elapsedMs: 4,
      truncated: false
    }));
    installSynthesizeSpy(mod, async () => ({ answer: "an", reasoning: "r" }));

    const args = {
      templateKey: DETERMINISTIC_TEMPLATE,
      sessionKey: 100,
      sortedDriverNumbers: [1],
      year: 2025
    };

    const first = await simulateChatRequest(mod, args);
    const second = await simulateChatRequest(mod, args);

    assert.equal(first.traceLog[first.traceLog.length - 1].cache_hit, false);
    assert.equal(second.traceLog[second.traceLog.length - 1].cache_hit, true);
  });
});

test("key distinctness: differing sessionKey, differing sortedDriverNumbers, and differing year all produce two misses each (sql spy increments twice per pairing)", async () => {
  await withAnswerCacheModule(async (mod) => {
    // pairing A: differs only in sessionKey
    {
      mod.__resetAnswerCacheForTests();
      let runSqlCalls = 0;
      installRunSqlSpy(mod, async () => {
        runSqlCalls += 1;
        return { sql: "S", rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
      });
      installSynthesizeSpy(mod, async () => ({ answer: "a", reasoning: "r" }));

      await simulateChatRequest(mod, {
        templateKey: DETERMINISTIC_TEMPLATE,
        sessionKey: 1000,
        sortedDriverNumbers: [1, 16],
        year: 2025
      });
      await simulateChatRequest(mod, {
        templateKey: DETERMINISTIC_TEMPLATE,
        sessionKey: 1001,
        sortedDriverNumbers: [1, 16],
        year: 2025
      });
      assert.equal(runSqlCalls, 2, "different sessionKey must be two distinct cache slots → two SQL invocations");
    }

    // pairing B: differs only in sortedDriverNumbers
    {
      mod.__resetAnswerCacheForTests();
      let runSqlCalls = 0;
      installRunSqlSpy(mod, async () => {
        runSqlCalls += 1;
        return { sql: "S", rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
      });
      installSynthesizeSpy(mod, async () => ({ answer: "a", reasoning: "r" }));

      await simulateChatRequest(mod, {
        templateKey: DETERMINISTIC_TEMPLATE,
        sessionKey: 9000,
        sortedDriverNumbers: [1, 16],
        year: 2025
      });
      await simulateChatRequest(mod, {
        templateKey: DETERMINISTIC_TEMPLATE,
        sessionKey: 9000,
        sortedDriverNumbers: [4, 81],
        year: 2025
      });
      assert.equal(runSqlCalls, 2, "different sortedDriverNumbers must be two distinct cache slots → two SQL invocations");
    }

    // pairing C: differs only in year
    {
      mod.__resetAnswerCacheForTests();
      let runSqlCalls = 0;
      installRunSqlSpy(mod, async () => {
        runSqlCalls += 1;
        return { sql: "S", rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
      });
      installSynthesizeSpy(mod, async () => ({ answer: "a", reasoning: "r" }));

      await simulateChatRequest(mod, {
        templateKey: DETERMINISTIC_TEMPLATE,
        sessionKey: 9000,
        sortedDriverNumbers: [1, 16],
        year: 2024
      });
      await simulateChatRequest(mod, {
        templateKey: DETERMINISTIC_TEMPLATE,
        sessionKey: 9000,
        sortedDriverNumbers: [1, 16],
        year: 2025
      });
      assert.equal(runSqlCalls, 2, "different year must be two distinct cache slots → two SQL invocations (year is part of the cache key)");
    }
  });
});

test("sortedDriverNumbers is order-insensitive: [16,1] and [1,16] produce the same cache key (the normalizer sorts)", async () => {
  await withAnswerCacheModule(async (mod) => {
    mod.__resetAnswerCacheForTests();
    let runSqlCalls = 0;
    installRunSqlSpy(mod, async () => {
      runSqlCalls += 1;
      return { sql: "S", rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
    });
    installSynthesizeSpy(mod, async () => ({ answer: "a", reasoning: "r" }));

    await simulateChatRequest(mod, {
      templateKey: DETERMINISTIC_TEMPLATE,
      sessionKey: 7000,
      sortedDriverNumbers: [16, 1],
      year: 2025
    });
    await simulateChatRequest(mod, {
      templateKey: DETERMINISTIC_TEMPLATE,
      sessionKey: 7000,
      sortedDriverNumbers: [1, 16],
      year: 2025
    });
    assert.equal(runSqlCalls, 1, "[16,1] and [1,16] must collapse to the same cache key");
  });
});

test("TTL expiry past 10min causes the same key to re-miss; spies increment again; trace re-emits cache_hit=false then cache_hit=true on follow-up", async (t) => {
  await withAnswerCacheModule(async (mod) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
    try {
      mod.__resetAnswerCacheForTests();
      let runSqlCalls = 0;
      installRunSqlSpy(mod, async () => {
        runSqlCalls += 1;
        return { sql: "S", rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
      });
      let synthesizeCalls = 0;
      installSynthesizeSpy(mod, async () => {
        synthesizeCalls += 1;
        return { answer: "a", reasoning: "r" };
      });

      const args = {
        templateKey: DETERMINISTIC_TEMPLATE,
        sessionKey: 555,
        sortedDriverNumbers: [1, 16],
        year: 2025
      };

      const first = await simulateChatRequest(mod, args);
      assert.equal(first.cacheHit, false);
      assert.equal(runSqlCalls, 1);

      // within TTL — still hits
      t.mock.timers.tick(5 * 60 * 1000);
      const within = await simulateChatRequest(mod, args);
      assert.equal(within.cacheHit, true);
      assert.equal(runSqlCalls, 1, "lookup within TTL must not re-invoke runSql");

      // past TTL — must re-miss
      t.mock.timers.tick(6 * 60 * 1000); // total advance ~ 11min
      const afterExpiry = await simulateChatRequest(mod, args);
      assert.equal(afterExpiry.cacheHit, false, "post-TTL request must miss");
      assert.equal(runSqlCalls, 2, "post-TTL miss must re-invoke the SQL spy");
      assert.ok(synthesizeCalls >= 2, "post-TTL miss must re-invoke synthesize at least once more");
      assert.equal(afterExpiry.traceLog.at(-1).cache_hit, false);

      // follow-up identical → hit again
      const followUp = await simulateChatRequest(mod, args);
      assert.equal(followUp.cacheHit, true, "follow-up after re-miss must hit");
      assert.equal(followUp.traceLog.at(-1).cache_hit, true);
    } finally {
      t.mock.timers.reset();
    }
  });
});

test("non-deterministic bypass: requests with no templateKey neither read nor write the cache (sql spy increments every call; cacheHit always false)", async () => {
  await withAnswerCacheModule(async (mod) => {
    mod.__resetAnswerCacheForTests();
    let runSqlCalls = 0;
    installRunSqlSpy(mod, async () => {
      runSqlCalls += 1;
      return { sql: "S", rows: [{}], rowCount: 1, elapsedMs: 1, truncated: false };
    });
    installSynthesizeSpy(mod, async () => ({ answer: "a", reasoning: "r" }));

    const args = {
      templateKey: null, // non-deterministic
      sessionKey: 100,
      sortedDriverNumbers: [1],
      year: 2025
    };

    const first = await simulateChatRequest(mod, args);
    const second = await simulateChatRequest(mod, args);
    const third = await simulateChatRequest(mod, args);

    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, false);
    assert.equal(third.cacheHit, false);
    assert.equal(runSqlCalls, 3, "non-deterministic requests must invoke SQL on every call");
    for (const r of [first, second, third]) {
      assert.equal(r.traceLog.at(-1).cache_hit, false, "no cache_hit:true is emitted for non-deterministic requests");
    }

    // also assert: buildAnswerCacheKey returns null for missing templateKey
    assert.equal(
      mod.buildAnswerCacheKey({ templateKey: null, sessionKey: 100, sortedDriverNumbers: [1], year: 2025 }),
      null,
      "buildAnswerCacheKey must return null when templateKey is missing"
    );
  });
});

test("failed-deterministic / fallback bypass on writes: throwing runSql leaves cache empty; subsequent successful run populates; next identical hits", async () => {
  await withAnswerCacheModule(async (mod) => {
    mod.__resetAnswerCacheForTests();
    let runSqlCalls = 0;
    let runSqlMode = "throw";
    installRunSqlSpy(mod, async () => {
      runSqlCalls += 1;
      if (runSqlMode === "throw") {
        throw new Error("simulated postgres failure");
      }
      return {
        sql: "SELECT 1",
        rows: [{ a: 1 }],
        rowCount: 1,
        elapsedMs: 4,
        truncated: false
      };
    });
    let synthesizeCalls = 0;
    installSynthesizeSpy(mod, async () => {
      synthesizeCalls += 1;
      return { answer: "real", reasoning: "r" };
    });

    const args = {
      templateKey: DETERMINISTIC_TEMPLATE,
      sessionKey: 9999,
      sortedDriverNumbers: [1, 16],
      year: 2025
    };

    // 1) deterministic SQL fails; route's heuristic fallback path engages
    const fallbackResp = await simulateChatRequest(mod, { ...args, forceFallback: true });
    assert.equal(fallbackResp.cacheHit, false);
    assert.equal(fallbackResp.response.generationSource, "heuristic_after_template_failure");
    assert.equal(runSqlCalls, 1);

    // 2) follow-up identical request must still miss (no entry was written)
    const followMiss = await simulateChatRequest(mod, { ...args, forceFallback: true });
    assert.equal(followMiss.cacheHit, false, "no cache entry should have been written for the fallback path");
    assert.equal(runSqlCalls, 2, "SQL spy increments again because the fallback branch did not cache");
    assert.equal(followMiss.traceLog.at(-1).cache_hit, false);

    // 3) Now make runSql succeed; subsequent deterministic-success request populates the cache
    runSqlMode = "ok";
    const successResp = await simulateChatRequest(mod, args);
    assert.equal(successResp.cacheHit, false);
    assert.equal(successResp.response.generationSource, "deterministic_template");
    assert.equal(runSqlCalls, 3);
    assert.equal(synthesizeCalls, 1, "synth invoked exactly once on the deterministic-success request");

    // 4) follow-up identical → hit
    const finalHit = await simulateChatRequest(mod, args);
    assert.equal(finalHit.cacheHit, true);
    assert.equal(runSqlCalls, 3, "SQL spy must NOT increment on the follow-up cache hit");
    assert.equal(synthesizeCalls, 1, "synth spy must NOT increment on the follow-up cache hit");
    assert.equal(finalHit.traceLog.at(-1).cache_hit, true);
  });
});

test("buildAnswerCacheKey: undefined sessionKey/sortedDriverNumbers/year collapse into placeholder segments (templateKey-only key for the three Abu-Dhabi-baked templates)", async () => {
  await withAnswerCacheModule(async (mod) => {
    const baseline = mod.buildAnswerCacheKey({ templateKey: "canonical_id_lookup_abu_dhabi_2025_race" });
    const repeated = mod.buildAnswerCacheKey({ templateKey: "canonical_id_lookup_abu_dhabi_2025_race" });
    assert.equal(baseline, repeated, "templateKey-only inputs must produce a stable key");
    assert.match(baseline, /canonical_id_lookup_abu_dhabi_2025_race/);
    // placeholder segments present so the key is never bare-templateKey-equals-other-templates
    assert.match(baseline, /_no_session/);
    assert.match(baseline, /_no_drivers/);
    assert.match(baseline, /_no_year/);
  });
});

test("__answerCacheConfig exposes 10-min TTL and 500-entry max, matching the slice spec", async () => {
  await withAnswerCacheModule(async (mod) => {
    assert.equal(mod.__answerCacheConfig.ttlMs, 10 * 60 * 1000);
    assert.equal(mod.__answerCacheConfig.max, 500);
  });
});
