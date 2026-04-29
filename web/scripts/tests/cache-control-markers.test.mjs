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

test("buildSynthesisRequestParams attaches ephemeral cache_control to the static prefix only, with no env or network", async () => {
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
    const { buildSynthesisRequestParams, buildSynthesisPromptParts } = importResult.mod;

    assert.equal(
      typeof buildSynthesisRequestParams,
      "function",
      "buildSynthesisRequestParams must be exported"
    );
    assert.equal(
      typeof buildSynthesisPromptParts,
      "function",
      "buildSynthesisPromptParts must be exported"
    );

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

    const paramsA = buildSynthesisRequestParams(inputA);
    const paramsB = buildSynthesisRequestParams(inputB);

    const partsA = buildSynthesisPromptParts(inputA);
    const partsB = buildSynthesisPromptParts(inputB);

    assert.ok(Array.isArray(paramsA.system), "system must be an array");
    assert.equal(paramsA.system.length, 1, "system must have exactly one block");
    assert.equal(paramsA.system[0].type, "text", "system[0].type must be 'text'");
    assert.strictEqual(
      paramsA.system[0].text,
      partsA.staticPrefix,
      "system[0].text must equal buildSynthesisPromptParts(input).staticPrefix byte-for-byte"
    );
    assert.deepStrictEqual(
      paramsA.system[0].cache_control,
      { type: "ephemeral" },
      "system[0].cache_control must deep-equal { type: 'ephemeral' }"
    );

    assert.ok(Array.isArray(paramsB.system), "system must be an array (B)");
    assert.equal(paramsB.system.length, 1, "system must have exactly one block (B)");
    assert.equal(paramsB.system[0].type, "text", "system[0].type must be 'text' (B)");
    assert.strictEqual(
      paramsB.system[0].text,
      partsB.staticPrefix,
      "system[0].text must equal staticPrefix (B)"
    );
    assert.deepStrictEqual(
      paramsB.system[0].cache_control,
      { type: "ephemeral" },
      "system[0].cache_control must deep-equal { type: 'ephemeral' } (B)"
    );

    assert.strictEqual(
      paramsA.system[0].text,
      paramsB.system[0].text,
      "static prefix must be byte-identical across inputs"
    );

    assert.equal(paramsA.messages.length, 1, "messages must have exactly one entry");
    assert.equal(paramsA.messages[0].role, "user", "messages[0].role must be 'user'");
    assert.strictEqual(
      paramsA.messages[0].content,
      partsA.dynamicSuffix,
      "messages[0].content must equal buildSynthesisPromptParts(input).dynamicSuffix"
    );
    assert.equal(
      typeof paramsA.messages[0].content,
      "string",
      "messages[0].content must be a plain string (no cache marker on suffix)"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(paramsA.messages[0], "cache_control"),
      false,
      "messages[0] must not have its own cache_control property"
    );

    assert.equal(paramsB.messages.length, 1, "messages must have exactly one entry (B)");
    assert.equal(paramsB.messages[0].role, "user", "messages[0].role must be 'user' (B)");
    assert.strictEqual(
      paramsB.messages[0].content,
      partsB.dynamicSuffix,
      "messages[0].content must equal dynamicSuffix (B)"
    );
    assert.equal(
      typeof paramsB.messages[0].content,
      "string",
      "messages[0].content must be a plain string (B)"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(paramsB.messages[0], "cache_control"),
      false,
      "messages[0] must not have its own cache_control property (B)"
    );

    assert.notStrictEqual(
      paramsA.messages[0].content,
      paramsB.messages[0].content,
      "dynamic suffix must differ when inputs differ"
    );

    assert.equal(fetchCalled, false, "buildSynthesisRequestParams must not invoke fetch");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
