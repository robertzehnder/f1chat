// Tests for the race-analysis cards added 2026-06-10 (second wave):
//   raceTrace (gap evolution + over/under-cut verdict),
//   degradationCurve, positionChanges, telemetryOverlay.
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

async function load(relPath) {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-race-cards-"));
  const src = await readFile(path.resolve(webRoot, relPath), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const file = path.join(dir, "mod.mjs");
  await writeFile(file, out, "utf8");
  const mod = await import(file);
  return { mod, dir };
}

const BANNED = /\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i;

test("all four templates fire on their prompts with read-only SQL", async () => {
  const cases = [
    {
      rel: "src/lib/deterministicSql/raceTrace.ts",
      fn: "buildRaceTraceTemplate",
      input: { lower: "did russell s covering stop on the lap after verstappen in canada 2025 successfully execute the over-cut", targetSession: 9963, driverA: 63, driverB: 1 },
      key: "session_race_trace"
    },
    {
      rel: "src/lib/deterministicSql/degradationCurve.ts",
      fn: "buildDegradationCurveTemplate",
      input: { lower: "how big is the tyre cliff at bahrain 2025 show the deg curves", targetSession: 10014, driverA: undefined, driverB: undefined },
      key: "compound_degradation_curve"
    },
    {
      rel: "src/lib/deterministicSql/positionChanges.ts",
      fn: "buildPositionChangesTemplate",
      input: { lower: "show the position changes at silverstone 2025", targetSession: 9947 },
      key: "race_position_changes"
    },
    {
      rel: "src/lib/deterministicSql/telemetryOverlay.ts",
      fn: "buildTelemetryOverlayTemplate",
      input: { lower: "show the lap telemetry comparison for verstappen and norris at suzuka 2025", targetSession: 10006, driverA: 1, driverB: 4 },
      key: "driver_telemetry_overlay"
    }
  ];
  for (const c of cases) {
    const { mod, dir } = await load(c.rel);
    try {
      const tpl = mod[c.fn](c.input);
      assert.ok(tpl, `${c.key} should fire`);
      assert.equal(tpl.templateKey, c.key);
      assert.ok(!tpl.sql.includes(";"), `${c.key}: no statement separator`);
      assert.ok(!BANNED.test(tpl.sql), `${c.key}: no banned keywords`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("race trace: over-cut verdict YES when the later stopper emerges ahead", async () => {
  const { mod, dir } = await load("src/lib/synthesis/raceTraceInsight.ts");
  try {
    const VENUE = { country_name: "Canada", location: "Montréal", year: 2025, session_name: "Race" };
    const row = (driver, name, lap, gap, opts = {}) => ({
      driver_number: driver, driver_name: name, lap_number: lap,
      gap_to_leader_s: gap, is_pit_lap: opts.pit ?? false, is_neutralized: false,
      is_focus: opts.focus ?? false, analysis_kind: "pit_cycle",
      grid_position: 1, finish_position: opts.finish ?? null, ...VENUE
    });
    const rows = [];
    // Driver B (early stopper) pits lap 10; A (late stopper) pits lap 11
    // and emerges ahead: relative gap (A−B) flips from +1.5 to −1.0.
    for (let lap = 1; lap <= 15; lap += 1) {
      rows.push(row(63, "George RUSSELL", lap, lap >= 12 ? 4.0 : 5.5, { pit: lap === 11, focus: true, finish: 2 }));
      rows.push(row(1, "Max VERSTAPPEN", lap, lap >= 12 ? 5.0 : 4.0, { pit: lap === 10, focus: true, finish: 3 }));
      rows.push(row(4, "Lando NORRIS", lap, 0, { finish: 1 }));
    }
    const res = mod.buildRaceTraceInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.verdict?.label, "YES");
    assert.match(res.insight.verdict.summary, /Russell stayed out/);
    assert.match(res.insight.title, /Pit-Cycle Trace/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("degradation curve: cliff detected and rate computed per compound", async () => {
  const { mod, dir } = await load("src/lib/synthesis/degradationCurveInsight.ts");
  try {
    const VENUE = { country_name: "Bahrain", location: "Sakhir", year: 2025, session_name: "Race" };
    const point = (compound, age, delta, laps = 8) => ({
      compound_name: compound, tyre_age: age, deg_delta_s: delta, lap_count: laps, compound_baseline_s: 95, ...VENUE
    });
    const rows = [
      point("SOFT", 1, 0), point("SOFT", 5, 0.3), point("SOFT", 9, 0.9), point("SOFT", 12, 1.4),
      point("HARD", 1, 0), point("HARD", 10, 0.2), point("HARD", 20, 0.45)
    ];
    const res = mod.buildDegradationCurveInsight(rows);
    assert.ok(res);
    assert.ok(res.insight.key_takeaways.some((t) => /Soft: degrades .* cliff around tyre age 9/.test(t)), "soft cliff at age 9");
    assert.ok(res.insight.key_takeaways.some((t) => /Hard: .*no sustained cliff/.test(t)), "hard has no cliff");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("position changes: biggest climber/faller + change-feed caveat", async () => {
  const { mod, dir } = await load("src/lib/synthesis/positionChangesInsight.ts");
  try {
    const VENUE = { country_name: "UK", location: "Silverstone", year: 2025, session_name: "Race" };
    const row = (driver, name, lap, pos, grid, finish) => ({
      driver_number: driver, driver_name: name, lap_number: lap, position: pos,
      grid_position: grid, finish_position: finish, total_laps: 52, ...VENUE
    });
    const rows = [
      row(44, "Lewis HAMILTON", 0, 18, 18, 7), row(44, "Lewis HAMILTON", 30, 9, 18, 7),
      row(1, "Max VERSTAPPEN", 0, 1, 1, 5),
      row(4, "Lando NORRIS", 0, 3, 3, 1)
    ];
    const res = mod.buildPositionChangesInsight(rows);
    assert.ok(res);
    assert.match(res.insight.metrics[0].value, /Hamilton \+11/);
    assert.ok(res.insight.key_takeaways.some((t) => /logs changes only/.test(t)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("telemetry overlay: lap delta metric + differing-laps caveat", async () => {
  const { mod, dir } = await load("src/lib/synthesis/telemetryOverlayInsight.ts");
  try {
    const VENUE = { country_name: "Japan", location: "Suzuka", year: 2025, session_name: "Race" };
    const rows = [
      { driver_number: 1, driver_name: "Max VERSTAPPEN", fastest_lap_number: 52, lap_duration: 92.144, top_speed_kph: 329, overlay_session_key: 10006, ...VENUE },
      { driver_number: 4, driver_name: "Lando NORRIS", fastest_lap_number: 51, lap_duration: 92.581, top_speed_kph: 331, overlay_session_key: 10006, ...VENUE }
    ];
    const res = mod.buildTelemetryOverlayInsight(rows);
    assert.ok(res);
    assert.ok(res.insight.metrics.some((m) => m.label === "Lap delta" && m.value === "0.437s"));
    assert.ok(res.insight.key_takeaways.some((t) => /best efforts, not the same moment/.test(t)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("telemetry overlay: requested driver with no valid lap is named, not dropped", async () => {
  const { mod, dir } = await load("src/lib/synthesis/telemetryOverlayInsight.ts");
  try {
    // The Sainz/Spielberg incident: lap-1 retirement → null fastest lap.
    const VENUE = { country_name: "Austria", location: "Spielberg", year: 2025, session_name: "Race" };
    const rows = [
      { driver_number: 55, driver_name: "Carlos SAINZ", fastest_lap_number: null, lap_duration: null, top_speed_kph: null, laps_completed: 1, overlay_session_key: 9955, ...VENUE },
      { driver_number: 81, driver_name: "Oscar PIASTRI", fastest_lap_number: 59, lap_duration: 67.924, top_speed_kph: 319, laps_completed: 70, overlay_session_key: 9955, ...VENUE }
    ];
    const res = mod.buildTelemetryOverlayInsight(rows);
    assert.ok(res);
    assert.match(res.answer, /comparison isn't possible/);
    assert.match(res.answer, /Sainz has no valid flying lap/);
    assert.match(res.answer, /completed 1 lap/);
    assert.match(res.answer, /Showing Piastri's fastest lap/);
    assert.match(res.insight.subtitle, /no valid lap for Sainz/);
    assert.ok(res.insight.metrics.some((m) => m.label === "Sainz" && m.value === "no valid lap"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
