import type { ChatApiResponse, MessagePart } from "@/lib/chatTypes";
import type { ChartSpec, DraftInsight } from "@/lib/chart-types";
import { getTeamColor } from "@/lib/f1-team-colors";

// =============================================================================
// foldPartsIntoInsight — collapse SSE MessagePart stream into DraftInsight
// =============================================================================

export function foldPartsIntoInsight(
  prev: DraftInsight | null,
  part: MessagePart
): DraftInsight {
  const next: DraftInsight = prev ?? { body: "" };
  switch (part.type) {
    case "text":
      next.body = next.body ? `${next.body}\n\n${part.text}` : part.text;
      break;
    case "sql":
      next.sql = part.sql;
      break;
    case "table":
      next.rows = part.rows;
      next.rowCount = part.rowCount;
      next.elapsedMs = part.elapsedMs;
      next.truncated = part.truncated;
      if (part.title) next.title = part.title;
      next.chart = detectChart(part.rows) ?? next.chart;
      break;
    case "warning":
      // InsightMock doesn't define a `warnings` field; fold validator
      // warnings into key_takeaways with a "⚠" prefix instead.
      next.key_takeaways = [
        ...(next.key_takeaways ?? []),
        ...part.messages.map((m) => `⚠ ${m}`)
      ];
      break;
    case "followUps":
      next.related_questions = [
        ...(next.related_questions ?? []),
        ...part.prompts
      ];
      break;
    case "metadata":
      // Suppressed at the part level; refusal/etc. flows through
      // applyResponseSemantics on the final ChatApiResponse.
      break;
  }
  return next;
}

// =============================================================================
// applyResponseSemantics — final-frame ChatApiResponse semantics (M21 refusal)
// =============================================================================

const PROPRIETARY_FALLBACK = [
  "Speed at any sample point on the lap",
  "Brake-pedal on/off state and pressure proxy",
  "Throttle application percentage",
  "Lap-time deltas through the brake zone"
];

export function applyResponseSemantics(
  insight: DraftInsight,
  response: ChatApiResponse
): DraftInsight {
  const next = { ...insight };
  const src = response.generationSource;

  if (src === "no_data_refusal" || src === "proprietary_no_data") {
    next.tone = "muted";
    if (!next.what_we_have || next.what_we_have.length === 0) {
      next.what_we_have = PROPRIETARY_FALLBACK;
    }
    if (!next.title) next.title = "Not in dataset";
    next.chart = undefined;
  }

  return next;
}

// =============================================================================
// applyScalarHero — M01 single-row scalar promotion
// =============================================================================

const IDENTIFIER_COLS = new Set([
  "driver_number",
  "session_key",
  "lap_number",
  "meeting_key",
  "year",
  "round",
  "id"
]);

const COMPOUND_COLS = new Set(["compound", "starting_compound", "tyre", "tyre_compound"]);
const COMPOUND_VALUES = /^(HARD|MEDIUM|SOFT|INTER|INTERMEDIATE|WET|C1|C2|C3|C4|C5)$/i;

function humanizeColumnName(col: string): string {
  const words = col.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function isCompoundShaped(col: string, val: unknown): boolean {
  if (COMPOUND_COLS.has(col)) return true;
  return typeof val === "string" && COMPOUND_VALUES.test(val);
}

function isTimeShaped(val: unknown): boolean {
  return typeof val === "string" && /^[\d:.+-]+$/.test(val);
}

function pickValueCol(row: Record<string, unknown>, cols: string[]): string {
  const eligible = cols.filter((c) => !IDENTIFIER_COLS.has(c));
  const compoundCol = eligible.find((c) => isCompoundShaped(c, row[c]));
  if (compoundCol) return compoundCol;
  const timeCol = eligible.find((c) => isTimeShaped(row[c]));
  if (timeCol) return timeCol;
  const numCol = eligible.find((c) => typeof row[c] === "number");
  if (numCol) return numCol;
  return eligible[0] ?? cols[0];
}

export function applyScalarHero(insight: DraftInsight): DraftInsight {
  if (insight.chart) return insight;
  if (insight.hero) return insight;
  if (!insight.rows || insight.rows.length !== 1) return insight;
  const row = insight.rows[0];
  const cols = Object.keys(row);
  if (cols.length === 0 || cols.length > 3) return insight;

  const valueCol = pickValueCol(row, cols);

  const otherCol = cols.find((c) => c !== valueCol && !IDENTIFIER_COLS.has(c));
  const otherLabel = otherCol ? String(row[otherCol] ?? "").trim() : "";
  const label =
    otherLabel.length > 0
      ? otherLabel
      : humanizeColumnName(valueCol) || (insight.subtitle ?? "Result");

  const next = { ...insight };
  next.hero = { value: String(row[valueCol]), label };
  return next;
}

// =============================================================================
// applyVerdictSemantics — M02 YES/NO verdict promotion
// =============================================================================

export function applyVerdictSemantics(insight: DraftInsight): DraftInsight {
  if (insight.verdict) return insight;
  const body = insight.body?.trimStart() ?? "";
  const m = body.match(/^(YES|NO)\b[\s—:.,-]*(.*?)(?:[.!?](?:\s|$)|$)/i);
  if (!m) return insight;
  const label = m[1].toUpperCase() as "YES" | "NO";
  const summary = m[2].trim();
  if (summary.length === 0) return insight;

  const next = { ...insight };
  next.verdict = { label, summary, color: "#E10600" };
  next.body = body.slice(m[0].length).trimStart();
  return next;
}

// =============================================================================
// detectChart — Tier 1 chart auto-detection from result rows
// =============================================================================

function detectChart(rows: Record<string, unknown>[] | undefined): ChartSpec | undefined {
  if (!rows || rows.length === 0) return undefined;
  const cols = Object.keys(rows[0]);

  if (cols.includes("corner_label") && cols.some((c) => /entry|apex|exit|speed/.test(c))) {
    return buildGroupedBar(rows);
  }
  if (cols.includes("position_delta")) {
    return buildDivergingBar(rows);
  }
  if (cols.includes("clean_air_laps") && cols.includes("traffic_laps")) {
    return buildStackedHorizontal(rows);
  }
  if (cols.includes("compound") && cols.includes("stint_start_lap")) {
    return buildStintGantt(rows);
  }
  if (cols.includes("lap_number") && cols.some((c) => /lap_time|delta/.test(c))) {
    return buildLineChart(rows);
  }
  if (cols.includes("driver_name") || cols.includes("driver_number")) {
    const numericCol = cols.find(
      (c) => !IDENTIFIER_COLS.has(c) && typeof rows[0][c] === "number"
    );
    if (numericCol) return buildHorizontalBar(rows, numericCol);
  }
  return undefined;
}

// =============================================================================
// Tier 1 chart builders
// =============================================================================

function getDriverColor(row: Record<string, unknown>): string {
  const name = String(row.driver_name ?? "");
  return getTeamColor(name);
}

function buildGroupedBar(rows: Record<string, unknown>[]): ChartSpec {
  // Group by corner_label, pivot driver_name into series.
  // Pick the speed metric column (entry_speed_kph preferred, then apex/exit/speed).
  const speedCol =
    Object.keys(rows[0]).find((c) => /entry.*speed|entry_speed/.test(c)) ??
    Object.keys(rows[0]).find((c) => /apex.*speed|apex_min_speed/.test(c)) ??
    Object.keys(rows[0]).find((c) => /exit.*speed/.test(c)) ??
    Object.keys(rows[0]).find((c) => /speed/.test(c)) ??
    "speed_kph";

  const corners = Array.from(new Set(rows.map((r) => String(r.corner_label ?? "")))).filter(Boolean);
  const drivers = Array.from(new Set(rows.map((r) => String(r.driver_name ?? "")))).filter(Boolean);

  const series = drivers.map((driver) => {
    const values = corners.map((corner) => {
      const match = rows.find(
        (r) => String(r.driver_name) === driver && String(r.corner_label) === corner
      );
      const v = match?.[speedCol];
      return typeof v === "number" ? v : 0;
    });
    return {
      name: driver,
      values,
      color: getTeamColor(driver)
    };
  });

  return {
    type: "grouped_bar",
    x_axis: corners,
    y_label: humanizeColumnName(speedCol),
    series
  };
}

function buildDivergingBar(rows: Record<string, unknown>[]): ChartSpec {
  // X-axis = driver labels; values = position_delta (signed).
  const sorted = [...rows].sort((a, b) => {
    return Number(b.position_delta ?? 0) - Number(a.position_delta ?? 0);
  });
  const labels = sorted.map((r) => String(r.driver_name ?? r.driver_number ?? ""));
  const values = sorted.map((r) => Number(r.position_delta ?? 0));

  return {
    type: "horizontal_bar_diverging",
    y_axis: labels,
    x_label: "Positions gained / lost",
    series: [
      {
        name: "Position Δ",
        values,
        color: "#E10600"
      }
    ]
  };
}

function buildStackedHorizontal(rows: Record<string, unknown>[]): ChartSpec {
  // y_axis = drivers; two series: clean_air_laps + traffic_laps.
  const labels = rows.map((r) => String(r.driver_name ?? r.driver_number ?? ""));
  const cleanAir = rows.map((r) => Number(r.clean_air_laps ?? 0));
  const traffic = rows.map((r) => Number(r.traffic_laps ?? 0));

  return {
    type: "stacked_horizontal_bar",
    y_axis: labels,
    x_label: "Laps",
    series: [
      { name: "Clean Air", values: cleanAir, color: "#A3A3A3" },
      { name: "In Traffic", values: traffic, color: "#E10600" }
    ]
  };
}

const COMPOUND_HEX: Record<string, string> = {
  hard: "#E5E7EB",
  medium: "#FCD34D",
  soft: "#EF4444",
  inter: "#22C55E",
  intermediate: "#22C55E",
  wet: "#3B82F6"
};

function buildStintGantt(rows: Record<string, unknown>[]): ChartSpec {
  const drivers = Array.from(new Set(rows.map((r) => String(r.driver_name ?? r.driver_number ?? "")))).filter(Boolean);
  const stints = rows.map((r) => {
    const compound = String(r.compound ?? "medium").toLowerCase() as
      | "hard"
      | "medium"
      | "soft"
      | "inter"
      | "wet";
    return {
      driver: String(r.driver_name ?? r.driver_number ?? ""),
      start: Number(r.stint_start_lap ?? 0),
      end: Number(r.stint_end_lap ?? 0),
      compound,
      lap_times_avg: typeof r.avg_lap_time === "number" ? Number(r.avg_lap_time) : undefined
    };
  });
  const totalLaps = Math.max(...stints.map((s) => s.end || 0), 0);

  return {
    type: "stint_gantt",
    y_axis: drivers,
    total_laps: totalLaps,
    stints,
    compound_legend: COMPOUND_HEX
  };
}

function buildLineChart(rows: Record<string, unknown>[]): ChartSpec {
  // X = lap_number; pivot by driver_name into series.
  const valueCol =
    Object.keys(rows[0]).find((c) => /lap_time/.test(c)) ??
    Object.keys(rows[0]).find((c) => /delta/.test(c)) ??
    "lap_time";
  const drivers = Array.from(new Set(rows.map((r) => String(r.driver_name ?? "")))).filter(Boolean);
  const laps = Array.from(new Set(rows.map((r) => Number(r.lap_number ?? 0)))).sort((a, b) => a - b);

  // Build y-array per driver aligned to the laps axis.
  const series = drivers.map((driver) => ({
    name: driver,
    color: getTeamColor(driver),
    values: laps.map((lap) => {
      const match = rows.find(
        (r) => String(r.driver_name) === driver && Number(r.lap_number) === lap
      );
      const v = match?.[valueCol];
      return typeof v === "number" ? v : 0;
    })
  }));

  return {
    type: "line",
    x_label: "Lap",
    y_label: humanizeColumnName(valueCol),
    series
  };
}

function buildHorizontalBar(
  rows: Record<string, unknown>[],
  numericCol: string
): ChartSpec {
  const sorted = [...rows].sort(
    (a, b) => Number(b[numericCol] ?? 0) - Number(a[numericCol] ?? 0)
  );
  const labels = sorted.map((r) => String(r.driver_name ?? r.driver_number ?? ""));
  const values = sorted.map((r) => Number(r[numericCol] ?? 0));

  return {
    type: "horizontal_bar",
    y_axis: labels,
    x_label: humanizeColumnName(numericCol),
    series: [
      {
        name: humanizeColumnName(numericCol),
        values,
        color: "#E10600"
      }
    ]
  };
}

// Internal helpers re-exported for tests.
export const __test = {
  pickValueCol,
  humanizeColumnName,
  IDENTIFIER_COLS,
  COMPOUND_COLS
};
