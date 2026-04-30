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
const validatorSourcePath = path.resolve(
  webRoot,
  "src/lib/validators/pitStintsValidator.ts"
);

async function transpileAndImportValidator() {
  const sourceText = await readFile(validatorSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-pitstints-validator-"));
  const outFile = path.join(dir, "pitStintsValidator.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

function makeContract(rows) {
  return {
    contractName: "core.stint_summary",
    grain: "stint",
    keys: { session_key: 9839, driver_number: 1 },
    rows,
    rowCount: rows.length
  };
}

test("validatePitStints: passes when stint and pit-stop counts are consistent (pit_stops = stints - 1)", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportValidator();
    const { validatePitStints } = importResult.mod;

    const contract = makeContract([
      { driver_number: 1, stints: 3, pit_stops: 2 }
    ]);
    const answer = "Verstappen ran 3 stints and made 2 pit stops in this race.";
    const result = validatePitStints(answer, contract);

    assert.equal(result.ok, true, `expected ok=true, got reasons=${JSON.stringify(result.reasons)}`);
    assert.deepEqual(result.reasons, []);
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("validatePitStints: fails when answer claims an undercut without position-change rows", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportValidator();
    const { validatePitStints } = importResult.mod;

    const contract = makeContract([
      { driver_number: 1, stints: 2, pit_stops: 1, avg_lap_ms: 81234 }
    ]);
    const answer = "Verstappen executed an undercut to gain track position over Leclerc.";
    const result = validatePitStints(answer, contract);

    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some((r) => /undercut|overcut/i.test(r) && /position-change/i.test(r)),
      `expected reasons to flag missing position-change evidence; got ${JSON.stringify(result.reasons)}`
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("validatePitStints: fails when pit_stops count does not match stints - 1", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportValidator();
    const { validatePitStints } = importResult.mod;

    const contract = makeContract([
      { driver_number: 1, stints: 2, pit_stops: 1 }
    ]);
    // Answer claims 2 pit stops with 2 stints (which violates pit_stops = stints - 1).
    const answer = "Verstappen ran 2 stints but made 2 pit stops during the race.";
    const result = validatePitStints(answer, contract);

    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => /pit-stop count/i.test(r) && /stint count/i.test(r)
      ),
      `expected reasons to flag inconsistent pit-stop/stint counts; got ${JSON.stringify(result.reasons)}`
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("validatePitStints: fails when claimed pit-stop count is not derivable from contract rows", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportValidator();
    const { validatePitStints } = importResult.mod;

    const contract = makeContract([
      { driver_number: 1, stints: 2, pit_stops: 1 }
    ]);
    // Contract supports only 1 pit stop (or stints-1 = 1); claiming 5 must fail.
    const answer = "Verstappen made 5 pit stops in this race.";
    const result = validatePitStints(answer, contract);

    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => /asserts 5 pit stops/i.test(r) && /derivable/i.test(r)
      ),
      `expected reasons to flag 5 not derivable from contract; got ${JSON.stringify(result.reasons)}`
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});

test("validatePitStints: undercut claim passes when contract rows expose grid/finish columns", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportValidator();
    const { validatePitStints } = importResult.mod;

    const contract = makeContract([
      { driver_number: 1, stints: 2, pit_stops: 1, grid: 3, finish: 1 }
    ]);
    const answer = "Verstappen executed an undercut and gained 2 positions over Leclerc.";
    const result = validatePitStints(answer, contract);

    assert.equal(
      result.ok,
      true,
      `expected ok=true when grid/finish present; got reasons=${JSON.stringify(result.reasons)}`
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
