// Chart specification types — extended from v0's chart-types.ts to
// cover all per-shape fields actually used by v0's mock-insights.ts
// fixtures (stint_gantt's total_laps/stints/compound_legend, donut's
// center_label/slices, pit_event_strip's phases/post_cycle, track_heatmap's
// circuit/sector/view, etc.). Without these, /mock typecheck breaks.

export type ChartType =
  | "grouped_bar"
  | "line"
  | "horizontal_bar"
  | "horizontal_bar_diverging"
  | "stacked_horizontal_bar"
  | "line_dual_axis"
  | "line_with_stint_markers"
  | "timeline"
  | "event_timeline"
  | "radar"
  | "scatter_with_regression"
  | "status_grid"
  | "metric_grid"
  | "stint_gantt"
  | "donut"
  | "pit_event_strip"
  | "track_heatmap";

export interface ChartSeries {
  name: string;
  values: number[];
  color: string;
  slope?: number; // for scatter_with_regression
  points?: [number, number][]; // for scatter
  axis?: "y1" | "y2"; // for line_dual_axis
}

export interface TimelineEvent {
  lap: number;
  driver: string;
  kind: string;
  team_color: string;
  message: string;
}

export interface StatusGridRow {
  session_key?: number;
  label: string;
  [key: string]: string | number | undefined;
}

export interface VerticalMarker {
  x: number;
  label: string;
}

export interface StintSegment {
  driver: string;
  start: number;
  end: number;
  compound: "hard" | "medium" | "soft" | "inter" | "wet";
  lap_times_avg?: number;
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export interface PitPhase {
  label: string;
  duration_sec: number;
  color: string;
}

export interface ChartSpec {
  type: ChartType;
  // generic axes / labels
  x_axis?: string[];
  y_axis?: string[];
  x_label?: string;
  y_label?: string;
  y1_label?: string;
  y2_label?: string;
  axes?: string[]; // radar axis labels
  max_value?: number; // radar
  series?: ChartSeries[];
  events?: TimelineEvent[]; // timeline / event_timeline
  rows?: StatusGridRow[]; // status_grid
  segments?: Array<{
    // track_heatmap (extended with delta_ms)
    minisector_index: number;
    name: string;
    leader: string;
    color: string;
    delta_ms?: number;
  }>;
  vertical_markers?: VerticalMarker[];
  legend?: Record<string, string>;
  horizontal_marker?: { value: number; label?: string }; // line charts

  // stint_gantt
  total_laps?: number;
  stints?: StintSegment[];
  compound_legend?: Record<string, string>;

  // donut
  center_label?: string;
  slices?: DonutSlice[];

  // pit_event_strip
  phases?: PitPhase[];
  post_cycle?: { before_position: number; after_position: number; recovered_by_lap?: number };

  // track_heatmap (top-level meta)
  circuit?: string;
  sector?: number;
  view?: "track_shape" | "strip";

  // line_with_stint_markers
  stint_boundaries?: Array<{ lap: number; label: string }>;
}

export interface Metric {
  label: string;
  value: string;
  unit?: string;
  emphasis?: boolean;
}

export interface InsightMock {
  title: string;
  subtitle?: string;
  body: string;
  metrics?: Metric[];
  chart?: ChartSpec;
  key_takeaways?: string[];
  related_questions?: string[];
  // M01 Hero scalar
  hero?: {
    value: string;
    label: string;
    context?: string;
  };
  // M02 Yes/No verdict
  verdict?: {
    label: "YES" | "NO";
    color?: string;
    summary: string;
  };
  // M20 Composite
  composite?: Array<{
    type: string;
    title?: string;
    x_label?: string;
    y_label?: string;
    series?: Array<{ name: string; color: string; values: number[] }>;
    vertical_markers?: Array<{ x: number; label: string }>;
    metrics?: Metric[];
  }>;
  // M21 No-data refusal
  what_we_have?: string[];
  tone?: "normal" | "muted";
}

/**
 * Streaming-time superset of `InsightMock`. Used by `mapInsight.ts`
 * during SSE folding because:
 *   - `title` may not arrive until the final frame (so make it optional)
 *   - the backend produces `sql` and `rows` from result tables, which
 *     `InsightMock` does not have slots for
 *
 * Never returned to fixtures — fixtures stay typed as `InsightMock`.
 * Production page state holds `DraftInsight`; the `toCardProps`
 * adapter accepts the union.
 */
export interface DraftInsight extends Omit<InsightMock, "title"> {
  title?: string;
  sql?: string;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  elapsedMs?: number;
  truncated?: boolean;
  /** Cumulative reasoning_delta stream — model's chain-of-thought. */
  reasoning?: string;
  /** True while the SSE stream is still open. Drives the "Thinking…" UI. */
  streaming?: boolean;
}
