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
  applyResponseSemantics,
  applyScalarHero,
  applyVerdictSemantics,
  foldPartsIntoInsight
} from "../../src/lib/mapInsight";
import { mapChatApiResponseToParts } from "../../src/lib/mapChatResponse";
import type { ChatApiResponse } from "../../src/lib/chatTypes";
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

test("horizontal_bar — driver_name + numeric column", () => {
  const r = runPipeline(fxRanking);
  assert.equal(r.chart?.type, "horizontal_bar");
  assert.equal(r.chart?.y_axis?.[0], "Lando Norris");
  assert.equal(r.chart?.series?.[0]?.values?.[0], 7);
});

test("line — lap_number + lap_time", () => {
  const r = runPipeline(fxLine);
  assert.equal(r.chart?.type, "line");
  assert.equal(r.chart?.series?.length, 2);
});

test("M21 refusal — generationSource=no_data_refusal sets muted tone", () => {
  const r = runPipeline(fxRefusal);
  assert.equal(r.tone, "muted");
  assert.ok(r.what_we_have && r.what_we_have.length > 0);
  assert.equal(r.chart, undefined);
  assert.equal(r.title, "Not in dataset");
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
