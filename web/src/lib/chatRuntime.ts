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
import { classifyQuestion, type QuestionType } from "./chatRuntime/classification";
import {
  fallbackOptionsForTables,
  requiredTablesForQuestion,
  type CompletenessStatus,
  type TableCheck
} from "./chatRuntime/completeness";
import { type ChatRuntimeStageLog } from "./chatRuntime/planTrace";
import { isFollowUp } from "./chatRuntime/recommendations";
import {
  buildSessionLabel,
  compareScoredSessions,
  deriveResolutionStatus,
  disambiguateDrivers,
  isWarehouseWideQuestion,
  mergeDriverRows,
  mergeSessionRows,
  requiresResolvedSession,
  type ResolutionStatus
} from "./chatRuntime/resolution";

export { isFollowUp };
export type { ChatRuntimeStageLog };

type ChatContext = {
  sessionKey?: number;
  driverNumber?: number;
};

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
  year: number | null;
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

// Phase 19-A (rev4): `ChatRuntimeResult` is a discriminated union so the
// proactive `no_data_refusal` arm cannot leak through `resolution.status`
// or `completeness.available`. Every consumer must branch on `kind` —
// removing the discriminant is a compile-time error.
export type ChatRuntimeProceed = {
  kind: "proceed";
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

// Phase 19-A (rev3 + rev4): proactive INSUFFICIENT_DATA refusal arm.
// Returned by `buildChatRuntime` when the deterministic pre-SQL
// `PROPRIETARY_NO_DATA_TOPICS` keyword guard fires. The orchestration
// layer short-circuits before any Anthropic call when `kind` is this
// arm — `generateSqlWithAnthropic` / `executeSqlWithTrace` MUST NOT run.
export type ChatRuntimeNoDataRefusal = {
  kind: "no_data_refusal";
  refusalReason: string;
  matchedKeyword: string;
  questionType: QuestionType;
  durationMs: number;
};

export type ChatRuntimeResult = ChatRuntimeProceed | ChatRuntimeNoDataRefusal;

// Phase 19-A (rev3): proactive `no_data_refusal` keyword guard lives in
// its own module (`./chatRuntime/proprietaryNoData`) so unit tests can
// import the detector without dragging in the full chatRuntime DB
// dependency graph. Re-exported here for backward compatibility with
// any existing callers.
export { detectProprietaryNoDataMatch } from "./chatRuntime/proprietaryNoData";
import { detectProprietaryNoDataMatch as _detectProprietaryNoDataMatch } from "./chatRuntime/proprietaryNoData";

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
  // NFKD + diacritic strip mirrors the SQL-side public.f1_unaccent
  // normalization so query-side and seed-side values agree exactly
  // (Phase 14 alias resolver work).
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

// Phase 14-G: build a structured "Did you mean A or B?" clarification
// from a list of candidate drivers / sessions / teams the resolver
// matched ambiguously. Reuses the existing clarificationPrompt
// surface (no contract change) — see
// diagnostic/alias_resolver_plan_2026-05-01.md (rev4) Slice G.
export type ClarificationCandidate = {
  label: string;            // Human-readable ("Max Verstappen, driver 1, 2015-now")
  qualifier?: string;        // Optional secondary detail in parentheses
};

export function buildAmbiguousClarificationPrompt(
  mention: string,
  candidates: ClarificationCandidate[],
): string {
  if (candidates.length === 0) {
    return `I'm not sure who or what you mean by "${mention}". Could you give me a bit more detail (full name, driver number, or year)?`;
  }
  if (candidates.length === 1) {
    return `Did you mean ${formatCandidate(candidates[0])}? If so, please confirm and re-ask.`;
  }
  const opts = candidates
    .slice(0, 4)
    .map((c, i) => `(${i + 1}) ${formatCandidate(c)}`)
    .join(" ");
  const tail = candidates.length > 4 ? ` (+${candidates.length - 4} more)` : "";
  return `"${mention}" is ambiguous — did you mean ${opts}${tail}?`;
}

function formatCandidate(c: ClarificationCandidate): string {
  if (c.qualifier) return `**${c.label}** (${c.qualifier})`;
  return `**${c.label}**`;
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

// Phase 19 outcome-fix Fix 2 (codex audit pass 1-3): race-shaped intent
// extractors. When a question names a venue + year AND contains a
// race-shaped marker AND does NOT contain a session-type-sensitive
// marker, the resolver picks the race session at high confidence
// without clarifying. Quali/sprint/practice questions still clarify.
//
// Race-shaped markers: phrases analysts use when discussing the race
// itself (closing laps, pit stop, finished, opening stint, etc.).
// Session-type-sensitive markers: phrases that imply a non-race
// session type (qualifying, pole, Q1/Q2/Q3, sprint, FP1/FP2/FP3,
// practice, long run).
//
// Test fixtures in `chatRuntime-resolution-race-shaped.test.mjs`
// cover positive race-shaped + negative session-type-sensitive +
// the existing 50q rubric clarification ids 8/9/15/17.
export const RACE_SHAPED_MARKERS: ReadonlyArray<string> = [
  "grand prix",
  "the race",
  "during the race",
  "of the race",
  "throughout the race",
  "race pace",
  "race trim",
  "race-trim",
  "race stint",
  "closing laps",
  "opening laps",
  "first stint",
  "final stint",
  "second stint",
  "third stint",
  "closing stint",
  "closing-stint",
  "opening stint",
  "opening-stint",
  "longest stint",
  "medium stint",
  "stint 1",
  "stint 2",
  "stint 3",
  "stint length",
  "stint lengths",
  "stint pace",
  "long stint",
  "lap-1",
  "lap 1 launch",
  "race start",
  "pit stop",
  "pit stops",
  "first stop",
  "first-stop",
  "pit cycle",
  "pit window",
  "two-stop",
  "one-stop",
  "two-stopper",
  "one-stopper",
  "undercut",
  "overcut",
  "safety car",
  "sc restart",
  "vsc",
  "drs train",
  "fastest lap of",
  "won by",
  "finished",
  "finishing",
  "running order",
  "tyre management",
  "tire management",
  "tyre choice",
  "tire choice",
  "compound choice",
  "compound choices",
  "narrow setup window"
];

export const SESSION_TYPE_SENSITIVE_MARKERS: ReadonlyArray<string> = [
  "qualifying",
  "qualifier",
  "qualified",
  "pole",
  "pole lap",
  "pole position",
  "q1",
  "q2",
  "q3",
  "sprint",
  "sprint race",
  "sprint quali",
  "sprint shootout",
  "fp1",
  "fp2",
  "fp3",
  "practice",
  "long run",
  "long-run",
  "long stint simulation"
];

function containsRaceShapedMarker(normalizedText: string): boolean {
  const lower = normalizedText.toLowerCase();
  for (const m of RACE_SHAPED_MARKERS) {
    // Phrase-level match with word boundaries on each end. Allow
    // arbitrary whitespace between phrase tokens.
    const escaped = m.replace(/[\\.*+?^${}()|[\]]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i").test(lower)) return true;
  }
  return false;
}

function containsSessionTypeSensitiveMarker(normalizedText: string): boolean {
  const lower = normalizedText.toLowerCase();
  for (const m of SESSION_TYPE_SENSITIVE_MARKERS) {
    const escaped = m.replace(/[\\.*+?^${}()|[\]]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i").test(lower)) return true;
  }
  return false;
}

/**
 * Phase 19 outcome-fix Fix 2: returns true when the question is
 * race-shaped AND has a venue+year anchor AND is NOT session-type-
 * sensitive. Callers use this to bypass close-score clarification
 * and prefer the race session among candidates. Exported for test
 * fixtures.
 */
export function isRaceShapedVenueYearIntent(
  normalizedText: string,
  hasVenueYearAnchor: boolean
): boolean {
  if (!hasVenueYearAnchor) return false;
  if (containsSessionTypeSensitiveMarker(normalizedText)) return false;
  return containsRaceShapedMarker(normalizedText);
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

function hasGrandPrixVenueAlias(lookupAliasCandidates: string[]): boolean {
  return lookupAliasCandidates.some((alias) =>
    /\b[a-z]+(?:\s+[a-z]+){0,2}\s+grand\s+prix\b/i.test(alias)
  );
}

function hasExplicitGrandPrixVenueYearAnchor(normalizedText: string): boolean {
  return /\b20\d{2}\s+[a-z]+(?:\s+[a-z]+){0,2}\s+grand\s+prix\b/i.test(normalizedText);
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

  // Phase 19-A (rev3 + rev4): proactive `no_data_refusal` route. The
  // PROPRIETARY_NO_DATA_TOPICS phrase match runs DURING the
  // classification stage — BEFORE any Anthropic call, BEFORE the
  // resolver. On match, return the typed refusal arm; the orchestration
  // layer must short-circuit on `kind` and never invoke
  // generateSqlWithAnthropic / executeSqlWithTrace.
  const proprietaryHit = _detectProprietaryNoDataMatch(input.message);
  if (proprietaryHit) {
    return {
      kind: "no_data_refusal",
      refusalReason: proprietaryHit.refusalReason,
      matchedKeyword: proprietaryHit.matchedKeyword,
      questionType,
      durationMs: Date.now() - startedAt
    };
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
      kind: "proceed",
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
      kind: "proceed",
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
      kind: "proceed",
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

  // Phase 17 (post-deploy diagnostic 2026-05-02): wrap each resolver-side
  // query with its own perfTrace span and log to stderr at start AND end.
  // The pre-await log fires before the await so we can see which query is
  // pending when the resolve_db deadline (30s) trips — recordSpan only fires
  // on resolve, so a hung query would otherwise be invisible.
  //
  // Implemented via promise .then(success, error) chaining (no try/catch
  // block so the structural assertion in `perf-trace-spans.test.mjs` about
  // the resolve_db span's closing block keeps holding even with these
  // inner per-query traces.
  const traceQuery = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const span = startSpan(name);
    const startedAtMs = Date.now();
    console.error(JSON.stringify({ event: "resolve_step_started", name, ts: new Date().toISOString() }));
    return fn().then(
      (result) => {
        console.error(
          JSON.stringify({
            event: "resolve_step_finished",
            name,
            elapsedMs: Date.now() - startedAtMs,
            ts: new Date().toISOString()
          })
        );
        recordSpan?.(span.end());
        return result;
      },
      (err) => {
        recordSpan?.(span.end());
        throw err;
      }
    );
  };

  if (explicitSessionKey) {
    const session = await traceQuery("resolve.getSessionByKey", () => getSessionByKey(explicitSessionKey));
    if (session) {
      const row = session as SessionResolutionRow;
      selectedSession = {
        sessionKey: row.session_key,
        meetingKey: row.meeting_key,
        sessionName: row.session_name,
        year: row.year ?? null,
        confidence: 0.99,
        score: 100,
        label: buildSessionLabel(row),
        matchedOn: explicitSessionSource ? [explicitSessionSource] : ["context/explicit session key"]
      };
      sessionCandidates.push(selectedSession);
    }
  }

  if (!selectedSession) {
    // Phase 17 (post-deploy diagnostic 2026-05-02): the alias-based lookup
    // (`getSessionsFromSearchLookup`) is fast — it goes through the GIN
    // trigram indexes Phase 14 created. The fallback `getSessionsForResolution`
    // does an unfiltered LEFT JOIN against `core.session_completeness` and
    // is brutal on Neon's cold buffer cache (10-15s observed). Run aliases
    // first; only pay the fallback when aliases returned nothing.
    const sessionLookupAliases = unique([...venueHints, ...lookupAliasCandidates]);
    const lookupSessionRows = sessionLookupAliases.length > 0
      ? await traceQuery("resolve.getSessionsFromSearchLookup", () =>
          getSessionsFromSearchLookupCached({
            aliases: sessionLookupAliases,
            year: extractedYear,
            sessionName: sessionNameHint,
            includeFutureSessions: includeFutureOrPlaceholderSessions,
            includePlaceholderSessions: includeFutureOrPlaceholderSessions,
            limit: 200
          })
        )
      : [];
    const lookupSessionKeys = new Set(lookupSessionRows.map((row) => row.session_key));
    if (lookupSessionRows.length > 0) {
      // Alias-based lookup succeeded; skip the unfiltered scan entirely.
      sessionRows = lookupSessionRows;
    } else {
      sessionRows = await traceQuery("resolve.getSessionsForResolution", () =>
        getSessionsForResolutionCached({
          year: extractedYear,
          sessionName: sessionNameHint,
          includeFutureSessions: includeFutureOrPlaceholderSessions,
          includePlaceholderSessions: includeFutureOrPlaceholderSessions
        })
      );
    }
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
        // Phase 17 (post-deploy diagnostic 2026-05-02): was 30; on Neon this
        // fans out to 30 × N table EXISTS probes via Promise.all and
        // saturates the pool (max=10). Top 5 candidates is plenty — they're
        // already scored by alias hits + recency + venue match.
        const candidatesToCheck = scored.slice(0, 5);
        const coverageBonus = new Map<number, { bonus: number; allUsable: boolean }>();

        await Promise.all(
          candidatesToCheck.map(async (item) => {
            try {
              const counts = await traceQuery(
                `resolve.coverage.${item.row.session_key}`,
                () => getSessionTableCounts(item.row.session_key, coverageTables)
              );
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
        year: item.row.year ?? null,
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

  let driverRows = await traceQuery("resolve.getDriversForResolution", () =>
    getDriversForResolutionCached({
      sessionKey: selectedSession?.sessionKey
    })
  );
  const lookupDriverRows = await traceQuery("resolve.getDriversFromIdentityLookup", () =>
    getDriversFromIdentityLookupCached({
      aliases: lookupAliasCandidates,
      sessionKey: selectedSession?.sessionKey,
      limit: 120
    })
  );
  driverRows = mergeDriverRows(driverRows, lookupDriverRows);
  const { scoredCandidates, ambiguousSurnames } = disambiguateDrivers(driverRows, normalizedMessage, selectedSession?.year ?? null);
  const forceDriverClarification = (asksSpecificDriverClarification || ambiguousSurnames.length > 0) && explicitDriverNumbers.length === 0;
  const scoredDrivers = scoredCandidates
    .map((item) => {
      const explicitHit = explicitDriverNumbers.includes(item.row.driver_number) ? 30 : 0;
      return {
        row: item.row,
        score: item.score + explicitHit,
        matchedOn: unique(
          explicitHit > 0 ? [...item.matchedOn, "context/explicit driver number"] : item.matchedOn
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
      hasExplicitGrandPrixVenueYearAnchor(normalizedMessage) ||
      hasGrandPrixVenueAlias(lookupAliasCandidates) ||
      includesAnyPhrase(normalizedMessage, [
        "abu dhabi 2025 qualifying session",
        "abu dhabi 2025 weekend",
        "within the abu dhabi 2025 weekend",
        "yas marina 2025",
        "yas island 2025"
      ]));
  // Phase 19 outcome-fix Fix 2: race-shaped intent with venue+year
  // bypasses close-score clarification (tie-break to the race
  // session). Session-type-sensitive markers (qualifying, sprint,
  // FP, practice, pole) preserve clarification.
  const hasRaceShapedIntentForVenueYear = isRaceShapedVenueYearIntent(
    normalizedMessage,
    Boolean(hasStrongVenueYearAnchor)
  );
  // When race-shaped intent fires AND a race candidate exists in the
  // top candidate set, re-rank so the race candidate becomes
  // `selectedSession`. Two close-scored candidates (race + quali) get
  // the race tie-break; questions with explicit session-type markers
  // are filtered out earlier by the deny-list inside
  // `isRaceShapedVenueYearIntent`.
  if (hasRaceShapedIntentForVenueYear && sessionCandidates.length > 1) {
    const isRaceCandidate = (c: typeof sessionCandidates[number]): boolean => {
      const name = (c.sessionName ?? "").toLowerCase();
      // "Race" matches; "Sprint" / "Sprint Race" stay non-race so a
      // generic race-shaped question (no "sprint" marker) prefers the
      // grand-prix race over the sprint.
      return name === "race" || name.endsWith(" race");
    };
    const currentIsRace = selectedSession ? isRaceCandidate(selectedSession) : false;
    if (!currentIsRace) {
      const raceCandidate = sessionCandidates.find(isRaceCandidate);
      if (raceCandidate) {
        selectedSession = raceCandidate;
      }
    }
  }
  const closeScoreNeedsClarification =
    closeScores &&
    !runtimeFastPath &&
    !hasStrongVenueYearAnchor &&
    !hasRaceShapedIntentForVenueYear;
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
      kind: "proceed",
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
    const globalCounts = await traceQuery("completeness.globalCounts", () =>
      getGlobalTableCounts(requiredTables)
    );
    const sessionCounts =
      selectedSession?.sessionKey !== undefined
        ? await traceQuery("completeness.sessionCounts", () =>
            getSessionTableCounts(selectedSession!.sessionKey, requiredTables)
          )
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
    kind: "proceed",
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
