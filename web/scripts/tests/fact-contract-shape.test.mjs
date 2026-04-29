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
const factContractSourcePath = path.resolve(webRoot, "src/lib/contracts/factContract.ts");

async function transpileAndImportFactContract() {
  const sourceText = await readFile(factContractSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-factcontract-"));
  const outFile = path.join(dir, "factContract.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

test("serializeRowsToFactContract: rowCount === 0 for empty rows", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportFactContract();
    const { serializeRowsToFactContract } = importResult.mod;
    assert.equal(typeof serializeRowsToFactContract, "function");

    const result = serializeRowsToFactContract({
      contractName: "core.empty",
      grain: "session",
      keys: { session_key: 42 },
      rows: [],
    });
    assert.equal(result.rowCount, 0, "rowCount must be 0 for empty rows");
    assert.equal(result.rows.length, 0);
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("serializeRowsToFactContract: rowCount === rows.length for non-empty rows", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportFactContract();
    const { serializeRowsToFactContract } = importResult.mod;

    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const result = serializeRowsToFactContract({
      contractName: "core.three",
      grain: "lap",
      keys: { session_key: 7, driver_number: 1 },
      rows,
    });
    assert.equal(result.rowCount, rows.length);
    assert.equal(result.rowCount, 3);
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("serializeRowsToFactContract: returned object is frozen at the top level", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportFactContract();
    const { serializeRowsToFactContract } = importResult.mod;

    const result = serializeRowsToFactContract({
      contractName: "core.frozen",
      grain: "stint",
      keys: { session_key: 1 },
      rows: [{ a: 1 }],
    });

    assert.equal(Object.isFrozen(result), true, "top-level result must be frozen");

    const originalRowCount = result.rowCount;
    let threw = false;
    try {
      result.rowCount = 999;
    } catch {
      threw = true;
    }
    assert.equal(
      threw || result.rowCount === originalRowCount,
      true,
      "assigning to result.rowCount must throw in strict mode or leave the value unchanged"
    );
    assert.equal(result.rowCount, originalRowCount);
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("serializeRowsToFactContract: coverage omitted when not provided, present when provided", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportFactContract();
    const { serializeRowsToFactContract } = importResult.mod;

    const without = serializeRowsToFactContract({
      contractName: "core.no_cov",
      grain: "driver",
      keys: { driver_number: 1 },
      rows: [{ a: 1 }],
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(without, "coverage"),
      false,
      "coverage must be omitted when not provided"
    );

    const warnings = ["incomplete: missing 3 laps"];
    const withCov = serializeRowsToFactContract({
      contractName: "core.with_cov",
      grain: "driver",
      keys: { driver_number: 1 },
      rows: [{ a: 1 }],
      coverage: { warnings },
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(withCov, "coverage"),
      true,
      "coverage must be present when provided"
    );
    assert.deepStrictEqual(withCov.coverage, { warnings });
    assert.strictEqual(withCov.coverage.warnings, warnings);
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
