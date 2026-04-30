import type { DriverResolutionRow, SessionResolutionRow } from "@/lib/queries";
import type { QuestionType } from "./classification";

export type ResolutionStatus = "high_confidence" | "medium_confidence" | "low_confidence";

const SESSION_REQUIRED_TYPES = new Set<QuestionType>([
  "metadata_lookup",
  "aggregate_analysis",
  "comparison_analysis",
  "event_timeline_analysis",
  "telemetry_analysis"
]);

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function containsWholePhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function isBroadSessionDiscoveryQuestion(normalizedText: string): boolean {
  return (
    normalizedText.includes("sessions do we have") ||
    normalizedText.startsWith("which sessions") ||
    normalizedText.startsWith("what sessions") ||
    normalizedText.startsWith("what race sessions") ||
    normalizedText.includes("sessions in the warehouse")
  );
}

export function isWarehouseWideQuestion(normalizedText: string): boolean {
  return (
    normalizedText.includes("in the warehouse") ||
    normalizedText.includes("across the dataset") ||
    normalizedText.includes("across dataset") ||
    normalizedText.includes("currently have") ||
    normalizedText.includes("how many unique drivers") ||
    normalizedText.includes("which driver numbers appear") ||
    normalizedText.includes("appeared in all race sessions")
  );
}

export function requiresResolvedSession(questionType: QuestionType, normalizedText: string): boolean {
  if (isWarehouseWideQuestion(normalizedText)) {
    return false;
  }
  if (questionType === "entity_lookup" || questionType === "data_health_question") {
    return false;
  }
  if (isBroadSessionDiscoveryQuestion(normalizedText)) {
    return false;
  }
  if (questionType === "metadata_lookup") {
    if (normalizedText.includes("during 2025") || normalizedText.includes("across the dataset")) {
      return false;
    }
  }
  return SESSION_REQUIRED_TYPES.has(questionType);
}

export function sessionRecencyValue(row: SessionResolutionRow): number {
  const parsed = row.date_start ? Date.parse(row.date_start) : NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

export function compareScoredSessions(
  a: { row: SessionResolutionRow; score: number },
  b: { row: SessionResolutionRow; score: number }
): number {
  return (
    b.score - a.score ||
    sessionRecencyValue(b.row) - sessionRecencyValue(a.row) ||
    (a.row.session_key ?? 0) - (b.row.session_key ?? 0)
  );
}

export function buildSessionLabel(row: SessionResolutionRow): string {
  const segments = [
    row.session_name,
    row.country_name,
    row.location,
    row.circuit_short_name,
    row.year ? String(row.year) : undefined
  ].filter(Boolean);
  return segments.join(" / ");
}

export function mergeSessionRows(primary: SessionResolutionRow[], secondary: SessionResolutionRow[]): SessionResolutionRow[] {
  if (!secondary.length) {
    return primary;
  }
  const bySessionKey = new Map<number, SessionResolutionRow>();
  for (const row of primary) {
    bySessionKey.set(row.session_key, row);
  }
  for (const row of secondary) {
    if (!bySessionKey.has(row.session_key)) {
      bySessionKey.set(row.session_key, row);
    }
  }
  return Array.from(bySessionKey.values());
}

export function mergeDriverRows(primary: DriverResolutionRow[], secondary: DriverResolutionRow[]): DriverResolutionRow[] {
  if (!secondary.length) {
    return primary;
  }
  const byDriverNumber = new Map<number, DriverResolutionRow>();
  for (const row of primary) {
    byDriverNumber.set(row.driver_number, row);
  }
  for (const row of secondary) {
    if (!byDriverNumber.has(row.driver_number)) {
      byDriverNumber.set(row.driver_number, row);
    }
  }
  return Array.from(byDriverNumber.values());
}

export function deriveResolutionStatus(confidence: number): ResolutionStatus {
  if (confidence >= 0.9) {
    return "high_confidence";
  }
  if (confidence >= 0.6) {
    return "medium_confidence";
  }
  return "low_confidence";
}

export function scoreDriverCandidate(row: DriverResolutionRow, normalizedMessage: string): {
  score: number;
  matchedOn: string[];
} {
  let score = 0;
  const matchedOn: string[] = [];
  const fullName = (row.full_name ?? "").toLowerCase();
  const firstName = (row.first_name ?? "").toLowerCase();
  const lastName = (row.last_name ?? "").toLowerCase();
  const acronym = (row.name_acronym ?? "").toLowerCase();
  const broadcastName = (row.broadcast_name ?? "").toLowerCase();
  const teamName = (row.team_name ?? "").toLowerCase();

  if (fullName && containsWholePhrase(normalizedMessage, fullName)) {
    score += 25;
    matchedOn.push("full_name_exact");
  }
  if (fullName && normalizedMessage.includes(fullName)) {
    score += 8;
    matchedOn.push("full_name");
  }
  if (firstName && normalizedMessage.includes(firstName)) {
    score += 4;
    matchedOn.push("first_name");
  }
  if (lastName && normalizedMessage.includes(lastName)) {
    score += 6;
    matchedOn.push("last_name");
  }
  if (acronym && normalizedMessage.includes(acronym.toLowerCase())) {
    score += 3;
    matchedOn.push("name_acronym");
  }
  if (broadcastName && normalizedMessage.includes(broadcastName)) {
    score += 2;
    matchedOn.push("broadcast_name");
  }
  if (teamName && normalizedMessage.includes(teamName)) {
    score += 2;
    matchedOn.push("team_name");
  }
  if (containsWholePhrase(normalizedMessage, "max verstappen") && row.driver_number === 1) {
    score += 100;
    matchedOn.push("canonical_full_name_match");
  }

  return { score, matchedOn: unique(matchedOn) };
}
