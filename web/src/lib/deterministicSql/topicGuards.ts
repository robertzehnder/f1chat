// Phase 18-A: deterministic-template topic guards. Templates historically
// matched on positive trigger words alone, so a question whose intent is
// "tyre stints" could match a "lap pace + compare" template and silently
// answer the wrong question (observed 2026-05-02). topicSignal() classifies
// every question into one of five disjoint topics; templates declare which
// topics they answer and reject the call when an incompatible topic flag
// fires.

// Phase 21 (rev2): expanded topic taxonomy. Phase 18-A's 5-flag signal
// was extended for the analytics matviews — `dominance`, `traffic`, and
// `telemetry` are MODIFIERS that compose with primary topics; the rest
// are PRIMARY. The `templateAllowsTopic` guard interprets these via the
// ALLOWED_PRIMARY_PAIRS set so legitimate hybrids (`pace + stint`,
// `corner + braking`, etc.) match without false-rejection.
export type TopicSignal = {
  pace: boolean;
  stint: boolean;
  strategy: boolean;
  telemetry: boolean;
  dataHealth: boolean;
  // Phase 21 additions:
  dominance: boolean;       // modifier — composes with pace, corner, sector, straight_line
  corner: boolean;          // primary — pairs with braking, traction, pace
  braking: boolean;         // primary — pairs with corner
  traction: boolean;        // primary — pairs with corner
  straight_line: boolean;   // primary — pairs with pace
  traffic: boolean;         // modifier — composes with pace, stint, strategy, overtake_battle
  weather: boolean;         // primary — pairs with pace, stint
  incident: boolean;        // primary — pairs with restart
  restart: boolean;         // primary — pairs with overtake_battle, incident
  overtake_battle: boolean; // primary — pairs with strategy, restart, pace
  driver_score: boolean;    // primary — aggregator (bypasses pair check)
};

// Phase 21: primary vs modifier classification.
export const PRIMARY_TOPICS: ReadonlySet<keyof TopicSignal> = new Set<keyof TopicSignal>([
  "pace",
  "stint",
  "strategy",
  "corner",
  "braking",
  "traction",
  "straight_line",
  "weather",
  "incident",
  "restart",
  "overtake_battle",
  "driver_score",
  "dataHealth"
]);

export const MODIFIER_TOPICS: ReadonlySet<keyof TopicSignal> = new Set<keyof TopicSignal>([
  "dominance",
  "traffic",
  "telemetry"
]);

// Pair set: any UNORDERED primary pair appearing here is allowed. Pairs
// NOT here are rejected when both primaries are present.
export const ALLOWED_PRIMARY_PAIRS: ReadonlyArray<ReadonlyArray<keyof TopicSignal>> = [
  ["pace", "stint"],
  ["stint", "strategy"],
  ["pace", "weather"],
  ["stint", "weather"],
  ["pace", "corner"],
  ["pace", "straight_line"],
  ["corner", "braking"],
  ["corner", "traction"],
  ["pace", "overtake_battle"],
  ["overtake_battle", "restart"],
  ["incident", "restart"],
  ["overtake_battle", "strategy"]
];

const PACE_KEYWORDS: ReadonlyArray<string> = [
  "lap pace",
  "lap time",
  "pace summary",
  "sector pace",
  "sector time",
  "clean lap pace",
  "clean-lap pace",
  "average lap",
  "avg lap",
  "best lap",
  "fastest lap",
  "lap duration",
  "consistency",
  "fresh-tyre pace",
  "fresh tyre pace",
  "fresh-tire pace",
  "fresh tire pace",
  "pre-pit pace",
  "post-pit pace"
];

const STINT_KEYWORDS: ReadonlyArray<string> = [
  "stint",
  "stints",
  "tyre",
  "tire",
  "tyres",
  "tires",
  "compound",
  "compounds",
  "pit window",
  "pit cycle",
  "fresh tyres",
  "fresh tires",
  "used tyres",
  "used tires"
];

const STRATEGY_KEYWORDS: ReadonlyArray<string> = [
  "strategy",
  "strategies",
  "pit stop",
  "pit stops",
  "pit count",
  "undercut",
  "overcut",
  "two-stopper",
  "one-stopper",
  "stop count",
  "pit duration"
];

const TELEMETRY_KEYWORDS: ReadonlyArray<string> = [
  "telemetry",
  "top speed",
  "throttle",
  "brake",
  "gear",
  "drs",
  "rpm",
  "speed trap",
  "trap speed"
];

// Phase 21: keyword sets for the new topic flags. Kept conservative —
// false-positive risk on bare tokens (e.g. "brake" already in
// TELEMETRY_KEYWORDS) is mitigated by phrase-level matches. The
// PROPRIETARY_NO_DATA_TOPICS guard runs FIRST in chatRuntime, so any
// genuinely-proprietary phrase is filtered before topicSignal() runs.
const DOMINANCE_KEYWORDS: ReadonlyArray<string> = [
  "track dominance",
  "minisector",
  "mini-sector",
  "mini sector",
  "sector dominance",
  "dominant",
  "owned the sector",
  "owned s1",
  "owned s2",
  "owned s3",
  "purple sector"
];

const CORNER_KEYWORDS: ReadonlyArray<string> = [
  "corner",
  "apex",
  "entry speed",
  "exit speed",
  "mid-corner",
  "mid corner",
  "turn-in",
  "turn in",
  "trail-brake",
  "trail brake"
];

const BRAKING_KEYWORDS: ReadonlyArray<string> = [
  "brake zone",
  "brake-zone",
  "braking zone",
  "braking-zone",
  "brake later",
  "braked later",
  "brake earlier",
  "threshold braking",
  "brake application"
];

const TRACTION_KEYWORDS: ReadonlyArray<string> = [
  "traction",
  "throttle application",
  "exit traction",
  "corner-exit",
  "corner exit",
  "throttle-on"
];

const STRAIGHT_LINE_KEYWORDS: ReadonlyArray<string> = [
  "straight line",
  "straight-line",
  "i1 speed",
  "i2 speed",
  "speed trap",
  "trap speed",
  "kemmel"
];

const TRAFFIC_KEYWORDS: ReadonlyArray<string> = [
  "traffic",
  "clean air",
  "clean-air",
  "dirty air",
  "dirty-air",
  "drs train"
];

const WEATHER_KEYWORDS: ReadonlyArray<string> = [
  "wet",
  "dry",
  "rain",
  "intermediate",
  "inters",
  "crossover lap",
  "wet pace",
  "dry pace"
];

const INCIDENT_KEYWORDS: ReadonlyArray<string> = [
  "penalty",
  "penalties",
  "license points",
  "licence points",
  "stewards",
  "investigation",
  "track limits",
  "drive through",
  "drive-through"
];

const RESTART_KEYWORDS: ReadonlyArray<string> = [
  "safety car restart",
  "sc restart",
  "vsc restart",
  "lap-1 launch",
  "lap 1 launch",
  "race start",
  "standing start",
  "rolling start"
];

const OVERTAKE_BATTLE_KEYWORDS: ReadonlyArray<string> = [
  "overtake",
  "overtaken",
  "battle",
  "side-by-side",
  "side by side",
  "drs zone",
  "wheel-to-wheel",
  "wheel to wheel"
];

const DRIVER_SCORE_KEYWORDS: ReadonlyArray<string> = [
  "driver rating",
  "driver score",
  "7-axis",
  "seven axis",
  "season ranking",
  "axis score"
];

const DATA_HEALTH_KEYWORDS: ReadonlyArray<string> = [
  "coverage",
  "complete",
  "completeness",
  "ingest",
  "rows in",
  "row count",
  "in canonical id",
  "canonical id",
  "canonical ids",
  "data health"
];

function anyContains(haystack: string, needles: ReadonlyArray<string>): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}

/**
 * Phase 18-A: classify a normalized (lowercased) question text into the
 * topic flags. Multiple flags can be true (hybrids: "stint pace vs tyre age"
 * → pace + stint). Templates that own a hybrid topic explicitly accept the
 * hybrid; templates that own a single topic reject when an incompatible
 * topic is also present.
 */
export function topicSignal(text: string): TopicSignal {
  const lower = text.toLowerCase();
  return {
    pace: anyContains(lower, PACE_KEYWORDS),
    stint: anyContains(lower, STINT_KEYWORDS),
    strategy: anyContains(lower, STRATEGY_KEYWORDS),
    telemetry: anyContains(lower, TELEMETRY_KEYWORDS),
    dataHealth: anyContains(lower, DATA_HEALTH_KEYWORDS),
    // Phase 21 additions:
    dominance: anyContains(lower, DOMINANCE_KEYWORDS),
    corner: anyContains(lower, CORNER_KEYWORDS),
    braking: anyContains(lower, BRAKING_KEYWORDS),
    traction: anyContains(lower, TRACTION_KEYWORDS),
    straight_line: anyContains(lower, STRAIGHT_LINE_KEYWORDS),
    traffic: anyContains(lower, TRAFFIC_KEYWORDS),
    weather: anyContains(lower, WEATHER_KEYWORDS),
    incident: anyContains(lower, INCIDENT_KEYWORDS),
    restart: anyContains(lower, RESTART_KEYWORDS),
    overtake_battle: anyContains(lower, OVERTAKE_BATTLE_KEYWORDS),
    driver_score: anyContains(lower, DRIVER_SCORE_KEYWORDS)
  };
}

/**
 * Topic taxonomy for every deterministic template. Each entry names the
 * topics the template owns; the template's match guard checks that AT
 * LEAST ONE owned topic is present and that NO disjoint topic conflicts
 * (per the per-template `rejectIfPresent` set).
 *
 * Hybrids (pre/post pit pace, stint pace vs tire age, lap degradation by
 * stint) own two topics and accept either, but reject `strategy`-only or
 * `telemetry`-only intents.
 *
 * To add a new template: add an entry here AND a topic guard at the
 * template's match site. The coverage test
 * `template-router-topic-coverage.test.mjs` enumerates `templateKey:`
 * literals across the deterministic-SQL files and fails when one isn't
 * declared in this map (or in `TEMPLATE_TOPICS_EXEMPT`).
 */
export type TemplateTopicEntry = {
  owns: ReadonlyArray<keyof TopicSignal>;
  rejectIfPresent?: ReadonlyArray<keyof TopicSignal>;
};

export const TEMPLATE_TOPICS: Readonly<Record<string, TemplateTopicEntry>> = {
  // pace.ts (split)
  practice_laps_vs_race_pace_same_meeting: { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_avg_clean_lap_pace:           { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_lap_degradation_by_stint:     { owns: ["pace", "stint"], rejectIfPresent: ["strategy"] },
  max_leclerc_final_third_pace:             { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_common_lap_window_pace:       { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_pre_post_pit_pace:            { owns: ["pace", "stint"], rejectIfPresent: ["strategy"] },
  max_leclerc_stint_pace_vs_tire_age:       { owns: ["pace", "stint"], rejectIfPresent: ["strategy"] },
  max_leclerc_post_pit_pace:                { owns: ["pace", "stint"], rejectIfPresent: ["strategy"] },
  max_leclerc_lap_pace_summary:             { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },

  // strategy.ts (split)
  max_leclerc_pit_stop_count:                       { owns: ["strategy"], rejectIfPresent: ["pace", "telemetry"] },
  max_leclerc_pit_laps:                             { owns: ["strategy"], rejectIfPresent: ["pace", "telemetry"] },
  max_leclerc_shortest_pit_stop:                    { owns: ["strategy"], rejectIfPresent: ["pace", "telemetry"] },
  max_leclerc_total_pit_time:                       { owns: ["strategy"], rejectIfPresent: ["pace", "telemetry"] },
  max_leclerc_stint_lengths:                        { owns: ["stint", "strategy"], rejectIfPresent: ["telemetry"] },
  max_leclerc_compounds_used:                       { owns: ["stint", "strategy"], rejectIfPresent: ["telemetry"] },
  max_leclerc_strategy_type:                        { owns: ["strategy"], rejectIfPresent: ["pace", "telemetry"] },
  max_leclerc_position_change_around_pit_cycle:     { owns: ["strategy"], rejectIfPresent: ["telemetry"] },
  max_leclerc_opening_closing_stint_lengths:        { owns: ["stint", "strategy"], rejectIfPresent: ["telemetry"] },

  // result.ts (split)
  max_leclerc_positions_gained_or_lost: { owns: ["strategy"], rejectIfPresent: ["pace", "telemetry"] },

  // telemetry.ts (split)
  max_leclerc_fastest_lap_telemetry_window: { owns: ["telemetry", "pace"], rejectIfPresent: ["strategy"] },

  // dataHealth.ts (split)
  canonical_id_lookup_abu_dhabi_2025_race:       { owns: ["dataHealth"] },
  sessions_most_complete_downstream_coverage:    { owns: ["dataHealth"] },

  // deterministicSql.ts (legacy monolith — pre-split inline templates)
  fastest_lap_by_driver:                              { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  top10_fastest_laps_overall:                         { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_qualifying_improvement:                 { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  abu_dhabi_weekend_smallest_spread_and_comparison:   { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_fastest_lap_per_driver:                 { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_sector_comparison:                      { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_lap_consistency:                        { owns: ["pace"], rejectIfPresent: ["stint", "strategy"] },
  max_leclerc_top_speed:                              { owns: ["telemetry", "pace"], rejectIfPresent: ["strategy"] },
  max_leclerc_running_order_progression:              { owns: ["pace", "strategy"], rejectIfPresent: ["telemetry"] },
  max_leclerc_fresh_vs_used_tires:                    { owns: ["pace", "stint"], rejectIfPresent: ["telemetry"] }
};

/**
 * templateKeys that intentionally have no topic annotation. Empty for now;
 * if a future template legitimately answers across all topics (e.g. a
 * "session metadata" template), add it here with a justification.
 */
export const TEMPLATE_TOPICS_EXEMPT: ReadonlyArray<string> = [];

/**
 * Phase 18-A guard: returns true iff the topic signal is compatible with
 * the named template. A template MAY fire when:
 * - at least one of its `owns` flags is true in the signal, AND
 * - none of its `rejectIfPresent` flags are true.
 *
 * For unknown templateKeys, returns true (preserves current behavior; the
 * coverage test catches missing annotations at PR-time).
 */
export function templateAllowsTopic(templateKey: string, signal: TopicSignal): boolean {
  const entry = TEMPLATE_TOPICS[templateKey];
  if (!entry) return true;
  const ownsAny = entry.owns.some((flag) => signal[flag]);
  if (!ownsAny) return false;
  const rejectAny = entry.rejectIfPresent?.some((flag) => signal[flag]) ?? false;
  if (rejectAny) return false;
  return true;
}
