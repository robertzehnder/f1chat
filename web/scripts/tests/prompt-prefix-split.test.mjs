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
const anthropicSourcePath = path.resolve(webRoot, "src/lib/anthropic.ts");
const buildSynthesisPromptSourcePath = path.resolve(
  webRoot,
  "src/lib/synthesis/buildSynthesisPrompt.ts"
);

async function transpileAndImportAnthropic() {
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-anthropic-"));

  const buildSynthesisSource = await readFile(buildSynthesisPromptSourcePath, "utf8");
  const buildSynthesisOut = ts.transpileModule(buildSynthesisSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "buildSynthesisPrompt.mjs"), buildSynthesisOut.outputText, "utf8");

  const sourceText = await readFile(anthropicSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const rewritten = transpiled.outputText.replace(
    /@\/lib\/synthesis\/buildSynthesisPrompt/g,
    "./buildSynthesisPrompt.mjs"
  );
  const outFile = path.join(dir, "anthropic.mjs");
  await writeFile(outFile, rewritten, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

test("buildSynthesisPromptParts returns a byte-identical staticPrefix and per-input dynamicSuffix without env or network", async () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalDbUrl = process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DATABASE_URL;

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (...args) => {
    fetchCalled = true;
    throw new Error(`Unexpected fetch call during test: ${JSON.stringify(args[0])}`);
  };

  let importResult = null;
  try {
    importResult = await transpileAndImportAnthropic();
    const { buildSynthesisPromptParts } = importResult.mod;

    assert.equal(typeof buildSynthesisPromptParts, "function", "buildSynthesisPromptParts must be exported");

    const inputA = {
      question: "Who won the 2024 Monaco Grand Prix?",
      sql: "SELECT driver_number FROM core.sessions WHERE session_key = 1",
      contract: {
        contractName: "core.sessions",
        grain: "session",
        keys: { session_key: 1 },
        rows: [{ driver_number: 16 }],
        rowCount: 1
      }
    };

    const inputB = {
      question: "Average lap time for VER in Bahrain Q3?",
      sql: "SELECT AVG(lap_duration) FROM core.laps_enriched WHERE session_key = 7 AND driver_number = 1",
      contract: {
        contractName: "core.laps_enriched",
        grain: "lap",
        keys: { session_key: 7, driver_number: 1 },
        rows: [{ avg: 91.234 }, { avg: 90.5 }],
        rowCount: 2
      }
    };

    const partsA = buildSynthesisPromptParts(inputA);
    const partsB = buildSynthesisPromptParts(inputB);

    assert.equal(typeof partsA.staticPrefix, "string", "staticPrefix must be a string");
    assert.equal(typeof partsA.dynamicSuffix, "string", "dynamicSuffix must be a string");
    assert.equal(typeof partsB.staticPrefix, "string", "staticPrefix must be a string");
    assert.equal(typeof partsB.dynamicSuffix, "string", "dynamicSuffix must be a string");

    assert.strictEqual(
      partsA.staticPrefix,
      partsB.staticPrefix,
      "staticPrefix must be byte-identical across different inputs"
    );

    assert.notStrictEqual(
      partsA.dynamicSuffix,
      partsB.dynamicSuffix,
      "dynamicSuffix must differ when inputs differ"
    );

    assert.equal(fetchCalled, false, "buildSynthesisPromptParts must not invoke fetch");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
