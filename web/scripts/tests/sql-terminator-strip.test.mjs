// Chat follow-up derail fix (2026-08): the LLM SQL generator
// intermittently ends its single valid statement with `;`,
// `; -- explanation`, or a tail comment block. querySafety rejects ANY
// semicolon ("Only a single SQL statement is allowed"), so one bad model
// roll — on generate AND the single repair attempt — hard-failed the
// turn. parseSqlJsonPayload now peels trailing terminators/comments via
// stripTrailingSqlTerminators; this test pins that behavior, including
// the do-NOT-touch cases (interior semicolons stay, so genuine
// multi-statement output is still rejected downstream).

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const sourcePath = path.resolve(webRoot, "src/lib/anthropic.ts");

async function loadModule() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-sql-strip-"));
  const src = await readFile(sourcePath, "utf8");
  const stubbed = src.replace(
    /import\(\s*"@\/lib\/schemaCatalog"\s*\)/g,
    `import("./schemaCatalog.stub.mjs")`
  );
  const transpiled = ts.transpileModule(stubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const output = transpiled.outputText.replace(
    /from\s+["']@\/lib\/[^"']+["']/g,
    `from "./neutral.stub.mjs"`
  );
  await writeFile(
    path.join(dir, "schemaCatalog.stub.mjs"),
    `export async function getSchemaDocs() { throw new Error("test stub"); }
export async function getSchemaCatalog() { return new Map(); }
export async function getColumnsForTable() { return undefined; }
export const CORE_CONTRACT_LIST = [];
export function _resetSchemaCatalogForTests() {}
`,
    "utf8"
  );
  await writeFile(
    path.join(dir, "neutral.stub.mjs"),
    `export const buildSynthesisPrompt = () => "";
export const answerHedgesVerdict = () => false;
`,
    "utf8"
  );
  await writeFile(path.join(dir, "anthropic.mjs"), output, "utf8");
  const mod = await import(path.join(dir, "anthropic.mjs"));
  return { mod, dir };
}

async function withModule(fn) {
  const { mod, dir } = await loadModule();
  try {
    await fn(mod);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("stripTrailingSqlTerminators: trailing semicolon variants are peeled", async () => {
  await withModule(({ stripTrailingSqlTerminators }) => {
    assert.equal(stripTrailingSqlTerminators("SELECT 1;"), "SELECT 1");
    assert.equal(stripTrailingSqlTerminators("SELECT 1;\n"), "SELECT 1");
    assert.equal(stripTrailingSqlTerminators("SELECT 1 ;;  "), "SELECT 1");
    assert.equal(
      stripTrailingSqlTerminators("SELECT a FROM t ORDER BY a; -- ranked by pass count"),
      "SELECT a FROM t ORDER BY a"
    );
    assert.equal(
      stripTrailingSqlTerminators("SELECT 1;\n-- explanation line\n-- second line"),
      "SELECT 1"
    );
    assert.equal(
      stripTrailingSqlTerminators("SELECT 1;\n/* tail block\ncomment */"),
      "SELECT 1"
    );
  });
});

test("stripTrailingSqlTerminators: interior semicolons and clean SQL untouched", async () => {
  await withModule(({ stripTrailingSqlTerminators }) => {
    // Genuine multi-statement output keeps its interior `;` — querySafety
    // must still reject it.
    assert.equal(
      stripTrailingSqlTerminators("SELECT 1;\nSELECT 2"),
      "SELECT 1;\nSELECT 2"
    );
    // Clean single statement is returned as-is (modulo outer trim).
    const clean = "WITH x AS (SELECT 1 AS n)\nSELECT n FROM x ORDER BY n\nLIMIT 200";
    assert.equal(stripTrailingSqlTerminators(clean), clean);
    // Semicolon inside a string literal is interior — untouched here.
    assert.equal(
      stripTrailingSqlTerminators("SELECT ';' AS c FROM t"),
      "SELECT ';' AS c FROM t"
    );
  });
});
