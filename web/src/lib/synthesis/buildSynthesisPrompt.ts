import type { FactContract } from "@/lib/contracts/factContract";
import type { InsightShape } from "@/lib/chatRuntime/insightShape";

export type BuildSynthesisPromptInput = {
  question: string;
  sql: string;
  contract: FactContract;
  /** Phase 3: shape picked by the classifier. When omitted, the
   *  prompt falls back to `chart-with-metrics` (the workhorse
   *  template) for backwards compatibility with callers that
   *  haven't been updated to pass it yet. */
  shape?: InsightShape;
  /** F01 honesty clamp (golden-set audit 2026-07-02): when the runtime
   *  pinned a session at high confidence, the model must never claim
   *  that session/event is absent from the dataset — fallback SQL that
   *  missed it is a query failure, not a data gap. */
  resolvedSession?: { sessionKey: number; label: string };
};

const COMMON_RULES = `
Rules for "answer":
- Directly answer the user's question using only provided rows.
- Prefer plain-language summary over table-style wording.
- Never use row-dump framing like "I found N rows" or "Key results:".
- Include key values (driver names, session keys, counts, times) when present.
- If rows are insufficient, clearly say what is missing.
- Do not invent facts not present in the rows.
- Do not claim undercut/overcut benefits without explicit position-change evidence.
- Do not claim positions gained/lost without both grid and finish values.
- For session-sensitive questions (for example pole, qualifying, Q1, Q2, Q3, sprint qualifying), verify the returned rows match that session context using fields like session_name before answering.
- Never treat a race fastest lap or any non-qualifying lap row as a pole lap unless the rows explicitly show qualifying/pole session context.
- Keep stint count and pit-stop count logically consistent (pit_stops = stints - 1 when both are present).
- Keep sector winner statements consistent with reported best/average sector values.
- Keep "answer" concise (2-6 sentences).

Rules for formatting lap times and durations (apply EVERYWHERE — answer, reasoning, metrics values, key_takeaways, related_questions):
- Any lap time, stint average, or session-duration value ≥ 60 seconds MUST be written as M:SS.mmm (minutes : two-digit seconds . three-digit milliseconds). Examples: 82.878 → "1:22.878", 89 → "1:29.000", 124.531 → "2:04.531".
- Values < 60 seconds (sector times, pit losses, gaps, deltas) stay in decimal seconds with up to three decimals + an "s" suffix. Examples: 22.63 → "22.630s", 0.36 → "+0.36s".
- Never emit a bare number like "82.878 seconds" or "82.878s" for a full lap — always use mm:ss.mmm above 60s.
- The same rule applies to differences phrased as totals (e.g. cumulative time lost) but NOT to per-lap deltas, which stay in decimal seconds.

Rules for "title" / "subtitle":
- "title" should describe the topic + scope (e.g. "Clean Air vs Traffic — 2025 Season").
- "subtitle" should locate the data: venue, session, year, or "All Race Sessions · 2025" for season aggregates.

"reasoning" should briefly explain how the rows support the answer.

CRITICAL: Always emit "answer" FIRST among the JSON keys so the
streaming UI can render the body text immediately. Other keys can
follow in any order.
`.trim();

/** ---------------------------------------------------------------
 *  Shape: chart-with-metrics  (M04-M19, M22 — the workhorse)
 *  -------------------------------------------------------------- */
function chartWithMetricsTemplate() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
Return JSON only with these keys:

  "answer"             — REQUIRED, plain-language answer (2-6 sentences)
  "at_a_glance"        — recommended, ONE punchy sentence (≤120 chars) that
                          leads with the direct answer (who/what/how much).
                          Rendered big above the tiles; must NOT just repeat
                          the first sentence of "answer" verbatim.
  "reasoning"          — optional, brief justification from the rows
  "title"              — recommended, ≤60 chars
  "subtitle"           — recommended, ≤60 chars (venue/session/year)
  "metrics"            — recommended, 2-3 hero metric tiles
  "key_takeaways"      — recommended, 3-5 bullet takeaways
  "related_questions"  — optional, 2-4 follow-up prompts
  "corner_map"         — ONLY when the answer is about a SINGLE named corner and
                          the rows carry a circuit + corner number/label (e.g.
                          entry/apex/exit speeds through one corner). Emit
                          { "circuit": "<circuit_short_name>", "corner_number": <N> }
                          so the UI pins that corner on the real track outline.
                          Omit for anything not tied to one specific corner.

Each "metrics" item: { "label": "...", "value": "...", "unit": "...", "context": "...", "emphasis": true }
At most ONE metric may have "emphasis": true (the headline figure).

Rules for "metrics":
- 2-3 tiles. Each has a 1-3 word "label", a number/time/string "value", optional "unit", optional "context".
- "unit" is a PURE token only: "s", "kph", "km/h", "%", "sec/lap", "s/lap", "laps". NEVER pack qualifiers into unit.
- "context" is the qualifier annotation (driver name, lap number, compound, scope). Examples: "Antonelli (lap 3)", "vs Russell · medium tyres", "race-stint avg". Keep ≤ 40 chars.
- NEVER concatenate value + qualifier with em-dash inside "unit" or "value" — split them across the dedicated fields.
- Prefer signed deltas (e.g. "+0.36" with unit "s/lap") over raw values when the question implies comparison.
- Skip metrics entirely for trivial single-fact answers (use the hero shape instead).

Rules for "key_takeaways":
- 3-5 short bullets, ≤90 chars each.
- Concrete, evidence-based — "Verstappen led 82% of his laps in clean air", not "Verstappen did well".
- No row-dump framing.

Rules for "related_questions":
- 2-4 plausible follow-ups. ≤80 chars each.
- Phrased as questions or directives ("Show pace delta in traffic vs clean air").

${COMMON_RULES}

EXAMPLE (clean-air vs traffic question):
{
  "answer": "Across the 2025 season, Verstappen leads in clean-air share with 412 laps in clean air vs 89 in traffic (82% clean). Norris is second at 78%. The midfield runners spent more than half their laps in traffic.",
  "reasoning": "Aggregating analytics.traffic_adjusted_pace across all Race sessions 2025; clean_air_laps + traffic_laps per driver.",
  "title": "Clean Air vs Traffic — 2025 Season",
  "subtitle": "All Race Sessions · 2025",
  "metrics": [
    { "label": "Most Clean-Air laps", "value": "412", "unit": "laps", "context": "Verstappen", "emphasis": true },
    { "label": "Pace Delta", "value": "+0.42", "unit": "s/lap", "context": "vs traffic" },
    { "label": "Drivers ≥70% Clean", "value": "5" }
  ],
  "key_takeaways": [
    "Verstappen led 82% of his laps in clean air",
    "Avg traffic pace penalty: +0.42 s/lap field-wide",
    "5 drivers maintained 70%+ clean-air share",
    "Backmarkers spent >55% of laps stuck behind another car"
  ],
  "related_questions": [
    "Show pace delta in traffic vs clean air",
    "Filter by stint",
    "Mexico 2025 specifically"
  ]
}
`.trim();
}

/** ---------------------------------------------------------------
 *  Shape: hero  (M01 — pole lap, fastest lap, total overtakes, compound)
 *  -------------------------------------------------------------- */
function heroTemplate() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
The user asked a single-fact question. Return JSON only with:

  "answer"      — REQUIRED, 1-3 sentence summary placing the fact in context
  "reasoning"   — optional, brief justification
  "title"       — recommended, ≤60 chars (e.g. "Pole Lap — Suzuka 2025")
  "subtitle"    — recommended, "<Venue> · <Session>" (e.g. "2025 Japanese GP · Q3")
  "hero"        — REQUIRED for hero shape: { "value": "...", "label": "...", "context": "..." }

The "hero" object IS the answer's centerpiece: a big number/time/string
under the title. "value" is the literal fact ("1:27.502", "47", "MEDIUM");
"label" describes what the value is ("pole lap time", "total overtakes",
"starting compound"); "context" is an optional 1-line tighter framing
(e.g. "+0.044s ahead of Norris (P2)").

DO NOT emit "metrics", "chart" (handled by the row-shape detector),
"key_takeaways", or "related_questions" unless the question genuinely
warrants them. The hero card is intentionally minimal.

${COMMON_RULES}

EXAMPLE (pole lap question):
{
  "answer": "Verstappen took pole at Suzuka 2025 with a lap of 1:27.502, 0.044s ahead of Norris in P2. The lap featured a personal-best Sector 2 through the high-speed esses where Red Bull's downforce package excelled.",
  "reasoning": "Q3 lap_time_seconds for the fastest classified driver in session_key=10006 qualifying.",
  "title": "Pole Lap — Suzuka 2025",
  "subtitle": "2025 Japanese GP · Q3",
  "hero": {
    "value": "1:27.502",
    "label": "pole lap time",
    "context": "+0.044s ahead of Norris (P2)"
  }
}
`.trim();
}

/** ---------------------------------------------------------------
 *  Shape: verdict  (M02 — yes/no with evidence)
 *  -------------------------------------------------------------- */
function verdictTemplate() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
The user asked a yes/no question. Return JSON only with:

  "answer"      — REQUIRED, 2-4 sentences explaining the verdict with evidence
  "reasoning"   — optional, brief justification
  "title"       — recommended, ≤60 chars (e.g. "Over-Cut Verdict — Canada 2025")
  "subtitle"    — recommended, "<Venue> · <Session> · <lap range>"
  "verdict"     — REQUIRED for verdict shape: { "label": "YES" | "NO", "summary": "...", "color": "#E10600" }
  "metrics"     — recommended, 2-3 supporting tiles (gap before, gap after, net swing)

The "verdict.label" is exactly "YES" or "NO" (uppercase). The
"verdict.summary" is a single sentence that justifies the verdict
("Russell's lap-29 stop gained track position over Verstappen by 1.4s
after the cycle"). Color defaults to "#E10600" (F1 red); the renderer
applies it to the YES/NO badge.

DO NOT include the YES/NO word at the start of "answer" — the verdict
component renders the label in its own visual slot. Start "answer"
with the explanation.

If the returned rows CANNOT support a categorical answer (data missing,
truncated, or covering only part of the question's scope), OMIT the
"verdict" field entirely and say so in "answer". Never pair a YES/NO
verdict with an answer that hedges ("cannot be confirmed", "data only
covers…") — an unsupported NO reads as "the thing did not happen",
which is wrong, not cautious.

The inverse also holds: when your "answer" DOES state a categorical
outcome ("the over-cut did not succeed", "yes, the gap reversed"), the
"verdict" field is REQUIRED — a categorical answer without a verdict is
an error, not caution.

${COMMON_RULES}

EXAMPLE (overcut-success question):
{
  "answer": "Russell pitted on lap 29, one lap after Verstappen's lap-28 stop. With Russell on fresher mediums and Verstappen still warming up his tyres on lap 30, Russell's out-lap was 1.1s quicker than Verstappen's in-lap, and the cycle handed Russell a 1.4s lead by the end of lap 30. Net swing: +3.2s in Mercedes' favor.",
  "reasoning": "Sequence analysis: lap_time_seconds for both drivers across laps 27-31; gap_to_leader before vs after the cycle.",
  "title": "Over-Cut Verdict — Canada 2025",
  "subtitle": "2025 Canadian GP · Race · lap 28-29",
  "verdict": {
    "label": "YES",
    "summary": "Russell's lap-29 stop gained track position over Verstappen by 1.4s after the cycle",
    "color": "#E10600"
  },
  "metrics": [
    { "label": "Gap before", "value": "1.8s", "context": "Russell behind" },
    { "label": "Gap after", "value": "1.4s", "context": "Russell ahead", "emphasis": true },
    { "label": "Net swing", "value": "+3.2s" }
  ]
}
`.trim();
}

/** ---------------------------------------------------------------
 *  Shape: metric-grid  (M03 — entry/apex/exit, before/after triplets)
 *  -------------------------------------------------------------- */
function metricGridTemplate() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
The user asked for a 3-value triplet (entry/apex/exit, before/after,
delta-with-context). Return JSON only with:

  "answer"      — REQUIRED, 2-4 sentences placing the values in context
  "reasoning"   — optional
  "title"       — recommended, ≤60 chars
  "subtitle"    — recommended, "<Venue> · <Session>"
  "metrics"     — REQUIRED for metric-grid shape: array of EXACTLY 3 tiles
  "key_takeaways" — optional, 3-4 bullets

The 3 metric tiles ARE the visual centerpiece. One should have
"emphasis": true for the headline figure. The "answer" provides
narrative context that the tiles can't carry alone.

DO NOT emit "chart" (M03 has no chart) or "hero" (use chart-with-metrics
or hero shapes for those).

${COMMON_RULES}

EXAMPLE (brake-zone speed drop):
{
  "answer": "Across 41 race laps at Jeddah's Turn 22, Verstappen approached at an average of 318 km/h and braked down to 92 km/h — a brake-zone drop of 226 km/h with a peak brake pressure of 92.4%. The drop was consistent across the stint (std-dev 4.2 km/h), suggesting Red Bull's brake balance held up well as fuel burned off.",
  "reasoning": "core.car_data_lap_position filtered to T22 brake-zone region; aggregate min/max/peak per lap.",
  "title": "Turn 22 Brake-Zone — Saudi 2025",
  "subtitle": "2025 Saudi Arabian GP · Race",
  "metrics": [
    { "label": "Approach", "value": "318", "unit": "km/h" },
    { "label": "Min in zone", "value": "92", "unit": "km/h" },
    { "label": "Drop", "value": "226", "unit": "km/h", "emphasis": true }
  ],
  "key_takeaways": [
    "Peak brake pressure 92.4%",
    "Std-dev across the stint: 4.2 km/h (consistent)",
    "Brake balance held as fuel burned off",
    "Top-1 brake-zone severity at Jeddah"
  ]
}
`.trim();
}

/** ---------------------------------------------------------------
 *  Shape: composite  (M20 — cross-category multi-shape)
 *  -------------------------------------------------------------- */
function compositeTemplate() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
The user asked a cross-category question — does X coincide with Y,
or how does Z interact with W? Return JSON only with:

  "answer"      — REQUIRED, 3-5 sentences threading the two phenomena
  "reasoning"   — optional
  "title"       — recommended, ≤60 chars
  "subtitle"    — recommended, "<Venue> · <Session> · <stint/lap range>"
  "verdict"     — recommended, { "label": "YES" | "NO", "summary": "..." }
  "metrics"     — recommended, 2-3 tiles spanning both phenomena
  "key_takeaways" — optional, 4-5 bullets

Composite questions usually have an underlying yes/no — did the two
things coincide? Use "verdict" to surface that. "metrics" should mix
values from both phenomena (e.g. "Cliff onset Lap 14" + "Δ at lap 16
+1.1 s/lap" + "Stop lap 17"). "answer" tells the story.

The chart auto-detector handles the chart family choice; this prompt
focuses on the narrative + cross-references.

${COMMON_RULES}

EXAMPLE (graining + pace cliff):
{
  "answer": "YES — Piastri's lap-pace fell off a cliff over laps 14-16 before his lap-17 stop, with deltas of +0.4, +0.7, +1.1 s/lap to his stint-best. The cliff coincided with the team's radio call about front-right graining at lap 14. The pit-stop on lap 17 was reactive to the cliff, not a strategic call.",
  "reasoning": "Pace-cliff detection via lap_time_seconds vs stint-best; correlated with team radio messages timestamped lap 14.",
  "title": "Imola — Piastri Front-Right Graining",
  "subtitle": "2025 Emilia-Romagna GP · Race · stint 1",
  "verdict": {
    "label": "YES",
    "summary": "Pace cliff lap 14-16, stop lap 17 — graining-driven, not strategic"
  },
  "metrics": [
    { "label": "Cliff onset", "value": "Lap 14" },
    { "label": "Δ at lap 16", "value": "+1.1 s/lap", "emphasis": true },
    { "label": "Stop lap", "value": "17" }
  ],
  "key_takeaways": [
    "Cliff began lap 14, accelerated lap 16",
    "+1.1 s/lap on the final pre-stop lap",
    "Stop on lap 17 was reactive, not strategic",
    "Front-right radio call confirmed by lap-pace pattern"
  ]
}
`.trim();
}

/** ---------------------------------------------------------------
 *  Shape: refusal  (M21 — no-data refusal, muted card)
 *  -------------------------------------------------------------- */
function refusalTemplate() {
  return `
You are reviewing a query that hit a no-data refusal — the user asked
about a data category we don't ingest (brake temps, fuel flow,
front-wing damage state, ERS deployment, etc.). Return JSON only with:

  "answer"        — REQUIRED, 1-2 sentences explaining what's missing
  "reasoning"     — optional, why this category isn't in the OpenF1 feed

Do NOT emit "title" (the renderer uses "Not in dataset"), "metrics",
"chart", "key_takeaways", "related_questions", "hero", or "verdict".
The refusal card is intentionally minimal and the muted-tone is set
by the runtime, not by the LLM.

Rules for "answer":
- Acknowledge what was asked.
- Identify the missing data category specifically.
- Briefly explain what we DO ingest that's adjacent (the runtime layer
  may add a "what_we_have" list separately).
- DO NOT speculate or fabricate values.

${COMMON_RULES}

EXAMPLE (brake temperature question):
{
  "answer": "Brake temperatures aren't part of the OpenF1 public telemetry feed. We ingest car_data (speed, throttle, brake on/off, n_gear, RPM, DRS), location, lap times, weather, and race control — but not internal component telemetry like brake/tyre temps, fuel flow, or ERS state-of-charge.",
  "reasoning": "PROPRIETARY_NO_DATA topic match: 'brake temperature' is in the deny-list of categories not exposed by OpenF1."
}
`.trim();
}

/** Pick the shape-specific template. */
function buildAnswerSynthesisPrompt(shape: InsightShape | undefined): string {
  switch (shape) {
    case "hero":
      return heroTemplate();
    case "verdict":
      return verdictTemplate();
    case "metric-grid":
      return metricGridTemplate();
    case "composite":
      return compositeTemplate();
    case "refusal":
      return refusalTemplate();
    case "chart-with-metrics":
    case undefined:
    default:
      return chartWithMetricsTemplate();
  }
}

export function buildSynthesisPrompt(
  input: BuildSynthesisPromptInput
): { staticPrefix: string; dynamicSuffix: string } {
  const { contract, shape } = input;
  const runtimeText = JSON.stringify({
    contractName: contract.contractName,
    grain: contract.grain,
    keys: contract.keys,
    coverage: contract.coverage ?? null
  });
  const rowsForPrompt = contract.rows.slice(0, 25);
  const resolvedSessionBlock = input.resolvedSession
    ? `
RESOLVED SESSION (authoritative): session_key=${input.resolvedSession.sessionKey} — ${input.resolvedSession.label}.
This session EXISTS in the dataset. Never claim it, its event, or its year is missing, absent, or "not yet ingested".
If the returned rows do not cover it, say the query failed to target it — not that the data is absent.
`
    : "";
  const dynamicSuffix = `
Question:
${input.question}
${resolvedSessionBlock}
SQL:
${input.sql}

Row count:
${contract.rowCount}

Rows (sample):
${JSON.stringify(rowsForPrompt)}

Runtime:
${runtimeText}

Return JSON only.
`.trim();

  return {
    staticPrefix: buildAnswerSynthesisPrompt(shape),
    dynamicSuffix
  };
}

// ===========================================================================
// Verdict hedge guard (synthesis-output validation)
//
// The verdict shape asks for a YES/NO verdict, but when the returned data
// can't actually support one the model sometimes emits a categorical
// verdict anyway while the prose hedges ("…the final hard stint comparison
// is not present in the returned rows, so a reversal cannot be confirmed"
// — rendered under a giant red NO). A skimming reader takes the verdict as
// the answer, which is worse than no verdict at all. validateInsightFields
// (anthropic.ts) calls this and drops the verdict on a hit; deterministic
// builders never hedge, so only the LLM synthesis path is affected.
// ===========================================================================

const VERDICT_HEDGE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:cannot|can(?:'|no)?t|can not)\s+(?:be\s+)?(?:confirm|determin|verif|conclud|establish|assess)/i,
  /\bunable to\s+(?:confirm|determine|verify|conclude|establish|assess)/i,
  /\bimpossible to\s+(?:confirm|determine|verify|say|tell|conclude)/i,
  /\binsufficient\s+(?:data|evidence|information|rows|laps|coverage)/i,
  /\bnot enough\s+(?:data|evidence|information|rows|laps|coverage)/i,
  /\bdata\s+(?:is|are|was|were)?\s*(?:incomplete|absent|missing|unavailable|not available|not present|not returned)/i,
  /\bincomplete\s+(?:data|coverage|rows)\b/i,
  /\b(?:absent|missing|not present|not included)\s+(?:from|in)\s+the\s+returned\b/i,
  /\bnot present in the (?:returned|result)/i,
  /\b(?:rows?|data|results?)\s+(?:was|were|are|is)\s+(?:truncated|cut off|capped)/i,
  /\b(?:row|result)\s+limit\b/i,
  /\bonly covers?\b/i,
  /\bdoes not cover\b/i,
  /\bno (?:rows|data|laps)\s+(?:for|covering|matching)\b/i
];

/**
 * True when the answer body or verdict summary contains language that
 * contradicts a categorical YES/NO verdict.
 */
export function answerHedgesVerdict(
  answerText: string | null | undefined,
  verdictSummary: string | null | undefined
): boolean {
  const haystacks = [answerText, verdictSummary].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  return haystacks.some((text) => VERDICT_HEDGE_PATTERNS.some((pattern) => pattern.test(text)));
}
