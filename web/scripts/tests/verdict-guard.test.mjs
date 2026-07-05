// Tests for the verdict hedge guard: a YES/NO verdict must be dropped
// when the synthesis answer (or the verdict summary itself) hedges with
// insufficient-data language. Origin: 2025 Bahrain stint-delta incident —
// a giant red "NO" rendered over an answer that said the hard-stint rows
// were truncated away and "a reversal cannot be confirmed".

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadGuard() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-verdict-guard-"));
  // answerHedgesVerdict lives in buildSynthesisPrompt.ts (only type-level
  // imports, which erase on transpile) so the anthropic.ts test harnesses
  // keep working with their single-module import rewrite.
  const src = await readFile(path.resolve(webRoot, "src/lib/synthesis/buildSynthesisPrompt.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  await writeFile(path.join(dir, "verdictGuard.mjs"), out, "utf8");
  const mod = await import(path.join(dir, "verdictGuard.mjs"));
  return { mod, dir };
}

const HEDGED_ANSWERS = [
  "The data returned covers only stint 1 laps, so the final hard stint comparison is not present in the returned rows. Without hard-stint lap data for both drivers, it is impossible to confirm whether Hamilton's deficit reversed.",
  "A reversal cannot be confirmed from the available rows.",
  "The result set was truncated at the 200-row limit.",
  "There is insufficient data to compare the final stints.",
  "Lap data is missing for the closing stint, so this can't be determined.",
  "The returned rows only cover the opening stint.",
  "Not enough laps survive the filters to assess the closing stint."
];

const CLEAN_ANSWERS = [
  "Hamilton was 0.4s/lap slower on the middle mediums and 0.2s/lap slower on the final hards, so the gap narrowed but never flipped.",
  "Russell's lap-29 stop gained him track position; he emerged 1.4s ahead and held the lead to the flag.",
  "Leclerc was consistently faster across all three stints."
];

test("hedged answers suppress the verdict", async () => {
  const { mod, dir } = await loadGuard();
  try {
    for (const answer of HEDGED_ANSWERS) {
      assert.equal(mod.answerHedgesVerdict(answer, "Some verdict summary"), true, `should hedge: ${answer.slice(0, 60)}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hedging in the verdict summary alone also suppresses", async () => {
  const { mod, dir } = await loadGuard();
  try {
    assert.equal(
      mod.answerHedgesVerdict("Leclerc led every stint.", "Cannot be confirmed from the returned data"),
      true
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clean categorical answers keep the verdict", async () => {
  const { mod, dir } = await loadGuard();
  try {
    for (const answer of CLEAN_ANSWERS) {
      assert.equal(mod.answerHedgesVerdict(answer, "Clear verdict summary"), false, `should not hedge: ${answer.slice(0, 60)}`);
    }
    assert.equal(mod.answerHedgesVerdict(undefined, undefined), false);
    assert.equal(mod.answerHedgesVerdict("", ""), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
