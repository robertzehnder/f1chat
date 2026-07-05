// Adapter tests for web/src/lib/mapInsight.ts
//
// Run:   tsx --test scripts/tests/mapInsight.test.ts
//
// Coverage:
//   1. Tier-1 chart auto-detection (grouped_bar, horizontal_bar, line,
//      stacked_horizontal_bar, horizontal_bar_diverging, stint_gantt)
//   2. M01 hero (q1922-style scalar) with non-empty label assertions
//   3. M02 verdict (q2062-style YES/NO) with summary parsing
//   4. M21 refusal (q1750-style no_data_refusal) with muted tone +
//      what_we_have populated
//   5. SSE-stream concat: text parts that land in the final frame after
//      the cumulative stream string is already populated must NOT
//      double-print (page-level handler skips text parts at final fold)
//   6. Hero regression guards: identifier columns deny-listed; compound
//      values recognized

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyInsightFields,
  applyResponseSemantics,
  applyScalarHero,
  applyVerdictSemantics,
  foldPartsIntoInsight
} from "../../src/lib/mapInsight";
import { mapChatApiResponseToParts } from "../../src/lib/mapChatResponse";
import { pickInsightShape } from "../../src/lib/chatRuntime/insightShape";
import type { ChatApiResponse, InsightFields } from "../../src/lib/chatTypes";
import type { DraftInsight } from "../../src/lib/chart-types";

function runPipeline(fx: ChatApiResponse): DraftInsight {
  // Mirrors web/src/app/page.tsx final-frame handling.
  let insight: DraftInsight = { body: fx.answer ?? "" };
  for (const p of mapChatApiResponseToParts(fx)) {
    if (p.type !== "text") insight = foldPartsIntoInsight(insight, p);
  }
  insight = applyResponseSemantics(insight, fx);
  insight = applyScalarHero(insight);
  insight = applyVerdictSemantics(insight);
  return insight;
}

// ---------------------------------------------------------------------------
// Synthetic ChatApiResponse fixtures — shaped to exercise each Tier 1 detector
// ---------------------------------------------------------------------------

const fxGroupedBar: ChatApiResponse = {
  answer: "Across the Suzuka esses, Verstappen carried higher entry speeds at T7 and T8.",
  sql: "SELECT corner_label, driver_name, entry_speed_kph FROM analytics.corner_analysis ...",
  generationSource: "anthropic",
  result: {
    rowCount: 6,
    elapsedMs: 320,
    truncated: false,
    rows: [
      { corner_label: "T7", driver_name: "Max Verstappen", entry_speed_kph: 232 },
      { corner_label: "T7", driver_name: "Lewis Hamilton", entry_speed_kph: 227 },
      { corner_label: "T8", driver_name: "Max Verstappen", entry_speed_kph: 248 },
      { corner_label: "T8", driver_name: "Lewis Hamilton", entry_speed_kph: 242 },
      { corner_label: "T9", driver_name: "Max Verstappen", entry_speed_kph: 263 },
      { corner_label: "T9", driver_name: "Lewis Hamilton", entry_speed_kph: 264 }
    ]
  }
};

const fxRanking: ChatApiResponse = {
  answer: "The 2025 Imola GP produced 28 on-track overtakes; Norris led with 7.",
  sql: "SELECT driver_name, overtakes FROM analytics.overtake_events ...",
  generationSource: "anthropic",
  result: {
    rowCount: 5,
    elapsedMs: 180,
    truncated: false,
    rows: [
      { driver_name: "Lando Norris", overtakes: 7 },
      { driver_name: "Lewis Hamilton", overtakes: 5 },
      { driver_name: "Nico Hulkenberg", overtakes: 4 },
      { driver_name: "Carlos Sainz", overtakes: 3 },
      { driver_name: "Alex Albon", overtakes: 3 }
    ]
  }
};

const fxLine: ChatApiResponse = {
  answer: "Hamilton averaged 83.95s vs Russell 84.31s across the first stint.",
  sql: "SELECT lap_number, driver_name, lap_time FROM core.laps_enriched ...",
  generationSource: "anthropic",
  result: {
    rowCount: 4,
    elapsedMs: 290,
    truncated: false,
    rows: [
      { lap_number: 1, driver_name: "Lewis Hamilton", lap_time: 83.5 },
      { lap_number: 1, driver_name: "George Russell", lap_time: 84.0 },
      { lap_number: 2, driver_name: "Lewis Hamilton", lap_time: 82.9 },
      { lap_number: 2, driver_name: "George Russell", lap_time: 83.4 }
    ]
  }
};

const fxRefusal: ChatApiResponse = {
  answer:
    "Brake temperatures aren't part of the OpenF1 public telemetry feed. We ingest car_data, location, lap times, weather, and race control — but not internal component telemetry like brake/tyre temps.",
  sql: "",
  generationSource: "no_data_refusal"
};

const fxHeroPole: ChatApiResponse = {
  answer: "Verstappen took pole at Suzuka 2025 with a 1:27.502.",
  sql: "SELECT driver_name, pole_lap_time FROM ...",
  generationSource: "anthropic",
  result: {
    rowCount: 1,
    elapsedMs: 45,
    truncated: false,
    rows: [{ driver_name: "Max Verstappen", pole_lap_time: "1:27.502" }]
  }
};

const fxVerdict: ChatApiResponse = {
  answer:
    "YES — Russell's lap-29 stop gained track position over Verstappen by 1.4s after the cycle. With fresher mediums on the out-lap, he was 1.1s quicker than Verstappen's in-lap.",
  sql: "SELECT ...",
  generationSource: "anthropic",
  result: {
    rowCount: 0,
    elapsedMs: 200,
    truncated: false,
    rows: []
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("grouped_bar — corner_label + speed columns", () => {
  const r = runPipeline(fxGroupedBar);
  assert.equal(r.chart?.type, "grouped_bar");
  assert.ok(r.rows && r.rows.length === 6);
  assert.ok(r.body.length > 0);
  assert.equal(r.chart?.x_axis?.length, 3);
  assert.equal(r.chart?.series?.length, 2);
});

test("grouped_bar — numeric strings stay numeric, not zeroed", () => {
  const fx: ChatApiResponse = {
    answer: "Across the Suzuka esses, Verstappen carried higher entry speeds at T7 and T8.",
    sql: "SELECT corner_label, driver_name, entry_speed_kph FROM analytics.corner_analysis ...",
    generationSource: "anthropic",
    result: {
      rowCount: 6,
      elapsedMs: 320,
      truncated: false,
      rows: [
        { corner_label: "T7", driver_name: "Max Verstappen", entry_speed_kph: "232.6" },
        { corner_label: "T7", driver_name: "Lewis Hamilton", entry_speed_kph: "227.3" },
        { corner_label: "T8", driver_name: "Max Verstappen", entry_speed_kph: "247.6" },
        { corner_label: "T8", driver_name: "Lewis Hamilton", entry_speed_kph: "241.8" },
        { corner_label: "T9", driver_name: "Max Verstappen", entry_speed_kph: "262.0" },
        { corner_label: "T9", driver_name: "Lewis Hamilton", entry_speed_kph: "264.4" }
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "grouped_bar");
  assert.deepEqual(r.chart?.series?.[0]?.values, [232.6, 247.6, 262]);
  assert.deepEqual(r.chart?.series?.[1]?.values, [227.3, 241.8, 264.4]);
});

test("grouped_bar — wide driver-prefixed numeric strings stay numeric", () => {
  const fx: ChatApiResponse = {
    answer: "Verstappen and Hamilton are compared through Turns 7-9.",
    sql: "SELECT corner_label, ver_avg_entry_kph, ham_avg_entry_kph FROM ...",
    generationSource: "anthropic",
    result: {
      rowCount: 3,
      elapsedMs: 140,
      truncated: false,
      rows: [
        { corner_label: "Turn 7 (Esses)", ver_avg_entry_kph: "232.6", ham_avg_entry_kph: "227.3" },
        { corner_label: "Turn 8 (Degner 1)", ver_avg_entry_kph: "247.6", ham_avg_entry_kph: "241.8" },
        { corner_label: "Turn 9 (Degner 2)", ver_avg_entry_kph: "262.0", ham_avg_entry_kph: "264.4" }
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "grouped_bar");
  assert.deepEqual(r.chart?.x_axis, ["T7", "T8", "T9"]);
  assert.deepEqual(r.chart?.series?.[0]?.values, [232.6, 247.6, 262]);
  assert.deepEqual(r.chart?.series?.[1]?.values, [227.3, 241.8, 264.4]);
});

test("horizontal_bar — driver_name + numeric column", () => {
  const r = runPipeline(fxRanking);
  assert.equal(r.chart?.type, "horizontal_bar");
  // Y-axis labels are last-name-only to match v0 mock layout.
  assert.equal(r.chart?.y_axis?.[0], "Norris");
  assert.equal(r.chart?.series?.[0]?.values?.[0], 7);
});

test("horizontal_bar — inferred_overtakes rows pick 'overtakes' value despite carried venue cols", () => {
  const fx: ChatApiResponse = {
    answer: "Inferred ~17 on-track passes at Marina Bay 2025.",
    sql: "-- inferred_overtakes",
    generationSource: "deterministic_template",
    result: {
      rowCount: 3,
      elapsedMs: 90,
      truncated: false,
      rows: [
        { driver_name: "Fernando ALONSO", overtakes: 5, location: "Marina Bay", year: 2025, session_name: "Race" },
        { driver_name: "Alexander ALBON", overtakes: 4, location: "Marina Bay", year: 2025, session_name: "Race" },
        { driver_name: "Carlos SAINZ", overtakes: 3, location: "Marina Bay", year: 2025, session_name: "Race" }
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "horizontal_bar");
  // Value column must be overtakes (not year/identifier), top driver first.
  assert.equal(r.chart?.y_axis?.[0], "Alonso");
  assert.equal(r.chart?.series?.[0]?.values?.[0], 5);
});

test("line — lap_number + lap_time", () => {
  const r = runPipeline(fxLine);
  assert.equal(r.chart?.type, "line");
  assert.equal(r.chart?.series?.length, 2);
});

test("pit_event_strip — phases + post_cycle from single_driver_pit_cycle rows", () => {
  const fx: ChatApiResponse = {
    answer: "Antonelli's first stop came on lap 14, Medium to Hard.",
    sql: "-- single_driver_pit_cycle",
    generationSource: "deterministic_template",
    result: {
      rowCount: 3,
      elapsedMs: 90,
      truncated: false,
      rows: [
        { phase_label: "Lap 13", duration_sec: 77.73, stop_lap: 14, total_pit_loss_s: 23.32, stationary_s: null, before_position: 2, after_position: 7, recovered_by_lap: 37, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Andrea Kimi Antonelli" },
        { phase_label: "Pit lane", duration_sec: 23.32, stop_lap: 14, total_pit_loss_s: 23.32, stationary_s: null, before_position: 2, after_position: 7, recovered_by_lap: 37, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Andrea Kimi Antonelli" },
        { phase_label: "Out-lap (15)", duration_sec: 79.76, stop_lap: 14, total_pit_loss_s: 23.32, stationary_s: null, before_position: 2, after_position: 7, recovered_by_lap: 37, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Andrea Kimi Antonelli" }
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "pit_event_strip");
  assert.equal(r.chart?.phases?.length, 3);
  // Pit lane is the red time-loss segment; flanking laps are grey.
  assert.equal(r.chart?.phases?.[1]?.color, "#E10600");
  assert.equal(r.chart?.phases?.[0]?.color, "#9CA3AF");
  assert.deepEqual(r.chart?.post_cycle, {
    before_position: 2,
    after_position: 7,
    recovered_by_lap: 37
  });
});

test("pit_event_strip — omits post_cycle when before_position is a data gap", () => {
  const fx: ChatApiResponse = {
    answer: "Verstappen's first stop came on lap 12, Medium to Hard.",
    sql: "-- single_driver_pit_cycle",
    generationSource: "deterministic_template",
    result: {
      rowCount: 3,
      elapsedMs: 90,
      truncated: false,
      rows: [
        { phase_label: "Lap 11", duration_sec: 76.99, stop_lap: 12, total_pit_loss_s: 23.6, stationary_s: null, before_position: null, after_position: 8, recovered_by_lap: null, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Max VERSTAPPEN" },
        { phase_label: "Pit lane", duration_sec: 23.6, stop_lap: 12, total_pit_loss_s: 23.6, stationary_s: null, before_position: null, after_position: 8, recovered_by_lap: null, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Max VERSTAPPEN" },
        { phase_label: "Out-lap (13)", duration_sec: 79.05, stop_lap: 12, total_pit_loss_s: 23.6, stationary_s: null, before_position: null, after_position: 8, recovered_by_lap: null, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Max VERSTAPPEN" }
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "pit_event_strip");
  assert.equal(r.chart?.phases?.length, 3);
  assert.equal(r.chart?.post_cycle, undefined);
});

test("line_with_stint_markers — single-driver lap rows (no driver_name) render one trimmed series", () => {
  // Single-driver pace/cliff result: one row per lap, NO driver_name column,
  // is_pit_lap flag, a duplicated lap row, and unflagged outlier laps.
  // Regression for the empty-chart bug (drivers=[] → 0 series → blank box).
  const lap = (n: number, dur: number, opts: Partial<Record<string, unknown>> = {}) => ({
    lap_number: n,
    lap_duration: dur,
    delta_vs_rolling_avg: null,
    is_pit_lap: false,
    is_pit_out_lap: false,
    ...opts
  });
  const fx: ChatApiResponse = {
    answer: "Piastri's medium stint held steady before the stop.",
    sql: "SELECT lap_number, lap_duration, is_pit_lap FROM core.laps_enriched ...",
    generationSource: "anthropic",
    result: {
      rowCount: 9,
      elapsedMs: 120,
      truncated: false,
      rows: [
        lap(8, 81.18),
        lap(8, 81.18), // duplicate (warehouse dup rows)
        lap(9, 81.17),
        lap(10, 81.74), // cliff step
        lap(11, 81.74),
        lap(12, 81.68),
        lap(13, 95.6, { is_pit_lap: true }), // pit lap — excluded
        lap(14, 79.0, { is_pit_out_lap: true }), // out lap — excluded
        lap(30, 131.1) // unflagged anomaly — outlier-trimmed
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "line_with_stint_markers");
  assert.equal(r.chart?.series?.length, 1, "single-driver data must yield exactly one series");
  const values = r.chart?.series?.[0]?.values ?? [];
  const finite = values.filter((v) => Number.isFinite(v)) as number[];
  // Pit lap (95.6), out lap (79.0), and the 131s anomaly are all excluded;
  // the racing laps stay within a tight band so the cliff is visible.
  assert.ok(Math.max(...finite) < 90, `outliers must be trimmed; got max ${Math.max(...finite)}`);
  assert.ok(finite.length >= 5, "racing laps must remain");
  // Pit marker present and de-duped (lap 13 appears once despite dup rows).
  const pitMarkers = (r.chart?.stint_boundaries ?? []).filter((b) => b.lap === 13);
  assert.equal(pitMarkers.length, 1, "pit-lap marker must be de-duplicated");
});

test("line_with_stint_markers — NULL-sentinel (999999999) is stripped, not plotted", () => {
  // The value column is a delta here (median trim does NOT apply), so this
  // exercises the universal sentinel guard. A leaked 999999999 would
  // otherwise blow the y-axis domain to ~1e9.
  const fx: ChatApiResponse = {
    answer: "Lap-to-lap delta with a missing-lap sentinel.",
    sql: "SELECT lap_number, delta_vs_prev_lap, is_pit_lap FROM core.laps_enriched ...",
    generationSource: "anthropic",
    result: {
      rowCount: 5,
      elapsedMs: 80,
      truncated: false,
      rows: [
        { lap_number: 8, delta_vs_prev_lap: 0.05, is_pit_lap: false },
        { lap_number: 9, delta_vs_prev_lap: -0.02, is_pit_lap: false },
        { lap_number: 10, delta_vs_prev_lap: 0.57, is_pit_lap: false },
        { lap_number: 11, delta_vs_prev_lap: 999999999, is_pit_lap: false }, // sentinel
        { lap_number: 12, delta_vs_prev_lap: 0.01, is_pit_lap: false }
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "line_with_stint_markers");
  const finite = (r.chart?.series?.[0]?.values ?? []).filter((v) => Number.isFinite(v)) as number[];
  assert.ok(Math.max(...finite) < 1000, `sentinel must be stripped; got max ${Math.max(...finite)}`);
});

test("line_with_stint_markers — is_cliff_onset adds a 'Cliff' marker (pace-cliff card)", () => {
  const lap = (n: number, dur: number, opts: Partial<Record<string, unknown>> = {}) => ({
    lap_number: n,
    lap_duration: dur,
    delta_vs_rolling_avg: 0, // present so line_with_stint_markers matches
    is_pit_lap: false,
    is_pit_out_lap: false,
    is_cliff_onset: false,
    ...opts
  });
  const fx: ChatApiResponse = {
    answer: "Piastri's medium stint cliffed at lap 10 before the lap-13 stop.",
    sql: "-- single_driver_pace_cliff",
    generationSource: "deterministic_template",
    result: {
      rowCount: 6,
      elapsedMs: 90,
      truncated: false,
      rows: [
        lap(8, 81.18),
        lap(9, 81.17),
        lap(10, 81.74, { is_cliff_onset: true }),
        lap(11, 81.74),
        lap(12, 81.68),
        lap(13, 86.2, { is_pit_lap: true })
      ]
    }
  };
  const r = runPipeline(fx);
  assert.equal(r.chart?.type, "line_with_stint_markers");
  const labels = (r.chart?.stint_boundaries ?? []).map((b) => `${b.label}@${b.lap}`);
  assert.ok(labels.includes("Cliff@10"), `expected a Cliff marker at lap 10; got ${labels.join(", ")}`);
  assert.ok(labels.includes("Pit@13"), `expected a Pit marker at lap 13; got ${labels.join(", ")}`);
});

test("M21 refusal — generationSource=no_data_refusal sets muted tone", () => {
  const r = runPipeline(fxRefusal);
  assert.equal(r.tone, "muted");
  assert.ok(r.what_we_have && r.what_we_have.length > 0);
  assert.equal(r.chart, undefined);
  assert.equal(r.title, "Not in dataset");
});

test("M21 refusal — server-provided insight.what_we_have flows through (empty-table data gap)", () => {
  // Mirrors the orchestration data-gap refusal: a no_data_refusal carrying a
  // relevant what_we_have should render that list, NOT the generic fallback.
  // Exercises applyInsightFields (copies what_we_have) + applyResponseSemantics
  // (keeps it for no_data_refusal) — the page's final-fold order.
  const fx: ChatApiResponse = {
    answer: "INSUFFICIENT_DATA: raw.overtakes is empty in this warehouse, so there are no rows to analyse.",
    sql: "-- query not executed (data gap)",
    generationSource: "no_data_refusal"
  };
  const serverFields: InsightFields = {
    title: "Not in dataset",
    what_we_have: ["infer position changes from raw.position_history and raw.pit (not official overtakes)"]
  };
  let r: DraftInsight = { body: fx.answer };
  r = applyInsightFields(r, serverFields);
  r = applyResponseSemantics(r, fx);
  assert.equal(r.tone, "muted");
  assert.equal(r.chart, undefined);
  assert.equal(r.title, "Not in dataset");
  assert.deepEqual(r.what_we_have, [
    "infer position changes from raw.position_history and raw.pit (not official overtakes)"
  ]);
});

test("M01 hero — single-row scalar promotes to hero with non-empty label", () => {
  const r = runPipeline(fxHeroPole);
  assert.ok(r.hero, "hero set");
  assert.equal(r.hero!.value, "1:27.502");
  assert.ok(r.hero!.label.trim().length > 0, "hero.label must not be empty");
  // Other column on the row is driver_name (not an identifier), so it
  // becomes the label.
  assert.equal(r.hero!.label, "Max Verstappen");
});

test("M02 verdict — YES at body start splits into verdict + remaining body", () => {
  const r = runPipeline(fxVerdict);
  assert.ok(r.verdict, "verdict populated");
  assert.equal(r.verdict!.label, "YES");
  assert.ok(r.verdict!.summary.length > 0);
  // Body should have the verdict sentence stripped.
  assert.ok(!r.body.startsWith("YES"));
});

// --- applyScalarHero unit-style guards ---

test("applyScalarHero — single-column row produces non-empty label", () => {
  const insight: DraftInsight = { body: "", rows: [{ pole_lap_time: "1:27.502" }] };
  const r = applyScalarHero(insight);
  assert.ok(r.hero);
  assert.equal(r.hero!.value, "1:27.502");
  assert.equal(r.hero!.label, "Pole lap time");
});

test("applyScalarHero — q1941 starting compound prefers compound over driver_number", () => {
  const insight: DraftInsight = { body: "", rows: [{ driver_number: 1, compound: "MEDIUM" }] };
  const r = applyScalarHero(insight);
  assert.ok(r.hero);
  assert.equal(r.hero!.value, "MEDIUM", "compound column wins over identifier");
  assert.equal(r.hero!.label, "Compound");
});

test("applyScalarHero — compound recognized by enum value even without compound-named column", () => {
  const insight: DraftInsight = {
    body: "",
    rows: [{ driver_name: "Max VERSTAPPEN", tyre_compound: "SOFT" }]
  };
  const r = applyScalarHero(insight);
  assert.ok(r.hero);
  assert.equal(r.hero!.value, "SOFT");
  assert.equal(r.hero!.label, "Max VERSTAPPEN");
});

test("applyScalarHero — does NOT fire when chart already detected", () => {
  const insight: DraftInsight = {
    body: "",
    rows: [{ driver_name: "Max", overtakes: 7 }],
    chart: { type: "horizontal_bar" }
  };
  const r = applyScalarHero(insight);
  assert.equal(r.hero, undefined, "hero must not overwrite when chart exists");
});

// --- foldPartsIntoInsight ---

test("foldPartsIntoInsight — text parts concatenate with \\n\\n", () => {
  let insight: DraftInsight = { body: "" };
  insight = foldPartsIntoInsight(insight, { type: "text", text: "First sentence." });
  insight = foldPartsIntoInsight(insight, { type: "text", text: "Second sentence." });
  assert.equal(insight.body, "First sentence.\n\nSecond sentence.");
});

test("foldPartsIntoInsight — warning part folds into key_takeaways with ⚠", () => {
  let insight: DraftInsight = { body: "" };
  insight = foldPartsIntoInsight(insight, {
    type: "warning",
    messages: ["Only 41 laps available; expected 53."]
  });
  assert.ok(insight.key_takeaways);
  assert.ok(insight.key_takeaways!.some((t) => t.startsWith("⚠")));
});

test("foldPartsIntoInsight — followUps part populates related_questions", () => {
  let insight: DraftInsight = { body: "" };
  insight = foldPartsIntoInsight(insight, {
    type: "followUps",
    prompts: ["Show qualifying comparison", "Add Leclerc"]
  });
  assert.equal(insight.related_questions?.length, 2);
});

test("foldPartsIntoInsight — table part captures sql + rows + auto-detects chart", () => {
  let insight: DraftInsight = { body: "" };
  insight = foldPartsIntoInsight(insight, {
    type: "table",
    rows: [
      { corner_label: "T7", driver_name: "Max Verstappen", entry_speed_kph: 232 },
      { corner_label: "T7", driver_name: "Lewis Hamilton", entry_speed_kph: 227 }
    ],
    rowCount: 2,
    elapsedMs: 100,
    truncated: false
  });
  assert.equal(insight.rowCount, 2);
  assert.equal(insight.chart?.type, "grouped_bar");
});

test("clean_air_laps + traffic_laps with total_ prefix → stacked_horizontal_bar", () => {
  // Regression guard: backend SQL returned `total_clean_air_laps` /
  // `total_traffic_laps` but the original detector required the bare
  // `clean_air_laps` / `traffic_laps`. Now matches both via regex.
  const fx: ChatApiResponse = {
    answer: "Across the 2025 season, Leclerc led clean-air laps with 4,224.",
    sql: "SELECT ...",
    generationSource: "anthropic",
    result: {
      rowCount: 2,
      elapsedMs: 99,
      truncated: false,
      rows: [
        { driver_name: "Charles LECLERC", total_clean_air_laps: 4224, total_traffic_laps: 1128 },
        { driver_name: "George RUSSELL",  total_clean_air_laps: 4078, total_traffic_laps: 1294 }
      ]
    }
  };
  let insight: DraftInsight = { body: fx.answer ?? "" };
  for (const p of mapChatApiResponseToParts(fx)) {
    if (p.type !== "text") insight = foldPartsIntoInsight(insight, p);
  }
  assert.equal(insight.chart?.type, "stacked_horizontal_bar");
  assert.equal(insight.chart?.series?.length, 2);
  assert.equal(insight.chart?.series?.[0]?.name, "Clean Air");
  assert.equal(insight.chart?.series?.[1]?.name, "In Traffic");
});

test("pickInsightShape — refusal generationSource → refusal", () => {
  const r = pickInsightShape({
    message: "What was Hamilton's brake temperature at Turn 8?",
    questionType: "telemetry_analysis",
    generationSource: "no_data_refusal"
  });
  assert.equal(r, "refusal");
});

test("pickInsightShape — 'did X work' verdict pattern → verdict", () => {
  const r = pickInsightShape({
    message: "Did Russell's overcut on Verstappen work at Canada 2025?",
    questionType: "comparison_analysis"
  });
  assert.equal(r, "verdict");
});

test("pickInsightShape — pole-lap question → hero", () => {
  const r = pickInsightShape({
    message: "What was Verstappen's pole lap time at Suzuka 2025?",
    questionType: "aggregate_analysis"
  });
  assert.equal(r, "hero");
});

test("pickInsightShape — single-corner brake-zone → metric-grid", () => {
  const r = pickInsightShape({
    message: "What was Verstappen's brake-zone speed drop into Turn 22?",
    questionType: "telemetry_analysis"
  });
  assert.equal(r, "metric-grid");
});

test("pickInsightShape — cross-category 'coincide with' → composite", () => {
  const r = pickInsightShape({
    message: "Did the front-right graining coincide with a pace cliff at Imola?",
    questionType: "comparison_analysis"
  });
  assert.equal(r, "composite");
});

test("pickInsightShape — default falls through to chart-with-metrics", () => {
  const r = pickInsightShape({
    message: "Compare Verstappen and Hamilton through the Suzuka esses",
    questionType: "comparison_analysis"
  });
  assert.equal(r, "chart-with-metrics");
});

test("pickInsightShape — 'how did X compare' is NOT verdict (false-positive guard)", () => {
  const r = pickInsightShape({
    message: "How did Hamilton's race pace compare to Russell at Monza?",
    questionType: "comparison_analysis"
  });
  assert.equal(r, "chart-with-metrics", "'how did' must not flip to verdict");
});

test("applyInsightFields — populates title, subtitle, metrics, takeaways, related_questions from synthesis JSON", () => {
  const fields: InsightFields = {
    title: "Clean Air vs Traffic — 2025 Season",
    subtitle: "All Race Sessions · 2025",
    metrics: [
      { label: "Most Clean-Air laps", value: "412", unit: "VER", emphasis: true },
      { label: "Pace Delta", value: "+0.42", unit: "s/lap" }
    ],
    key_takeaways: [
      "Verstappen led 82% of his laps in clean air",
      "Avg traffic pace penalty: +0.42 s/lap"
    ],
    related_questions: ["Show pace delta in traffic vs clean air", "Mexico 2025 specifically"]
  };
  const r = applyInsightFields({ body: "field-derived body" }, fields);
  assert.equal(r.title, "Clean Air vs Traffic — 2025 Season");
  assert.equal(r.subtitle, "All Race Sessions · 2025");
  assert.equal(r.metrics?.length, 2);
  assert.equal(r.metrics?.[0]?.emphasis, true);
  assert.equal(r.key_takeaways?.length, 2);
  assert.equal(r.related_questions?.length, 2);
});

test("applyInsightFields — preserves existing fields, doesn't overwrite", () => {
  const r = applyInsightFields(
    { body: "", title: "Existing title", metrics: [{ label: "x", value: "1" }] },
    { title: "New title", metrics: [{ label: "y", value: "2" }] }
  );
  assert.equal(r.title, "Existing title", "existing title kept");
  assert.equal(r.metrics?.[0]?.label, "x", "existing metrics kept");
});

test("applyInsightFields — null is a no-op (parse-failure fallback)", () => {
  const before: DraftInsight = { body: "hello" };
  const after = applyInsightFields(before, null);
  assert.deepEqual(after, before);
});

test("applyInsightFields — merges takeaways without dropping ⚠ warnings already present", () => {
  const r = applyInsightFields(
    { body: "", key_takeaways: ["⚠ Coverage gap on Lusail"] },
    { key_takeaways: ["Verstappen led 82%", "Avg pace penalty +0.42"] }
  );
  assert.equal(r.key_takeaways?.length, 3);
  assert.ok(r.key_takeaways?.[0].startsWith("⚠"), "warning preserved");
});

test("non-streaming path (clarification / deterministic) — body must populate from text part when no answer_delta arrives", () => {
  // Regression guard: when the route emits a single `final` frame with no
  // answer_delta events (e.g. runtime_clarification, deterministic_template),
  // mapChatApiResponseToParts produces a `text` part carrying the answer.
  // The page-level handler must fold the text part in this case (deltaCount=0).
  // Without that branch, the assistant card shows an empty body.
  const fxClarification: ChatApiResponse = {
    answer:
      "I couldn't resolve session/driver references within the time budget. Please rephrase or include explicit session_key.",
    sql: "-- query not executed (resolve timeout)",
    generationSource: "runtime_clarification"
  };
  const parts = mapChatApiResponseToParts(fxClarification);
  // Simulate the page-level final-fold flow with deltaCount = 0.
  let folded: DraftInsight = { body: "" };
  for (const p of parts) {
    folded = foldPartsIntoInsight(folded, p); // no skip — deltaCount === 0
  }
  assert.ok(folded.body.length > 0, "body must populate from text part");
  assert.ok(folded.body.includes("rephrase"), "body must contain the answer text");
});
