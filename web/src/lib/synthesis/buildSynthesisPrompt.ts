import type { FactContract } from "@/lib/contracts/factContract";

export type BuildSynthesisPromptInput = {
  question: string;
  sql: string;
  contract: FactContract;
};

function buildAnswerSynthesisPrompt() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
Return JSON only with keys: "answer", "reasoning".

Rules:
- "answer" must directly answer the user's question using only provided rows.
- Prefer plain-language summary over table-style wording.
- Never use row-dump framing like "I found N rows" or "Key results:".
- Include key values (driver names, session keys, counts, times) when present.
- If rows are insufficient, clearly say what is missing.
- Do not invent facts not present in the rows.
- Do not claim undercut/overcut benefits without explicit position-change evidence.
- Do not claim positions gained/lost without both grid and finish values.
- Keep stint count and pit-stop count logically consistent (pit_stops = stints - 1 when both are present).
- Keep sector winner statements consistent with reported best/average sector values.
- Keep "answer" concise (2-6 sentences).
- "reasoning" should briefly explain how the rows support the answer.
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
