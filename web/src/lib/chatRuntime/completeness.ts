import type { QuestionType } from "./classification";

export type CompletenessStatus = "usable" | "globally_empty" | "session_empty" | "needs_session";

export type TableCheck = {
  table: string;
  globalRows: number;
  sessionRows?: number;
  status: CompletenessStatus;
};

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function includesAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function requiredTablesForQuestion(questionType: QuestionType, normalizedMessage: string): string[] {
  const asksStrategy = includesAnyPhrase(normalizedMessage, [
    "pit stop",
    "pit stops",
    "pit lane",
    "stint",
    "strategy",
    "undercut",
    "overcut",
    "fresh tires",
    "fresh tyres",
    "tyre age",
    "tire age"
  ]);
  const asksResultOrGrid = includesAnyPhrase(normalizedMessage, [
    "starting grid",
    "grid position",
    "finish order",
    "final result",
    "classification",
    "positions gained",
    "gained or lost"
  ]);
  const asksProgression = includesAnyPhrase(normalizedMessage, [
    "running order",
    "race progression",
    "pit cycle",
    "position change"
  ]);
  const asksTelemetry = includesAnyPhrase(normalizedMessage, [
    "telemetry",
    "top speed",
    "braked later",
    "carried more speed",
    "throttle",
    "brake"
  ]);

  if (
    normalizedMessage.includes("which teams were present") ||
    normalizedMessage.includes("teams were present in") ||
    normalizedMessage.includes("driver and team names") ||
    normalizedMessage.includes("roster for")
  ) {
    return ["core.sessions", "core.session_drivers"];
  }

  if (
    normalizedMessage.includes("how many unique drivers") ||
    normalizedMessage.includes("which driver numbers appear") ||
    normalizedMessage.includes("driver numbers appear in the warehouse")
  ) {
    return ["core.session_drivers"];
  }

  if (normalizedMessage.includes("starting grid") || normalizedMessage.includes("grid position")) {
    return ["core.grid_vs_finish", "core.session_drivers"];
  }
  if (normalizedMessage.includes("overtake")) {
    return ["raw.overtakes", "raw.position_history", "raw.pit"];
  }
  if (
    normalizedMessage.includes("classification") ||
    normalizedMessage.includes("final result") ||
    normalizedMessage.includes("finish order")
  ) {
    return ["core.grid_vs_finish", "core.race_progression_summary", "core.session_drivers"];
  }

  switch (questionType) {
    case "entity_lookup":
      return ["core.sessions"];
    case "metadata_lookup":
      return ["core.sessions", "core.session_drivers"];
    case "aggregate_analysis":
      if (asksResultOrGrid) {
        return ["core.grid_vs_finish", "core.race_progression_summary", "core.session_drivers"];
      }
      if (asksStrategy) {
        return [
          "core.strategy_summary",
          "core.stint_summary",
          "core.pit_cycle_summary",
          "core.strategy_evidence_summary",
          "core.session_drivers"
        ];
      }
      if (asksProgression) {
        return ["core.race_progression_summary", "core.replay_lap_frames"];
      }
      return ["core.laps_enriched", "core.driver_session_summary", "core.session_drivers"];
    case "comparison_analysis":
      if (asksTelemetry) {
        return [
          "core.telemetry_lap_bridge",
          "core.laps_enriched",
          "core.replay_lap_frames",
          "raw.car_data",
          "raw.location"
        ];
      }
      if (asksResultOrGrid) {
        return ["core.grid_vs_finish", "core.race_progression_summary", "core.session_drivers"];
      }
      if (asksProgression) {
        return ["core.race_progression_summary", "core.replay_lap_frames"];
      }
      if (asksStrategy) {
        return [
          "core.strategy_summary",
          "core.stint_summary",
          "core.pit_cycle_summary",
          "core.strategy_evidence_summary",
          "core.laps_enriched",
          "core.session_drivers"
        ];
      }
      return [
        "core.laps_enriched",
        "core.driver_session_summary",
        "core.session_drivers"
      ];
    case "event_timeline_analysis":
      return [
        "core.race_progression_summary",
        "core.replay_lap_frames",
        "raw.weather",
        "raw.race_control",
        "raw.team_radio"
      ];
    case "telemetry_analysis":
      return [
        "core.telemetry_lap_bridge",
        "core.replay_lap_frames",
        "core.laps_enriched",
        "raw.car_data",
        "raw.location"
      ];
    case "data_health_question":
      return [
        "core.session_completeness",
        "core.weekend_session_coverage",
        "core.weekend_session_expectation_audit",
        "core.source_anomaly_tracking",
        "raw.sessions",
        "raw.drivers",
        "raw.laps",
        "raw.car_data",
        "raw.location"
      ];
    default:
      return ["core.sessions"];
  }
}

export function fallbackOptionsForTables(tables: string[]): string[] {
  const options: string[] = [];
  if (tables.includes("core.laps_enriched")) {
    options.push("fallback to raw.laps with explicit validity filters when semantic lap contract is unavailable");
  }
  if (tables.includes("core.driver_session_summary")) {
    options.push("fallback to raw.laps + core.session_drivers aggregation for driver/session pace");
  }
  if (tables.includes("core.stint_summary") || tables.includes("core.strategy_summary")) {
    options.push("fallback to raw.stints/raw.pit-derived strategy calculations");
  }
  if (tables.includes("core.grid_vs_finish")) {
    options.push("fallback to raw.starting_grid/raw.session_result with raw.position_history backfill");
  }
  if (tables.includes("core.race_progression_summary")) {
    options.push("fallback to raw.position_history aligned with lap windows");
  }
  if (tables.includes("core.telemetry_lap_bridge")) {
    options.push("fallback to raw.car_data/raw.location sampled in lap windows");
  }
  if (tables.includes("core.replay_lap_frames")) {
    options.push("fallback to raw.weather/raw.race_control joined to lap timeline");
  }
  if (tables.includes("raw.session_result")) {
    options.push("infer from latest raw.position_history or raw.intervals (unofficial)");
  }
  if (tables.includes("raw.overtakes")) {
    options.push("infer position changes from raw.position_history and raw.pit (not official overtakes)");
  }
  if (tables.includes("raw.starting_grid")) {
    options.push("no reliable fallback available for starting grid in the current load");
  }
  if (tables.includes("raw.car_data") || tables.includes("raw.location")) {
    options.push("use telemetry_window sampling instead of full telemetry_point extraction");
  }
  return unique(options);
}
