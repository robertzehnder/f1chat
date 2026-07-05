// Tests for the driver_pair_stint_delta deterministic card:
//   1. the SQL template trigger (pair + stint + delta language, read-only SQL)
//   2. the insight builder (reversal verdict, median-corroboration caveat,
//      outlier takeaway, null on wrong shape)
// Same transpile-at-test-time pattern as pace-cliff-insight.test.mjs —
// both sources only have `import type` deps, which erase.

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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-stint-delta-"));
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

test("template fires on a stint-delta reversal question with a driver pair", async () => {
  const { mod, dir } = await loadModule("src/lib/deterministicSql/stintDelta.ts", "stintDelta.mjs");
  try {
    const tpl = mod.buildStintDeltaTemplate({
      lower: "did hamilton s middle stint medium deltas to leclerc reverse on the final hard stint at 2025 bahrain",
      targetSession: 10014,
      driverA: 44,
      driverB: 16
    });
    assert.ok(tpl, "template should fire");
    assert.equal(tpl.templateKey, "driver_pair_stint_delta");
    assert.match(tpl.sql, /driver_number = 44/);
    assert.match(tpl.sql, /driver_number = 16/);
    // Read-only guard compatibility: no statement separator, no banned words.
    assert.ok(!tpl.sql.includes(";"), "SQL must not contain a statement separator");
    assert.ok(
      !/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i.test(tpl.sql),
      "SQL must not contain banned keywords"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("template stays quiet without a pair, without stint language, or without delta language", async () => {
  const { mod, dir } = await loadModule("src/lib/deterministicSql/stintDelta.ts", "stintDelta.mjs");
  try {
    const base = {
      lower: "did hamilton s stint deltas to leclerc reverse on the final stint",
      targetSession: 10014,
      driverA: 44,
      driverB: 16
    };
    assert.equal(mod.buildStintDeltaTemplate({ ...base, driverB: undefined }), null, "needs a pair");
    assert.equal(mod.buildStintDeltaTemplate({ ...base, driverA: undefined }), null, "needs a pair");
    assert.equal(
      mod.buildStintDeltaTemplate({ ...base, lower: "who was faster between hamilton and leclerc" }),
      null,
      "needs stint language"
    );
    assert.equal(
      mod.buildStintDeltaTemplate({ ...base, lower: "what stint lengths did hamilton run" }),
      null,
      "needs delta/comparison language"
    );
    assert.equal(
      mod.buildStintDeltaTemplate({ ...base, lower: "how many stints did hamilton run vs leclerc" }),
      null,
      "count questions are not delta questions"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Insight builder
// ---------------------------------------------------------------------------

const META = {
  driver_a_name: "Lewis HAMILTON",
  driver_b_name: "Charles LECLERC",
  country_name: "Bahrain",
  location: "Sakhir",
  year: 2025,
  session_name: "Race",
  outlier_lap_count: 0
};

// One row per shared green lap; stint aggregates repeated per row like the SQL.
function stintRows(stintNumber, firstLap, deltas, { avg, median, aComp = "MEDIUM", bComp = "MEDIUM", outliers = 0 } = {}) {
  return deltas.map((delta, i) => ({
    lap_number: firstLap + i,
    delta_s: delta,
    stint_number: stintNumber,
    a_compound: aComp,
    b_compound: bComp,
    same_compound: aComp === bComp,
    stint_avg_delta: avg,
    stint_median_delta: median,
    stint_lap_count: deltas.length,
    is_stint_start: i === 0,
    ...META,
    outlier_lap_count: outliers
  }));
}

test("clean reversal → YES verdict, green, medians corroborate", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/stintDeltaInsight.ts", "stintDeltaInsight.mjs");
  try {
    const rows = [
      ...stintRows(2, 18, [0.45, 0.4, 0.35, 0.42], { avg: 0.405, median: 0.41 }),
      ...stintRows(3, 34, [-0.3, -0.25, -0.35, -0.28], { avg: -0.295, median: -0.29, aComp: "HARD", bComp: "HARD" })
    ];
    const res = mod.buildStintDeltaInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "YES");
    assert.equal(res.insight.verdict.color, "#22C55E");
    assert.match(res.insight.verdict.summary, /flipped/);
    assert.ok(!/outlier laps drive/.test(res.insight.verdict.summary), "no outlier caveat when medians corroborate");
    assert.match(res.insight.title, /Hamilton vs Leclerc/);
    assert.match(res.insight.subtitle, /Sakhir 2025/);
    // Final stint tile is emphasised.
    const emphasised = res.insight.metrics.filter((m) => m.emphasis);
    assert.equal(emphasised.length, 1);
    assert.match(emphasised[0].label, /Stint 3/);
    assert.match(res.answer, /reversed on stint 3/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no sign flip → NO verdict", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/stintDeltaInsight.ts", "stintDeltaInsight.mjs");
  try {
    const rows = [
      ...stintRows(2, 18, [0.1, 0.05, 0.08], { avg: 0.068, median: 0.08 }),
      ...stintRows(3, 34, [0.25, 0.2, 0.3], { avg: 0.235, median: 0.25, aComp: "HARD", bComp: "HARD" })
    ];
    const res = mod.buildStintDeltaInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "NO");
    assert.match(res.insight.verdict.summary, /No sign flip/);
    assert.match(res.answer, /did not reverse/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("average flips but median does not corroborate → YES with amber outlier caveat", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/stintDeltaInsight.ts", "stintDeltaInsight.mjs");
  try {
    const rows = [
      ...stintRows(2, 18, [0.1, 0.05, 0.08], { avg: 0.068, median: -0.078 }),
      ...stintRows(3, 34, [-2.5, 0.3, 0.25], { avg: -0.65, median: 0.292, aComp: "HARD", bComp: "HARD" })
    ];
    const res = mod.buildStintDeltaInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "YES");
    assert.equal(res.insight.verdict.color, "#F59E0B");
    assert.match(res.insight.verdict.summary, /outlier laps drive the flip/);
    assert.ok(
      res.insight.key_takeaways.some((t) => /median did not/.test(t)),
      "takeaway explains the median disagreement"
    );
    assert.match(res.answer, /rests on a few outlier laps/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("excluded outlier laps and offset compounds surface as takeaways", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/stintDeltaInsight.ts", "stintDeltaInsight.mjs");
  try {
    const rows = [
      ...stintRows(2, 18, [0.1, 0.05], { avg: 0.075, median: 0.075, outliers: 1 }),
      ...stintRows(3, 34, [0.2, 0.25], { avg: 0.225, median: 0.225, aComp: "HARD", bComp: "MEDIUM", outliers: 1 })
    ];
    const res = mod.buildStintDeltaInsight(rows);
    assert.ok(res);
    assert.ok(
      res.insight.key_takeaways.some((t) => /1 shared lap with a gap above 5s excluded/.test(t)),
      "outlier exclusion takeaway present"
    );
    assert.ok(
      res.insight.key_takeaways.some((t) => /Leclerc was on Medium against Hamilton's Hard/.test(t)),
      "offset-compound caveat present"
    );
    // Tile label shows both compounds when offset.
    assert.ok(res.insight.metrics.some((m) => /Hard\/Medium/.test(m.label)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns null on empty or wrong-shaped rows", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/stintDeltaInsight.ts", "stintDeltaInsight.mjs");
  try {
    assert.equal(mod.buildStintDeltaInsight(undefined), null);
    assert.equal(mod.buildStintDeltaInsight([]), null);
    assert.equal(mod.buildStintDeltaInsight([{ lap_number: 1, lap_duration: 90 }]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("single stint → no verdict, but stats still render", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/stintDeltaInsight.ts", "stintDeltaInsight.mjs");
  try {
    const rows = stintRows(1, 2, [0.3, 0.4, 0.35], { avg: 0.35, median: 0.35 });
    const res = mod.buildStintDeltaInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict, undefined);
    assert.equal(res.insight.metrics.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing earlier stints → answer leads with the gap, takeaway flags it", async () => {
  const { mod, dir } = await loadModule("src/lib/synthesis/stintDeltaInsight.ts", "stintDeltaInsight.mjs");
  try {
    // Only stint 3 survives the shared-green-lap filter (the seed-7
    // Silverstone incident: the answer narrated stint 3 as if it were
    // the whole story).
    const only3 = mod.buildStintDeltaInsight(stintRows(3, 34, [0.3, 0.4, 0.35], { avg: 0.35, median: 0.35 }));
    assert.ok(only3);
    assert.match(only3.answer, /^Did the deltas reverse\? That can't be determined/);
    assert.match(only3.answer, /only stint 3 has shared green laps/);
    assert.match(only3.answer, /stints 1 and 2 have none/);
    assert.ok(only3.insight.key_takeaways.some((t) => /Stints 1, 2: no shared green laps/.test(t)));
    // Stints 1 and 3 present, 2 missing → noted but comparison proceeds.
    const gap2 = mod.buildStintDeltaInsight([
      ...stintRows(1, 2, [0.3, 0.4], { avg: 0.35, median: 0.35 }),
      ...stintRows(3, 34, [-0.3, -0.2], { avg: -0.25, median: -0.25 })
    ]);
    assert.ok(gap2);
    assert.match(gap2.answer, /^A reversal across stint 2 can't be assessed/);
    assert.match(gap2.answer, /what CAN be compared is stints 1 and 3/);
    assert.ok(gap2.insight.verdict, "two comparable stints still produce a verdict");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
