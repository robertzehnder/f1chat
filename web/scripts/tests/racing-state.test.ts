// Racing-state layer (visuals plan S1.1): builder classification, the
// trusted-session attachment rule, fold-side attachment in either arrival
// order, and the response→part mapping.
//
// Run: tsx --test scripts/tests/racing-state.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachRacingStateToChart,
  buildRacingStateLayer,
  isInferredEnd,
  trustedSessionKey
} from "../../src/lib/racingState/build";
import { foldPartsIntoInsight } from "../../src/lib/mapInsight";
import { mapChatApiResponseToParts } from "../../src/lib/mapChatResponse";
import type { ChatApiResponse } from "../../src/lib/chatTypes";
import type { ChartSpec, RacingStateLayer } from "../../src/lib/chart-types";

// Monza 2026 as the 062 view returns it.
const MONZA_ROWS = [
  { kind: "sc", start_ts: "2026-09-06T13:05:07Z", end_ts: "2026-09-06T13:07:43Z", start_lap: 3, end_lap: 3, endpoint_inferred: "superseded_by_red", opened_by_message: "SAFETY CAR DEPLOYED", closed_by_message: "RED FLAG" },
  { kind: "red", start_ts: "2026-09-06T13:07:43Z", end_ts: "2026-09-06T13:34:00Z", start_lap: 3, end_lap: 4, endpoint_inferred: "resumption_state_msg", opened_by_message: "RED FLAG", closed_by_message: "SAFETY CAR LIGHTS ON" },
  { kind: "sc", start_ts: "2026-09-06T13:34:00Z", end_ts: "2026-09-06T13:36:30Z", start_lap: 4, end_lap: 4, endpoint_inferred: "lights_on_lap_end", opened_by_message: "SAFETY CAR LIGHTS ON", closed_by_message: null },
  { kind: "vsc", start_ts: "2026-09-06T14:12:10Z", end_ts: "2026-09-06T14:15:02Z", start_lap: 28, end_lap: 29, endpoint_inferred: "ending_lap_end", opened_by_message: "VSC DEPLOYED", closed_by_message: null }
];
const SECTORS = [
  { lap_number: 1, sector: 2, flag: "YELLOW", date: "2026-09-06T13:01:20Z" },
  { lap_number: 1, sector: 5, flag: "DOUBLE YELLOW", date: "2026-09-06T13:01:25Z" },
  { lap_number: 0, sector: 1, flag: "YELLOW", date: "2026-09-06T12:59:00Z" }, // pre-race: dropped
  { lap_number: 20, sector: 6, flag: "GREEN", date: "2026-09-06T13:58:00Z" } // not a yellow: dropped
];

test("builder: Monza → incomplete (inferred ends), periods in time order, notes say why", () => {
  const layer = buildRacingStateLayer({ sessionKey: 11361, intervalRows: MONZA_ROWS, sectorRows: SECTORS, raceControlRowCount: 157, hasChequered: true });
  assert.equal(layer.source, "incomplete");
  assert.deepEqual(layer.periods.map((p) => p.kind), ["sc", "red", "sc", "vsc"]);
  assert.equal(layer.periods[1].to_lap, 4);
  assert.equal(layer.periods[3].closed_by, null);
  assert.deepEqual(layer.sector_flags.map((f) => [f.lap, f.sector, f.level]), [[1, 2, "yellow"], [1, 5, "double_yellow"]]);
  assert.equal(layer.notes.length, 2, "one note per inferred end; superseded/resumption closures are exact");
  assert.match(layer.notes[1], /VSC end inferred at end of lap 29 \(feed has no VSC ENDED message\)/);
});

test("builder: superseded and resumption closures are exact; lap-end / never-closed are inferred", () => {
  assert.equal(isInferredEnd("superseded_by_red"), false);
  assert.equal(isInferredEnd("resumption_state_msg"), false);
  assert.equal(isInferredEnd("ending_lap_end"), true);
  assert.equal(isInferredEnd("never_closed"), true);
  assert.equal(isInferredEnd(null), false);
});

test("builder: feed present with zero periods → available, no notes (honest absence draws nothing)", () => {
  const layer = buildRacingStateLayer({ sessionKey: 1, intervalRows: [], sectorRows: [], raceControlRowCount: 40, hasChequered: true });
  assert.equal(layer.source, "available");
  assert.deepEqual(layer.notes, []);
});

test("builder: no race-control rows → absent with its note; missing chequered → incomplete", () => {
  const absent = buildRacingStateLayer({ sessionKey: 1, intervalRows: [], sectorRows: [], raceControlRowCount: 0, hasChequered: false });
  assert.equal(absent.source, "absent");
  assert.match(absent.notes[0], /feed unavailable/);
  const noChq = buildRacingStateLayer({ sessionKey: 1, intervalRows: [], sectorRows: [], raceControlRowCount: 12, hasChequered: false });
  assert.equal(noChq.source, "incomplete");
  assert.match(noChq.notes[0], /ends before the chequered flag/);
});

test("trustedSessionKey: rows with a single matching session_key → trusted; mixed or foreign → not", () => {
  const base = { resolvedSessionKey: 11361, deterministicTemplate: false, sql: "SELECT 1" };
  assert.equal(trustedSessionKey({ ...base, rows: [{ session_key: 11361 }, { session_key: "11361" }] }), 11361);
  assert.equal(trustedSessionKey({ ...base, rows: [{ session_key: 11361 }, { session_key: 11360 }] }), null);
  assert.equal(trustedSessionKey({ ...base, rows: [{ session_key: 9999 }] }), null);
});

test("trustedSessionKey: deterministic templates are trusted; LLM SQL needs exactly one matching literal", () => {
  const rows = [{ lap_number: 1, driver_name: "X" }];
  assert.equal(trustedSessionKey({ resolvedSessionKey: 11361, deterministicTemplate: true, sql: "", rows }), 11361);
  assert.equal(trustedSessionKey({ resolvedSessionKey: 11361, deterministicTemplate: false, sql: "SELECT * FROM core.laps_enriched WHERE session_key = 11361", rows }), 11361);
  assert.equal(trustedSessionKey({ resolvedSessionKey: 11361, deterministicTemplate: false, sql: "SELECT * FROM x WHERE session_key IN (11361, 11300)", rows }), null);
  assert.equal(trustedSessionKey({ resolvedSessionKey: 11361, deterministicTemplate: false, sql: "SELECT * FROM x WHERE session_key = 11300", rows }), null);
  assert.equal(trustedSessionKey({ resolvedSessionKey: null, deterministicTemplate: true, sql: "", rows }), null);
});

const layer: RacingStateLayer = buildRacingStateLayer({ sessionKey: 11361, intervalRows: MONZA_ROWS, sectorRows: SECTORS, raceControlRowCount: 157, hasChequered: true });

test("attach: lap-axis charts get racing_state and lose the legacy bands/heuristic; other charts untouched", () => {
  const trace: ChartSpec = { type: "race_trace", series: [], neutralized_laps: [3, 4, 5], caution_bands: [{ from: 3, to: 5, label: "SC" }] };
  const out = attachRacingStateToChart(trace, layer);
  assert.equal(out.racing_state, layer);
  assert.equal(out.neutralized_laps, undefined);
  assert.equal(out.caution_bands, undefined);
  assert.deepEqual(trace.neutralized_laps, [3, 4, 5], "pure: input not mutated");
  const bar: ChartSpec = { type: "grouped_bar", series: [] };
  assert.equal(attachRacingStateToChart(bar, layer), bar);
});

test("attach: when the feed is absent the heuristic survives (renderer labels it) and the layer carries the note", () => {
  const absent = buildRacingStateLayer({ sessionKey: 1, intervalRows: [], sectorRows: [], raceControlRowCount: 0, hasChequered: false });
  const out = attachRacingStateToChart({ type: "race_trace", series: [], neutralized_laps: [7] }, absent);
  assert.deepEqual(out.neutralized_laps, [7]);
  assert.equal(out.racing_state?.source, "absent");
});

const TRACE_ROWS = [
  { lap_number: 1, driver_name: "Russell", gap_to_leader_s: 0, is_neutralized: false },
  { lap_number: 1, driver_name: "Antonelli", gap_to_leader_s: 3.2, is_neutralized: false },
  { lap_number: 2, driver_name: "Russell", gap_to_leader_s: 0, is_neutralized: true },
  { lap_number: 2, driver_name: "Antonelli", gap_to_leader_s: 2.1, is_neutralized: true }
];

test("fold: racing_state part attaches to the chart whether it arrives before or after the table part", () => {
  const after = [{ type: "table" as const, rows: TRACE_ROWS, rowCount: 4, elapsedMs: 1, truncated: false }, { type: "racing_state" as const, state: layer }]
    .reduce((acc, p) => foldPartsIntoInsight(acc, p), null as ReturnType<typeof foldPartsIntoInsight> | null);
  assert.equal(after?.chart?.type, "race_trace");
  assert.equal(after?.chart?.racing_state?.session_key, 11361);
  assert.equal(after?.chart?.neutralized_laps, undefined);
  const before = [{ type: "racing_state" as const, state: layer }, { type: "table" as const, rows: TRACE_ROWS, rowCount: 4, elapsedMs: 1, truncated: false }]
    .reduce((acc, p) => foldPartsIntoInsight(acc, p), null as ReturnType<typeof foldPartsIntoInsight> | null);
  assert.equal(before?.chart?.racing_state?.session_key, 11361);
});

test("mapChatApiResponseToParts: racingState on the payload becomes a racing_state part after the table", () => {
  const payload: ChatApiResponse = { answer: "x", sql: "SELECT 1", result: { rowCount: 4, elapsedMs: 1, truncated: false, rows: TRACE_ROWS }, racingState: layer };
  const parts = mapChatApiResponseToParts(payload);
  const idxTable = parts.findIndex((p) => p.type === "table");
  const idxState = parts.findIndex((p) => p.type === "racing_state");
  assert.ok(idxState > idxTable && idxTable >= 0);
  const none = mapChatApiResponseToParts({ ...payload, racingState: null });
  assert.equal(none.some((p) => p.type === "racing_state"), false);
});

import { reconcileRaceTraceProse } from "../../src/lib/racingState/server";

test("builder: repeated sector-yellow messages collapse to one tick per (lap, sector); double beats single", () => {
  const rows = [
    { lap_number: 3, sector: 15, flag: "YELLOW", date: "2026-09-06T13:05:00Z" },
    { lap_number: 3, sector: 15, flag: "YELLOW", date: "2026-09-06T13:05:04Z" },
    { lap_number: 3, sector: 16, flag: "YELLOW", date: "2026-09-06T13:05:01Z" },
    { lap_number: 3, sector: 16, flag: "DOUBLE YELLOW", date: "2026-09-06T13:05:03Z" }
  ];
  const l = buildRacingStateLayer({ sessionKey: 1, intervalRows: [], sectorRows: rows, raceControlRowCount: 10, hasChequered: true });
  assert.deepEqual(l.sector_flags.map((f) => [f.sector, f.level, f.issued_at]), [
    [15, "yellow", "2026-09-06T13:05:00Z"],
    [16, "double_yellow", "2026-09-06T13:05:01Z"]
  ]);
});

test("reconcile: the race-trace card's heuristic sentence, metric and takeaway become the record", () => {
  const payload: Record<string, unknown> = {
    answer: "The race trace at Monza 2026: each line is a driver's gap to the leader, lap by lap. Antonelli controlled it. Shaded bands mark 2 neutralized windows where the field compressed (inferred from synchronized lap-time spikes, not official race control data). Gaps are computed from cumulative lap times.",
    insight: {
      metrics: [{ label: "Winning margin", value: "3.899s" }, { label: "SC/VSC windows", value: "2", context: "laps 3–5 · lap 28" }],
      key_takeaways: ["Antonelli won by 3.899s over Russell", "Neutralized laps 3–5, lap 28 (detected from synchronized lap-time spikes)", "Gaps derived from cumulative lap times — immune to the sampled intervals feed's noise"]
    }
  };
  reconcileRaceTraceProse(payload, layer);
  assert.match(String(payload.answer), /Shaded bands mark the race-control record: SC lap 3, red flag laps 3–4, SC lap 4, VSC laps 28–29\./);
  assert.doesNotMatch(String(payload.answer), /lap-time spikes/);
  const ins = payload.insight as { metrics: Array<{ label: string; value: string }>; key_takeaways: string[] };
  assert.equal(ins.metrics[1].label, "Cautions (race control)");
  assert.equal(ins.metrics[1].value, "4");
  assert.equal(ins.key_takeaways[1], "Race control: SC lap 3, red flag laps 3–4, SC lap 4, VSC laps 28–29");
  assert.equal(ins.key_takeaways[0], "Antonelli won by 3.899s over Russell", "unrelated takeaways untouched");
});

test("reconcile: absent/failed layers leave the heuristic prose alone (it is still labelled a heuristic)", () => {
  const payload: Record<string, unknown> = { answer: "x Shaded bands mark 1 neutralized window where the field compressed (inferred from synchronized lap-time spikes, not official race control data)." };
  reconcileRaceTraceProse(payload, buildRacingStateLayer({ sessionKey: 1, intervalRows: [], sectorRows: [], raceControlRowCount: 0, hasChequered: false }));
  assert.match(String(payload.answer), /lap-time spikes/);
});
