// Tests for the driver_pair_strategy_split deterministic card:
//   1. template trigger (pair + strategy + split/compare language)
//   2. insight builder (split verdict matrix, pit-offset reporting,
//      not-teammates premise check, null on wrong shape)
// Transpile-at-test-time pattern (type-only imports erase).

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadModule(relPath, outName) {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-strategy-split-"));
  const src = await readFile(path.resolve(webRoot, relPath), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, outName), out, "utf8");
  const mod = await import(path.join(dir, outName));
  return { mod, dir };
}

// ---------------------------------------------------------------------------
// Template trigger + SQL safety
// ---------------------------------------------------------------------------

test("template fires on a strategy-split question with a driver pair", async () => {
  const { mod, dir } = await loadModule("src/lib/deterministicSql/strategySplit.ts", "strategySplit.mjs");
  try {
    const tpl = mod.buildStrategySplitTemplate({
      lower: "did mercedes split strategies between russell and hamilton at spa 2025",
      targetSession: 9939,
      driverA: 63,
      driverB: 44
    });
    assert.ok(tpl, "template should fire");
    assert.equal(tpl.templateKey, "driver_pair_strategy_split");
    assert.match(tpl.sql, /driver_number = 63/);
    assert.ok(!tpl.sql.includes(";"), "no statement separator");
    assert.ok(
      !/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i.test(tpl.sql),
      "no banned keywords"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("template stays quiet without a pair, strategy language, or compare language", async () => {
  const { mod, dir } = await loadModule("src/lib/deterministicSql/strategySplit.ts", "strategySplit.mjs");
  try {
    const base = {
      lower: "did mercedes split strategies between russell and hamilton at spa 2025",
      targetSession: 9939,
      driverA: 63,
      driverB: 44
    };
    assert.equal(mod.buildStrategySplitTemplate({ ...base, driverB: undefined }), null, "needs a pair");
    assert.equal(
      mod.buildStrategySplitTemplate({ ...base, lower: "who was faster between russell and hamilton at spa" }),
      null,
      "needs strategy language"
    );
    assert.equal(
      mod.buildStrategySplitTemplate({ ...base, lower: "what was russell s strategy at spa" }),
      null,
      "needs split/compare language"
    );
    assert.equal(
      mod.buildStrategySplitTemplate({ ...base, lower: "how many different strategies did russell and hamilton use" }),
      null,
      "count questions are excluded"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Insight builder
// ---------------------------------------------------------------------------

const VENUE = { country_name: "Belgium", location: "Spa-Francorchamps", year: 2025, session_name: "Race" };

function stintRow(driverNumber, name, team, stint, compound, start, end, extra = {}) {
  return {
    driver_number: driverNumber,
    driver_name: name,
    team_name: team,
    stint_number: stint,
    compound,
    stint_start_lap: start,
    stint_end_lap: end,
    stint_length_laps: end - start + 1,
    avg_valid_lap: null,
    grid_position: extra.grid ?? null,
    finish_position: extra.finish ?? null,
    positions_gained: null,
    ...VENUE
  };
}

const HAM = (stint, compound, start, end) =>
  stintRow(44, "Lewis HAMILTON", "Ferrari", stint, compound, start, end, { grid: 18, finish: 7 });
const RUS = (stint, compound, start, end) =>
  stintRow(63, "George RUSSELL", "Mercedes", stint, compound, start, end, { grid: 6, finish: 5 });

test("mirrored strategies → NO verdict with pit offset + not-teammates premise check", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/strategySplitInsight.ts", "strategySplitInsight.mjs");
  try {
    const rows = [
      RUS(1, "INTERMEDIATE", 1, 1), RUS(2, "MEDIUM", 2, 12), RUS(3, "MEDIUM", 13, 44),
      HAM(1, "INTERMEDIATE", 1, 1), HAM(2, "MEDIUM", 2, 11), HAM(3, "MEDIUM", 12, 44)
    ];
    const res = mod.buildStrategySplitInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "NO");
    assert.match(res.insight.verdict.summary, /Both ran Int → Med → Med/);
    assert.match(res.insight.verdict.summary, /within 1 lap/);
    // Premise check: Hamilton is Ferrari in 2025.
    assert.ok(
      res.insight.key_takeaways.some((t) => /Not teammates in 2025/.test(t) && /Ferrari/.test(t)),
      "not-teammates takeaway present"
    );
    assert.match(res.answer, /not teammates/i);
    // Finish tile from grid_vs_finish.
    assert.ok(res.insight.metrics.some((m) => m.label === "Finish" && /P5 · P7/.test(m.value)));
    // Russell mentioned first (driver A by row order).
    assert.match(res.insight.metrics[0].label, /Russell/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("different stop counts → YES structural split", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/strategySplitInsight.ts", "strategySplitInsight.mjs");
  try {
    const rows = [
      RUS(1, "MEDIUM", 1, 22), RUS(2, "HARD", 23, 44),
      HAM(1, "MEDIUM", 1, 14), HAM(2, "HARD", 15, 32), HAM(3, "MEDIUM", 33, 44)
    ];
    const res = mod.buildStrategySplitInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "YES");
    assert.match(res.insight.verdict.summary, /Russell ran 1 stop .*against Hamilton's 2/i);
    assert.match(res.answer, /genuine strategy split/);
    assert.ok(res.insight.metrics[0].emphasis && res.insight.metrics[1].emphasis);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same stops, different compounds → YES compound split", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/strategySplitInsight.ts", "strategySplitInsight.mjs");
  try {
    const rows = [
      RUS(1, "MEDIUM", 1, 22), RUS(2, "HARD", 23, 44),
      HAM(1, "SOFT", 1, 18), HAM(2, "HARD", 19, 44)
    ];
    const res = mod.buildStrategySplitInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "YES");
    assert.match(res.insight.verdict.summary, /Same stop count but different compounds/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same sequence, big timing offset → NO with divergence note", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/strategySplitInsight.ts", "strategySplitInsight.mjs");
  try {
    const rows = [
      RUS(1, "MEDIUM", 1, 12), RUS(2, "HARD", 13, 44),
      HAM(1, "MEDIUM", 1, 25), HAM(2, "HARD", 26, 44)
    ];
    const res = mod.buildStrategySplitInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "NO");
    assert.match(res.insight.verdict.summary, /stop timing diverged by up to 13 laps/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns null on empty, wrong shape, or not-exactly-two drivers", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/strategySplitInsight.ts", "strategySplitInsight.mjs");
  try {
    assert.equal(mod.buildStrategySplitInsight(undefined), null);
    assert.equal(mod.buildStrategySplitInsight([]), null);
    assert.equal(mod.buildStrategySplitInsight([{ lap_number: 1, delta_s: 0.1 }]), null);
    assert.equal(
      mod.buildStrategySplitInsight([RUS(1, "MEDIUM", 1, 22), RUS(2, "HARD", 23, 44)]),
      null,
      "single driver is not a split question"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F15 (DNF) + F19 (fragmented stints) — golden-set audit 2026-07-02
// ---------------------------------------------------------------------------

// stintRow with an explicit avg_valid_lap (real stints have a lap time;
// SC/red-flag tyre-record fragments have null).
function stintRowV(driverNumber, name, team, stint, compound, start, end, avg, extra = {}) {
  return {
    driver_number: driverNumber, driver_name: name, team_name: team,
    stint_number: stint, compound, stint_start_lap: start, stint_end_lap: end,
    stint_length_laps: end - start + 1, avg_valid_lap: avg,
    grid_position: extra.grid ?? null, finish_position: extra.finish ?? null,
    positions_gained: null, ...VENUE
  };
}

test("F15: a driver who retired early → verdict NO 'can't compare', not a 0-stop split", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/strategySplitInsight.ts", "strategySplitInsight.mjs");
  try {
    // Leclerc runs full 72 laps (2 stops); Hamilton's only stint ends lap 22 (DNF).
    const rows = [
      stintRowV(16, "Charles LECLERC", "Ferrari", 1, "MEDIUM", 1, 24, 78.1, { grid: 4, finish: 3 }),
      stintRowV(16, "Charles LECLERC", "Ferrari", 2, "HARD", 25, 48, 79.0, { grid: 4, finish: 3 }),
      stintRowV(16, "Charles LECLERC", "Ferrari", 3, "HARD", 49, 72, 79.4, { grid: 4, finish: 3 }),
      stintRowV(44, "Lewis HAMILTON", "Ferrari", 1, "MEDIUM", 1, 22, 78.9, { grid: 5, finish: 20 })
    ];
    const res = mod.buildStrategySplitInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "NO");
    assert.match(res.insight.verdict.summary, /Can't compare strategies|not meaningful after the retirement/i);
    assert.ok(!/genuine strategy split/.test(res.answer), "must NOT call a DNF a strategy split");
    assert.match(res.answer, /retired before the finish/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F19: contiguous same-compound micro-fragments merge → correct stop count", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/strategySplitInsight.ts", "strategySplitInsight.mjs");
  try {
    // Albon: 1 real stop (2 stints). Sainz: 1 real stop + 3 same-compound
    // 1-lap fragments (null avg) at the end from a late SC →真 stops = 1.
    const rows = [
      stintRowV(23, "Alexander ALBON", "Williams", 1, "MEDIUM", 1, 40, 75.0, { grid: 9, finish: 8 }),
      stintRowV(23, "Alexander ALBON", "Williams", 2, "HARD", 41, 70, 75.5, { grid: 9, finish: 8 }),
      stintRowV(55, "Carlos SAINZ", "Williams", 1, "MEDIUM", 1, 40, 75.1, { grid: 10, finish: 9 }),
      stintRowV(55, "Carlos SAINZ", "Williams", 2, "HARD", 41, 65, 75.6, { grid: 10, finish: 9 }),
      stintRowV(55, "Carlos SAINZ", "Williams", 3, "HARD", 66, 66, null, { grid: 10, finish: 9 }),
      stintRowV(55, "Carlos SAINZ", "Williams", 4, "HARD", 67, 67, null, { grid: 10, finish: 9 }),
      stintRowV(55, "Carlos SAINZ", "Williams", 5, "HARD", 68, 68, null, { grid: 10, finish: 9 })
    ];
    const res = mod.buildStrategySplitInsight(rows);
    assert.ok(res);
    // Sainz真 stops after merge = 1 (not 4); both drivers 1 stop → NO split.
    assert.equal(res.insight.verdict.label, "NO");
    assert.ok(!/Sainz's 4|to Sainz's 4/.test(res.insight.verdict.summary), "4 fragments must not count as 4 stops");
    assert.ok(res.insight.key_takeaways.some((t) => /fragment.*merged|merged.*not counted/i.test(t)), "merge caveat present");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
