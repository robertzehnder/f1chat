import type { FactContract } from "@/lib/contracts/factContract";
import { buildSynthesisPrompt, answerHedgesVerdict } from "@/lib/synthesis/buildSynthesisPrompt";

const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
/** Phase 15-1: Haiku for SQL generation (fast + cheap), Sonnet as fallback on parse/validate failure. */
const SQL_MODEL_PRIMARY = process.env.ANTHROPIC_SQL_MODEL ?? "claude-haiku-4-5-20251001";
const SQL_MODEL_FALLBACK = process.env.ANTHROPIC_SQL_MODEL_FALLBACK ?? DEFAULT_ANTHROPIC_MODEL;
/** Short JSON answers; keep separate from SQL generation which needs a much higher ceiling. */
const ANSWER_MAX_TOKENS = Number(
  process.env.ANTHROPIC_MAX_TOKENS_ANSWER ?? process.env.ANTHROPIC_MAX_TOKENS ?? "1024"
);
/** Large CTEs exceed 600 tokens easily; override with ANTHROPIC_MAX_TOKENS_SQL. */
const SQL_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS_SQL ?? "4096");

type SqlGenerationInput = {
  question: string;
  context?: {
    sessionKey?: number;
    driverNumber?: number;
  };
  runtime?: {
    questionType?: string;
    grain?: string;
    resolvedEntities?: Record<string, unknown>;
    queryPlan?: Record<string, unknown>;
    requiredTables?: string[];
    completenessWarnings?: string[];
  };
};

type SqlGenerationOutput = {
  sql: string;
  reasoning?: string;
  model: string;
  rawText: string;
};

export type AnswerSynthesisInput = {
  question: string;
  sql: string;
  contract: FactContract;
  /** Phase 3: optional shape selector — drives which prompt template
   *  (hero / verdict / metric-grid / chart-with-metrics / composite /
   *  refusal) the LLM sees. Defaults to chart-with-metrics when
   *  omitted, so existing callers don't break. */
  shape?: import("@/lib/chatRuntime/insightShape").InsightShape;
  /** F01 honesty clamp — see BuildSynthesisPromptInput.resolvedSession. */
  resolvedSession?: { sessionKey: number; label: string };
};

type AnswerSynthesisOutput = {
  answer: string;
  reasoning?: string;
  /** Phase 2: structured insight fields extracted from the JSON
   *  payload, or null when the model didn't emit them / validation
   *  produced no usable fields. */
  insight: import("@/lib/chatTypes").InsightFields | null;
  model: string;
  rawText: string;
};

// Phase 19 outcome-fix Fix 4: exported so the
// `web/scripts/tests/raw-table-prompt-reminders.test.mjs` fixture can
// assert the column lists + forbidden-pattern note are present in the
// assembled prompt. The function name is otherwise internal-only.
export async function buildSystemPrompt(): Promise<string> {
  // Phase 17-F: column docs are pulled from `information_schema` at first
  // call and cached for the process lifetime. On introspection failure we
  // fall back to a minimal hand-typed reminder list so SQL-gen still runs.
  // Dynamic import keeps the existing anthropic.ts unit-test harnesses
  // (which stub `@/lib/synthesis/buildSynthesisPrompt` only) from needing
  // to know about `@/lib/schemaCatalog` resolution.
  let coreDocs = "";
  try {
    const { getSchemaDocs } = await import("@/lib/schemaCatalog");
    coreDocs = await getSchemaDocs();
  } catch {
    coreDocs = "";
  }
  const coreSection = coreDocs.trim().length > 0
    ? coreDocs
    : `- core.sessions has: session_key, meeting_name, session_name, year, country_name, location, date_start.`;
  return `
You are a PostgreSQL analytics assistant for an OpenF1 warehouse.
Only generate read-only SQL using these schemas/tables:

core.sessions, core.session_drivers, core.meetings, core.driver_dim
core.lap_semantic_bridge, core.laps_enriched, core.driver_session_summary, core.stint_summary,
core.strategy_summary, core.grid_vs_finish, core.race_progression_summary, core.lap_phase_summary,
core.telemetry_lap_bridge, core.lap_context_summary, core.replay_lap_frames, core.metric_registry
raw.sessions, raw.drivers, raw.laps, raw.car_data, raw.location, raw.intervals, raw.position_history,
raw.weather, raw.race_control, raw.pit, raw.stints, raw.team_radio, raw.session_result,
raw.starting_grid, raw.overtakes, raw.championship_drivers, raw.championship_teams

Important column reminders (raw.* — hand-curated):
- raw.session_result has: session_key, driver_number, position, points, status, classified (no "time" column).
- raw.laps has: session_key, driver_number, lap_number, lap_duration, date_start.
- raw.drivers has: session_key, driver_number, full_name, team_name.
- raw.car_data has: session_key, driver_number, date, brake, throttle, n_gear, rpm, speed, drs, meeting_key
  (this is the telemetry feed; n_gear and rpm live HERE, not in raw.location).
- raw.location has: session_key, driver_number, date, x, y, z, meeting_key
  (spatial coordinates ONLY; no telemetry fields like n_gear/brake/throttle).
- raw.overtakes has: session_key, meeting_key, lap_number, overtaking_driver_number, overtaken_driver_number, position_change, date
  (NO "driver_number" or "overtake_type" columns — use overtaking_driver_number / overtaken_driver_number).

DO NOT join raw.car_data and raw.location by timestamp proximity (e.g.
ABS(EXTRACT(EPOCH FROM (cd.date - loc.date))) < 0.15). That cross-join shape
times out at the 15s budget. Use core.telemetry_lap_bridge for cross-telemetry
analysis, OR aggregate raw.car_data and raw.location samples within their
respective (session_key, driver_number, lap_number) bins separately.

Important column reminders (core.* — introspected from information_schema):
${coreSection}

Guidance:
- core.laps_enriched is the default lap analysis contract for pace/sector/clean-lap questions.
- core.driver_session_summary, core.stint_summary, core.strategy_summary, core.grid_vs_finish,
  core.race_progression_summary are preferred summary contracts for analytics.
- For data_health_question coverage/completeness prompts, prefer core.session_completeness over raw tables.
- For placeholder/partially loaded session questions, use core.session_completeness.coverage_score (and is_placeholder when needed).
- For missing weather coverage, use core.session_completeness.weather_rows to identify sessions where weather_rows = 0.
- For driver-level missing-laps-gap / lap-coverage questions, use core.session_completeness for the expected session lap total and raw.laps for each driver's observed lap count.
- For driver-level missing-laps-gap questions, return exactly one summary row even when no drivers qualify so the result is non-empty.
- For "which sessions are missing coverage" questions, return exactly one summary row even when no sessions match:
  aggregate the missing set into a count plus a list/text field that yields 0 and 'none' instead of an empty result set.
- For intermediate-tyre crossover questions ("who pitted first for inters"), use core.stint_summary filtered by compound_name ILIKE '%INTER%' ORDER BY lap_start ASC.
- For per-driver telemetry-coverage questions, use core.session_completeness.car_data_rows / coverage_score; no per-driver coverage matview exists yet.
- For "pit-stop timing vs FIA pit log" questions, JOIN core.session_completeness.pit_rows (manifest) vs COUNT(*) FROM raw.pit (observed) per session_key. Surface manifest-vs-observed deltas only; do not embed semicolons or multi-clause notes inside SQL string literals (the FIA-pit-log caveat belongs in the synthesis text, not the SQL output).
- For tyre-degradation / deg-curve / compound-deg-comparison questions, return ROW-LEVEL data so the chart can draw a scatter-with-regression: SELECT driver_name, stint_number, lap_in_stint AS stint_lap, lap_time_s FROM core.laps_enriched JOINed with core.stint_summary, WHERE compound and stint and session_key match, ORDER BY driver_number, stint_lap. Also include the precomputed degradation_per_lap_s from analytics.stint_degradation_curve as a constant per-(driver, stint) column so the synthesis layer can read the slope. Do NOT collapse to one row per stint — the visual REQUIRES per-lap points.
- For steward / penalty / incident questions, use analytics.race_control_incidents (driver_number, incident_kind, action_status, penalty_seconds, message_text). penalty_points is always NULL — note as data-not-ingested. JOIN core.race_progression_summary on (session_key, lap_number) when position context is needed.

Rules:
- Output JSON only.
- JSON keys: "sql", "reasoning".
- SQL must be exactly one SELECT/CTE statement.
- Never use INSERT/UPDATE/DELETE/DDL.
- Prefer bounded queries with LIMIT unless aggregation naturally returns small output.
- If telemetry tables are used, prefer filtering by session_key and optionally driver_number.
- If runtime context includes resolved IDs (such as session_key, driver_number), use those exact IDs in filters.
- Do not rely on meeting_name alone for venue matching because it may be null/empty.
- Prefer semantic/core contracts over raw tables for analytical questions; use raw.* only when a required semantic view is missing.
- Only reference columns documented above; if a column you want is not listed, pick a different contract that has it.
- Put only executable SQL in "sql". Never append trace lines, notes, or text like session_pin_* inside the JSON or the query string.
`.trim();
}

// Phase 25.2 loop tightening Fix 2: append a structured matview-
// suggestion preamble to the user message when the question matches
// known per-slice patterns. System-prompt bullets routinely get
// ignored under load (LLM composes its own SQL from scratch);
// per-question hints attached to the user message are harder to
// skip and dramatically improve synthesis-prompt compliance.
//
// Each entry: a list of trigger substrings AND a multi-line hint
// block. Triggers are matched case-insensitively against the
// normalized question text. First-match wins (so put more-specific
// patterns first if they would otherwise collide).
const MATVIEW_HINTS: ReadonlyArray<{ triggers: string[]; hint: string }> = [
  {
    triggers: [
      "deg curve", "deg per lap", "tyre deg", "compound deg",
      "degradation curve", "degradation per lap", "deg cliff",
      "compound cliff", "compare tyre degradation", "tyre degradation between",
      "deg comparison", "stint degradation"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-stint-degradation-curve, comparison-aware):",
      "  Two output shapes depending on intent:",
      "",
      "  (1) SCALAR / 'what is the degradation slope' question:",
      "      SELECT driver_name, stint_number, compound_name, degradation_per_lap_s, fuel_corrected_degradation_per_lap_s, lap_start, lap_end",
      "      FROM analytics.stint_degradation_curve sdc",
      "      WHERE session_key = :s AND driver_number IN (:d1, :d2) [AND compound_name = :c]",
      "      ORDER BY driver_number, stint_number;",
      "",
      "  (2) COMPARISON / CHART intent — triggered by 'compare', 'between X and Y', 'show', 'visualize', 'profile':",
      "      The card needs lap-by-lap rows so the chart adapter can render a scatter-with-regression.",
      "      MUST return one row per (driver, lap-in-stint) with these columns:",
      "        driver_name (string)",
      "        stint_number (int)",
      "        stint_lap (int)             — alias for lap_in_stint",
      "        lap_time_s (numeric)        — alias of lap_duration",
      "        degradation_per_lap_s       — constant per (driver, stint), from analytics.stint_degradation_curve",
      "      Recommended shape:",
      "        WITH stints AS (",
      "          SELECT session_key, driver_number, driver_name, stint_number, compound_name, lap_start, lap_end,",
      "                 degradation_per_lap_s, fuel_corrected_degradation_per_lap_s",
      "          FROM analytics.stint_degradation_curve",
      "          WHERE session_key = :s AND driver_number IN (:d1, :d2) AND compound_name = :c",
      "        )",
      "        SELECT s.driver_name, s.stint_number,",
      "               (l.lap_number - s.lap_start + 1) AS stint_lap,",
      "               l.lap_duration AS lap_time_s,",
      "               s.degradation_per_lap_s",
      "        FROM stints s",
      "        JOIN core.laps_enriched l",
      "          ON l.session_key = s.session_key",
      "         AND l.driver_number = s.driver_number",
      "         AND l.lap_number BETWEEN s.lap_start AND s.lap_end",
      "        WHERE l.is_clean_lap = TRUE",
      "        ORDER BY s.driver_name, stint_lap;",
      "  Do NOT collapse to one row per stint when the intent is comparison/chart — the chart REQUIRES per-lap points."
    ].join("\n")
  },
  {
    triggers: [
      "pit stop time", "pit stop times", "pit losses",
      "stationary time", "pit lane time", "pit times at", "pit stops at",
      "how long did pit", "fastest pit stop", "slowest pit stop",
      "best pit stop", "worst pit stop"
    ],
    hint: [
      "MATVIEW HINT (pit-stop time comparison, one-row-per-driver):",
      "  The horizontal bar chart adapter needs ONE row per driver with driver_name + a pit-loss numeric.",
      "  Per-stop data lives on analytics.pit_loss_per_circuit (columns: session_key, driver_number,",
      "  pit_in_lap_number, out_lap_number, pit_loss_s, baseline_lap_s, new_compound_name, stop_number).",
      "  Aggregate per driver and join raw.drivers for the human-readable name:",
      "    SELECT d.full_name                          AS driver_name,",
      "           MIN(plc.pit_loss_s)::numeric(6,3)    AS best_pit_loss_s,",
      "           AVG(plc.pit_loss_s)::numeric(6,3)    AS avg_pit_loss_s,",
      "           MAX(plc.pit_loss_s)::numeric(6,3)    AS worst_pit_loss_s,",
      "           COUNT(*)                             AS stop_count",
      "    FROM analytics.pit_loss_per_circuit plc",
      "    JOIN raw.drivers d",
      "      ON d.session_key = plc.session_key AND d.driver_number = plc.driver_number",
      "    WHERE plc.session_key = :s",
      "    GROUP BY d.full_name",
      "    ORDER BY best_pit_loss_s ASC;",
      "  Do NOT use core.pit_cycle_summary for pit_loss_s — that column lives on analytics.pit_loss_per_circuit.",
      "  Do NOT return one row per individual stop — that produces a 50-row chart with driver_number axis labels.",
      "  driver_name MUST be present and human-readable so the chart renders team-coloured per-driver bars."
    ].join("\n")
  },
  {
    triggers: [
      "steward", "fia stewards", "incident involv", "penalty point",
      "time penalty", "drive-through", "drive through penalty",
      "track limits", "leaving the track", "forcing-off", "forcing off",
      "unsafe release", "5 second penalty", "10 second penalty",
      "5-second penalty", "10-second penalty"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-race-control-incident-index):",
      "  primary table: analytics.race_control_incidents",
      "  columns: driver_number, second_driver_number, incident_kind, action_status, penalty_seconds, message_text, lap_number",
      "  incident_kind values: track_limits / collision / leaving_track_advantage / forcing_off / unsafe_release / pit_speeding / pit_lane_infraction / false_start / multiple_track_limits / other",
      "  action_status values: time_penalty / drive_through / no_further_action / under_investigation / investigation_deferred / reprimand / grid_penalty / other",
      "  penalty_points is ALWAYS NULL — note in synthesis that OpenF1 does not ingest FIA penalty-point assignments.",
      "  recommended shape: SELECT ... FROM analytics.race_control_incidents WHERE session_key = :s [AND driver_number = :d] [AND incident_kind = :k] ORDER BY lap_number, date",
      "  for 'who led at lap N after SC restart' questions: JOIN core.race_progression_summary ON (session_key, lap_number) for position_end_of_lap context."
    ].join("\n")
  },
  {
    triggers: [
      "intermediate", "for inters", "switched to inter", "inter tyre",
      "inters at"
    ],
    hint: [
      "MATVIEW HINT (intermediate-tyre crossover):",
      "  use core.stint_summary filtered by compound_name ILIKE '%INTER%' ORDER BY lap_start ASC",
      "  do NOT compose multi-stint joins from raw.laps + raw.stints."
    ].join("\n")
  },
  {
    triggers: [
      "fia pit log", "pit-stop timing data", "pit stop timing data",
      "pit timing data"
    ],
    hint: [
      "MATVIEW HINT (FIA pit log gap):",
      "  JOIN core.session_completeness.pit_rows (manifest) vs COUNT(*) FROM raw.pit (observed) per session_key.",
      "  do NOT embed semicolons or multi-clause notes inside SQL string literals.",
      "  the FIA-pit-log caveat belongs in the synthesis text, not the SQL output."
    ].join("\n")
  },
  {
    // Phase 21 21-weather-impact: wet-pace delta + crossover laps.
    triggers: [
      "wet pace", "wet-tyre pace", "inter pace", "inters pace",
      "crossover lap", "dry-line", "dry line crossover",
      "inter-to-slick", "inters-to-slicks", "slicks-to-inters",
      "rain shower"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-weather-impact):",
      "  primary table: analytics.weather_impact",
      "  columns: wet_pace_delta_s, crossover_lap, inter_to_slick_crossover_lap, slick_to_inter_crossover_lap, is_wet_lap, driver_dry_baseline_s",
      "  recommended shape: single SELECT WHERE session_key = :s AND driver_number IN (...) — wet_pace_delta_s is non-null only on is_wet_lap=true rows.",
      "  crossover_lap is repeated on every (session, driver) row, so a single-row driver lookup gives the answer."
    ].join("\n")
  },
  {
    // Phase 21 21-pit-loss-per-circuit: pit_loss_s per stop.
    triggers: [
      "pit loss", "pit-loss", "pit-stop delta", "pit stop delta",
      "stop delta", "pit-cycle cost", "stay out under the", "free pit",
      "free stop", "stop time", "pit cycle"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-pit-loss-per-circuit):",
      "  primary table: analytics.pit_loss_per_circuit",
      "  columns: pit_in_lap_number, out_lap_number, pit_loss_s, baseline_lap_s, new_compound_name, stop_number",
      "  recommended shape: SELECT ... FROM analytics.pit_loss_per_circuit WHERE session_key = :s AND driver_number IN (...) ORDER BY stop_number",
      "  positive pit_loss_s = the stop cost time vs running two clean baseline laps."
    ].join("\n")
  },
  {
    // Phase 21 21-tyre-warmup-curves: warmup_laps_to_target.
    triggers: [
      "warmup lap", "warm-up lap", "warmup laps", "warm-up laps",
      "tyre warmup", "tire warmup", "tyre warm-up", "tire warm-up",
      "fresh-tyre", "fresh tyre", "warm the medium", "warm the hard",
      "warm the soft", "get the medium", "get the hard", "get the soft"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-tyre-warmup-curves):",
      "  primary table: analytics.tyre_warmup",
      "  columns: warmup_laps_to_target, best_non_warmup_lap_s, stint_length_laps, compound_name",
      "  recommended shape: single SELECT WHERE session_key = :s AND driver_number = :d [AND stint_number = :n]",
      "  warmup_laps_to_target is the lap-offset within the stint (1-based) at which the driver first hit within 0.5s of the stint best."
    ].join("\n")
  },
  {
    // Phase 21 21-traffic-adjusted-pace: clean-air vs traffic.
    triggers: [
      "clean air", "clean-air", "in traffic", "dirty air", "dirty-air",
      "traffic-corrected", "traffic-adjusted", "traffic pace",
      "traffic-induced", "stuck behind", "behind another car",
      "lap pace drop"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-traffic-adjusted-pace):",
      "  primary table: analytics.traffic_adjusted_pace",
      "  columns: clean_air_pace_s, traffic_pace_s, traffic_pace_delta_s, clean_air_laps, traffic_laps",
      "  per-(session, driver) granularity (one row per driver per session). Filter session_key + driver_number for single-row answers.",
      "  traffic_pace_delta_s is positive when traffic cost time.",
      "  WARNING: clean_air_laps / traffic_laps are inflated ~2x (they count over duplicated laps_enriched rows). Their sum can exceed race distance. Treat them as a RATIO (clean_air_laps / (clean_air_laps + traffic_laps)), not absolute lap totals, and never state a per-driver total above ~78."
    ].join("\n")
  },
  {
    // Phase 21 21-restart-performance: position_delta on restart laps.
    triggers: [
      "sc restart", "safety-car restart", "safety car restart",
      "vsc restart", "lap-1 launch", "lap 1 launch", "race start position",
      "starting line", "positions gained on the restart",
      "positions on the restart", "field-bunching", "field bunching",
      "the restart lap", "after the restart"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-restart-performance):",
      "  primary table: analytics.restart_performance",
      "  columns: restart_lap, restart_kind, position_before, position_after, position_delta",
      "  restart_kind values: race_start / sc_restart / vsc_restart / other",
      "  recommended shape: SELECT ... FROM analytics.restart_performance WHERE session_key = :s [AND restart_lap = :n] ORDER BY restart_lap",
      "  position_delta NEGATIVE = gained positions; POSITIVE = lost. To answer 'positions gained' show -position_delta."
    ].join("\n")
  },
  {
    // Phase 21 21-overtake-events: overtake_count per session.
    triggers: [
      "overtake", "overtakes", "passes completed", "passing moves",
      "on-track pass", "on-track overtakes"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-overtake-events):",
      "  primary table: analytics.overtake_events",
      "  columns: overtake_count, overtake_lap, overtaking_driver_number, overtaken_driver_number",
      "  overtake_count is repeated on every row for the same session — single-row \"how many overtakes\" answers don't need an aggregate.",
      "  location_corner is NULL (Phase 22 spatial slice not shipped); do NOT pretend per-corner attribution exists."
    ].join("\n")
  },
  {
    // Phase 21 21-undercut-overcut-history: success counts per stop.
    triggers: [
      "undercut", "overcut", "covering stop", "covered the undercut",
      "covered the overcut", "stop strategy", "covering pit"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-undercut-overcut-history):",
      "  primary table: analytics.undercut_overcut_history",
      "  columns: undercut_success_count, overcut_success_count, neutral_stop_count, total_stops",
      "  per-(session, driver) granularity. Filter session_key + driver_number for single-row answers.",
      "  Heuristic-based: stops gaining position in 2-lap-after vs 2-lap-before window count as undercut_success."
    ].join("\n")
  },
  {
    // Phase 21 21-straight-line-dominance: speed-trap proxies.
    triggers: [
      "speed trap", "speed-trap", "i1 speed", "i2 speed", "st speed",
      "straight-line speed", "straight line speed", "top speed",
      "speed reading", "intermediate speed"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 21-straight-line-dominance):",
      "  primary table: analytics.straight_line_dominance",
      "  columns: st_speed_kph (top-speed proxy = MAX(speed)), i2_speed_kph (95th pctile), i1_speed_kph (90th pctile), avg_speed_kph",
      "  per-(session, driver) granularity. Filter session_key for per-race / per-quali answers.",
      "  These are statistical proxies (no spatial zone attribution); cite as such if the question demands precise zone semantics."
    ].join("\n")
  },
  {
    // Phase 21 Tier 4 21-driver-performance-7axis: season aggregator.
    triggers: [
      // Original axis-keyword triggers
      "axis score", "axis rating", "qualifying axis", "race-pace axis",
      "race pace axis", "tyre-management axis", "tyre management axis",
      "restart axis", "traffic-handling axis", "traffic handling axis",
      "overtake-difficulty axis", "overtake difficulty axis",
      "error-rate axis", "error rate axis", "performance axis",
      "season axis", "performance score",
      // Comparison-flavor triggers: "compare X vs Y across all metrics",
      // "season performance comparison", "all performance metrics",
      // "how does X rate", "driver rating", "season-wide comparison".
      "performance metrics", "all performance metrics",
      "performance comparison", "performance breakdown",
      "across all metrics", "across all performance",
      "across the season", "season-wide", "season wide",
      "season aggregate", "season-aggregate", "for the season",
      "driver rating", "driver ratings",
      "all the metrics", "every metric", "every axis",
      "compare drivers", "head-to-head"
    ],
    hint: [
      "MATVIEW HINT (Phase 21 Tier 4 21-driver-performance-7axis):",
      "  primary table: analytics.driver_performance_score",
      "  columns: season_year, driver_number, driver_name,",
      "           qualifying_axis, race_pace_axis, tyre_management_axis,",
      "           restart_axis, traffic_handling_axis, overtake_difficulty_axis,",
      "           error_rate_axis (each 0-100; higher = better).",
      "  CRITICAL: this is a SEASON-WIDE aggregate — do NOT pin a specific session_key.",
      "  CRITICAL: ALWAYS filter season_year = the year named in the question (e.g. season_year = 2025).",
      "  recommended shape for a two-driver comparison (returns one row per driver — perfect for the radar chart):",
      "    SELECT driver_number, driver_name,",
      "           qualifying_axis, race_pace_axis, tyre_management_axis,",
      "           restart_axis, traffic_handling_axis, overtake_difficulty_axis,",
      "           error_rate_axis",
      "    FROM analytics.driver_performance_score",
      "    WHERE season_year = 2025 AND driver_number IN (:d1, :d2)",
      "    ORDER BY driver_number;",
      "  Do NOT JOIN core.session_drivers / core.sessions / core.laps_enriched — the matview is already season-aggregated;",
      "  composing your own multi-table aggregation will return session metadata only and the chart adapter will get a 0-axis result."
    ].join("\n")
  },
  {
    // Phase 25 follow-up: telemetry-coverage-per-driver (q2182 lift).
    triggers: [
      "telemetry sample", "car telemetry sample", "missing telemetry sample",
      "missing more than", "telemetry coverage", "coverage missing",
      "missing telemetry"
    ],
    hint: [
      "MATVIEW HINT (Phase 25 follow-up — telemetry coverage per driver):",
      "  primary table: analytics.telemetry_coverage_per_driver",
      "  columns: car_data_samples, median_samples_per_driver, missing_pct_vs_median, missing_more_than_5pct, missing_more_than_10pct",
      "  recommended shape: SELECT session_key, driver_number, driver_name, missing_pct_vs_median FROM analytics.telemetry_coverage_per_driver WHERE missing_more_than_5pct = TRUE [AND session_key IN ...]",
      "  Use the missing_more_than_5pct / 10pct booleans directly when the question's threshold matches; otherwise compute from missing_pct_vs_median."
    ].join("\n")
  },
  {
    // Phase 26.2b slice 21-minisector-dominance.
    triggers: [
      "mini-sector", "mini sector", "minisector", "mini-sectors",
      "sector dominance", "lead the most sectors",
      "lead in his pole lap", "led in his pole lap",
      "dominant_count"
    ],
    hint: [
      "MATVIEW HINT (Phase 26 slice 21-minisector-dominance):",
      "  primary table: analytics.minisector_dominance",
      "  per-(session, driver, minisector_index) dominance count.",
      "  columns: minisector_index, dominant_count, valid_lap_count, avg_speed_kph",
      "  recommended: SELECT driver_number, driver_name, SUM(dominant_count) AS total_minisectors_led FROM analytics.minisector_dominance WHERE session_key=:s GROUP BY driver_number, driver_name ORDER BY total_minisectors_led DESC",
      "  for per-driver per-minisector breakdown: filter session_key + driver_number; rows are already pre-aggregated."
    ].join("\n")
  },
  {
    // Phase 26.2c slice 21-traction-analysis.
    triggers: [
      "exit speed out of",
      "exit traction",
      "traction-zone",
      "traction zone",
      "throttle application",
      "exit throttle"
    ],
    hint: [
      "MATVIEW HINT (Phase 26 slice 21-traction-analysis):",
      "  primary table: analytics.traction_analysis",
      "  per-(session, driver, corner) corner-exit traction metrics.",
      "  columns: exit_speed_kph, avg_exit_throttle_pct, exit_throttle_application_pct, valid_lap_count",
      "  exit_throttle_application_pct = % of exit-zone samples on throttle > 90.",
      "  recommended: SELECT corner_label, AVG(exit_speed_kph), AVG(exit_throttle_application_pct) FROM analytics.traction_analysis WHERE session_key=:s AND driver_number IN (...) AND corner_label ILIKE :corner GROUP BY corner_label"
    ].join("\n")
  },
  {
    // Phase 26.2d slice 21-braking-performance.
    triggers: [
      "brake-zone speed drop",
      "brake zone",
      "threshold-braking",
      "threshold braking",
      "braking deceleration",
      "brake pressure",
      "lock up under braking"
    ],
    hint: [
      "MATVIEW HINT (Phase 26 slice 21-braking-performance):",
      "  primary table: analytics.braking_performance",
      "  per-(session, driver, corner) brake-zone metrics.",
      "  columns: approach_speed_kph, min_brake_zone_speed_kph, brake_zone_speed_drop_kph, peak_brake_pressure_pct, avg_brake_pressure_pct",
      "  brake_zone_speed_drop_kph = approach_speed - min-brake-zone-speed.",
      "  recommended: SELECT corner_label, AVG(brake_zone_speed_drop_kph), AVG(peak_brake_pressure_pct) FROM analytics.braking_performance WHERE session_key=:s AND driver_number IN (...) AND corner_label ILIKE :corner GROUP BY corner_label"
    ].join("\n")
  },
  {
    // Phase 26.2a slice 21-corner-analysis.
    triggers: [
      "apex speed", "apex-speed", "minimum speed at turn", "min speed at turn",
      "entry speed", "exit speed", "mid-corner speed",
      "through turn", "at turn ", "at corner ",
      // Comparison-flavor: "which corners did X gain on Y", "where did X
      // lose to Y", "through sector N", "sector 1/2/3 corners".
      "which corner", "which corners", "gain on", "gained on", "lost to",
      "lose time to", "through sector", "in sector 1", "in sector 2",
      "in sector 3", "across sector",
      "eau rouge", "raidillon", "pouhon", "stavelot", "copse",
      "tarzan", "rettifilo", "ste devote", "casino", "hairpin",
      "degner", "spoon", "130r", "parabolica", "maggotts", "becketts",
      "chapel"
    ],
    hint: [
      "MATVIEW HINT (Phase 26 slice 21-corner-analysis):",
      "  primary table: analytics.corner_analysis",
      "  per-(session, driver, lap, corner_id) entry / apex / exit speeds.",
      "  columns: corner_label, corner_number, entry_speed_kph, apex_min_speed_kph, exit_speed_kph, sample_count",
      "  corner_label EXAMPLES (use these as-is; do NOT abbreviate / paraphrase):",
      "    Monaco:      'Turn 1 (Sainte Devote)', 'Turn 4 (Massenet)', 'Turn 6 (Casino)', 'Turn 10 (Loews / Hairpin)', 'Turn 13 (Tabac)', 'Turn 18 (Rascasse)'",
      "    Spa:         'Eau Rouge', 'Raidillon', 'Pouhon', 'Stavelot'",
      "    Silverstone: 'Turn 1 (Abbey)', 'Turn 9 (Copse)', 'Turn 10 (Maggotts)', 'Turn 11 (Becketts)', 'Turn 12 (Chapel)', 'Turn 18 (Club)'",
      "    Suzuka:      'Turn 1', 'Turn 2', 'Turn 7 (Esses)', 'Turn 8 (Degner 1)', 'Turn 9 (Degner 2)', '130R'",
      "    Monza:       'Turn 1 (Rettifilo)', 'Turn 6 (Lesmo 1)', 'Turn 7 (Lesmo 2)', 'Turn 8 (Ascari)', 'Turn 11 (Parabolica)'",
      "  to match a corner robustly, use ILIKE on the canonical name — e.g. corner_label ILIKE '%Devote%' matches Sainte Devote; corner_label ILIKE '%Hairpin%' matches Loews / Hairpin; corner_label ILIKE '%Casino%' matches Casino.",
      "  recommended (single-driver corner profile):",
      "    SELECT corner_label, AVG(apex_min_speed_kph), AVG(entry_speed_kph), AVG(exit_speed_kph)",
      "    FROM analytics.corner_analysis",
      "    WHERE session_key=:s AND driver_number IN (...) AND corner_label ILIKE ANY(ARRAY['%Devote%','%Casino%','%Hairpin%'])",
      "    GROUP BY corner_label, corner_number;",
      "  recommended (comparison — 'which corners did X gain on Y'):",
      "    Sector→corner_number ranges (Silverstone Race): Sector 1 = turns 1-6; Sector 2 = turns 7-12; Sector 3 = turns 13-18.",
      "    Use corner_number BETWEEN :s_start AND :s_end to restrict by sector when the user names one.",
      "    WITH per_corner AS (",
      "      SELECT corner_number, corner_label, driver_name,",
      "             AVG(apex_min_speed_kph) AS avg_apex_kph,",
      "             AVG(entry_speed_kph)    AS avg_entry_kph,",
      "             AVG(exit_speed_kph)     AS avg_exit_kph",
      "      FROM analytics.corner_analysis",
      "      WHERE session_key=:s AND driver_number IN (:d1, :d2)",
      "        AND corner_number BETWEEN :sector_start AND :sector_end",
      "      GROUP BY corner_number, corner_label, driver_name",
      "    )",
      "    SELECT corner_number, corner_label,",
      "           MAX(CASE WHEN driver_name=:d1_name THEN avg_apex_kph END) AS d1_apex_kph,",
      "           MAX(CASE WHEN driver_name=:d2_name THEN avg_apex_kph END) AS d2_apex_kph,",
      "           MAX(CASE WHEN driver_name=:d1_name THEN avg_apex_kph END) -",
      "           MAX(CASE WHEN driver_name=:d2_name THEN avg_apex_kph END) AS apex_delta_d1_minus_d2",
      "    FROM per_corner GROUP BY corner_number, corner_label ORDER BY corner_number;",
      "  Positive *_delta_d1_minus_d2 = driver 1 (the named subject) carried MORE speed → they 'gained on' the comparison driver at that corner."
    ].join("\n")
  }
];

// Phase 26.0 regression-recovery: deny-list of question-text tokens
// that indicate the question is too lap-range / event-specific for
// the session-level matview to answer correctly. When the deny-list
// fires, the matview-hint is suppressed so the LLM falls back to
// hand-built SQL with the question's specific filters.
//
// Examples that the deny-list catches (all regressed A → B/C in
// the May-5 baseline because the matview hint forced a session-
// aggregate that was too coarse):
//   q2040 "before his contact with Bearman"              → "before his contact"
//   q2044 "during his second stint at Hungary 2025"      → "during his second stint"
//   q2046 "once he cleared the train of cars"            → "once he"
//   q2102 "on the lap-22 SC restart" + "his spin"        → "lap-N" + nested-event
const MATVIEW_HINT_DENYLIST: ReadonlyArray<string> = [
  // Specific event sequencing
  "before his contact",
  "before his crash",
  "before the contact",
  "before the spin",
  "before the incident",
  "after his contact",
  "after the contact",
  "after his spin",
  "after the spin",
  "once he cleared",
  "once she cleared",
  "once they cleared",
  "once verstappen cleared",
  "once norris cleared",
  "once leclerc cleared",
  "once piastri cleared",
  "once russell cleared",
  "once hamilton cleared",
  "once sainz cleared",
  // Specific stint/lap range
  "during his second stint",
  "during her second stint",
  "during his third stint",
  "during his first stint",
  "during the second stint",
  "during the first stint",
  "during the third stint",
  "during stint 2",
  "during stint 3",
  "in his second stint",
  "in his first stint",
  "in his third stint",
  "second stint at",
  "first stint at",
  "third stint at",
  "in the closing laps",
  "in the opening laps",
  "before his first pit",
  "before her first pit",
  "before the first pit",
  "before his pit",
  "before pit",
  // Nested events
  "and was",
  "and his",
  "and her",
  "spin",
  "brake-test",
  "brake test penalty",
  "track-limits violation",
  // Multi-driver lap-by-lap (matview is per-driver session-level)
  "lap-by-lap",
  "lap by lap delta",
  "rolling 5-lap",
  "first-three-laps",
  "first three laps of",
  "last three laps of",
  "first 3 laps of",
  "last 3 laps of"
];

export function buildMatviewHint(question: string): string {
  if (!question) return "";
  const lower = question.toLowerCase();
  // Phase 26.0: if the question carries a lap-range / event-specific
  // / nested-event token, skip the matview hint and let the LLM
  // hand-build SQL.
  for (const denied of MATVIEW_HINT_DENYLIST) {
    if (lower.includes(denied)) {
      return "";
    }
  }
  for (const entry of MATVIEW_HINTS) {
    if (entry.triggers.some((t) => lower.includes(t))) {
      return `\n\n${entry.hint}\n`;
    }
  }
  return "";
}

function buildRepairPrompt() {
  return `
You are fixing a PostgreSQL query for the OpenF1 warehouse.
Return JSON only with keys: "sql", "reasoning".
The SQL must be exactly one SELECT/CTE statement.
Do not use non-existent columns.
Do not use INSERT/UPDATE/DELETE/DDL.
`.trim();
}

export type ColumnValidationMiss = {
  table: string;
  column: string;
  sourceRef: string;
};

/**
 * Phase 17-C: format a hint for the repair prompt that names exactly which
 * columns were hallucinated and lists the actual columns of each affected
 * table. Keeps the repair LLM from guessing again.
 */
export function formatColumnValidationHint(
  missing: ColumnValidationMiss[],
  catalog: Map<string, string[]>
): string {
  if (missing.length === 0) return "";
  const lines: string[] = ["Pre-execution column validation flagged these references as missing:"];
  for (const m of missing) {
    lines.push(`- ${m.sourceRef} → ${m.table} has no column "${m.column}".`);
  }
  const seen = new Set<string>();
  lines.push("");
  lines.push("Available columns:");
  for (const m of missing) {
    if (seen.has(m.table)) continue;
    seen.add(m.table);
    const cols = catalog.get(m.table);
    if (cols && cols.length > 0) {
      lines.push(`- ${m.table}: ${cols.join(", ")}.`);
    }
  }
  return lines.join("\n");
}

export function buildSynthesisPromptParts(
  input: AnswerSynthesisInput
): { staticPrefix: string; dynamicSuffix: string } {
  return buildSynthesisPrompt(input);
}

function ensureSessionAlignmentGuard(staticPrefix: string): string {
  if (staticPrefix.includes("fields like session_name")) {
    return staticPrefix;
  }
  return `${staticPrefix}
- For session-sensitive questions (for example pole, qualifying, Q1, Q2, Q3, sprint qualifying), verify the returned rows match that session context using fields like session_name before answering.
- Never treat a race fastest lap or any non-qualifying lap row as a pole lap unless the rows explicitly show qualifying/pole session context.`;
}

export function buildSynthesisRequestParams(
  input: AnswerSynthesisInput
): {
  system: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>;
  messages: Array<{ role: "user"; content: string }>;
} {
  const { staticPrefix, dynamicSuffix } = buildSynthesisPromptParts(input);
  return {
    system: [
      {
        type: "text",
        text: ensureSessionAlignmentGuard(staticPrefix),
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [{ role: "user", content: dynamicSuffix }]
  };
}

function stripModelTraceNoise(text: string): string {
  return text.replace(/\s*\|\s*session_pin_[a-z0-9_]+\([^)]*\)\s*$/gim, "").trim();
}

/** Remove echoed session-pin trace fragments the model sometimes appends inside the SQL string. */
function stripSqlEchoArtifacts(sql: string): string {
  return sql.replace(/\s*\|\s*session_pin_[a-z0-9_]+\([^)]*\)/gi, "").trimEnd();
}

function extractJsonText(text: string): string {
  let t = stripModelTraceNoise(text);

  const fenced = t.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const openJsonFence = t.match(/```json\s*([\s\S]*)/i);
  if (openJsonFence?.[1]) {
    return openJsonFence[1].trim();
  }

  const fencedPlain = t.match(/```\s*([\s\S]*?)```/);
  if (fencedPlain?.[1]?.trim().startsWith("{")) {
    return fencedPlain[1].trim();
  }

  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return t.slice(firstBrace, lastBrace + 1);
  }

  return t.trim();
}

/**
 * When the model hits max_tokens mid-JSON, recover the sql string value if it started.
 */
function recoverSqlFromTruncatedJsonPayload(payload: string): string | null {
  const match = /"sql"\s*:\s*"/.exec(payload);
  if (!match || match.index === undefined) {
    return null;
  }
  let i = match.index + match[0].length;
  let out = "";
  while (i < payload.length) {
    const c = payload[i];
    if (c === "\\") {
      if (i + 1 >= payload.length) {
        break;
      }
      const n = payload[i + 1];
      if (n === "n") {
        out += "\n";
        i += 2;
        continue;
      }
      if (n === "t") {
        out += "\t";
        i += 2;
        continue;
      }
      if (n === "r") {
        out += "\r";
        i += 2;
        continue;
      }
      if (n === '"' || n === "\\" || n === "/") {
        out += n;
        i += 2;
        continue;
      }
      if (n === "u" && i + 5 < payload.length) {
        const hex = payload.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      out += n;
      i += 2;
      continue;
    }
    if (c === '"') {
      break;
    }
    out += c;
    i += 1;
  }

  let sql = stripSqlEchoArtifacts(stripModelTraceNoise(out).trim());
  if (sql.length < 12) {
    return null;
  }
  if (!/\b(WITH|SELECT)\b/i.test(sql)) {
    return null;
  }
  return sql;
}

function parseSqlJsonPayload(jsonText: string, rawText: string): { sql: string; reasoning?: string } {
  let parsed: { sql?: string; reasoning?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const recovered = recoverSqlFromTruncatedJsonPayload(jsonText);
    if (recovered) {
      return { sql: recovered, reasoning: undefined };
    }
    throw new Error(`Could not parse JSON from model output: ${rawText.slice(0, 4000)}`);
  }

  if (!parsed.sql || typeof parsed.sql !== "string") {
    throw new Error("Model output did not include a valid 'sql' field.");
  }
  let sql = stripSqlEchoArtifacts(stripModelTraceNoise(parsed.sql).trim());
  if (!sql) {
    throw new Error("Model output did not include a valid 'sql' field.");
  }
  return {
    sql,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined
  };
}

/**
 * Hand-rolled validator for `InsightFields` (Phase 2 of the v0 match
 * plan; no `zod` dependency). Each field is independently coerced;
 * fields that fail validation are dropped silently and a `WARN` is
 * logged. Structurally invalid JSON throws and falls through to
 * body-only at the call site.
 */
function validateInsightFields(parsed: Record<string, unknown>): import("@/lib/chatTypes").InsightFields | null {
  const out: import("@/lib/chatTypes").InsightFields = {};

  if (typeof parsed.title === "string" && parsed.title.trim().length > 0) {
    out.title = parsed.title.trim().slice(0, 120);
  }
  if (typeof parsed.subtitle === "string" && parsed.subtitle.trim().length > 0) {
    out.subtitle = parsed.subtitle.trim().slice(0, 120);
  }
  if (typeof parsed.at_a_glance === "string" && parsed.at_a_glance.trim().length > 0) {
    out.at_a_glance = parsed.at_a_glance.trim().slice(0, 200);
  }
  if (parsed.corner_map && typeof parsed.corner_map === "object") {
    const cm = parsed.corner_map as Record<string, unknown>;
    if (typeof cm.circuit === "string" && cm.circuit.trim().length > 0) {
      out.corner_map = {
        circuit: cm.circuit.trim().slice(0, 40),
        corner_number: typeof cm.corner_number === "number" ? cm.corner_number : undefined,
        corner_label: typeof cm.corner_label === "string" ? cm.corner_label.slice(0, 40) : undefined
      };
    }
  }

  if (Array.isArray(parsed.metrics)) {
    const metrics: import("@/lib/chatTypes").InsightFieldMetric[] = [];
    for (const raw of parsed.metrics.slice(0, 3)) {
      if (!raw || typeof raw !== "object") continue;
      const m = raw as Record<string, unknown>;
      if (typeof m.label !== "string" || typeof m.value !== "string") continue;
      // Legacy data sometimes packs qualifier text into `unit` like
      // "s — Antonelli (lap 3)". Split on the em-dash so the unit stays
      // pure ("s") and the rest becomes context. Falls through cleanly
      // if the unit is already a bare token.
      let unit = typeof m.unit === "string" ? m.unit.trim() : undefined;
      let context = typeof m.context === "string" ? m.context.trim() : undefined;
      if (unit) {
        const splitMatch = /^(.{0,8}?)\s+[—–-]\s+(.+)$/.exec(unit);
        if (splitMatch) {
          unit = splitMatch[1].trim();
          if (!context) context = splitMatch[2].trim();
        }
      }
      metrics.push({
        label: m.label.trim().slice(0, 40),
        value: m.value.trim().slice(0, 30),
        unit: unit ? unit.slice(0, 12) : undefined,
        context: context ? context.slice(0, 60) : undefined,
        emphasis: m.emphasis === true || undefined
      });
    }
    if (metrics.length > 0) out.metrics = metrics;
  }

  if (Array.isArray(parsed.key_takeaways)) {
    const takeaways = parsed.key_takeaways
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 140))
      .slice(0, 6);
    if (takeaways.length > 0) out.key_takeaways = takeaways;
  }

  if (Array.isArray(parsed.related_questions)) {
    const followUps = parsed.related_questions
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim().slice(0, 120))
      .slice(0, 4);
    if (followUps.length > 0) out.related_questions = followUps;
  }

  if (parsed.hero && typeof parsed.hero === "object") {
    const h = parsed.hero as Record<string, unknown>;
    if (typeof h.value === "string" && typeof h.label === "string") {
      out.hero = {
        value: h.value.trim().slice(0, 60),
        label: h.label.trim().slice(0, 80),
        context: typeof h.context === "string" ? h.context.trim().slice(0, 120) : undefined
      };
    }
  }

  if (parsed.verdict && typeof parsed.verdict === "object") {
    const v = parsed.verdict as Record<string, unknown>;
    if ((v.label === "YES" || v.label === "NO") && typeof v.summary === "string") {
      // A categorical YES/NO over a hedging answer ("…cannot be confirmed
      // from the returned rows") misleads — the verdict banner reads as
      // the answer. Drop the verdict and let the prose carry the
      // uncertainty (2025 Bahrain stint-delta incident: "NO" over an
      // answer that said the hard-stint rows were truncated away).
      const answerText = typeof parsed.answer === "string" ? parsed.answer : undefined;
      if (answerHedgesVerdict(answerText, v.summary)) {
        logInsightParseOutcome("success", { droppedVerdict: "hedged_answer", label: v.label });
      } else {
        out.verdict = {
          label: v.label,
          summary: v.summary.trim().slice(0, 200),
          color: typeof v.color === "string" ? v.color : undefined
        };
      }
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Phase 11 telemetry: log insight-parse outcomes so we can monitor
 * the rate of structured-output parse failures over time. Drives the
 * decision of whether the JSON-key-extension format holds up or we
 * need to migrate to tool-use / structured outputs (§4.7).
 *
 * Outcomes:
 *   - "success"  — JSON parsed, validateInsightFields produced fields
 *   - "no-fields" — JSON parsed but no insight fields extracted (LLM
 *                   omitted the new keys; falls back to body-only)
 *   - "fallback"  — JSON parse threw; whole synthesis path falls back
 *                   to buildFallbackAnswer at the orchestration layer
 */
type InsightParseOutcome = "success" | "no-fields" | "fallback";

function logInsightParseOutcome(outcome: InsightParseOutcome, details?: Record<string, unknown>): void {
  // Async fire-and-forget log via the existing logServer path. Don't
  // block synthesis on the log write.
  void import("@/lib/serverLog").then(({ logServer }) => {
    void logServer("INFO", "chat_insight_parse", { outcome, ...details });
  }).catch(() => {
    // Logging failures are not fatal.
  });
}

function parseAnswerJsonPayload(
  jsonText: string,
  rawText: string
): {
  answer: string;
  reasoning?: string;
  insight: import("@/lib/chatTypes").InsightFields | null;
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    logInsightParseOutcome("fallback", { rawSnippet: rawText.slice(0, 200) });
    throw new Error(`Could not parse JSON from model output: ${rawText.slice(0, 4000)}`);
  }

  if (!parsed.answer || typeof parsed.answer !== "string") {
    logInsightParseOutcome("fallback", { reason: "missing_answer_field" });
    throw new Error("Model output did not include a valid 'answer' field.");
  }
  const insight = validateInsightFields(parsed);
  logInsightParseOutcome(insight ? "success" : "no-fields", {
    fieldCount: insight ? Object.keys(insight).length : 0
  });
  return {
    answer: parsed.answer.trim(),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    insight
  };
}

function parseAnthropicTextFromResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("content" in payload)) {
    throw new Error("Unexpected Anthropic response shape.");
  }
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("Anthropic response did not include content array.");
  }
  const textBlocks = content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const maybeText = (block as { type?: unknown; text?: unknown }).text;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .filter(Boolean);
  if (!textBlocks.length) {
    throw new Error("Anthropic response contained no text.");
  }
  return textBlocks.join("\n");
}

async function _callSqlGen(
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ rawText: string }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: SQL_MAX_TOKENS,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }
  const payload = await response.json();
  return { rawText: parseAnthropicTextFromResponse(payload) };
}

export async function generateSqlWithAnthropic(
  input: SqlGenerationInput
): Promise<SqlGenerationOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const contextText = JSON.stringify(input.context ?? {});
  const runtimeText = JSON.stringify(input.runtime ?? {});
  const matviewHint = buildMatviewHint(input.question);
  const userPrompt = `
Question:
${input.question}
${matviewHint}
Context:
${contextText}

Runtime:
${runtimeText}

Return JSON only.
`.trim();

  const systemPrompt = await buildSystemPrompt();

  // Phase 15-1: Try Haiku first; fall back to Sonnet if parse/validate fails.
  // Most SQL-gen tasks are simple enough that Haiku produces correct SQL
  // first-shot at ~10% the cost and ~3x faster than Sonnet. Anything that
  // fails the JSON-shape parse falls through to the Sonnet retry.
  const tryParse = async (model: string): Promise<SqlGenerationOutput> => {
    const { rawText } = await _callSqlGen(model, apiKey, systemPrompt, userPrompt);
    const jsonText = extractJsonText(rawText);
    const parsed = parseSqlJsonPayload(jsonText, rawText);
    return { sql: parsed.sql, reasoning: parsed.reasoning, model, rawText };
  };

  // Override path: explicit ANTHROPIC_MODEL set keeps the legacy single-model
  // behavior (used by the test grading suite where determinism matters).
  if (process.env.ANTHROPIC_MODEL && process.env.ANTHROPIC_MODEL.length > 0) {
    return tryParse(process.env.ANTHROPIC_MODEL);
  }

  try {
    return await tryParse(SQL_MODEL_PRIMARY);
  } catch (err) {
    // Surface the fallback decision in the rawText for telemetry.
    const fallbackResult = await tryParse(SQL_MODEL_FALLBACK);
    return {
      ...fallbackResult,
      reasoning: fallbackResult.reasoning
        ? `[fallback from ${SQL_MODEL_PRIMARY} after error: ${String(err).slice(0, 120)}] ${fallbackResult.reasoning}`
        : `[fallback from ${SQL_MODEL_PRIMARY} after error: ${String(err).slice(0, 120)}]`
    };
  }
}

export async function repairSqlWithAnthropic(input: {
  question: string;
  failingSql: string;
  dbError: string;
  /** Phase 17-C: optional pre-baked hint listing missing columns + the table's
   * real column list. Spliced verbatim into the user prompt before the dbError
   * block so the LLM has the catalog handy without needing to guess. */
  columnValidationHint?: string;
  context?: {
    sessionKey?: number;
    driverNumber?: number;
  };
  runtime?: {
    questionType?: string;
    grain?: string;
    resolvedEntities?: Record<string, unknown>;
    queryPlan?: Record<string, unknown>;
    requiredTables?: string[];
    completenessWarnings?: string[];
  };
}): Promise<SqlGenerationOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = DEFAULT_ANTHROPIC_MODEL;
  const contextText = JSON.stringify(input.context ?? {});
  const runtimeText = JSON.stringify(input.runtime ?? {});
  const validationBlock = input.columnValidationHint
    ? `\n\nColumn validation hint:\n${input.columnValidationHint}`
    : "";
  const userPrompt = `
Question:
${input.question}

Context:
${contextText}

Runtime:
${runtimeText}

Failing SQL:
${input.failingSql}

Database error:
${input.dbError}${validationBlock}

Provide corrected SQL only in JSON format.
`.trim();

  const repairSystem = `${await buildSystemPrompt()}\n\n${buildRepairPrompt()}`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: SQL_MAX_TOKENS,
      temperature: 0,
      system: repairSystem,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const rawText = parseAnthropicTextFromResponse(payload);
  const jsonText = extractJsonText(rawText);
  const parsed = parseSqlJsonPayload(jsonText, rawText);

  return {
    sql: parsed.sql,
    reasoning: parsed.reasoning,
    model,
    rawText
  };
}

export async function synthesizeAnswerWithAnthropic(
  input: AnswerSynthesisInput
): Promise<AnswerSynthesisOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = DEFAULT_ANTHROPIC_MODEL;
  const { system, messages } = buildSynthesisRequestParams(input);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: ANSWER_MAX_TOKENS,
      temperature: 0,
      system,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const rawText = parseAnthropicTextFromResponse(payload);
  const jsonText = extractJsonText(rawText);
  const parsed = parseAnswerJsonPayload(jsonText, rawText);

  return {
    answer: parsed.answer,
    reasoning: parsed.reasoning,
    insight: parsed.insight,
    model,
    rawText
  };
}

export type StreamChunk =
  | { kind: "answer_delta"; text: string }
  | { kind: "reasoning_delta"; text: string }
  | {
      kind: "final";
      answer: string;
      reasoning?: string;
      /** Phase 2: structured insight fields extracted from the
       *  synthesis JSON. `null` when validation produced no fields. */
      insight: import("@/lib/chatTypes").InsightFields | null;
      model: string;
      rawText: string;
    };

function decodeJsonStringSoFar(
  raw: string,
  startIdx: number
): { decoded: string; closed: boolean } {
  let i = startIdx;
  let out = "";
  let closed = false;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\\") {
      if (i + 1 >= raw.length) break;
      const n = raw[i + 1];
      if (n === "n") { out += "\n"; i += 2; continue; }
      if (n === "t") { out += "\t"; i += 2; continue; }
      if (n === "r") { out += "\r"; i += 2; continue; }
      if (n === "b") { out += "\b"; i += 2; continue; }
      if (n === "f") { out += "\f"; i += 2; continue; }
      if (n === '"' || n === "\\" || n === "/") { out += n; i += 2; continue; }
      if (n === "u") {
        if (i + 5 >= raw.length) break;
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += n;
      i += 2;
      continue;
    }
    if (c === '"') {
      closed = true;
      i += 1;
      break;
    }
    out += c;
    i += 1;
  }
  return { decoded: out, closed };
}

export async function* synthesizeAnswerStream(
  input: AnswerSynthesisInput
): AsyncGenerator<StreamChunk, void, undefined> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = DEFAULT_ANTHROPIC_MODEL;
  const { system, messages } = buildSynthesisRequestParams(input);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: ANSWER_MAX_TOKENS,
      temperature: 0,
      system,
      messages,
      stream: true
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error("Anthropic streaming response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let accumulated = "";

  let answerStart = -1;
  let reasoningStart = -1;
  let answerYielded = "";
  let reasoningYielded = "";
  let answerClosed = false;
  let reasoningClosed = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    let eventBoundary;
    while ((eventBoundary = sseBuffer.indexOf("\n\n")) !== -1) {
      const eventBlock = sseBuffer.slice(0, eventBoundary);
      sseBuffer = sseBuffer.slice(eventBoundary + 2);

      for (const line of eventBlock.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let evt: { type?: unknown; delta?: { type?: unknown; text?: unknown } };
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        if (
          evt.type !== "content_block_delta" ||
          !evt.delta ||
          evt.delta.type !== "text_delta" ||
          typeof evt.delta.text !== "string"
        ) {
          continue;
        }
        accumulated += evt.delta.text;

        if (answerStart === -1) {
          const m = /"answer"\s*:\s*"/.exec(accumulated);
          if (m && m.index !== undefined) {
            answerStart = m.index + m[0].length;
          }
        }
        if (reasoningStart === -1) {
          const m = /"reasoning"\s*:\s*"/.exec(accumulated);
          if (m && m.index !== undefined) {
            reasoningStart = m.index + m[0].length;
          }
        }

        if (answerStart !== -1 && !answerClosed) {
          const { decoded, closed } = decodeJsonStringSoFar(accumulated, answerStart);
          if (decoded.length > answerYielded.length) {
            const delta = decoded.slice(answerYielded.length);
            answerYielded = decoded;
            yield { kind: "answer_delta", text: delta };
          }
          if (closed) answerClosed = true;
        }

        if (reasoningStart !== -1 && !reasoningClosed) {
          const { decoded, closed } = decodeJsonStringSoFar(accumulated, reasoningStart);
          if (decoded.length > reasoningYielded.length) {
            const delta = decoded.slice(reasoningYielded.length);
            reasoningYielded = decoded;
            yield { kind: "reasoning_delta", text: delta };
          }
          if (closed) reasoningClosed = true;
        }
      }
    }
  }

  const jsonText = extractJsonText(accumulated);
  const parsed = parseAnswerJsonPayload(jsonText, accumulated);

  yield {
    kind: "final",
    answer: parsed.answer,
    reasoning: parsed.reasoning,
    insight: parsed.insight,
    model,
    rawText: accumulated
  };
}
