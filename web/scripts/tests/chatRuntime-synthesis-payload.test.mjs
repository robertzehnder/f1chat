import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const buildSynthesisPromptSourcePath = path.resolve(
  webRoot,
  "src/lib/synthesis/buildSynthesisPrompt.ts"
);

// Inline copy of the live `buildAnswerSynthesisPrompt()` text in
// web/src/lib/anthropic.ts:99-116, post-`.trim()`. Locks in byte-for-byte
// equality of the staticPrefix; if the synthesis instructions ever change
// in anthropic.ts (or the new module), this fixture must be updated to
// match. The slice's expectation is that the cutover does NOT change them.
const EXPECTED_STATIC_PREFIX = `You are reviewing SQL query output from an OpenF1 analytics system.
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
- "reasoning" should briefly explain how the rows support the answer.`;

async function transpileAndImportBuildSynthesisPrompt() {
  const sourceText = await readFile(buildSynthesisPromptSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-buildsynth-"));
  const outFile = path.join(dir, "buildSynthesisPrompt.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

const FIXTURE_QUESTION = "Who won the 2024 Monaco Grand Prix?";
const FIXTURE_SQL = "SELECT driver_number FROM core.sessions WHERE session_key = 1";
const FIXTURE_CONTRACT = {
  contractName: "core.sessions",
  grain: "session",
  keys: { session_key: 1, driver_number: 16 },
  rows: [{ driver_number: 16, full_name: "Charles Leclerc" }],
  rowCount: 1,
  coverage: { warnings: ["mocked: Monaco timing not yet ingested"] },
};

function buildExpectedDynamicSuffix(input) {
  const rowsForPrompt = input.contract.rows.slice(0, 25);
  const runtimeText = JSON.stringify({
    contractName: input.contract.contractName,
    grain: input.contract.grain,
    keys: input.contract.keys,
    coverage: input.contract.coverage ?? null,
  });
  return `
Question:
${input.question}

SQL:
${input.sql}

Row count:
${input.contract.rowCount}

Rows (sample):
${JSON.stringify(rowsForPrompt)}

Runtime:
${runtimeText}

Return JSON only.
`.trim();
}

test("buildSynthesisPrompt: dynamicSuffix matches the live prompt template byte-for-byte outside the Runtime block, and Runtime body is the FactContract-derived four-key object", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportBuildSynthesisPrompt();
    const { buildSynthesisPrompt } = importResult.mod;
    assert.equal(typeof buildSynthesisPrompt, "function");

    const input = {
      question: FIXTURE_QUESTION,
      sql: FIXTURE_SQL,
      contract: FIXTURE_CONTRACT,
    };

    const rendered = buildSynthesisPrompt(input);
    const expectedDynamicSuffix = buildExpectedDynamicSuffix(input);

    // (a) byte-for-byte equality of the rendered dynamicSuffix against the
    // hand-constructed expected string. Every line outside the Runtime block
    // — Question:, SQL:, Row count:, Rows (sample):, the trailing
    // "Return JSON only.", and all blank-line separators — matches the live
    // web/src/lib/anthropic.ts:124-141 template byte-for-byte. The
    // Rows (sample): line uses JSON.stringify(rows.slice(0, 25)) with no
    // null, 2 indent argument.
    assert.strictEqual(
      rendered.dynamicSuffix,
      expectedDynamicSuffix,
      "dynamicSuffix must match the hand-constructed expected string byte-for-byte"
    );

    // (c) Runtime block body is exactly JSON.stringify({ contractName,
    // grain, keys, coverage }) for the fixture's FactContract values.
    const expectedRuntimeBody = JSON.stringify({
      contractName: FIXTURE_CONTRACT.contractName,
      grain: FIXTURE_CONTRACT.grain,
      keys: FIXTURE_CONTRACT.keys,
      coverage: FIXTURE_CONTRACT.coverage,
    });
    assert.ok(
      rendered.dynamicSuffix.includes(`Runtime:\n${expectedRuntimeBody}`),
      `Runtime block must contain JSON.stringify({contractName,grain,keys,coverage}); got dynamicSuffix=\n${rendered.dynamicSuffix}`
    );
    // Positive substring match on the four keys in fixed order.
    const fourKeyOrderRegex = /"contractName":[^,]+,"grain":[^,]+,"keys":\{[^}]*\},"coverage":/;
    assert.ok(
      fourKeyOrderRegex.test(rendered.dynamicSuffix),
      "Runtime block must contain the four keys contractName,grain,keys,coverage in fixed order"
    );

    // (d) legacy runtime keys must be absent from the Runtime block.
    const runtimeBlockMatch = rendered.dynamicSuffix.match(/Runtime:\n([^\n]+)/);
    assert.ok(runtimeBlockMatch, "Runtime block must be present in dynamicSuffix");
    const runtimeBody = runtimeBlockMatch[1];
    assert.equal(
      runtimeBody.includes("questionType"),
      false,
      "legacy runtime key 'questionType' must be absent from Runtime block"
    );
    assert.equal(
      runtimeBody.includes("resolvedEntities"),
      false,
      "legacy runtime key 'resolvedEntities' must be absent from Runtime block"
    );
    assert.equal(
      runtimeBody.includes("completenessWarnings"),
      false,
      "legacy runtime key 'completenessWarnings' must be absent from Runtime block"
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("buildSynthesisPrompt: staticPrefix matches the live buildAnswerSynthesisPrompt() text byte-for-byte", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportBuildSynthesisPrompt();
    const { buildSynthesisPrompt } = importResult.mod;

    const input = {
      question: FIXTURE_QUESTION,
      sql: FIXTURE_SQL,
      contract: FIXTURE_CONTRACT,
    };

    const rendered = buildSynthesisPrompt(input);

    // (b) byte-for-byte equality of staticPrefix against the inline copy of
    // the live buildAnswerSynthesisPrompt() text (web/src/lib/anthropic.ts:99-116
    // post-.trim()). The implementer is responsible for keeping
    // EXPECTED_STATIC_PREFIX in sync if the synthesis instructions ever
    // change in anthropic.ts; this slice's expectation is that the cutover
    // does NOT change them.
    assert.strictEqual(
      rendered.staticPrefix,
      EXPECTED_STATIC_PREFIX,
      "staticPrefix must equal the inline copy of buildAnswerSynthesisPrompt() byte-for-byte"
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("buildSynthesisPrompt: when contract.coverage is omitted, Runtime block coverage field serializes as null", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportBuildSynthesisPrompt();
    const { buildSynthesisPrompt } = importResult.mod;

    const inputNoCoverage = {
      question: FIXTURE_QUESTION,
      sql: FIXTURE_SQL,
      contract: {
        contractName: "core.laps_enriched",
        grain: "lap",
        keys: { session_key: 7, driver_number: 1 },
        rows: [{ avg: 91.234 }],
        rowCount: 1,
      },
    };
    const rendered = buildSynthesisPrompt(inputNoCoverage);
    const expectedRuntimeBody = JSON.stringify({
      contractName: "core.laps_enriched",
      grain: "lap",
      keys: { session_key: 7, driver_number: 1 },
      coverage: null,
    });
    assert.ok(
      rendered.dynamicSuffix.includes(`Runtime:\n${expectedRuntimeBody}`),
      `Runtime block must serialize coverage:null when contract.coverage is omitted; got=\n${rendered.dynamicSuffix}`
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
