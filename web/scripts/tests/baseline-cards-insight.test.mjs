// Consolidated tests for the six baseline-sweep cards added 2026-06-10:
//   performanceRadar (M17), raceControlIncidents (M15),
//   telemetryWeatherGap (M18), lap1Positions (M12),
//   wetCrossover (M14), brakeZones (M05).
// Each template: trigger + read-only SQL safety. Each builder: happy path
// + the honesty behavior that motivated it. Transpile-at-test-time
// pattern (type-only imports erase).

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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-baseline-cards-"));
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
function assertSqlSafe(sql, label) {
  assert.ok(!sql.includes(";"), `${label}: no statement separator`);
  assert.ok(!BANNED.test(sql), `${label}: no banned keywords`);
}

const VENUE = { country_name: "Australia", location: "Melbourne", year: 2025, session_name: "Race" };

// ---------------------------------------------------------------------------
// Templates: trigger + SQL safety
// ---------------------------------------------------------------------------

test("all six templates fire on their baseline prompts and emit read-only SQL", async () => {
  const cases = [
    {
      rel: "src/lib/deterministicSql/performanceRadar.ts",
      fn: "buildPerformanceRadarTemplate",
      input: { lower: "where does verstappen s edge over norris come from in 2025 qualifying axis or race pace axis", driverA: 1, driverB: 4 },
      key: "driver_pair_performance_radar"
    },
    {
      rel: "src/lib/deterministicSql/raceControlIncidents.ts",
      fn: "buildRaceControlIncidentsTemplate",
      input: { lower: "how many penalty points were issued by stewards at the 2025 sao paulo grand prix", targetSession: 9869 },
      key: "session_race_control_incidents"
    },
    {
      rel: "src/lib/deterministicSql/telemetryWeatherGap.ts",
      fn: "buildTelemetryWeatherGapTemplate",
      input: { lower: "across the 2025 season which sessions have telemetry but no matching weather data" },
      key: "sessions_telemetry_without_weather"
    },
    {
      rel: "src/lib/deterministicSql/lap1Positions.ts",
      fn: "buildLap1PositionsTemplate",
      input: { lower: "on the lap 1 launch at australia 2025 did norris or verstappen gain more positions before the first sc", targetSession: 9693, driverA: 4, driverB: 1 },
      key: "driver_pair_lap1_positions"
    },
    {
      rel: "src/lib/deterministicSql/wetCrossover.ts",
      fn: "buildWetCrossoverTemplate",
      input: { lower: "what was the inter to slick crossover lap for the mclarens at australia 2025", targetSession: 9693, driverA: 4, driverB: 81 },
      key: "driver_pair_wet_crossover"
    },
    {
      rel: "src/lib/deterministicSql/brakeZones.ts",
      fn: "buildBrakeZonesTemplate",
      input: { lower: "across the three heaviest brake zones at bahrain 2025 did piastri s lap 1 brake zone delta to norris foreshadow lap pace deficit", targetSession: 10014, driverA: 81, driverB: 4 },
      key: "driver_pair_brake_zones"
    }
  ];
  for (const c of cases) {
    const { mod, dir } = await load(c.rel);
    try {
      const tpl = mod[c.fn](c.input);
      assert.ok(tpl, `${c.key} should fire`);
      assert.equal(tpl.templateKey, c.key);
      assertSqlSafe(tpl.sql, c.key);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

test("performance radar: edges per axis + unpopulated-axis caveat", async () => {
  const { mod, dir } = await load("src/lib/synthesis/performanceRadarInsight.ts");
  try {
    const row = (name, q, r) => ({
      driver_name: name, team_name: "T", season_year: 2025,
      qualifying_axis: q, race_pace_axis: r, tyre_management_axis: 50,
      restart_axis: 0, traffic_handling_axis: 40, overtake_difficulty_axis: 60, error_rate_axis: 70
    });
    const res = mod.buildPerformanceRadarInsight([
      { ...row("Max VERSTAPPEN", 90, 85), restart_axis: 0 },
      { ...row("Lando NORRIS", 80, 88), restart_axis: 0, tyre_management_axis: 55, traffic_handling_axis: 40, overtake_difficulty_axis: 60, error_rate_axis: 70 }
    ]);
    assert.ok(res);
    assert.match(res.answer, /Qualifying/);
    assert.ok(res.insight.key_takeaways.some((t) => /1 of 7 axes not yet populated/.test(t)), "restart axis 0-0 flagged");
    assert.ok(res.insight.metrics.length >= 1);
    assert.equal(mod.buildPerformanceRadarInsight([{ driver_name: "X" }]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("race-control incidents: penalty-points honesty leads the answer", async () => {
  const { mod, dir } = await load("src/lib/synthesis/raceControlIncidentsInsight.ts");
  try {
    const inc = (lap, driver, kind, secs) => ({
      lap, driver, kind, message: "msg", action_status: "served",
      penalty_seconds: secs, penalty_points: null, ...VENUE
    });
    const res = mod.buildRaceControlIncidentsInsight([
      inc(3, "Lewis HAMILTON", "TrackLimits", null),
      inc(12, "Max VERSTAPPEN", "TimePenalty", 5),
      inc(30, "Race control", "SafetyCar", null)
    ]);
    assert.ok(res);
    assert.match(res.answer, /penalty points aren't ingested/i);
    assert.match(res.answer, /3 race-control events/);
    assert.ok(res.insight.metrics.some((m) => m.label === "Penalty points" && m.value === "n/a"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("telemetry/weather gap: zero gaps reads as full coverage, not 'no rows'", async () => {
  const { mod, dir } = await load("src/lib/synthesis/telemetryWeatherGapInsight.ts");
  try {
    const sess = (label, weather) => ({ session_key: 1, session_label: label, telemetry: "full", weather, year: 2025 });
    const clean = mod.buildTelemetryWeatherGapInsight([sess("Race · Melbourne 2025", "full"), sess("Quali · Melbourne 2025", "full")]);
    assert.ok(clean);
    assert.match(clean.answer, /^None — every session/);
    const gappy = mod.buildTelemetryWeatherGapInsight([sess("Sprint · Shanghai 2025", "missing"), sess("Race · Melbourne 2025", "full")]);
    assert.match(gappy.answer, /1 session in 2025/);
    assert.match(gappy.answer, /Sprint · Shanghai 2025/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lap-1 positions: winner verdict + end-of-lap-1 caveat; tie → NO", async () => {
  const { mod, dir } = await load("src/lib/synthesis/lap1PositionsInsight.ts");
  try {
    const row = (name, grid, lap1) => ({
      driver_name: name, grid_position: grid, lap1_position: lap1,
      position_delta: grid - lap1, ...VENUE
    });
    const res = mod.buildLap1PositionsInsight([row("Lando NORRIS", 3, 1), row("Max VERSTAPPEN", 1, 2)]);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "YES");
    assert.match(res.insight.verdict.summary, /Norris gained 2 positions/);
    assert.ok(res.insight.key_takeaways.some((t) => /end of lap 1/.test(t)));
    const tie = mod.buildLap1PositionsInsight([row("A B", 4, 3), row("C D", 8, 7)]);
    assert.equal(tie.insight.verdict.label, "NO");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("wet crossover: same-lap crossover called out; no-crossover handled", async () => {
  const { mod, dir } = await load("src/lib/synthesis/wetCrossoverInsight.ts");
  try {
    const lapRow = (name, lap, wet, xo) => ({
      lap_number: lap, driver_name: name, lap_time_s: 100 - lap,
      wet_track: wet, compound_name: wet ? "INTERMEDIATE" : "MEDIUM",
      inter_to_slick_crossover_lap: xo, ...VENUE
    });
    const rows = [
      lapRow("Lando NORRIS", 2, 1, 34), lapRow("Lando NORRIS", 35, 0, 34),
      lapRow("Oscar PIASTRI", 2, 1, 34), lapRow("Oscar PIASTRI", 35, 0, 34)
    ];
    const res = mod.buildWetCrossoverInsight(rows);
    assert.ok(res);
    assert.match(res.answer, /lap 34/);
    assert.match(res.answer, /switched together/);
    const none = mod.buildWetCrossoverInsight([lapRow("Lando NORRIS", 2, 0, null)]);
    assert.match(none.answer, /No inter-to-slick crossover is recorded/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brake zones: foreshadow verdict matches pace direction", async () => {
  const { mod, dir } = await load("src/lib/synthesis/brakeZonesInsight.ts");
  try {
    // shared_pace_delta_s = A − B median over shared green laps (A = first
    // row's driver); negative = A faster.
    const row = (corner, name, entry, apex, paceDelta) => ({
      corner_label: corner, driver_name: name,
      entry_speed_kph: entry, apex_min_speed_kph: apex,
      brake_drop_kph: entry - apex, zone_avg_drop_kph: 150,
      shared_pace_delta_s: paceDelta, shared_green_laps: 40, ...VENUE
    });
    // Piastri carries more apex speed AND is faster on shared laps → YES.
    const yes = mod.buildBrakeZonesInsight([
      row("Turn 1", "Oscar PIASTRI", 320, 95, -0.3), row("Turn 1", "Lando NORRIS", 318, 90, -0.3),
      row("Turn 11", "Oscar PIASTRI", 280, 80, -0.3), row("Turn 11", "Lando NORRIS", 279, 77, -0.3)
    ]);
    assert.equal(yes.insight.verdict.label, "YES");
    assert.match(yes.answer, /did foreshadow/);
    assert.match(yes.answer, /more apex speed than Norris/);
    assert.match(yes.answer, /laps both drivers ran green/);
    // Norris leads brake zones but Piastri faster on shared laps → NO.
    const no = mod.buildBrakeZonesInsight([
      row("Turn 1", "Oscar PIASTRI", 320, 90, -0.3), row("Turn 1", "Lando NORRIS", 318, 95, -0.3)
    ]);
    assert.equal(no.insight.verdict.label, "NO");
    assert.match(no.answer, /did not foreshadow/);
    // Fewer than 5 shared green laps → pace comparison withheld, no verdict.
    const thin = mod.buildBrakeZonesInsight([
      { ...row("Turn 1", "Oscar PIASTRI", 320, 95, -0.3), shared_green_laps: 3 },
      { ...row("Turn 1", "Lando NORRIS", 318, 90, -0.3), shared_green_laps: 3 }
    ]);
    assert.equal(thin.insight.verdict, undefined);
    assert.match(thin.answer, /Too few shared green laps/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
