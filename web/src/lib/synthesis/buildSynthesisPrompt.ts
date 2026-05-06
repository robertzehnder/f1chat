import type { FactContract } from "@/lib/contracts/factContract";

export type BuildSynthesisPromptInput = {
  question: string;
  sql: string;
  contract: FactContract;
};

function buildAnswerSynthesisPrompt() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
Return JSON only with these keys (all optional except "answer"):

  "answer"             — required, plain-language answer to the user's question
  "reasoning"          — optional, brief justification from the rows
  "title"              — optional, ≤60 chars, the card header (e.g. "Clean Air vs Traffic — 2025 Season")
  "subtitle"           — optional, ≤60 chars, venue/session/year (e.g. "All Race Sessions · 2025")
  "metrics"            — optional, array of 2-3 hero metric tiles
  "key_takeaways"      — optional, array of 3-5 bullet takeaways
  "related_questions"  — optional, array of 2-4 follow-up prompts the user might ask next

Each "metrics" item: { "label": "...", "value": "...", "unit": "...", "emphasis": true }
The "emphasis" field highlights one tile (the "hero" number); use it sparingly.

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

Rules for "title" / "subtitle":
- "title" should describe the topic + scope (e.g. "Clean Air vs Traffic — 2025 Season").
- "subtitle" should locate the data: venue, session, year, or "All Race Sessions · 2025" for season aggregates.
- If the question is a refusal or generic, omit both — the UI falls back to a derived title.

Rules for "metrics":
- 2-3 tiles. Each has a 1-3 word "label", a number/time/string "value", and optional "unit".
- One tile MAY have "emphasis": true to mark the headline figure. Maximum one.
- Prefer signed deltas (e.g. "+0.36" with unit "sec/lap") over raw values when the question implies comparison.
- Skip metrics entirely for trivial single-fact answers — use "answer" alone.

Rules for "key_takeaways":
- 3-5 short bullets, ≤90 chars each.
- Concrete, evidence-based — "Verstappen led 82% of his laps in clean air", not "Verstappen did well".
- No row-dump framing.

Rules for "related_questions":
- 2-4 plausible follow-ups the user might ask. ≤80 chars each.
- Phrased as questions or directives ("Show pace delta in traffic vs clean air", "Compare to Mexico 2025").
- Skip if the user's question is itself a follow-up of an obvious thread.

"reasoning" should briefly explain how the rows support the answer.
`.trim();
}

export function buildSynthesisPrompt(
  input: BuildSynthesisPromptInput
): { staticPrefix: string; dynamicSuffix: string } {
  const { contract } = input;
  const runtimeText = JSON.stringify({
    contractName: contract.contractName,
    grain: contract.grain,
    keys: contract.keys,
    coverage: contract.coverage ?? null
  });
  const rowsForPrompt = contract.rows.slice(0, 25);
  const dynamicSuffix = `
Question:
${input.question}

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
    staticPrefix: buildAnswerSynthesisPrompt(),
    dynamicSuffix
  };
}
