import type { ChatApiResponse, InsightFields, MessagePart } from "@/lib/chatTypes";
import type { ChartSpec, DraftInsight } from "@/lib/chart-types";
import { getTeamColor, getDistinctTeamColors } from "@/lib/f1-team-colors";

// =============================================================================
// foldPartsIntoInsight — collapse SSE MessagePart stream into DraftInsight
// =============================================================================

export function foldPartsIntoInsight(
  prev: DraftInsight | null,
  part: MessagePart,
  ctx: { question?: string } = {}
): DraftInsight {
  const next: DraftInsight = prev ?? { body: "" };
  switch (part.type) {
    case "text":
      next.body = next.body ? `${next.body}\n\n${part.text}` : part.text;
      break;
    case "sql":
      next.sql = part.sql;
      break;
    case "table":
      next.rows = part.rows;
      next.rowCount = part.rowCount;
      next.elapsedMs = part.elapsedMs;
      next.truncated = part.truncated;
      if (part.title) next.title = part.title;
      // Pass question through so topic-sensitive detectors (radar, etc.)
      // can match on natural-language signals as well as column shape.
      next.chart = detectChart(part.rows, ctx) ?? next.chart;
      break;
    case "warning":
      // InsightMock doesn't define a `warnings` field; fold validator
      // warnings into key_takeaways with a "⚠" prefix instead.
      next.key_takeaways = [
        ...(next.key_takeaways ?? []),
        ...part.messages.map((m) => `⚠ ${m}`)
      ];
      break;
    case "followUps":
      next.related_questions = [
        ...(next.related_questions ?? []),
        ...part.prompts
      ];
      break;
    case "metadata":
      // Suppressed at the part level; refusal/etc. flows through
      // applyResponseSemantics on the final ChatApiResponse.
      break;
  }
  return next;
}

// =============================================================================
// applyInsightFields — Phase 2 structured fields from synthesis JSON
// =============================================================================

/**
 * Merge LLM-emitted structured fields (title / subtitle / metrics /
 * key_takeaways / related_questions / hero / verdict) into the draft
 * insight. Called when the SSE `event: insight` frame arrives OR when
 * the non-SSE response includes a top-level `insight` field.
 *
 * Fields already present on the draft are NOT overwritten — this lets
 * the question-derived title fallback survive, and lets the chart
 * auto-detector or hero-detector run independently. Pass `null` for
 * a no-op (synthesis didn't extract fields).
 */
export function applyInsightFields(
  insight: DraftInsight,
  fields: InsightFields | null
): DraftInsight {
  if (!fields) return insight;
  const next = { ...insight };
  if (fields.title && !next.title) next.title = fields.title;
  if (fields.subtitle && !next.subtitle) next.subtitle = fields.subtitle;
  if (fields.at_a_glance && !next.at_a_glance) next.at_a_glance = fields.at_a_glance;
  if (fields.corner_map?.circuit && !next.corner_map) next.corner_map = fields.corner_map;
  if (fields.metrics && fields.metrics.length > 0 && !next.metrics) {
    next.metrics = fields.metrics;
  }
  if (fields.key_takeaways && fields.key_takeaways.length > 0) {
    // Merge: dedupe against existing takeaways (warning prefixes survive).
    const existing = new Set((next.key_takeaways ?? []).map((t) => t.replace(/^⚠\s+/, "")));
    const merged = [...(next.key_takeaways ?? [])];
    for (const t of fields.key_takeaways) {
      if (!existing.has(t)) merged.push(t);
    }
    next.key_takeaways = merged;
  }
  if (fields.related_questions && fields.related_questions.length > 0 && !next.related_questions) {
    next.related_questions = fields.related_questions;
  }
  if (fields.what_we_have && fields.what_we_have.length > 0 && !next.what_we_have) {
    next.what_we_have = fields.what_we_have;
  }
  if (fields.hero && !next.hero) next.hero = fields.hero;
  if (fields.verdict && !next.verdict) next.verdict = fields.verdict;
  return next;
}

// =============================================================================
// applyResponseSemantics — final-frame ChatApiResponse semantics (M21 refusal)
// =============================================================================

const PROPRIETARY_FALLBACK = [
  "Speed at any sample point on the lap",
  "Brake-pedal on/off state and pressure proxy",
  "Throttle application percentage",
  "Lap-time deltas through the brake zone"
];

// Patterns that signal "this answer is about missing/unavailable data" even
// when the SQL returned rows. Drives chart suppression so we don't render an
// irrelevant fallback visual (e.g. sector-1 durations for a pole-lap question
// that hit the Race session, or grid positions for a position-gain question
// where the gain column is NULL for every driver).
const DATA_UNAVAILABLE_TITLE = /\b(data mismatch|not (in|available)|unavailable|no data|missing data|mismatch|empty)\b/i;
const NA_HERO_VALUE = /^(n\/?a|null|none|—|-)$/i;

function answerSignalsDataUnavailable(insight: DraftInsight): boolean {
  if (insight.hero?.value && NA_HERO_VALUE.test(String(insight.hero.value).trim())) {
    return true;
  }
  if (insight.title && DATA_UNAVAILABLE_TITLE.test(insight.title)) {
    return true;
  }
  return false;
}

export function applyResponseSemantics(
  insight: DraftInsight,
  response: ChatApiResponse
): DraftInsight {
  const next = { ...insight };
  const src = response.generationSource;

  if (src === "no_data_refusal" || src === "proprietary_no_data") {
    next.tone = "muted";
    if (!next.what_we_have || next.what_we_have.length === 0) {
      next.what_we_have = PROPRIETARY_FALLBACK;
    }
    if (!next.title) next.title = "Not in dataset";
    next.chart = undefined;
  }

  // Chart-suppression guard: even on successful (rows > 0) responses,
  // the LLM sometimes recognizes a data mismatch and emits a hero of
  // "N/A" or a title like "Data Mismatch — …". In that case the
  // auto-detected chart is meaningless — drop it so the user sees the
  // explanation, not a fallback visual that looks like an answer.
  if (next.chart && answerSignalsDataUnavailable(next)) {
    next.chart = undefined;
    next.tone = next.tone ?? "muted";
  }

  return next;
}

// =============================================================================
// applyClarification — B17 session-disambiguation choice card
// =============================================================================

/** Derive a short session-type label ("Qualifying", "Sprint Qualifying",
 *  "Race", "Practice 3") from the candidate's sessionName, falling back to the
 *  head of the full label. */
function sessionTypeLabel(sessionName: string | null | undefined, fullLabel: string): string {
  const name = (sessionName ?? "").trim();
  if (name) return name;
  const head = fullLabel.split("/")[0]?.trim();
  return head && head.length > 0 ? head : "Session";
}

/** Compact the buildSessionLabel() " / "-joined label into a " · " line and
 *  drop the leading session-type token (already shown bold above it). */
function compactCandidateLabel(fullLabel: string): string {
  const segs = fullLabel.split("/").map((s) => s.trim()).filter(Boolean);
  const rest = segs.slice(1);
  return (rest.length ? rest : segs).join(" · ");
}

export function applyClarification(
  insight: DraftInsight,
  response: ChatApiResponse,
  question: string
): DraftInsight {
  if (response.generationSource !== "runtime_clarification") return insight;
  const res = response.runtime?.resolution;
  const candidates = res?.sessionCandidates ?? [];
  // Only render the choice card for a genuine session-type ambiguity (2+
  // candidates). Driver-pair / "specify the session" prose clarifications have
  // no candidate list and keep their existing text-body rendering.
  if (candidates.length < 2) return insight;

  const trimmedQuestion = question.trim();
  const options = candidates.slice(0, 4).map((c, i) => {
    const full = c.label ?? [c.sessionName, c.year].filter(Boolean).join(" ") ?? "session";
    const sessionType = sessionTypeLabel(c.sessionName, full);
    // parseSessionKeyMention() in chatRuntime matches /\bsession(?:\s+key)?\s*(\d{3,6})\b/i,
    // so appending "(session <key>)" deterministically pins this exact session
    // on the re-send and skips the clarification branch entirely.
    const resolvedQuery = `${trimmedQuestion} (session ${c.sessionKey})`;
    return {
      sessionKey: c.sessionKey,
      sessionType,
      label: compactCandidateLabel(full),
      resolvedQuery,
      primary: i === 0
    };
  });

  const next = { ...insight };
  next.clarification = {
    prompt: (response.answer ?? "").trim() || "Which session did you mean?",
    question: trimmedQuestion,
    options
  };
  // The prose prompt now lives inside the choice card; clear the duplicated
  // body so the card is the single surface. Keep title/subtitle if present.
  next.body = "";
  next.chart = undefined;
  return next;
}

// =============================================================================
// applyScalarHero — M01 single-row scalar promotion
// =============================================================================

const IDENTIFIER_COLS = new Set([
  "driver_number",
  "session_key",
  "lap_number",
  "meeting_key",
  "year",
  "round",
  "id"
]);

const COMPOUND_COLS = new Set(["compound", "starting_compound", "tyre", "tyre_compound"]);
const COMPOUND_VALUES = /^(HARD|MEDIUM|SOFT|INTER|INTERMEDIATE|WET|C1|C2|C3|C4|C5)$/i;

function humanizeColumnName(col: string): string {
  const words = col.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function isCompoundShaped(col: string, val: unknown): boolean {
  if (COMPOUND_COLS.has(col)) return true;
  return typeof val === "string" && COMPOUND_VALUES.test(val);
}

function isTimeShaped(val: unknown): boolean {
  return typeof val === "string" && /^[\d:.+-]+$/.test(val);
}

function pickValueCol(row: Record<string, unknown>, cols: string[]): string {
  const eligible = cols.filter((c) => !IDENTIFIER_COLS.has(c));
  const compoundCol = eligible.find((c) => isCompoundShaped(c, row[c]));
  if (compoundCol) return compoundCol;
  const timeCol = eligible.find((c) => isTimeShaped(row[c]));
  if (timeCol) return timeCol;
  const numCol = eligible.find((c) => typeof row[c] === "number");
  if (numCol) return numCol;
  return eligible[0] ?? cols[0];
}

export function applyScalarHero(insight: DraftInsight): DraftInsight {
  if (insight.chart) return insight;
  if (insight.hero) return insight;
  if (!insight.rows || insight.rows.length !== 1) return insight;
  const row = insight.rows[0];
  const cols = Object.keys(row);
  if (cols.length === 0 || cols.length > 3) return insight;

  const valueCol = pickValueCol(row, cols);

  const otherCol = cols.find((c) => c !== valueCol && !IDENTIFIER_COLS.has(c));
  const otherLabel = otherCol ? String(row[otherCol] ?? "").trim() : "";
  const label =
    otherLabel.length > 0
      ? otherLabel
      : humanizeColumnName(valueCol) || (insight.subtitle ?? "Result");

  const next = { ...insight };
  next.hero = { value: String(row[valueCol]), label };
  return next;
}

// =============================================================================
// applyVerdictSemantics — M02 YES/NO verdict promotion
// =============================================================================

export function applyVerdictSemantics(insight: DraftInsight): DraftInsight {
  if (insight.verdict) return insight;
  const body = insight.body?.trimStart() ?? "";
  // UPPERCASE only — a case-insensitive match promoted ordinary prose
  // openers into verdicts ("No rows matched this question…" rendered as a
  // giant NO with summary "rows matched this question…"). A deliberate
  // verdict prefix is always written "YES"/"NO".
  const m = body.match(/^(YES|NO)\b[\s—:.,-]*(.*?)(?:[.!?](?:\s|$)|$)/);
  if (!m) return insight;
  const label = m[1] as "YES" | "NO";
  const summary = m[2].trim();
  if (summary.length === 0) return insight;

  const next = { ...insight };
  next.verdict = { label, summary, color: "#E10600" };
  next.body = body.slice(m[0].length).trimStart();
  return next;
}

// =============================================================================
// applyCornerMap — A1 deterministic corner_map derive from result rows
// =============================================================================

/**
 * A1: DERIVE `corner_map` from the result rows when the answer is about a
 * SINGLE named corner (a single-corner metric card). The LLM does not
 * reliably emit corner_map, so when the rows carry exactly one distinct
 * `corner_number` (or, as a fallback, one distinct `corner_label`) together
 * with a `circuit_short_name`, we set it here so <CornerMiniMap> (resolved
 * client-side against the real track outline) can render.
 *
 * Guards (mirror applyScalarHero's conservatism): never overwrite an existing
 * corner_map (LLM path wins); require a resolvable circuit; require EXACTLY
 * ONE distinct corner (multi-corner grouped-bar results are not single-corner);
 * skip when no corner column is present.
 */
export function applyCornerMap(insight: DraftInsight): DraftInsight {
  if (insight.corner_map) return insight;
  const rows = insight.rows;
  if (!rows || rows.length === 0) return insight;
  const cols = Object.keys(rows[0]);
  if (!cols.includes("circuit_short_name")) return insight;

  const circuits = new Set(
    rows
      .map((r) => (typeof r.circuit_short_name === "string" ? r.circuit_short_name.trim() : ""))
      .filter((c) => c.length > 0)
  );
  if (circuits.size !== 1) return insight;
  const circuit = [...circuits][0];

  if (cols.includes("corner_number")) {
    // EVERY row must resolve to the same finite corner — a null/mixed set is a
    // multi-corner or non-single-corner result, not a single-corner card.
    const nums = rows.map((r) => {
      const n = typeof r.corner_number === "number" ? r.corner_number : Number(r.corner_number);
      return Number.isFinite(n) ? n : null;
    });
    if (nums.some((n) => n === null)) return insight;
    const distinctNums = new Set(nums as number[]);
    if (distinctNums.size !== 1) return insight;
    const cornerNumber = [...distinctNums][0];
    const labelForNum = rows.find((r) => Number(r.corner_number) === cornerNumber)?.corner_label;
    return {
      ...insight,
      corner_map: {
        circuit,
        corner_number: cornerNumber,
        corner_label:
          typeof labelForNum === "string" && labelForNum.trim().length > 0 ? labelForNum.trim() : undefined
      }
    };
  }

  if (cols.includes("corner_label")) {
    const labels = rows.map((r) => (typeof r.corner_label === "string" ? r.corner_label.trim() : ""));
    if (labels.some((l) => l.length === 0)) return insight; // mixed/partial
    const distinctLabels = new Set(labels);
    if (distinctLabels.size !== 1) return insight;
    return { ...insight, corner_map: { circuit, corner_label: [...distinctLabels][0] } };
  }

  return insight;
}

// =============================================================================
// detectChart — Tier 1 chart auto-detection from result rows
// =============================================================================

function findCol(cols: string[], pattern: RegExp): string | undefined {
  return cols.find((c) => pattern.test(c));
}

/**
 * Phase 5: detectChart now delegates to the registry. The local
 * builders below (buildGroupedBar, buildDivergingBar, etc.) are
 * preserved for backwards compatibility with any caller that imports
 * them, but new code should use the registry.
 */
import { runDetectorRegistry } from "@/lib/mapInsight/detectors/registry";
import type { AdapterContext } from "@/lib/mapInsight/detectors/types";

function detectChart(
  rows: Record<string, unknown>[] | undefined,
  ctx: AdapterContext = {}
): ChartSpec | undefined {
  return runDetectorRegistry(rows, ctx)?.spec;
}

// =============================================================================
// Tier 1 chart builders
// =============================================================================

function getDriverColor(row: Record<string, unknown>): string {
  const name = String(row.driver_name ?? "");
  return getTeamColor(name);
}

function buildGroupedBar(rows: Record<string, unknown>[]): ChartSpec {
  // Group by corner_label, pivot driver_name into series.
  // Pick the speed metric column (entry_speed_kph preferred, then apex/exit/speed).
  const speedCol =
    Object.keys(rows[0]).find((c) => /entry.*speed|entry_speed/.test(c)) ??
    Object.keys(rows[0]).find((c) => /apex.*speed|apex_min_speed/.test(c)) ??
    Object.keys(rows[0]).find((c) => /exit.*speed/.test(c)) ??
    Object.keys(rows[0]).find((c) => /speed/.test(c)) ??
    "speed_kph";

  const corners = Array.from(new Set(rows.map((r) => String(r.corner_label ?? "")))).filter(Boolean);
  const drivers = Array.from(new Set(rows.map((r) => String(r.driver_name ?? "")))).filter(Boolean);

  const driverColors = getDistinctTeamColors(drivers);
  const series = drivers.map((driver) => {
    const values = corners.map((corner) => {
      const match = rows.find(
        (r) => String(r.driver_name) === driver && String(r.corner_label) === corner
      );
      const v = match?.[speedCol];
      return typeof v === "number" ? v : 0;
    });
    return {
      name: driver,
      values,
      color: driverColors[driver]
    };
  });

  return {
    type: "grouped_bar",
    x_axis: corners,
    y_label: humanizeColumnName(speedCol),
    series
  };
}

function buildDivergingBar(rows: Record<string, unknown>[]): ChartSpec {
  // X-axis = driver labels; values = position_delta (signed).
  const sorted = [...rows].sort((a, b) => {
    return Number(b.position_delta ?? 0) - Number(a.position_delta ?? 0);
  });
  const labels = sorted.map((r) => String(r.driver_name ?? r.driver_number ?? ""));
  const values = sorted.map((r) => Number(r.position_delta ?? 0));

  return {
    type: "horizontal_bar_diverging",
    y_axis: labels,
    x_label: "Positions gained / lost",
    series: [
      {
        name: "Position Δ",
        values,
        color: "#E10600"
      }
    ]
  };
}

function buildStackedHorizontal(
  rows: Record<string, unknown>[],
  cleanCol = "clean_air_laps",
  trafficCol = "traffic_laps"
): ChartSpec {
  // y_axis = drivers; two stacked series: clean air vs traffic. Last
  // name in the driver string drives the label so "Charles LECLERC"
  // → "LECLERC". Falls back to driver_number if name missing.
  const labels = rows.map((r) => {
    const full = String(r.driver_name ?? "");
    const last = full.split(" ").pop() || full;
    return last || String(r.driver_number ?? "");
  });
  const cleanAir = rows.map((r) => Number(r[cleanCol] ?? 0));
  const traffic = rows.map((r) => Number(r[trafficCol] ?? 0));

  return {
    type: "stacked_horizontal_bar",
    y_axis: labels,
    x_label: "Laps",
    series: [
      { name: "Clean Air", values: cleanAir, color: "#22C55E" },
      { name: "In Traffic", values: traffic, color: "#E10600" }
    ]
  };
}

const COMPOUND_HEX: Record<string, string> = {
  hard: "#E5E7EB",
  medium: "#FCD34D",
  soft: "#EF4444",
  inter: "#22C55E",
  intermediate: "#22C55E",
  wet: "#3B82F6"
};

function buildStintGantt(rows: Record<string, unknown>[]): ChartSpec {
  const drivers = Array.from(new Set(rows.map((r) => String(r.driver_name ?? r.driver_number ?? "")))).filter(Boolean);
  const stints = rows.map((r) => {
    const compound = String(r.compound ?? "medium").toLowerCase() as
      | "hard"
      | "medium"
      | "soft"
      | "inter"
      | "wet";
    return {
      driver: String(r.driver_name ?? r.driver_number ?? ""),
      start: Number(r.stint_start_lap ?? 0),
      end: Number(r.stint_end_lap ?? 0),
      compound,
      lap_times_avg: typeof r.avg_lap_time === "number" ? Number(r.avg_lap_time) : undefined
    };
  });
  const totalLaps = Math.max(...stints.map((s) => s.end || 0), 0);

  return {
    type: "stint_gantt",
    y_axis: drivers,
    total_laps: totalLaps,
    stints,
    compound_legend: COMPOUND_HEX
  };
}

function buildLineChart(rows: Record<string, unknown>[]): ChartSpec {
  // X = lap_number; pivot by driver_name into series.
  const valueCol =
    Object.keys(rows[0]).find((c) => /lap_time/.test(c)) ??
    Object.keys(rows[0]).find((c) => /delta/.test(c)) ??
    "lap_time";
  const drivers = Array.from(new Set(rows.map((r) => String(r.driver_name ?? "")))).filter(Boolean);
  const laps = Array.from(new Set(rows.map((r) => Number(r.lap_number ?? 0)))).sort((a, b) => a - b);

  // Build y-array per driver aligned to the laps axis.
  const driverColors = getDistinctTeamColors(drivers);
  const series = drivers.map((driver) => ({
    name: driver,
    color: driverColors[driver],
    values: laps.map((lap) => {
      const match = rows.find(
        (r) => String(r.driver_name) === driver && Number(r.lap_number) === lap
      );
      const v = match?.[valueCol];
      return typeof v === "number" ? v : 0;
    })
  }));

  return {
    type: "line",
    x_label: "Lap",
    y_label: humanizeColumnName(valueCol),
    series
  };
}

function buildHorizontalBar(
  rows: Record<string, unknown>[],
  numericCol: string
): ChartSpec {
  const sorted = [...rows].sort(
    (a, b) => Number(b[numericCol] ?? 0) - Number(a[numericCol] ?? 0)
  );
  const labels = sorted.map((r) => String(r.driver_name ?? r.driver_number ?? ""));
  const values = sorted.map((r) => Number(r[numericCol] ?? 0));

  return {
    type: "horizontal_bar",
    y_axis: labels,
    x_label: humanizeColumnName(numericCol),
    series: [
      {
        name: humanizeColumnName(numericCol),
        values,
        color: "#E10600"
      }
    ]
  };
}

/**
 * Build a clean card title from the user's question. Used as a fallback
 * when neither the LLM nor the table part supplied one. Strategy:
 *   - strip leading filler ("how", "what", "across the 2025 season")
 *   - title-case the first ~60 chars, ending at sentence break
 *   - append "— 2025 Season" if the question mentions the season but
 *     doesn't already include it in the picked phrase
 */
const QUESTION_FILLER_PREFIXES = [
  "across the 2025 season,",
  "across the 2025 season",
  "for the 2025 season,",
  "for the 2025 season",
  "in the 2025 season,",
  "during the 2025 season",
  "throughout the 2025 season",
  "at the",
  "across",
  "during",
  "in the",
  "what was ",
  "what is ",
  "what were ",
  "how did ",
  "how does ",
  "how many ",
  "who ",
  "which ",
  "where ",
  "when ",
  "did ",
  "is ",
  "show me ",
  "tell me "
];

function titleFromQuestion(question: string): string {
  let q = question.trim();
  // Strip the longest matching filler prefix (case-insensitive).
  const lower = q.toLowerCase();
  let stripped = "";
  for (const filler of QUESTION_FILLER_PREFIXES) {
    if (lower.startsWith(filler) && filler.length > stripped.length) {
      stripped = filler;
    }
  }
  if (stripped) q = q.slice(stripped.length).trim();
  // Cut at first sentence break only — DO NOT cap length. The card
  // header CSS wraps long titles naturally; ellipsis truncation
  // makes long fallback titles look broken.
  const sentenceEnd = q.search(/[.?!]/);
  if (sentenceEnd > 0) q = q.slice(0, sentenceEnd);
  // Capitalize first letter.
  q = q.charAt(0).toUpperCase() + q.slice(1);
  return q || "Insight";
}

/** B14: true when the title just echoes the user's question (self-title bug) —
 *  the LLM sometimes returns the raw prompt as the title. Normalize both and
 *  compare so punctuation/casing differences don't hide the echo. */
function isSelfTitle(title: string, question: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = norm(title);
  const q = norm(question);
  if (!t || !q) return false;
  if (t === q) return true;
  // Echo only when the title covers MOST of the question — a short, concise
  // title that merely shares a prefix (e.g. "Hamilton vs Leclerc" for a longer
  // question) is NOT a self-echo and must be kept.
  const longer = Math.max(t.length, q.length);
  const shorter = Math.min(t.length, q.length);
  if (shorter >= 15 && shorter >= longer * 0.7 && (q.startsWith(t) || t.startsWith(q))) return true;
  return false;
}

/** B14: deterministic title from the resolved references in the result rows —
 *  distinct driver surname(s) + a corner + venue. Returns undefined when the
 *  rows don't carry enough to build a clean, non-echoed title. */
function titleFromRows(rows: Record<string, unknown>[] | undefined): string | undefined {
  if (!rows || rows.length === 0) return undefined;
  const cols = Object.keys(rows[0]);
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const distinct = (col: string) =>
    cols.includes(col) ? [...new Set(rows.map((r) => str(r[col])).filter(Boolean))] : [];
  const drivers = distinct("driver_name").map((n) => n.split(/\s+/).slice(-1)[0]);
  const venue = str(rows[0].circuit_short_name) || str(rows[0].location) || str(rows[0].country_name);
  const cornerLabels = distinct("corner_label");
  const cornerNums = cols.includes("corner_number")
    ? [...new Set(rows.map((r) => Number(r.corner_number)).filter((n) => Number.isFinite(n)))]
    : [];
  const corner =
    cornerLabels.length === 1
      ? cornerLabels[0]
      : cornerNums.length === 1
        ? `Turn ${cornerNums[0]}`
        : "";
  const who = drivers.length ? drivers.slice(0, 2).join(" vs ") : "";
  const head = corner || who;
  if (!head && !venue) return undefined;
  const tail = [corner && who ? who : "", venue].filter(Boolean).join(" · ");
  const title = [head, tail].filter(Boolean).join(" — ") || venue;
  return title || undefined;
}

/** Apply title fallback: replace a missing OR self-echoed title with a
 *  deterministic one (from rows, else cleaned from the question). */
export function applyQuestionTitle(insight: DraftInsight, question: string): DraftInsight {
  const current = insight.title;
  const needsTitle = !current || current === "Insight" || isSelfTitle(current, question);
  if (!needsTitle) return insight;
  return { ...insight, title: titleFromRows(insight.rows) ?? titleFromQuestion(question) };
}

// Internal helpers re-exported for tests.
export const __test = {
  pickValueCol,
  humanizeColumnName,
  titleFromQuestion,
  IDENTIFIER_COLS,
  COMPOUND_COLS
};
