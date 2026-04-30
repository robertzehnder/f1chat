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
  "src/lib/validators/sectorConsistencyValidator.ts"
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
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-sector-consistency-validator-"));
  const outFile = path.join(dir, "sectorConsistencyValidator.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

function makeContract(rows) {
  return {
    contractName: "core.sector_summary",
    grain: "lap",
    keys: { session_key: 9839, driver_number: 1 },
    rows,
    rowCount: rows.length
  };
}

async function withValidator(run) {
  const importResult = await transpileAndImportValidator();
  try {
    await run(importResult.mod);
  } finally {
    await rm(importResult.dir, { recursive: true, force: true });
  }
}

// (a) PASS — answer claims a best S1 of 25.123s against a contract row with best_s1: 25.123 → ok=true.
test("validateSectorConsistency: (a) passes when best S1 claim matches best_s1 column", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, best_s1: 25.123 }
    ]);
    const answer = "Verstappen's best S1 was 25.123s in this session.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (b) FAIL — answer claims "best S2 was 30.000s" but the contract's best_s2 and min(duration_sector_2) are far away.
test("validateSectorConsistency: (b) fails when qualified best S2 claim does not match any candidate", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, lap_number: 10, best_s2: 27.500, duration_sector_2: 28.100 },
      { driver_number: 1, lap_number: 11, best_s2: 27.500, duration_sector_2: 27.900 }
    ]);
    const answer = "Verstappen's best S2 was 30.000s on this stint.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => /kind=best/.test(r) && /sector=2/.test(r) && /30\.000/.test(r)
      ),
      `expected reason to name kind=best, sector=2, value=30.000; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (c) FAIL — answer makes a sector claim against a contract that exposes no sector columns at all.
test("validateSectorConsistency: (c) fails when contract has no sector columns and answer makes a sector claim", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, stints: 2, pit_stops: 1 }
    ]);
    const answer = "Verstappen's best S1 was 25.123s.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some((r) => /no sector column to derive from/i.test(r)),
      `expected umbrella "no sector column to derive from" reason; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (d) PASS — answer makes no sector claim at all against a contract with no sector columns → ok=true.
test("validateSectorConsistency: (d) passes when answer makes no sector claim at all", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, stints: 2, pit_stops: 1 }
    ]);
    const answer = "Verstappen finished P1 ahead of Leclerc.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true (no claims, no false positive); got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (e) FAIL — average S1 claim of 25.123s against best_s1=25.123, avg_s1=26.500 → must fail (claim-type-specific).
test("validateSectorConsistency: (e) fails when average S1 claim equals best_s1 but not avg_s1 (claim-type-specific)", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, best_s1: 25.123, avg_s1: 26.500 }
    ]);
    const answer = "Verstappen's average S1 was 25.123s.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => /kind=avg/.test(r) && /sector=1/.test(r) && /25\.123/.test(r)
      ),
      `expected reason naming kind=avg, sector=1, asserted 25.123; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (f) PASS — average S1 claim of 26.500s against the same contract row.
test("validateSectorConsistency: (f) passes when average S1 claim matches avg_s1 (claim-type-specific)", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, best_s1: 25.123, avg_s1: 26.500 }
    ]);
    const answer = "Verstappen's average S1 was 26.500s.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (g) FAIL — average S2 claim against a contract that exposes only best_s2 (no avg_s2, no duration_sector_2).
test("validateSectorConsistency: (g) fails when avg derivation is missing (no fallback to best)", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, best_s2: 30.000 }
    ]);
    const answer = "Verstappen's average S2 was 30.000s.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => r === "no avg_s2 or duration_sector_2 column to derive average from"
      ),
      `expected exact "no avg_s2 or duration_sector_2 column to derive average from" reason; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (h) FAIL — per_lap claim "S1 on lap 12 was 25.500s" against a contract with rows for laps 10 and 11 only.
test("validateSectorConsistency: (h) fails when per_lap claim references a lap absent from the contract", async () => {
  await withValidator(({ validateSectorConsistency }) => {
    const contract = makeContract([
      { driver_number: 1, lap_number: 10, duration_sector_1: 25.500 },
      { driver_number: 1, lap_number: 11, duration_sector_1: 25.490 }
    ]);
    const answer = "Verstappen's S1 on lap 12 was 25.500s.";
    const result = validateSectorConsistency(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => r === "no lap 12 row to derive per-lap S1 from"
      ),
      `expected exact "no lap 12 row to derive per-lap S1 from" reason; got=${JSON.stringify(result.reasons)}`
    );
  });
});
