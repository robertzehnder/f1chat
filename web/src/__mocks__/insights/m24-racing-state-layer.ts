// M24 — racing-state layer acceptance fixture (visuals plan S1.1).
// Monza 2026-shaped: SC on lap 3 superseded by a red flag, restart behind
// the SC on lap 4 (end inferred at lap end), a VSC on laps 28–29 whose end
// is inferred (the feed has no "VSC ENDED"), lap-1 sector yellows in four
// sectors (collision rule → count label) and a double yellow on lap 20.
// Every visual-grammar branch renders here so the pixel gate sees them.
import type { InsightMock, RacingStateLayer } from "@/lib/chart-types";

const TOTAL = 53;
const laps = Array.from({ length: TOTAL + 1 }, (_, i) => i); // 0 = grid

const trace = (grid: number, path: Array<[number, number]>): number[] => {
  const out: number[] = [];
  let cur = grid;
  for (const lap of laps) {
    const hit = path.find(([l]) => l === lap);
    if (hit) cur = hit[1];
    out.push(cur);
  }
  return out;
};

export const racingStateLayerMock: RacingStateLayer = {
  source: "incomplete",
  session_key: 11361,
  total_laps: TOTAL,
  periods: [
    { kind: "sc", start_ts: "2026-09-06T13:05:07Z", end_ts: "2026-09-06T13:07:43Z", from_lap: 3, to_lap: 3, endpoint_inferred: "superseded_by_red", opened_by: "SAFETY CAR DEPLOYED", closed_by: "RED FLAG" },
    { kind: "red", start_ts: "2026-09-06T13:07:43Z", end_ts: "2026-09-06T13:34:00Z", from_lap: 3, to_lap: 4, endpoint_inferred: "resumption_state_msg", opened_by: "RED FLAG", closed_by: "SAFETY CAR LIGHTS ON" },
    { kind: "sc", start_ts: "2026-09-06T13:34:00Z", end_ts: "2026-09-06T13:36:30Z", from_lap: 4, to_lap: 4, endpoint_inferred: "lights_on_lap_end", opened_by: "SAFETY CAR LIGHTS ON", closed_by: null },
    { kind: "vsc", start_ts: "2026-09-06T14:12:10Z", end_ts: "2026-09-06T14:15:02Z", from_lap: 28, to_lap: 29, endpoint_inferred: "ending_lap_end", opened_by: "VSC DEPLOYED", closed_by: null }
  ],
  sector_flags: [
    { lap: 1, sector: 2, level: "yellow", issued_at: "2026-09-06T13:01:20Z" },
    { lap: 1, sector: 3, level: "yellow", issued_at: "2026-09-06T13:01:22Z" },
    { lap: 1, sector: 5, level: "double_yellow", issued_at: "2026-09-06T13:01:25Z" },
    { lap: 1, sector: 8, level: "yellow", issued_at: "2026-09-06T13:01:40Z" },
    { lap: 20, sector: 6, level: "double_yellow", issued_at: "2026-09-06T13:58:00Z" },
    { lap: 49, sector: 1, level: "yellow", issued_at: "2026-09-06T14:45:00Z" }
  ],
  notes: [
    "SC end placed at L4 end; end of the SC-in lap, no end message recorded",
    "VSC end placed at L29 end; no VSC end message recorded"
  ]
};

export const m24: InsightMock = {
  title: "Antonelli's charge from 19th — with the race-state record",
  subtitle: "Italian Grand Prix 2026 · position by lap · SC / red / VSC periods and sector yellows from race control",
  body: "Positions are lap-end classified order. Red flag on lap 3 with the restart behind the safety car on lap 4; a virtual safety car on laps 28–29 priced the decisive stop.",
  chart: {
    type: "position_changes",
    series: [
      { name: "Antonelli", color: "#27F4D2", values: trace(19, [[1, 15], [2, 13], [3, 12], [10, 8], [18, 5], [26, 3], [29, 2], [50, 1]]), emphasis: true },
      { name: "Russell", color: "#6CD3BF", values: trace(2, [[1, 1], [29, 1], [50, 2]]), emphasis: true },
      { name: "Gasly", color: "#0093CC", values: trace(1, [[1, 2], [12, 3], [26, 4], [34, 6], [45, 7]]), emphasis: false },
      { name: "Verstappen", color: "#3671C6", values: trace(3, [[1, 3], [12, 2], [26, 5], [29, 7], [40, 4], [48, 3]]), emphasis: false }
    ],
    racing_state: racingStateLayerMock,
    chart_note: "4 of 20 drivers shown"
  },
  key_takeaways: [
    "Sequence, not a merged band: SC → red → SC inside laps 3–4 draws as stacked strips in time order.",
    "The VSC's end carries the inferred-end glyph and the note says why."
  ]
};
