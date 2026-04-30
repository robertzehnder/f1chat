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
  "src/lib/validators/strategyEvidenceValidator.ts"
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
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-strategy-evidence-validator-"));
  const outFile = path.join(dir, "strategyEvidenceValidator.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

function makeContract(rows, contractName = "core.strategy_summary") {
  return {
    contractName,
    grain: "driver",
    keys: { session_key: 9839 },
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

// (a) PASS — answer with no strategy-decision claims is vacuously ok.
test("validateStrategyEvidence: (a) returns ok=true on an answer with no strategy-decision claims", async () => {
  await withValidator(({ validateStrategyEvidence }) => {
    const contract = makeContract([
      {
        driver_name: "Max Verstappen",
        driver_number: 1,
        team_name: "Red Bull",
        pit_laps: [18, 41],
        pit_stop_count: 2,
        strategy_type: "Two-stop strategy",
        compounds_used: ["MEDIUM", "HARD", "HARD"],
        total_pit_duration_seconds: 45.123
      }
    ]);
    const answer = "The race finished under sunny conditions.";
    const result = validateStrategyEvidence(answer, contract);
    assert.equal(result.ok, true, `expected ok=true; got ${JSON.stringify(result)}`);
    assert.deepEqual(result.reasons, []);
  });
});

// (b) PASS — strategy claims backed by the matching driver row.
test("validateStrategyEvidence: (b) returns ok=true when claims match the driver's strategy_summary row", async () => {
  await withValidator(({ validateStrategyEvidence }) => {
    const contract = makeContract([
      {
        driver_name: "Max Verstappen",
        driver_number: 1,
        team_name: "Red Bull",
        pit_laps: [18, 41],
        pit_stop_count: 2,
        strategy_type: "Two-stop strategy",
        compounds_used: ["MEDIUM", "HARD", "HARD"],
        total_pit_duration_seconds: 45.123
      }
    ]);
    const answer = "Verstappen ran a two-stop strategy, pitting on laps 18 and 41.";
    const result = validateStrategyEvidence(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (c) FAIL — strategy claims contradict the matching driver row.
test("validateStrategyEvidence: (c) returns ok=false when claims contradict the driver's strategy_summary row", async () => {
  await withValidator(({ validateStrategyEvidence }) => {
    const contract = makeContract([
      {
        driver_name: "Max Verstappen",
        driver_number: 1,
        team_name: "Red Bull",
        pit_laps: [18, 41],
        pit_stop_count: 2,
        strategy_type: "Two-stop strategy"
      }
    ]);
    // Pit on lap 25 is not in pit_laps; "three-stop" strategy contradicts pit_stop_count=2.
    const answer = "Verstappen ran a three-stop strategy, pitting on lap 25.";
    const result = validateStrategyEvidence(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.length > 0,
      `expected non-empty reasons; got=${JSON.stringify(result.reasons)}`
    );
    assert.ok(
      result.reasons.some(
        (r) => /kind=strategy_name/.test(r) && /Verstappen/.test(r) && /three-stop/.test(r)
      ),
      `expected reason naming the three-stop mismatch; got=${JSON.stringify(result.reasons)}`
    );
    assert.ok(
      result.reasons.some(
        (r) => /kind=pit_lap/.test(r) && /Verstappen/.test(r) && /lap 25/.test(r)
      ),
      `expected reason naming the lap-25 mismatch; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (d) FAIL — contract whose rows lack ALL recognized evidence-bearing columns.
test("validateStrategyEvidence: (d) returns ok=false for claims against a contract with no recognized evidence-bearing columns", async () => {
  await withValidator(({ validateStrategyEvidence }) => {
    // Rows carry only non-strategy columns: driver_number, team_name, total_stints.
    const contract = makeContract(
      [
        {
          driver_name: "Max Verstappen",
          driver_number: 1,
          team_name: "Red Bull",
          total_stints: 3
        }
      ],
      "future.driver_session_summary"
    );
    const answer = "Verstappen ran a two-stop strategy, pitting on laps 18 and 41.";
    const result = validateStrategyEvidence(answer, contract);
    assert.equal(
      result.ok,
      false,
      `expected ok=false on missing-evidence contract; got=${JSON.stringify(result)}`
    );
    assert.ok(
      result.reasons.length > 0,
      `expected non-empty reasons; got=${JSON.stringify(result)}`
    );
    assert.ok(
      result.reasons.every((r) => /no recognized strategy-evidence columns/.test(r)),
      `expected all reasons to cite missing recognized columns; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (e) FAIL — driver-binding: one driver's evidence must not back another driver's claim.
test("validateStrategyEvidence: (e) returns ok=false when an answer attributes one driver's evidence to another driver", async () => {
  await withValidator(({ validateStrategyEvidence }) => {
    const contract = makeContract([
      {
        driver_name: "Max Verstappen",
        driver_number: 1,
        team_name: "Red Bull",
        pit_laps: [18, 41],
        pit_stop_count: 2,
        strategy_type: "Two-stop strategy"
      },
      {
        driver_name: "Lewis Hamilton",
        driver_number: 44,
        team_name: "Mercedes",
        pit_laps: [22],
        pit_stop_count: 1,
        strategy_type: "One-stop strategy"
      }
    ]);

    // Hamilton's claim is backed only by Verstappen's row; the validator must
    // refuse to credit it to Hamilton.
    const hamiltonAnswer = "Hamilton ran a two-stop strategy, pitting on laps 18 and 41.";
    const hamiltonResult = validateStrategyEvidence(hamiltonAnswer, contract);
    assert.equal(
      hamiltonResult.ok,
      false,
      `expected ok=false when Hamilton's claim is backed only by Verstappen's row; got=${JSON.stringify(hamiltonResult)}`
    );
    assert.ok(
      hamiltonResult.reasons.some((r) => r.includes("Hamilton")),
      `expected at least one reason naming the Hamilton driverToken; got=${JSON.stringify(hamiltonResult.reasons)}`
    );

    // Symmetric variant: Verstappen claim that would match Hamilton's row but
    // not Verstappen's row must also fail.
    const verstappenAnswer = "Verstappen ran a one-stop strategy, pitting on lap 22.";
    const verstappenResult = validateStrategyEvidence(verstappenAnswer, contract);
    assert.equal(
      verstappenResult.ok,
      false,
      `expected ok=false when Verstappen's claim is backed only by Hamilton's row; got=${JSON.stringify(verstappenResult)}`
    );
    assert.ok(
      verstappenResult.reasons.some((r) => r.includes("Verstappen")),
      `expected at least one reason naming the Verstappen driverToken; got=${JSON.stringify(verstappenResult.reasons)}`
    );
  });
});
