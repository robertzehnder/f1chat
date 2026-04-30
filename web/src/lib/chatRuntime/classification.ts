export type QuestionType =
  | "entity_lookup"
  | "metadata_lookup"
  | "aggregate_analysis"
  | "comparison_analysis"
  | "event_timeline_analysis"
  | "telemetry_analysis"
  | "data_health_question";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyQuestion(message: string): QuestionType {
  const lower = normalize(message);

  if (
    lower.includes("missing telemetry") ||
    lower.includes("completeness") ||
    lower.includes("coverage") ||
    lower.includes("data health")
  ) {
    return "data_health_question";
  }

  if (
    lower.includes("how many unique drivers") ||
    lower.includes("which driver numbers appear") ||
    lower.includes("driver numbers appear in the warehouse") ||
    lower.includes("drivers are represented in the warehouse")
  ) {
    return "metadata_lookup";
  }

  if (
    lower.includes("sessions do we have") ||
    lower.startsWith("which sessions") ||
    lower.startsWith("what sessions") ||
    lower.startsWith("what race sessions") ||
    lower.includes("sessions in the warehouse")
  ) {
    return "entity_lookup";
  }

  if (
    lower.includes("telemetry") ||
    lower.includes("throttle") ||
    lower.includes("brake") ||
    lower.includes("rpm") ||
    lower.includes("gear") ||
    lower.includes("drs") ||
    lower.includes("speed trace")
  ) {
    return "telemetry_analysis";
  }
  if (
    lower.includes("weather") ||
    lower.includes("race control") ||
    lower.includes("timeline") ||
    lower.includes("flag")
  ) {
    return "event_timeline_analysis";
  }
  if (lower.includes("compare") || lower.includes(" vs ") || lower.includes("versus")) {
    return "comparison_analysis";
  }
  if (
    lower.includes("which teams were present") ||
    lower.includes("teams were present in") ||
    lower.includes("driver and team names") ||
    lower.includes("roster for")
  ) {
    return "metadata_lookup";
  }

  if (
    lower.includes("who drove") ||
    lower.includes("which drivers") ||
    lower.includes("driver roster") ||
    lower.includes("drivers in")
  ) {
    return "metadata_lookup";
  }
  if (
    lower.includes("session key") ||
    lower.startsWith("what session") ||
    lower.startsWith("find session")
  ) {
    return "entity_lookup";
  }

  return "aggregate_analysis";
}
