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
  "src/lib/validators/countListParityValidator.ts"
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
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-count-list-parity-validator-"));
  const outFile = path.join(dir, "countListParityValidator.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

function makeContract(rows, contractName = "core.test_contract") {
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

// (a) PASS — count claim matches the length of the listed items in the same answer.
test("validateCountListParity: (a) returns ok=true when claim and bullet list lengths match", async () => {
  await withValidator(({ validateCountListParity }) => {
    const contract = makeContract([
      { driver_name: "Max Verstappen", pit_lap: 12 },
      { driver_name: "Max Verstappen", pit_lap: 24 },
      { driver_name: "Max Verstappen", pit_lap: 36 }
    ]);
    const answer = "There were 3 pit stops:\n- Lap 12\n- Lap 24\n- Lap 36";
    const result = validateCountListParity(answer, contract);
    assert.equal(result.ok, true, `expected ok=true; got ${JSON.stringify(result)}`);
    assert.deepEqual(result.reasons, []);
  });
});

// (b) FAIL (mismatch) — answer's parsed list disagrees with the claim, while
// the contract.rows.length matches the claim. Asserts the validator parses the
// answer text only and does NOT silently read from contract.rows.
test("validateCountListParity: (b) returns ok=false when claim and parsed list disagree, even when contract.rows.length matches the claim", async () => {
  await withValidator(({ validateCountListParity }) => {
    // contract.rows.length = 3 — matches the claim — but the answer lists only 2 items.
    const contract = makeContract([
      { driver_name: "Max Verstappen", pit_lap: 12 },
      { driver_name: "Max Verstappen", pit_lap: 24 },
      { driver_name: "Max Verstappen", pit_lap: 36 }
    ]);
    const answer = "There were 3 pit stops:\n- Lap 12\n- Lap 24";
    const result = validateCountListParity(answer, contract);
    assert.equal(
      result.ok,
      false,
      `expected ok=false on answer-text mismatch; got ${JSON.stringify(result)}`
    );
    assert.ok(
      result.reasons.length > 0,
      `expected non-empty reasons; got=${JSON.stringify(result.reasons)}`
    );
    assert.ok(
      result.reasons.some(
        (r) => /Count claim '3 pit stops' disagrees with listed-item count 2/.test(r)
      ),
      `expected reason naming the 3-vs-2 mismatch; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (c) FAIL (claim with no list) — answer has a numerical count claim but no
// corresponding list/enumeration in the same answer.
test("validateCountListParity: (c) returns ok=false when a count claim has no corresponding listed enumeration in the answer", async () => {
  await withValidator(({ validateCountListParity }) => {
    const contract = makeContract([
      { driver_name: "Max Verstappen", pit_lap: 12 },
      { driver_name: "Max Verstappen", pit_lap: 24 },
      { driver_name: "Max Verstappen", pit_lap: 36 }
    ]);
    const answer = "There were 3 pit stops in the race.";
    const result = validateCountListParity(answer, contract);
    assert.equal(
      result.ok,
      false,
      `expected ok=false when claim has no list to verify against; got=${JSON.stringify(result)}`
    );
    assert.ok(
      result.reasons.some(
        (r) =>
          /Count claim '3 pit stops' has no corresponding listed enumeration in the answer to verify against/.test(
            r
          )
      ),
      `expected reason naming the missing-list outcome; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (d) NO-CLAIM — answer has no parseable numerical count claim.
test("validateCountListParity: (d) returns ok=true on an answer with no parseable numerical count claim", async () => {
  await withValidator(({ validateCountListParity }) => {
    const contract = makeContract([
      { driver_name: "Max Verstappen", pit_lap: 12 }
    ]);
    const answer = "The race had a great atmosphere with cars going fast.";
    const result = validateCountListParity(answer, contract);
    assert.equal(result.ok, true, `expected ok=true; got ${JSON.stringify(result)}`);
    assert.deepEqual(result.reasons, []);
  });
});
