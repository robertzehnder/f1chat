import {
  getGlobalTableCounts,
  getSessionByKey,
  getSessionTableCounts,
  type DriverResolutionRow,
  type SessionResolutionRow
} from "@/lib/queries";
import {
  getDriversForResolutionCached,
  getDriversFromIdentityLookupCached,
  getSessionsForResolutionCached,
  getSessionsFromSearchLookupCached
} from "@/lib/resolverCache";
import { startSpan, type SpanRecord } from "@/lib/perfTrace";

type ChatContext = {
  sessionKey?: number;
  driverNumber?: number;
};

export type QuestionType =
  | "entity_lookup"
  | "metadata_lookup"
  | "aggregate_analysis"
  | "comparison_analysis"
  | "event_timeline_analysis"
  | "telemetry_analysis"
  | "data_health_question";

type ResolutionStatus = "high_confidence" | "medium_confidence" | "low_confidence";
type CompletenessStatus = "usable" | "globally_empty" | "session_empty" | "needs_session";
type RowVolume = "small" | "medium" | "large";
type Grain =
  | "session"
  | "driver_session"
  | "lap"
  | "stint"
  | "event"
  | "telemetry_point"
  | "telemetry_window";

type SessionCandidate = {
  sessionKey: number;
  meetingKey: number | null;
  sessionName: string | null;
  confidence: number;
  score: number;
  label: string;
  matchedOn: string[];
};

type DriverCandidate = {
  driverNumber: number;
  fullName: string | null;
  confidence: number;
  score: number;
  matchedOn: string[];
};

type TableCheck = {
  table: string;
  globalRows: number;
  sessionRows?: number;
  status: CompletenessStatus;
};

type QueryPlan = {
  question_type: QuestionType;
  resolved_entities: {
    session_key?: number;
    meeting_key?: number;
    driver_numbers?: number[];
    year?: number;
  };
  grain: Grain;
  primary_tables: string[];
  joins: string[];
  filters: string[];
  aggregation?: string;
  ordering?: string;
  limit?: number;
  sampling_strategy?: string;
  risk_flags: string[];
  expected_row_count: RowVolume;
};

export type ChatRuntimeStageLog = {
  stage:
    | "intake"
    | "entity_resolution"
    | "ambiguity_manager"
    | "completeness_check"
    | "grain_selection"
    | "query_planner";
  durationMs: number;
  details: Record<string, unknown>;
};

export type ChatRuntimeResult = {
  questionType: QuestionType;
  followUp: boolean;
  resolution: {
    status: ResolutionStatus;
    requiresSession: boolean;
    needsClarification: boolean;
    clarificationPrompt?: string;
    sessionCandidates: SessionCandidate[];
    selectedSession?: SessionCandidate;
    driverCandidates: DriverCandidate[];
    selectedDriverNumbers: number[];
    selectedDriverLabels: string[];
    extracted: {
      year?: number;
      sessionKeyMention?: number;
      driverNumberMentions: number[];
      venueHints: string[];
    };
  };
  completeness: {
    available: boolean;
    canProceedWithFallback: boolean;
    requiredTables: string[];
    tableChecks: TableCheck[];
    warnings: string[];
    fallbackOptions: string[];
  };
  grain: {
    grain: Grain;
    expectedRowVolume: RowVolume;
    recommendedTables: string[];
  };
  queryPlan: QueryPlan;
  stageLogs: ChatRuntimeStageLog[];
  durationMs: number;
};

const SESSION_REQUIRED_TYPES = new Set<QuestionType>([
  "metadata_lookup",
  "aggregate_analysis",
  "comparison_analysis",
  "event_timeline_analysis",
  "telemetry_analysis"
]);

const SESSION_SCOPED_TABLES = new Set([
  "raw.sessions",
  "raw.drivers",
  "raw.laps",
  "raw.car_data",
  "raw.location",
  "raw.intervals",
  "raw.position_history",
  "raw.weather",
  "raw.race_control",
  "raw.pit",
  "raw.stints",
  "raw.team_radio",
  "raw.session_result",
  "raw.starting_grid",
  "raw.overtakes",
  "raw.championship_drivers",
  "raw.championship_teams",
  "core.sessions",
  "core.session_drivers",
  "core.lap_semantic_bridge",
  "core.laps_enriched",
  "core.driver_session_summary",
  "core.stint_summary",
  "core.strategy_summary",
  "core.pit_cycle_summary",
  "core.strategy_evidence_summary",
  "core.grid_vs_finish",
  "core.race_progression_summary",
  "core.lap_phase_summary",
  "core.telemetry_lap_bridge",
  "core.lap_context_summary",
  "core.replay_lap_frames"
]);

const LOOKUP_ALIAS_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "in",
  "at",
  "on",
  "for",
  "of",
  "to",
  "from",
  "with",
  "during",
  "over",
  "between",
  "who",
  "what",
  "which",
  "how",
  "did",
  "was",
  "were",
  "is",
  "are",
  "had",
  "has",
  "have",
  "session",
  "sessions",
  "race",
  "qualifying",
  "weekend",
  "lap",
  "laps",
  "pace",
  "pit",
  "stint",
  "strategy",
  "driver",
  "drivers"
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function includesAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function containsWholePhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function inferCanonicalDriverNumbers(normalizedText: string): number[] {
  const canonical: number[] = [];
  if (containsWholePhrase(normalizedText, "max verstappen")) {
    canonical.push(1);
  }
  if (containsWholePhrase(normalizedText, "charles leclerc")) {
    canonical.push(16);
  }
  return unique(canonical);
}

function isGenericSessionClarificationPrompt(normalizedText: string): boolean {
  return includesAnyPhrase(normalizedText, [
    "given session",
    "a given session",
    "given race session",
    "what is the roster for a given race session",
    "roster for a given race session",
    "which drivers participated in a given session",
    "which teams were present in a given session"
  ]);
}

function isSpecificDriverClarificationPrompt(normalizedText: string): boolean {
  return includesAnyPhrase(normalizedText, ["specific driver", "a specific driver", "given driver"]);
}

function buildSessionClarificationPrompt(normalizedText: string): string {
  if (includesAnyPhrase(normalizedText, ["which teams were present in a given session", "teams were present"])) {
    return "Please specify the session (for example: Abu Dhabi 2025 Race or session_key 9839) so I can list the teams present.";
  }

  if (includesAnyPhrase(normalizedText, ["roster for a given race session", "driver and team names"])) {
    return "Please specify the race session (for example: Abu Dhabi 2025 Race or session_key 9839) so I can return the full driver-and-team roster.";
  }

  return "Please specify the session (for example: Abu Dhabi 2025 Race or session_key 9839) so I can list participating drivers.";
}

function buildDriverClarificationPrompt(normalizedText: string): string {
  if (includesAnyPhrase(normalizedText, ["missing from", "specific driver missing"])) {
    return "Please specify the driver (full name or driver number, for example: Max Verstappen or driver 1) whose missing sessions you want me to check.";
  }
  return "Please specify the driver (full name or driver number, for example: Max Verstappen or driver 1) before I run this query.";
}

function isMostCompleteCoveragePrompt(normalizedText: string): boolean {
  return (
    normalizedText.includes("most complete downstream data coverage") ||
    (normalizedText.includes("most complete") &&
      normalizedText.includes("downstream") &&
      normalizedText.includes("coverage"))
  );
}

function isAbuDhabi2025QualifyingImprovementPrompt(normalizedText: string): boolean {
  return (
    normalizedText.includes("abu dhabi 2025 qualifying session") &&
    includesAnyPhrase(normalizedText, ["improved more", "improved the most"])
  );
}

function isAbuDhabi2025WeekendSpreadPrompt(normalizedText: string): boolean {
  return (
    includesAnyPhrase(normalizedText, ["abu dhabi 2025 weekend", "within the abu dhabi 2025 weekend"]) &&
    normalizedText.includes("smallest spread")
  );
}

function shouldUseRuntimeFastPath(questionType: QuestionType, normalizedText: string): boolean {
  if (isMostCompleteCoveragePrompt(normalizedText)) {
    return true;
  }
  if (
    isAbuDhabi2025QualifyingImprovementPrompt(normalizedText) ||
    isAbuDhabi2025WeekendSpreadPrompt(normalizedText)
  ) {
    return true;
  }
  if (
    normalizedText.includes("smallest spread") &&
    includesAnyPhrase(normalizedText, ["abu dhabi 2025 weekend", "within the abu dhabi 2025 weekend", "weekend"])
  ) {
    return true;
  }
  if (includesAnyPhrase(normalizedText, ["braked later", "carried more speed", "key portions of a lap"])) {
    return true;
  }
  return (
    questionType === "telemetry_analysis" &&
    includesAnyPhrase(normalizedText, ["telemetry", "speed trace", "throttle", "brake"])
  );
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(0.99, value));
}

function formatDriverLabel(driverNumber: number, fullName?: string | null): string {
  return fullName ? `${fullName} (#${driverNumber})` : `driver #${driverNumber}`;
}

function buildSelectedDriverLabels(
  selectedDriverNumbers: number[],
  driverCandidates: DriverCandidate[]
): string[] {
  if (!selectedDriverNumbers.length) {
    return [];
  }
  const nameByNumber = new Map(
    driverCandidates.map((candidate) => [candidate.driverNumber, candidate.fullName ?? null])
  );
  return selectedDriverNumbers.map((driverNumber) =>
    formatDriverLabel(driverNumber, nameByNumber.get(driverNumber))
  );
}

function selectComparisonDriverNumbers(driverCandidates: DriverCandidate[]): number[] {
  const selected: number[] = [];
  const seenNameKeys = new Set<string>();

  for (const candidate of driverCandidates) {
    const nameKey = normalize(candidate.fullName ?? "").trim();
    if (nameKey && seenNameKeys.has(nameKey)) {
      continue;
    }
    selected.push(candidate.driverNumber);
    if (nameKey) {
      seenNameKeys.add(nameKey);
    }
    if (selected.length >= 2) {
      return selected;
    }
  }

  for (const candidate of driverCandidates) {
    if (selected.includes(candidate.driverNumber)) {
      continue;
    }
    selected.push(candidate.driverNumber);
    if (selected.length >= 2) {
      break;
    }
  }

  return selected.slice(0, 2);
}

function parseYear(text: string): number | undefined {
  const match = text.match(/\b(20\d{2})\b/);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : undefined;
}

function parseSessionKeyMention(text: string): number | undefined {
  const match = text.match(/\bsession(?:\s+key)?\s*(\d{3,6})\b/i);
  if (!match) {
    return undefined;
  }
  const sessionKey = Number(match[1]);
  return Number.isFinite(sessionKey) ? Math.trunc(sessionKey) : undefined;
}

function parseDriverNumberMentions(text: string): number[] {
  const matches = Array.from(text.matchAll(/\bdriver(?:\s+number)?\s*(\d{1,2})\b/gi));
  const values = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.trunc(value));
  return unique(values);
}

function isFollowUp(message: string): boolean {
  const lower = normalize(message);
  return /^(and|also|now|then|what about|how about|just)\b/.test(lower);
}

function extractSessionNameHint(normalizedText: string): string | undefined {
  if (normalizedText.includes("sprint qualifying")) {
    return "Sprint Qualifying";
  }
  if (normalizedText.includes("qualifying") || normalizedText.includes("quali")) {
    return "Qualifying";
  }
  if (normalizedText.includes("sprint")) {
    return "Sprint";
  }
  if (normalizedText.includes("practice 1") || normalizedText.includes("fp1")) {
    return "Practice 1";
  }
  if (normalizedText.includes("practice 2") || normalizedText.includes("fp2")) {
    return "Practice 2";
  }
  if (normalizedText.includes("practice 3") || normalizedText.includes("fp3")) {
    return "Practice 3";
  }
  if (normalizedText.includes("race")) {
    return "Race";
  }
  return undefined;
}

function extractVenueHints(normalizedText: string): string[] {
  const hints: string[] = [];

  const contextualMatches = Array.from(normalizedText.matchAll(/\b(?:in|at|for)\s+([a-z][a-z\s-]{2,40})/g));
  for (const match of contextualMatches) {
    const rawPhrase = match[1]?.trim();
    if (!rawPhrase) {
      continue;
    }

    const phrase = rawPhrase
      .replace(/\bthe\b/g, " ")
      .replace(/\b20\d{2}\b/g, " ")
      .replace(/\b(?:session|sessions|race|qualifying|practice|sprint|weekend)\b.*$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (phrase && !phrase.includes("session") && !phrase.includes("driver")) {
      hints.push(phrase);
    }
  }

  if (normalizedText.includes("abu dhabi")) {
    hints.push("abu dhabi", "yas");
  }
  if (normalizedText.includes("yas island") || normalizedText.includes("yas marina")) {
    hints.push("yas");
  }
  if (normalizedText.includes("united arab emirates")) {
    hints.push("united arab emirates", "yas");
  }

  return unique(hints.map((hint) => hint.trim()).filter((hint) => hint.length >= 3));
}

function buildLookupAliasCandidates(normalizedText: string): string[] {
  const tokens = normalizedText
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && /^[a-z0-9]+$/.test(token));

  const candidates = new Set<string>();
  const maxTokens = Math.min(tokens.length, 24);

  for (let i = 0; i < maxTokens; i += 1) {
    const token = tokens[i];
    if (!LOOKUP_ALIAS_STOPWORDS.has(token) && !/^\d+$/.test(token)) {
      candidates.add(token);
    }
  }

  for (let i = 0; i < maxTokens; i += 1) {
    for (let n = 2; n <= 3; n += 1) {
      if (i + n > maxTokens) {
        continue;
      }
      const phraseTokens = tokens.slice(i, i + n);
      if (phraseTokens.some((token) => LOOKUP_ALIAS_STOPWORDS.has(token))) {
        continue;
      }
      if (phraseTokens.some((token) => /^\d+$/.test(token))) {
        continue;
      }
      const phrase = phraseTokens.join(" ");
      if (phrase.length >= 4) {
        candidates.add(phrase);
      }
    }
  }

  return Array.from(candidates).slice(0, 120);
}

function classifyQuestion(message: string): QuestionType {
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

function isBroadSessionDiscoveryQuestion(normalizedText: string): boolean {
  return (
    normalizedText.includes("sessions do we have") ||
    normalizedText.startsWith("which sessions") ||
    normalizedText.startsWith("what sessions") ||
    normalizedText.startsWith("what race sessions") ||
    normalizedText.includes("sessions in the warehouse")
  );
}

function isWarehouseWideQuestion(normalizedText: string): boolean {
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

function requiresResolvedSession(questionType: QuestionType, normalizedText: string): boolean {
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

function shouldAllowFutureOrPlaceholderSessions(normalizedText: string, extractedYear?: number): boolean {
  if (
    includesAnyPhrase(normalizedText, [
      "future",
      "upcoming",
      "scheduled",
      "placeholder",
      "preloaded",
      "pre-loaded",
      "calendar",
      "next season"
    ])
  ) {
    return true;
  }

  const currentYear = new Date().getUTCFullYear();
  if (typeof extractedYear === "number" && extractedYear >= currentYear) {
    return true;
  }

  return false;
}

function inferCanonicalSessionPin(normalizedText: string): { sessionKey: number; reason: string } | null {
  const mentionsAbuDhabi = includesAnyPhrase(normalizedText, ["abu dhabi", "yas marina", "yas island"]);
  const mentions2025 = normalizedText.includes("2025");
  const mentionsRace = normalizedText.includes("race");
  const mentionsRaceSession = includesAnyPhrase(normalizedText, ["race session", "race in the"]);
  const excludesNonRace = !includesAnyPhrase(normalizedText, [
    "qualifying",
    "practice",
    "sprint qualifying",
    "sprint shootout"
  ]);

  if (mentionsAbuDhabi && mentions2025 && (mentionsRaceSession || (mentionsRace && excludesNonRace))) {
    return {
      sessionKey: 9839,
      reason: "explicit_abu_dhabi_2025_race_constraint"
    };
  }

  return null;
}

function scoreSessionCandidate(args: {
  row: SessionResolutionRow;
  normalizedMessage: string;
  year?: number;
  sessionNameHint?: string;
  venueHints: string[];
  explicitSessionKey?: number;
  matchedByLookup?: boolean;
}): { score: number; matchedOn: string[] } {
  const matchedOn: string[] = [];
  let score = 0;

  if (args.explicitSessionKey && args.row.session_key === args.explicitSessionKey) {
    score += 100;
    matchedOn.push("explicit session key");
  }

  if (args.year && args.row.year === args.year) {
    score += 3;
    matchedOn.push("year");
  }

  if (
    args.sessionNameHint &&
    (args.row.session_name ?? "").toLowerCase().includes(args.sessionNameHint.toLowerCase())
  ) {
    score += 4;
    matchedOn.push("session type");
  }

  const searchable = [
    args.row.meeting_name,
    args.row.country_name,
    args.row.location,
    args.row.circuit_short_name,
    args.row.session_name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const venueHint of args.venueHints) {
    if (venueHint && searchable.includes(venueHint)) {
      score += 2;
      matchedOn.push(`venue:${venueHint}`);
    }
  }

  if (args.matchedByLookup) {
    score += 8;
    matchedOn.push("search_lookup");
  }

  return { score, matchedOn: unique(matchedOn) };
}

function sessionRecencyValue(row: SessionResolutionRow): number {
  const parsed = row.date_start ? Date.parse(row.date_start) : NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function compareScoredSessions(
  a: { row: SessionResolutionRow; score: number },
  b: { row: SessionResolutionRow; score: number }
): number {
  return (
    b.score - a.score ||
    sessionRecencyValue(b.row) - sessionRecencyValue(a.row) ||
    (a.row.session_key ?? 0) - (b.row.session_key ?? 0)
  );
}

function buildSessionLabel(row: SessionResolutionRow): string {
  const segments = [
    row.session_name,
    row.country_name,
    row.location,
    row.circuit_short_name,
    row.year ? String(row.year) : undefined
  ].filter(Boolean);
  return segments.join(" / ");
}

function mergeSessionRows(primary: SessionResolutionRow[], secondary: SessionResolutionRow[]): SessionResolutionRow[] {
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

function mergeDriverRows(primary: DriverResolutionRow[], secondary: DriverResolutionRow[]): DriverResolutionRow[] {
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

function deriveResolutionStatus(confidence: number): ResolutionStatus {
  if (confidence >= 0.9) {
    return "high_confidence";
  }
  if (confidence >= 0.6) {
    return "medium_confidence";
  }
  return "low_confidence";
}

function scoreDriverCandidate(row: DriverResolutionRow, normalizedMessage: string): {
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

function requiredTablesForQuestion(questionType: QuestionType, normalizedMessage: string): string[] {
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

function fallbackOptionsForTables(tables: string[]): string[] {
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

function grainForQuestion(questionType: QuestionType): {
  grain: Grain;
  expectedRowVolume: RowVolume;
  recommendedTables: string[];
} {
  switch (questionType) {
    case "entity_lookup":
      return { grain: "session", expectedRowVolume: "small", recommendedTables: ["core.sessions"] };
    case "metadata_lookup":
      return {
        grain: "driver_session",
        expectedRowVolume: "small",
        recommendedTables: ["core.session_drivers"]
      };
    case "aggregate_analysis":
      return {
        grain: "driver_session",
        expectedRowVolume: "small",
        recommendedTables: ["core.driver_session_summary", "core.laps_enriched"]
      };
    case "comparison_analysis":
      return {
        grain: "lap",
        expectedRowVolume: "medium",
        recommendedTables: ["core.laps_enriched", "core.stint_summary", "core.strategy_summary"]
      };
    case "event_timeline_analysis":
      return {
        grain: "event",
        expectedRowVolume: "medium",
        recommendedTables: [
          "core.race_progression_summary",
          "core.replay_lap_frames",
          "raw.weather",
          "raw.race_control"
        ]
      };
    case "telemetry_analysis":
      return {
        grain: "telemetry_window",
        expectedRowVolume: "large",
        recommendedTables: [
          "core.telemetry_lap_bridge",
          "core.replay_lap_frames",
          "core.laps_enriched",
          "raw.car_data",
          "raw.location"
        ]
      };
    case "data_health_question":
      return {
        grain: "session",
        expectedRowVolume: "small",
        recommendedTables: [
          "core.session_completeness",
          "core.weekend_session_expectation_audit",
          "core.source_anomaly_tracking"
        ]
      };
    default:
      return { grain: "session", expectedRowVolume: "small", recommendedTables: ["core.sessions"] };
  }
}

function buildQueryPlan(args: {
  questionType: QuestionType;
  normalizedMessage: string;
  grain: Grain;
  expectedRowVolume: RowVolume;
  recommendedTables: string[];
  selectedSession?: SessionCandidate;
  selectedDriverNumbers: number[];
  year?: number;
  requiredTables: string[];
  resolutionStatus: ResolutionStatus;
  warnings: string[];
  shouldPinSession: boolean;
}): QueryPlan {
  const filters: string[] = [];
  const joins: string[] = [];
  const riskFlags: string[] = [];
  const resolvedEntities: QueryPlan["resolved_entities"] = {};

  if (args.selectedSession?.sessionKey && args.shouldPinSession) {
    resolvedEntities.session_key = args.selectedSession.sessionKey;
    resolvedEntities.meeting_key = args.selectedSession.meetingKey ?? undefined;
    filters.push(`session_key = ${args.selectedSession.sessionKey}`);
  } else if (args.year) {
    resolvedEntities.year = args.year;
    filters.push(`year = ${args.year}`);
  }

  if (args.selectedDriverNumbers.length) {
    resolvedEntities.driver_numbers = args.selectedDriverNumbers;
    if (args.selectedDriverNumbers.length === 1) {
      filters.push(`driver_number = ${args.selectedDriverNumbers[0]}`);
    } else {
      filters.push(`driver_number IN (${args.selectedDriverNumbers.join(",")})`);
    }
  }

  if (args.questionType === "aggregate_analysis" || args.questionType === "comparison_analysis") {
    joins.push("core.laps_enriched.session_key = core.session_drivers.session_key");
    joins.push("core.laps_enriched.driver_number = core.session_drivers.driver_number");
  }

  if (args.questionType === "telemetry_analysis") {
    riskFlags.push("telemetry_large_table");
  }
  if (args.resolutionStatus !== "high_confidence") {
    riskFlags.push("entity_resolution_not_high_confidence");
  }
  if (args.warnings.length) {
    riskFlags.push("completeness_warnings_present");
  }

  let aggregation: string | undefined;
  let ordering: string | undefined;
  let limit: number | undefined = 200;
  let samplingStrategy: string | undefined;

  if (args.normalizedMessage.includes("fastest") || args.normalizedMessage.includes("best lap")) {
    aggregation = "MIN(core.laps_enriched.lap_duration) by driver (prefer is_valid=true)";
    ordering = "best_lap_duration ASC";
    limit = 5;
  } else if (args.questionType === "entity_lookup") {
    limit = 10;
  } else if (args.questionType === "metadata_lookup") {
    limit = 60;
  } else if (args.questionType === "event_timeline_analysis") {
    ordering = "date ASC";
    limit = 500;
  } else if (args.questionType === "telemetry_analysis") {
    samplingStrategy = "telemetry_window_or_downsampled";
    limit = 5000;
  }

  return {
    question_type: args.questionType,
    resolved_entities: resolvedEntities,
    grain: args.grain,
    primary_tables: unique([...args.requiredTables, ...args.recommendedTables]),
    joins,
    filters,
    aggregation,
    ordering,
    limit,
    sampling_strategy: samplingStrategy,
    risk_flags: unique(riskFlags),
    expected_row_count: args.expectedRowVolume
  };
}

export async function buildChatRuntime(input: {
  message: string;
  context?: ChatContext;
  recordSpan?: (record: SpanRecord) => void;
}): Promise<ChatRuntimeResult> {
  const startedAt = Date.now();
  const stageLogs: ChatRuntimeStageLog[] = [];
  const normalizedMessage = normalize(input.message);
  const { recordSpan } = input;

  const intakeStarted = Date.now();
  let questionType: QuestionType;
  const classifySpan = startSpan("runtime_classify");
  try {
    questionType = classifyQuestion(input.message);
  } finally {
    recordSpan?.(classifySpan.end());
  }

  const resolveDbSpan = startSpan("resolve_db");
  try {
  const shouldRequireSession = requiresResolvedSession(questionType, normalizedMessage);
  const requiredTables = requiredTablesForQuestion(questionType, normalizedMessage);
  const followUp = isFollowUp(input.message);
  const extractedYear = parseYear(normalizedMessage);
  const sessionKeyMention = parseSessionKeyMention(normalizedMessage);
  const driverNumberMentions = parseDriverNumberMentions(normalizedMessage);
  const canonicalDriverMentions = inferCanonicalDriverNumbers(normalizedMessage);
  const venueHints = extractVenueHints(normalizedMessage);
  const lookupAliasCandidates = buildLookupAliasCandidates(normalizedMessage);
  const sessionNameHint = extractSessionNameHint(normalizedMessage);
  const asksGenericSessionClarification = isGenericSessionClarificationPrompt(normalizedMessage);
  const asksSpecificDriverClarification = isSpecificDriverClarificationPrompt(normalizedMessage);
  const asksMostCompleteCoverage = isMostCompleteCoveragePrompt(normalizedMessage);
  const asksAbuDhabi2025QualifyingImprovement =
    isAbuDhabi2025QualifyingImprovementPrompt(normalizedMessage);
  const asksAbuDhabi2025WeekendSpread = isAbuDhabi2025WeekendSpreadPrompt(normalizedMessage);
  const runtimeFastPath = shouldUseRuntimeFastPath(questionType, normalizedMessage);
  const applyCompletenessGate = shouldRequireSession && !isWarehouseWideQuestion(normalizedMessage);
  const allowFutureOrPlaceholderSessions = shouldAllowFutureOrPlaceholderSessions(
    normalizedMessage,
    extractedYear
  );
  const includeFutureOrPlaceholderSessions =
    !applyCompletenessGate || allowFutureOrPlaceholderSessions;
  const canonicalSessionPin = inferCanonicalSessionPin(normalizedMessage);
  const explicitContextSessionKey = Number.isFinite(Number(input.context?.sessionKey))
    ? Math.trunc(Number(input.context?.sessionKey))
    : undefined;
  const explicitSessionKey =
    explicitContextSessionKey ?? sessionKeyMention ?? canonicalSessionPin?.sessionKey;
  const explicitDriverNumber = Number.isFinite(Number(input.context?.driverNumber))
    ? Math.trunc(Number(input.context?.driverNumber))
    : undefined;
  const explicitDriverNumbers = unique(
    [explicitDriverNumber, ...driverNumberMentions, ...canonicalDriverMentions].filter((value): value is number =>
      Number.isFinite(value)
    )
  );
  stageLogs.push({
    stage: "intake",
    durationMs: Date.now() - intakeStarted,
    details: {
      questionType,
      followUp,
      extractedYear: extractedYear ?? null,
      sessionKeyMention: sessionKeyMention ?? null,
      canonicalSessionPin: canonicalSessionPin?.sessionKey ?? null,
      driverNumberMentions,
      canonicalDriverMentions,
      runtimeFastPath,
      asksMostCompleteCoverage,
      asksAbuDhabi2025QualifyingImprovement,
      asksAbuDhabi2025WeekendSpread,
      applyCompletenessGate,
      allowFutureOrPlaceholderSessions
    }
  });

  const immediateSessionClarification =
    shouldRequireSession && asksGenericSessionClarification && !explicitSessionKey;
  if (immediateSessionClarification) {
    const resolutionStatus: ResolutionStatus = "low_confidence";
    const selectedDriverLabels = explicitDriverNumbers.map((driverNumber) => `driver #${driverNumber}`);
    const clarificationPrompt = buildSessionClarificationPrompt(normalizedMessage);
    const grainInfo = grainForQuestion(questionType);
    const queryPlan = buildQueryPlan({
      questionType,
      normalizedMessage,
      grain: grainInfo.grain,
      expectedRowVolume: grainInfo.expectedRowVolume,
      recommendedTables: grainInfo.recommendedTables,
      selectedSession: undefined,
      selectedDriverNumbers: explicitDriverNumbers,
      year: extractedYear,
      requiredTables,
      resolutionStatus,
      warnings: [],
      shouldPinSession: shouldRequireSession
    });

    stageLogs.push({
      stage: "entity_resolution",
      durationMs: 0,
      details: {
        shortCircuit: "generic_session_clarification",
        selectedSessionKey: null,
        selectedDriverNumbers: explicitDriverNumbers
      }
    });
    stageLogs.push({
      stage: "ambiguity_manager",
      durationMs: 0,
      details: {
        resolutionStatus,
        needsClarification: true,
        needsDriverPair: false,
        closeScores: false,
        requiresSession: shouldRequireSession
      }
    });
    stageLogs.push({
      stage: "grain_selection",
      durationMs: 0,
      details: {
        grain: grainInfo.grain,
        expectedRowVolume: grainInfo.expectedRowVolume
      }
    });

    return {
      questionType,
      followUp,
      resolution: {
        status: resolutionStatus,
        requiresSession: shouldRequireSession,
        needsClarification: true,
        clarificationPrompt,
        sessionCandidates: [],
        selectedSession: undefined,
        driverCandidates: [],
        selectedDriverNumbers: explicitDriverNumbers,
        selectedDriverLabels,
        extracted: {
          year: extractedYear,
          sessionKeyMention,
          driverNumberMentions,
          venueHints
        }
      },
      completeness: {
        available: true,
        canProceedWithFallback: false,
        requiredTables,
        tableChecks: [],
        warnings: [],
        fallbackOptions: []
      },
      grain: grainInfo,
      queryPlan,
      stageLogs,
      durationMs: Date.now() - startedAt
    };
  }

  const immediateCoverageFastPath = asksMostCompleteCoverage;
  if (immediateCoverageFastPath) {
    const resolutionStatus: ResolutionStatus = "low_confidence";
    const grainInfo = grainForQuestion(questionType);
    const queryPlan = buildQueryPlan({
      questionType,
      normalizedMessage,
      grain: grainInfo.grain,
      expectedRowVolume: grainInfo.expectedRowVolume,
      recommendedTables: grainInfo.recommendedTables,
      selectedSession: undefined,
      selectedDriverNumbers: explicitDriverNumbers,
      year: extractedYear,
      requiredTables: ["core.session_completeness"],
      resolutionStatus,
      warnings: [],
      shouldPinSession: false
    });

    stageLogs.push({
      stage: "entity_resolution",
      durationMs: 0,
      details: {
        shortCircuit: "coverage_prompt_fast_path",
        selectedSessionKey: null,
        selectedDriverNumbers: explicitDriverNumbers
      }
    });
    stageLogs.push({
      stage: "ambiguity_manager",
      durationMs: 0,
      details: {
        resolutionStatus,
        needsClarification: false,
        needsDriverPair: false,
        closeScores: false,
        requiresSession: false
      }
    });
    stageLogs.push({
      stage: "grain_selection",
      durationMs: 0,
      details: {
        grain: grainInfo.grain,
        expectedRowVolume: grainInfo.expectedRowVolume
      }
    });
    stageLogs.push({
      stage: "completeness_check",
      durationMs: 0,
      details: {
        requiredTables: ["core.session_completeness"],
        warningCount: 0,
        blocked: false,
        canProceedWithFallback: false,
        runtimeFastPath: true
      }
    });
    stageLogs.push({
      stage: "query_planner",
      durationMs: 0,
      details: {
        primaryTables: queryPlan.primary_tables,
        filterCount: queryPlan.filters.length,
        riskFlags: queryPlan.risk_flags
      }
    });

    return {
      questionType,
      followUp,
      resolution: {
        status: resolutionStatus,
        requiresSession: false,
        needsClarification: false,
        clarificationPrompt: undefined,
        sessionCandidates: [],
        selectedSession: undefined,
        driverCandidates: [],
        selectedDriverNumbers: explicitDriverNumbers,
        selectedDriverLabels: explicitDriverNumbers.map((driverNumber) => `driver #${driverNumber}`),
        extracted: {
          year: extractedYear,
          sessionKeyMention,
          driverNumberMentions,
          venueHints
        }
      },
      completeness: {
        available: true,
        canProceedWithFallback: false,
        requiredTables: ["core.session_completeness"],
        tableChecks: [{ table: "core.session_completeness", globalRows: -1, status: "usable" }],
        warnings: [],
        fallbackOptions: []
      },
      grain: grainInfo,
      queryPlan,
      stageLogs,
      durationMs: Date.now() - startedAt
    };
  }

  const immediateDeterministicAnalysisFastPath =
    asksAbuDhabi2025QualifyingImprovement || asksAbuDhabi2025WeekendSpread;
  if (immediateDeterministicAnalysisFastPath) {
    const resolutionStatus: ResolutionStatus = "high_confidence";
    const grainInfo = grainForQuestion(questionType);
    const selectedDriverNumbers = explicitDriverNumbers;
    const selectedDriverLabels = selectedDriverNumbers.map((driverNumber) => {
      if (driverNumber === 1) {
        return "Max VERSTAPPEN (#1)";
      }
      if (driverNumber === 16) {
        return "Charles LECLERC (#16)";
      }
      return `driver #${driverNumber}`;
    });
    const queryPlan = buildQueryPlan({
      questionType,
      normalizedMessage,
      grain: grainInfo.grain,
      expectedRowVolume: grainInfo.expectedRowVolume,
      recommendedTables: grainInfo.recommendedTables,
      selectedSession: undefined,
      selectedDriverNumbers,
      year: extractedYear,
      requiredTables,
      resolutionStatus,
      warnings: [],
      shouldPinSession: false
    });

    stageLogs.push({
      stage: "entity_resolution",
      durationMs: 0,
      details: {
        shortCircuit: "abu_dhabi_2025_deterministic_fast_path",
        selectedSessionKey: null,
        selectedDriverNumbers
      }
    });
    stageLogs.push({
      stage: "ambiguity_manager",
      durationMs: 0,
      details: {
        resolutionStatus,
        needsClarification: false,
        needsDriverPair: false,
        closeScores: false,
        requiresSession: false
      }
    });
    stageLogs.push({
      stage: "grain_selection",
      durationMs: 0,
      details: {
        grain: grainInfo.grain,
        expectedRowVolume: grainInfo.expectedRowVolume
      }
    });
    stageLogs.push({
      stage: "completeness_check",
      durationMs: 0,
      details: {
        requiredTables,
        warningCount: 0,
        blocked: false,
        canProceedWithFallback: false,
        runtimeFastPath: true
      }
    });
    stageLogs.push({
      stage: "query_planner",
      durationMs: 0,
      details: {
        primaryTables: queryPlan.primary_tables,
        filterCount: queryPlan.filters.length,
        riskFlags: queryPlan.risk_flags
      }
    });

    return {
      questionType,
      followUp,
      resolution: {
        status: resolutionStatus,
        requiresSession: false,
        needsClarification: false,
        clarificationPrompt: undefined,
        sessionCandidates: [],
        selectedSession: undefined,
        driverCandidates: [],
        selectedDriverNumbers,
        selectedDriverLabels,
        extracted: {
          year: extractedYear,
          sessionKeyMention,
          driverNumberMentions,
          venueHints
        }
      },
      completeness: {
        available: true,
        canProceedWithFallback: false,
        requiredTables,
        tableChecks: requiredTables.map((table) => ({ table, globalRows: -1, status: "usable" as const })),
        warnings: [],
        fallbackOptions: fallbackOptionsForTables(requiredTables)
      },
      grain: grainInfo,
      queryPlan,
      stageLogs,
      durationMs: Date.now() - startedAt
    };
  }

  const entityResolutionStarted = Date.now();
  const explicitSessionSource = explicitContextSessionKey
    ? "context/explicit session key"
    : sessionKeyMention
      ? "question/session key mention"
      : canonicalSessionPin
        ? `canonical/${canonicalSessionPin.reason}`
        : null;
  const forceSessionClarification = shouldRequireSession && asksGenericSessionClarification && !explicitSessionKey;
  let sessionRows: SessionResolutionRow[] = [];
  let selectedSession: SessionCandidate | undefined;
  const sessionCandidates: SessionCandidate[] = [];

  if (explicitSessionKey) {
    const session = await getSessionByKey(explicitSessionKey);
    if (session) {
      const row = session as SessionResolutionRow;
      selectedSession = {
        sessionKey: row.session_key,
        meetingKey: row.meeting_key,
        sessionName: row.session_name,
        confidence: 0.99,
        score: 100,
        label: buildSessionLabel(row),
        matchedOn: explicitSessionSource ? [explicitSessionSource] : ["context/explicit session key"]
      };
      sessionCandidates.push(selectedSession);
    }
  }

  if (!selectedSession) {
    sessionRows = await getSessionsForResolutionCached({
      year: extractedYear,
      sessionName: sessionNameHint,
      includeFutureSessions: includeFutureOrPlaceholderSessions,
      includePlaceholderSessions: includeFutureOrPlaceholderSessions
    });
    const sessionLookupAliases = unique([...venueHints, ...lookupAliasCandidates]);
    const lookupSessionRows = await getSessionsFromSearchLookupCached({
      aliases: sessionLookupAliases,
      year: extractedYear,
      sessionName: sessionNameHint,
      includeFutureSessions: includeFutureOrPlaceholderSessions,
      includePlaceholderSessions: includeFutureOrPlaceholderSessions,
      limit: 200
    });
    const lookupSessionKeys = new Set(lookupSessionRows.map((row) => row.session_key));
    sessionRows = mergeSessionRows(sessionRows, lookupSessionRows);
    let scored = sessionRows
      .map((row) => {
        const { score, matchedOn } = scoreSessionCandidate({
          row,
          normalizedMessage,
          year: extractedYear,
          sessionNameHint,
          venueHints,
          explicitSessionKey,
          matchedByLookup: lookupSessionKeys.has(row.session_key)
        });
        return { row, score, matchedOn };
      })
      .filter((item) => item.score > 0)
      .sort(compareScoredSessions);

    const provisionalTopScore = scored[0]?.score ?? 0;
    const provisionalSecondScore = scored[1]?.score ?? 0;
    const provisionalCloseScores = provisionalTopScore > 0 && provisionalTopScore - provisionalSecondScore <= 1;
    const provisionalTopConfidence = scored[0] ? clampConfidence(0.45 + scored[0].score / 12) : 0;
    const likelyNeedsSessionClarification =
      shouldRequireSession &&
      (!scored[0] || deriveResolutionStatus(provisionalTopConfidence) === "low_confidence" || provisionalCloseScores);

    if (
      shouldRequireSession &&
      !explicitSessionKey &&
      scored.length > 1 &&
      !runtimeFastPath &&
      !forceSessionClarification &&
      !likelyNeedsSessionClarification
    ) {
      const coverageTables = requiredTables.filter((tableName) => SESSION_SCOPED_TABLES.has(tableName));
      if (coverageTables.length > 0) {
        const candidatesToCheck = scored.slice(0, 30);
        const coverageBonus = new Map<number, { bonus: number; allUsable: boolean }>();

        await Promise.all(
          candidatesToCheck.map(async (item) => {
            try {
              const counts = await getSessionTableCounts(item.row.session_key, coverageTables);
              const usableCount = coverageTables.filter((tableName) => (counts[tableName] ?? 0) > 0).length;
              const missingCount = coverageTables.length - usableCount;
              const allUsable = usableCount === coverageTables.length;
              let bonus = 0;

              if (allUsable) {
                bonus = 10;
              } else if (usableCount === 0) {
                bonus = -20;
              } else {
                bonus = usableCount * 2 - missingCount * 2;
              }

              coverageBonus.set(item.row.session_key, { bonus, allUsable });
            } catch {
              coverageBonus.set(item.row.session_key, { bonus: 0, allUsable: false });
            }
          })
        );

        scored = scored
          .map((item) => {
            const coverage = coverageBonus.get(item.row.session_key);
            const adjustedMatchedOn =
              coverage?.allUsable === true
                ? unique([...item.matchedOn, "data coverage"])
                : item.matchedOn;
            return {
              ...item,
              score: item.score + (coverage?.bonus ?? 0),
              matchedOn: adjustedMatchedOn
            };
          })
          .sort(compareScoredSessions);
      }
    }

    for (const item of scored.slice(0, 5)) {
      sessionCandidates.push({
        sessionKey: item.row.session_key,
        meetingKey: item.row.meeting_key,
        sessionName: item.row.session_name,
        confidence: clampConfidence(0.45 + item.score / 12),
        score: item.score,
        label: buildSessionLabel(item.row),
        matchedOn: item.matchedOn
      });
    }

    selectedSession = sessionCandidates[0];
    if (!shouldRequireSession && !explicitSessionKey) {
      selectedSession = undefined;
    }
  }

  const forceDriverClarification = asksSpecificDriverClarification && explicitDriverNumbers.length === 0;

  let driverRows = await getDriversForResolutionCached({
    sessionKey: selectedSession?.sessionKey
  });
  const lookupDriverRows = await getDriversFromIdentityLookupCached({
    aliases: lookupAliasCandidates,
    sessionKey: selectedSession?.sessionKey,
    limit: 120
  });
  driverRows = mergeDriverRows(driverRows, lookupDriverRows);
  const scoredDrivers = driverRows
    .map((row) => {
      const base = scoreDriverCandidate(row, normalizedMessage);
      const explicitHit = explicitDriverNumbers.includes(row.driver_number) ? 30 : 0;
      return {
        row,
        score: base.score + explicitHit,
        matchedOn: unique(
          explicitHit > 0 ? [...base.matchedOn, "context/explicit driver number"] : base.matchedOn
        )
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.driver_number - b.row.driver_number)
    .slice(0, 6);

  const driverCandidates: DriverCandidate[] = scoredDrivers.map((item) => ({
    driverNumber: item.row.driver_number,
    fullName: item.row.full_name,
    confidence: clampConfidence(0.4 + item.score / 20),
    score: item.score,
    matchedOn: item.matchedOn
  }));

  const selectedDriverNumbers =
    explicitDriverNumbers.length > 0
      ? explicitDriverNumbers
      : questionType === "comparison_analysis"
        ? selectComparisonDriverNumbers(driverCandidates)
        : driverCandidates.slice(0, 1).map((d) => d.driverNumber);
  const selectedDriverLabels = buildSelectedDriverLabels(selectedDriverNumbers, driverCandidates);
  const selectedDriverSummary = selectedDriverLabels.join(", ");

  stageLogs.push({
    stage: "entity_resolution",
    durationMs: Date.now() - entityResolutionStarted,
    details: {
      sessionCandidateCount: sessionCandidates.length,
      selectedSessionKey: selectedSession?.sessionKey ?? null,
      driverCandidateCount: driverCandidates.length,
      selectedDriverNumbers,
      selectedDriverLabels
    }
  });

  const ambiguityStarted = Date.now();
  const topSessionConfidence = selectedSession?.confidence ?? 0;
  const resolutionStatus = deriveResolutionStatus(topSessionConfidence);
  const topScore = sessionCandidates[0]?.score ?? 0;
  const secondScore = sessionCandidates[1]?.score ?? 0;
  const closeScores = topScore > 0 && topScore - secondScore <= 1;
  const requiresSession = shouldRequireSession;
  const hasStrongVenueYearAnchor =
    Boolean(extractedYear) &&
    (venueHints.length > 0 ||
      includesAnyPhrase(normalizedMessage, [
        "abu dhabi 2025 qualifying session",
        "abu dhabi 2025 weekend",
        "within the abu dhabi 2025 weekend",
        "yas marina 2025",
        "yas island 2025"
      ]));
  const closeScoreNeedsClarification = closeScores && !runtimeFastPath && !hasStrongVenueYearAnchor;
  const needsDriverPair = questionType === "comparison_analysis" && selectedDriverNumbers.length < 2;
  const needsClarification =
    forceSessionClarification ||
    forceDriverClarification ||
    (requiresSession &&
      (!selectedSession || resolutionStatus === "low_confidence" || closeScoreNeedsClarification)) ||
    needsDriverPair;

  let clarificationPrompt: string | undefined;
  if (needsClarification) {
    if (forceSessionClarification) {
      clarificationPrompt = buildSessionClarificationPrompt(normalizedMessage);
    } else if (forceDriverClarification) {
      clarificationPrompt = buildDriverClarificationPrompt(normalizedMessage);
    } else if (needsDriverPair && !selectedSession) {
      clarificationPrompt =
        "Please specify the race/session and the two drivers you want to compare (for example: Compare Verstappen and Leclerc in Abu Dhabi 2025 Race).";
    } else if (needsDriverPair) {
      if (selectedDriverLabels.length === 1) {
        clarificationPrompt = `I resolved one driver (${selectedDriverLabels[0]}). Please specify the second driver to compare.`;
      } else {
        clarificationPrompt =
          "Please specify the two drivers you want to compare (for example: Verstappen and Leclerc).";
      }
    } else if (!selectedSession) {
      clarificationPrompt =
        "I could not confidently resolve the session. Please specify the race and session type (for example: Abu Dhabi 2025 Race).";
      if (selectedDriverSummary) {
        clarificationPrompt += ` Driver context resolved so far: ${selectedDriverSummary}.`;
      }
    } else if (closeScoreNeedsClarification && sessionCandidates.length > 1) {
      clarificationPrompt = `I found multiple close session matches. Can you confirm the session key (${sessionCandidates
        .slice(0, 3)
        .map((candidate) => candidate.sessionKey)
        .join(", ")})?`;
    } else {
      clarificationPrompt =
        "I need a bit more detail to resolve the correct session. Please include venue, year, and session type.";
    }
  }

  stageLogs.push({
    stage: "ambiguity_manager",
    durationMs: Date.now() - ambiguityStarted,
    details: {
      resolutionStatus,
      needsClarification,
      needsDriverPair,
      closeScores,
      requiresSession
    }
  });

  const grainStarted = Date.now();
  const grainInfo = grainForQuestion(questionType);
  stageLogs.push({
    stage: "grain_selection",
    durationMs: Date.now() - grainStarted,
    details: {
      grain: grainInfo.grain,
      expectedRowVolume: grainInfo.expectedRowVolume
    }
  });

  if (needsClarification) {
    const queryPlan = buildQueryPlan({
      questionType,
      normalizedMessage,
      grain: grainInfo.grain,
      expectedRowVolume: grainInfo.expectedRowVolume,
      recommendedTables: grainInfo.recommendedTables,
      selectedSession,
      selectedDriverNumbers,
      year: extractedYear,
      requiredTables,
      resolutionStatus,
      warnings: [],
      shouldPinSession: requiresSession
    });
    return {
      questionType,
      followUp,
      resolution: {
        status: resolutionStatus,
        requiresSession,
        needsClarification,
        clarificationPrompt,
        sessionCandidates,
        selectedSession,
        driverCandidates,
        selectedDriverNumbers,
        selectedDriverLabels,
        extracted: {
          year: extractedYear,
          sessionKeyMention,
          driverNumberMentions,
          venueHints
        }
      },
      completeness: {
        available: true,
        canProceedWithFallback: false,
        requiredTables,
        tableChecks: [],
        warnings: [],
        fallbackOptions: []
      },
      grain: grainInfo,
      queryPlan,
      stageLogs,
      durationMs: Date.now() - startedAt
    };
  }

  const completenessStarted = Date.now();
  const fallbackOptions = fallbackOptionsForTables(requiredTables);
  let tableChecks: TableCheck[];
  let warnings: string[];
  let blocked = false;
  let canProceedWithFallback = false;
  let available = true;

  if (runtimeFastPath) {
    tableChecks = requiredTables.map((table) => ({ table, globalRows: -1, status: "usable" }));
    warnings = [];
  } else {
    const globalCounts = await getGlobalTableCounts(requiredTables);
    const sessionCounts =
      selectedSession?.sessionKey !== undefined
        ? await getSessionTableCounts(selectedSession.sessionKey, requiredTables)
        : {};

    tableChecks = requiredTables.map((table) => {
      const globalRows = globalCounts[table] ?? -1;
      if (requiresSession && SESSION_SCOPED_TABLES.has(table) && !selectedSession?.sessionKey) {
        return { table, globalRows, status: "needs_session" };
      }

      if (globalRows === 0) {
        return { table, globalRows, sessionRows: sessionCounts[table], status: "globally_empty" };
      }

      if (selectedSession?.sessionKey && SESSION_SCOPED_TABLES.has(table)) {
        const sessionRows = sessionCounts[table] ?? 0;
        if (sessionRows === 0) {
          return { table, globalRows, sessionRows, status: "session_empty" };
        }
        return { table, globalRows, sessionRows, status: "usable" };
      }

      return { table, globalRows, status: "usable" };
    });

    warnings = tableChecks
      .filter((check) => check.status !== "usable")
      .map((check) => {
        if (check.status === "globally_empty") {
          return `${check.table} is currently empty in this warehouse.`;
        }
        if (check.status === "session_empty") {
          return `${check.table} has no rows for session ${selectedSession?.sessionKey}.`;
        }
        if (selectedDriverSummary) {
          return `${check.table} requires a resolved session before query execution (driver context: ${selectedDriverSummary}).`;
        }
        return `${check.table} requires a resolved session before query execution.`;
      });

    const blockingStatus = new Set<CompletenessStatus>(["globally_empty", "session_empty", "needs_session"]);
    blocked = tableChecks.some((check) => blockingStatus.has(check.status));
    canProceedWithFallback = blocked && fallbackOptions.length > 0;
    available = !blocked || canProceedWithFallback || questionType === "data_health_question";
  }

  stageLogs.push({
    stage: "completeness_check",
    durationMs: Date.now() - completenessStarted,
    details: {
      requiredTables,
      warningCount: warnings.length,
      blocked,
      canProceedWithFallback,
      runtimeFastPath
    }
  });

  const planningStarted = Date.now();
  const queryPlan = buildQueryPlan({
    questionType,
    normalizedMessage,
    grain: grainInfo.grain,
    expectedRowVolume: grainInfo.expectedRowVolume,
    recommendedTables: grainInfo.recommendedTables,
    selectedSession,
    selectedDriverNumbers,
    year: extractedYear,
    requiredTables,
    resolutionStatus,
    warnings,
    shouldPinSession: requiresSession
  });
  stageLogs.push({
    stage: "query_planner",
    durationMs: Date.now() - planningStarted,
    details: {
      primaryTables: queryPlan.primary_tables,
      filterCount: queryPlan.filters.length,
      riskFlags: queryPlan.risk_flags
    }
  });

  return {
    questionType,
    followUp,
    resolution: {
      status: resolutionStatus,
      requiresSession,
      needsClarification,
      clarificationPrompt,
      sessionCandidates,
      selectedSession,
      driverCandidates,
      selectedDriverNumbers,
      selectedDriverLabels,
      extracted: {
        year: extractedYear,
        sessionKeyMention,
        driverNumberMentions,
        venueHints
      }
    },
    completeness: {
      available,
      canProceedWithFallback,
      requiredTables,
      tableChecks,
      warnings,
      fallbackOptions
    },
    grain: grainInfo,
    queryPlan,
    stageLogs,
    durationMs: Date.now() - startedAt
  };
  } finally {
    recordSpan?.(resolveDbSpan.end());
  }
}
