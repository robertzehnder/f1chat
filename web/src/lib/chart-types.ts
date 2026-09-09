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
  | "event_timeline"
  | "radar"
  | "scatter_with_regression"
  | "status_grid"
  | "metric_grid"
  | "stint_gantt"
  | "donut"
  | "pit_event_strip"
  | "track_heatmap"
  | "track_corner_delta"
  | "corner_delta_grid"
  | "track_speed_map"
  | "race_trace"
  | "degradation_curve"
  | "position_changes"
  | "telemetry_overlay";

export interface ChartSeries {
  name: string;
  values: number[];
  color: string;
  slope?: number; // for scatter_with_regression
  points?: [number, number][]; // for scatter
  axis?: "y1" | "y2"; // for line_dual_axis
  // Optional per-series line styling. All optional and back-compat: a series
  // with none of these renders exactly as before. `strokeDasharray` undefined
  // means a solid line (renderers must treat undefined as solid, never "0").
  // Used to keep same-team drivers distinguishable when hue alone isn't enough
  // (3rd+ teammate) and to de-emphasise the pack in full-field charts.
  strokeDasharray?: string;
  strokeWidth?: number;
  opacity?: number;
  emphasis?: boolean; // full color/width when true, dimmed when false (mixed field)
}

export interface TimelineEvent {
  lap: number;
  driver: string;
  kind: string;
  team_color: string;
  message: string;
  /** A4: circuit_short_name from the row (core.sessions), for the on-track
   *  corner pin. Only present on live race-control rows; absent on mocks. */
  circuit?: string;
  /** A4: corner label parsed from the steward message_text (e.g. "Turn 7").
   *  Data-gated — set ONLY when the message explicitly names a corner. */
  corner_label?: string;
  /** A4: corner number parsed from message_text. The pin's lap-fraction is
   *  resolved client-side against the real track-outline corners, so no
   *  corner-fraction is stored here (kept honest — never invented). */
  corner_number?: number;
}

export interface StatusGridRow {
  session_key?: number;
  label: string;
  [key: string]: string | number | undefined;
}

export interface VenueCoverage {
  /** core.sessions.circuit_short_name — the /api/track-outline circuit key. */
  circuit: string;
  /** Human venue label (location) for the tile caption. */
  location: string;
  /** Derived season round (R1..R24); undefined if unknown. */
  round?: number;
  /** green = every telemetry session at this venue has weather; amber =
   *  some sessions missing/partial; red = all missing. */
  status: "green" | "amber" | "red";
  /** count of sessions with a weather gap at this venue (for the tooltip). */
  gaps: number;
  /** total telemetry sessions checked at this venue. */
  total: number;
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
  // Renderer hint: format Y-axis ticks + tooltip values according to the
  // semantic of the data. "lap_time_s" → mm:ss.mmm above 60s, else "X.XXXs".
  // Default (undefined) → numeric 1-decimal.
  y_value_format?: "lap_time_s" | "decimal_seconds" | "kph" | "percent";
  axes?: string[]; // radar axis labels
  max_value?: number; // radar
  /**
   * Radar-specific data-quality hint: how many axes returned exactly 0 across
   * every series. Surfaced by the radar detector when the upstream matview
   * (analytics.driver_performance_score_data) emits COALESCE defaults for
   * missing source rows. The chart caption uses this to render
   * "⚠ N of M axes not yet populated" instead of silently drawing a
   * collapsed polygon. See driver_performance_score data-quality plan §A
   * remediation #3.
   */
  partial_data_axes?: number;
  total_axes?: number;
  /** Radar B3: labels of axes that were all-zero across every series — RETAINED
   *  in `axes` (index-aligned) so the renderer can grey/dash the spoke instead
   *  of dropping it. Subset of `axes`. */
  empty_axes?: string[];
  series?: ChartSeries[];
  events?: TimelineEvent[]; // timeline / event_timeline
  rows?: StatusGridRow[]; // status_grid
  /** status_grid venue mode: when set, StatusGridChart renders a grid of
   *  mini circuit outlines tinted by coverage status instead of the table. */
  venue_grid?: boolean;
  venues?: VenueCoverage[]; // status_grid venue mode
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
  /** horizontal_bar_diverging: per-side bar colors (e.g. each driver's
   *  team color in a pair-delta chart). Defaults to green/red. */
  diverging_colors?: { positive: string; negative: string };
  /** track_corner_delta: highlighted corner windows on the track map
   *  (f0/f1 = lap-distance fractions from analytics.corner_analysis). */
  corner_zones?: Array<{ label: string; f0: number; f1: number; color: string; leader: string }>;
  /** corner_delta_grid: per-corner entry/apex/exit A-B deltas (km/h) +
   *  each driver's absolute phase speeds, for the phase-tile grid. `f` is
   *  the corner-window midpoint fraction for the sized track-map node. */
  corner_deltas?: Array<{
    label: string;
    f: number;
    entry_delta: number;
    apex_delta: number;
    exit_delta: number;
    a_entry: number; b_entry: number;
    a_apex: number; b_apex: number;
    a_exit: number; b_exit: number;
    leader: string;
    color: string;
    node_r: number;
  }>;
  /** corner_delta_grid: the two driver surnames + their node colors, for
   *  the map legend and ladder axis. */
  corner_delta_drivers?: { a: string; b: string; a_color: string; b_color: string };
  /** track_speed_map: which telemetry channel colors the ribbon, and the
   *  reference car. The component fetches per-point channel data from the
   *  track-outline API. */
  speed_map?: { channel: "speed" | "throttle_brake"; driverNumber: number; sessionKey: number; driverName: string };
  /** race_trace / position_changes: laps under SC/VSC (shaded bands). */
  neutralized_laps?: number[];
  /** race_trace: pit-stop dots placed on the trace lines; `label` (e.g.
   *  "stop · VSC") is drawn beside the dot when present. */
  trace_pit_dots?: Array<{ x: number; y: number; color: string; driver: string; label?: string }>;
  /** race_trace / line: explicit lap number per series index, for figures
   *  whose window does not start at lap 1 (the renderer otherwise labels
   *  index+1). Visuals plan S1.2. */
  lap_numbers?: number[];
  /** race_trace: explicit y domain (pair-gap figures cross zero). */
  y_domain?: [number, number];
  /** Lap-anchored notes drawn in the annotation lane above the plot
   *  ("L49 lap deleted · track limits T1"). */
  annotations?: Array<{ lap: number; text: string; kind?: "deletion" | "note" | "pass" }>;
  /** stint_gantt: pit stops with their racing-state class ("VSC", "red", "green"). */
  gantt_stops?: Array<{ driver: string; lap: number; label: string }>;
  /** telemetry_overlay: reference identity — the component fetches the
   *  per-point traces from /api/lap-telemetry. */
  telemetry_overlay?: { sessionKey: number; drivers: Array<{ number: number; name: string }> };
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
  // Unit suffix for the per-segment delta label (default "ms"). The
  // minisector-dominance card emits speed deltas, so it sets "km/h".
  delta_unit?: string;

  // line_with_stint_markers
  stint_boundaries?: Array<{ lap: number; label: string }>;

  // Lap-axis charts (line_with_stint_markers, position_changes): shaded
  // x-ranges for caution periods derived from per-lap track_flag values.
  // Inclusive lap bounds; label like "SC" / "VSC" / "Yellow".
  // LEGACY (2026-09-09): superseded by `racing_state` whenever the layer is
  // attached — track_flag cannot see VSCs (their race-control rows carry no
  // flag) and collapses sector yellows. Kept for sessions without the layer.
  caution_bands?: Array<{ from: number; to: number; label?: string }>;

  /** Racing-state layer (visuals plan S1.1, 2026-09-09): SC / VSC / red
   *  periods from analytics.racing_state_intervals (migration 062) plus
   *  sector-yellow OBSERVATIONS from raw.race_control. Attached server-side
   *  for the resolved race session and drawn by every lap-axis renderer
   *  with one shared visual grammar (charts/racing-state-layer.tsx). */
  racing_state?: RacingStateLayer;

  // One-line honesty caption rendered subdued under the chart — e.g.
  // "7 pit/outlier laps hidden" or "data covers 16 of 52 laps". Set by
  // detectors whenever points are excluded or the series is sparse, so a
  // partial chart never silently reads as complete.
  chart_note?: string;

  // track_heatmap — explicit legend so BOTH compared drivers show even when one
  // wins zero segments (deriving the legend from segment leaders drops them).
  dominance_legend?: Array<{ name: string; color: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Racing-state layer (SC / VSC / red-flag periods + sector-yellow observations)
// ---------------------------------------------------------------------------

export type RacingStateKind = "sc" | "vsc" | "red";

/** One row of analytics.racing_state_intervals, kept whole — lap bounds AND
 *  timestamps AND closure provenance — so renderers can show sequence
 *  (SC → red → SC inside two laps) instead of a merged band. `to_lap` null =
 *  never closed before the chequered flag. */
export interface RacingStatePeriod {
  kind: RacingStateKind;
  start_ts: string;
  end_ts: string | null;
  from_lap: number;
  to_lap: number | null;
  /** NULL when an explicit closing message exists; otherwise the 062 code
   *  (ending_lap_end / resumption_state_msg / lights_on_lap_end / …). */
  endpoint_inferred: string | null;
  opened_by: string | null;
  closed_by: string | null;
}

/** A yellow-flag MESSAGE for one sector on one lap. An observation, not an
 *  interval: it says a yellow was issued, nothing about how long it stood. */
export interface SectorFlagObservation {
  lap: number;
  sector: number;
  level: "yellow" | "double_yellow";
  issued_at: string;
}

/** available: race-control feed present, periods (possibly none) exact.
 *  incomplete: periods present but at least one end is inferred, or the
 *  feed has no CHEQUERED message. absent: no race-control rows for the
 *  session (nothing can be said; renderers fall back to the heuristic
 *  overlay, labelled as such). failed: the load errored. */
export type RacingStateSource = "available" | "incomplete" | "absent" | "failed";

export interface RacingStateLayer {
  source: RacingStateSource;
  session_key: number | null;
  periods: RacingStatePeriod[];
  sector_flags: SectorFlagObservation[];
  /** One line per caveat, rendered under the chart ("VSC end inferred at end
   *  of lap 29 (feed has no VSC ENDED message)"). Empty when nothing to say. */
  notes: string[];
  total_laps?: number | null;
}

export interface Metric {
  label: string;
  value: string;
  unit?: string;
  emphasis?: boolean;
  /** Optional contextual annotation rendered subdued below the label. */
  context?: string;
}

export interface InsightMock {
  title: string;
  subtitle?: string;
  /** vNext: promoted one-line answer rendered above the tiles. */
  at_a_glance?: string;
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
  /** A1: corner-metrics card → highlight this corner on the real circuit
   *  outline (resolved client-side from track-outline's corners by number). */
  corner_map?: { circuit: string; corner_number?: number; corner_label?: string };
  /** B17: session-disambiguation choice card. When present the card renders
   *  one-tap option buttons; picking one re-sends `resolvedQuery`. `label` is
   *  human-readable (session type + venue/year) — sessionKey is carried only
   *  to build the re-send query, never shown as the button text. */
  clarification?: {
    prompt: string;
    /** Original user question, used to build each option's resolved re-send. */
    question: string;
    options: Array<{
      sessionKey: number;
      /** Session type, e.g. "Qualifying", "Sprint Qualifying", "Race". */
      sessionType: string;
      /** Full human label, e.g. "Qualifying · Yas Marina · 2025". */
      label: string;
      /** The exact text re-sent to /api/chat when this option is chosen. */
      resolvedQuery: string;
      /** Highest-confidence candidate → rendered as the primary button. */
      primary: boolean;
    }>;
  };
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
  /** True while the SSE stream is still open. Drives the "Working…" UI. */
  streaming?: boolean;
  /** Racing-state layer delivered by the server for the resolved race
   *  session; folded onto `chart` when the chart is lap-axis. */
  racingState?: RacingStateLayer;
  /** Stage-by-stage activity (synthetic during stream, real after final). */
  activity?: import("@/lib/activityLog").ActivityEvent[];
}
