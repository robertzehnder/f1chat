import type { DriverResolutionRow, SessionResolutionRow } from "@/lib/queries";
import type { QuestionType } from "./classification";

// Phase 17-E: 4-member union (added "timeout" for cases where the resolver
// SQL exceeds its deadline — a different shape from low_confidence).
// Consumers that switch on ResolutionStatus must handle the timeout branch.
export type ResolutionStatus =
  | "high_confidence"
  | "medium_confidence"
  | "low_confidence"
  | "timeout";

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

function isSeasonCalendarMetadataQuestion(normalizedText: string): boolean {
  return (
    /\b20\d{2}\b/.test(normalizedText) &&
    normalizedText.includes("calendar") &&
    (normalizedText.includes("sprint weekend") || normalizedText.includes("sprint weekends"))
  );
}

function isSeasonWideCrossSessionAggregateQuestion(normalizedText: string): boolean {
  const mentionsSeasonScope =
    /\b20\d{2}\b/.test(normalizedText) &&
    (normalizedText.includes("across all") || normalizedText.includes("all ")) &&
    (normalizedText.includes("race weekends") || normalizedText.includes("race weekend"));
  const mentionsCrossSessionMarkers =
    normalizedText.includes("fp1") &&
    (normalizedText.includes("qualifying") || normalizedText.includes("qualy"));
  return mentionsSeasonScope && mentionsCrossSessionMarkers;
}

export function isWarehouseWideQuestion(normalizedText: string): boolean {
  return (
    normalizedText.includes("in the warehouse") ||
    normalizedText.includes("across the dataset") ||
    normalizedText.includes("across dataset") ||
    normalizedText.includes("currently have") ||
    normalizedText.includes("how many unique drivers") ||
    normalizedText.includes("which driver numbers appear") ||
    normalizedText.includes("appeared in all race sessions") ||
    // Phase 25.2 loop tightening: season-scoped retrospectives are
    // structurally warehouse-wide — they enumerate races/sessions
    // across the season, not a specific weekend. Pinning a single
    // session forces the LLM to filter by session_key, returning 0
    // rows on a season-wide question.
    isSeasonRetrospective(normalizedText)
  );
}

function isSeasonRetrospective(normalizedText: string): boolean {
  // Conservative pattern set — fires only when the question
  // explicitly enumerates "the season" or "each race / weekend
  // / round / session" with a year anchor. False-positives on
  // single-race questions ("at the 2025 Hungarian Grand Prix")
  // would break Phase 25.1; the patterns below all require an
  // enumeration verb + season scope.
  const enumerative =
    normalizedText.includes("each race") ||
    normalizedText.includes("each weekend") ||
    normalizedText.includes("each round") ||
    normalizedText.includes("every race") ||
    normalizedText.includes("every weekend") ||
    normalizedText.includes("every round") ||
    normalizedText.includes("identify each") ||
    normalizedText.includes("identify all") ||
    normalizedText.includes("list each") ||
    normalizedText.includes("list all") ||
    normalizedText.includes("which races") ||
    normalizedText.includes("which weekends") ||
    normalizedText.includes("which rounds") ||
    normalizedText.includes("aggregate across") ||
    normalizedText.includes("across the 2025 season") ||
    normalizedText.includes("for the 2025 season") ||
    normalizedText.includes("across all 2025") ||
    normalizedText.includes("season-wide") ||
    normalizedText.includes("season wide");
  if (enumerative) return true;
  // Phase 25.2 Round 2: season-aggregate axis-rating questions like
  // "Verstappen's tyre-management axis rating for 2025" or
  // "Norris's qualifying-axis score across the 2025 season so far"
  // are season-wide aggregates against analytics.driver_performance_score.
  // They do NOT name a specific session and should not pin one.
  const axisAggregator =
    /\baxis\s+(score|rating|score across|rating across)\b/.test(normalizedText) &&
    /\b20\d{2}\b/.test(normalizedText);
  if (axisAggregator) return true;
  // Bare "for 2025" / "in 2025" / "during 2025" (no specific
  // venue mentioned) on a question that asks for a per-driver
  // aggregate. Conservative: requires absence of the most-common
  // single-race venue tokens AND presence of a season-grain word
  // (axis / rating / score / record / count / total / overall /
  // form / progress / trend).
  const hasVenue = (
    normalizedText.includes("monza") || normalizedText.includes("spa") ||
    normalizedText.includes("silverstone") || normalizedText.includes("suzuka") ||
    normalizedText.includes("monaco") || normalizedText.includes("abu dhabi") ||
    normalizedText.includes("yas marina") || normalizedText.includes("bahrain") ||
    normalizedText.includes("baku") || normalizedText.includes("imola") ||
    normalizedText.includes("hungaroring") || normalizedText.includes("hungarian") ||
    normalizedText.includes("zandvoort") || normalizedText.includes("austria") ||
    normalizedText.includes("austrian") || normalizedText.includes("spielberg") ||
    normalizedText.includes("saudi") || normalizedText.includes("jeddah") ||
    normalizedText.includes("australia") || normalizedText.includes("australian") ||
    normalizedText.includes("melbourne") || normalizedText.includes("vegas") ||
    normalizedText.includes("qatar") || normalizedText.includes("singapore") ||
    normalizedText.includes("mexico") || normalizedText.includes("brazil") ||
    normalizedText.includes("brazilian") || normalizedText.includes("sao paulo") ||
    normalizedText.includes("são paulo") || normalizedText.includes("interlagos") ||
    normalizedText.includes("miami") || normalizedText.includes("shanghai") ||
    normalizedText.includes("china") || normalizedText.includes("chinese") ||
    normalizedText.includes("japan") || normalizedText.includes("japanese") ||
    normalizedText.includes("italy") || normalizedText.includes("italian") ||
    normalizedText.includes("british") || normalizedText.includes("united kingdom") ||
    normalizedText.includes("netherlands") || normalizedText.includes("dutch") ||
    normalizedText.includes("belgian") || normalizedText.includes("spain") ||
    normalizedText.includes("spanish") || normalizedText.includes("canadian") ||
    normalizedText.includes("canada")
  );
  const hasSeasonGrainWord = (
    normalizedText.includes(" rating") || normalizedText.includes(" score") ||
    normalizedText.includes(" axis") || normalizedText.includes(" record") ||
    normalizedText.includes(" total") || normalizedText.includes(" overall") ||
    normalizedText.includes(" trend")
  );
  const hasYearAnchor = /\b20\d{2}\b/.test(normalizedText);
  const hasSeasonScopeShort =
    normalizedText.includes(" for 2025") ||
    normalizedText.includes(" in 2025") ||
    normalizedText.includes(" during 2025") ||
    normalizedText.includes(" 2025 season");
  if (!hasVenue && hasYearAnchor && hasSeasonGrainWord && hasSeasonScopeShort) return true;
  return false;
}

export function requiresResolvedSession(questionType: QuestionType, normalizedText: string): boolean {
  if (isWarehouseWideQuestion(normalizedText)) {
    return false;
  }
  if (isSeasonCalendarMetadataQuestion(normalizedText)) {
    return false;
  }
  if (isSeasonWideCrossSessionAggregateQuestion(normalizedText)) {
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

// F16 (golden-set audit 2026-07-02): the warehouse team_name is the full
// legal name ("red bull racing"), which a message saying "Red Bull" does
// not contain, so team mentions never matched and comparisons like
// "McLaren vs Red Bull" resolved only the substring-matching team. Match
// the canonical name OR any word-boundary alias.
const TEAM_ALIASES: Record<string, string[]> = {
  "red bull racing": ["red bull", "redbull", "rbr"],
  "racing bulls": ["rb", "vcarb", "visa cash app rb"],
  "aston martin": ["aston"],
  "kick sauber": ["sauber", "stake"],
  "haas f1 team": ["haas"],
  "alpine": ["alpine f1"]
};

function messageMentionsTeam(normalizedMessage: string, teamName: string): boolean {
  const canon = teamName.toLowerCase();
  if (normalizedMessage.includes(canon)) return true;
  const aliases = TEAM_ALIASES[canon] ?? [];
  // Word-boundary the aliases so "rb" doesn't match inside "verb"/"curb".
  return aliases.some((a) =>
    new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalizedMessage)
  );
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
  if (teamName && messageMentionsTeam(normalizedMessage, teamName)) {
    score += 2;
    matchedOn.push("team_name");
  }
  if (containsWholePhrase(normalizedMessage, "max verstappen") && row.driver_number === 1) {
    score += 100;
    matchedOn.push("canonical_full_name_match");
  }

  return { score, matchedOn: unique(matchedOn) };
}

export type DisambiguationResult = {
  scoredCandidates: { row: DriverResolutionRow; matchedOn: string[]; score: number }[];
  ambiguousSurnames: { surname: string; rows: DriverResolutionRow[] }[];
};

export function disambiguateDrivers(
  rows: DriverResolutionRow[],
  normalizedMessage: string,
  sessionYear: number | null
): DisambiguationResult {
  const scored = rows.map((row) => {
    const base = scoreDriverCandidate(row, normalizedMessage);
    return { row, score: base.score, matchedOn: [...base.matchedOn] };
  });

  const mentionsVerstappen = containsWholePhrase(normalizedMessage, "verstappen");
  const mentionsMax = containsWholePhrase(normalizedMessage, "max");
  const bareVerstappen = mentionsVerstappen && !mentionsMax;

  const ambiguousSurnames: DisambiguationResult["ambiguousSurnames"] = [];

  if (bareVerstappen) {
    if (sessionYear !== null && sessionYear >= 2024) {
      const maxItem = scored.find((item) => item.row.driver_number === 1);
      if (maxItem) {
        maxItem.score += 5;
        maxItem.matchedOn.push("bare_verstappen_2024_default");
      }
    } else {
      const verstappenRows = rows.filter(
        (row) => (row.last_name ?? "").toLowerCase() === "verstappen"
      );
      if (verstappenRows.length >= 2) {
        ambiguousSurnames.push({ surname: "verstappen", rows: verstappenRows });
      }
    }
  }

  const scoredCandidates = scored
    .filter((item) => item.score > 0)
    .map((item) => ({
      row: item.row,
      score: item.score,
      matchedOn: unique(item.matchedOn)
    }))
    .sort((a, b) => b.score - a.score || a.row.driver_number - b.row.driver_number);

  return { scoredCandidates, ambiguousSurnames };
}
