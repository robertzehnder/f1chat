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
  "src/lib/validators/gridFinishValidator.ts"
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
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-grid-finish-validator-"));
  const outFile = path.join(dir, "gridFinishValidator.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

function makeContract(rows) {
  return {
    contractName: "core.grid_vs_finish",
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

// (a1) PASS — explicit "started P5" + "finished P3" against matching contract row.
test("validateGridFinish: (a1) passes when explicit grid/finish position claims match contract row", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, grid_position: 5, finish_position: 3, positions_gained: 2 }
    ]);
    const answer = "Verstappen started P5 and finished P3 in this race.";
    const result = validateGridFinish(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (a2) FAIL — explicit position claim contradicting contract row.
test("validateGridFinish: (a2) fails when explicit grid/finish position claim contradicts contract row", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, grid_position: 5, finish_position: 3, positions_gained: 2 }
    ]);
    const answer = "Verstappen started P10 and finished P1 in this race.";
    const result = validateGridFinish(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => /kind=explicit_position/.test(r) && /Verstappen/.test(r) && /field=grid/.test(r) && /P10/.test(r)
      ),
      `expected reason naming the grid mismatch; got=${JSON.stringify(result.reasons)}`
    );
    assert.ok(
      result.reasons.some(
        (r) => /kind=explicit_position/.test(r) && /Verstappen/.test(r) && /field=finish/.test(r) && /P1\b/.test(r)
      ),
      `expected reason naming the finish mismatch; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (b1) PASS — "gained 4 places" matching contract row delta.
test("validateGridFinish: (b1) passes when 'gained N places' matches contract signed delta", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, grid_position: 8, finish_position: 4, positions_gained: 4 }
    ]);
    const answer = "Verstappen gained 4 places overall.";
    const result = validateGridFinish(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (b2) FAIL — "gained 4 places" but actual delta is +2.
test("validateGridFinish: (b2) fails when 'gained N places' contradicts contract signed delta", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, grid_position: 5, finish_position: 3, positions_gained: 2 }
    ]);
    const answer = "Verstappen gained 4 places.";
    const result = validateGridFinish(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => /kind=delta/.test(r) && /Verstappen/.test(r) && /signed_delta=4/.test(r) && /signed_delta=2/.test(r)
      ),
      `expected reason naming kind=delta with claimed=4 vs actual=2; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (b3) PASS — "lost 2 positions" matching contract.
test("validateGridFinish: (b3) passes when 'lost N positions' matches contract signed delta", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Lewis Hamilton", driver_number: 44, grid_position: 2, finish_position: 4, positions_gained: -2 }
    ]);
    const answer = "Hamilton lost 2 positions over the race.";
    const result = validateGridFinish(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (b4) FAIL — "lost 5 positions" but actual loss is 2.
test("validateGridFinish: (b4) fails when 'lost N positions' contradicts contract signed delta", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Lewis Hamilton", driver_number: 44, grid_position: 2, finish_position: 4, positions_gained: -2 }
    ]);
    const answer = "Hamilton lost 5 positions.";
    const result = validateGridFinish(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) => /kind=delta/.test(r) && /Hamilton/.test(r) && /signed_delta=-5/.test(r) && /signed_delta=-2/.test(r)
      ),
      `expected reason naming kind=delta with claimed=-5 vs actual=-2; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (c1) PASS — "Verstappen gained more positions than Leclerc" with deltaV > deltaL.
test("validateGridFinish: (c1) passes when 'A gained more than B' matches contract delta ordering", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, grid_position: 5, finish_position: 1, positions_gained: 4 },
      { full_name: "Charles Leclerc", driver_number: 16, grid_position: 4, finish_position: 3, positions_gained: 1 }
    ]);
    const answer = "Verstappen gained more positions than Leclerc in this race.";
    const result = validateGridFinish(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (c2) FAIL — "Verstappen gained more positions than Leclerc" but Leclerc actually gained more.
test("validateGridFinish: (c2) fails when 'A gained more than B' contradicts contract delta ordering", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, grid_position: 4, finish_position: 3, positions_gained: 1 },
      { full_name: "Charles Leclerc", driver_number: 16, grid_position: 5, finish_position: 1, positions_gained: 4 }
    ]);
    const answer = "Verstappen gained more positions than Leclerc.";
    const result = validateGridFinish(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) =>
          /kind=comparative/.test(r) &&
          /Verstappen/.test(r) &&
          /Leclerc/.test(r) &&
          /A=1/.test(r) &&
          /B=4/.test(r)
      ),
      `expected reason naming kind=comparative with A=1 vs B=4; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (c3) PASS — "Leclerc lost fewer places than Hamilton" with |loss_L| < |loss_H| → deltaL > deltaH.
test("validateGridFinish: (c3) passes when 'A lost fewer than B' matches contract delta ordering", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Charles Leclerc", driver_number: 16, grid_position: 3, finish_position: 4, positions_gained: -1 },
      { full_name: "Lewis Hamilton", driver_number: 44, grid_position: 2, finish_position: 5, positions_gained: -3 }
    ]);
    const answer = "Leclerc lost fewer places than Hamilton over the race.";
    const result = validateGridFinish(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (c4) FAIL — "Leclerc lost fewer places than Hamilton" but Leclerc actually lost more.
test("validateGridFinish: (c4) fails when 'A lost fewer than B' contradicts contract delta ordering", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Charles Leclerc", driver_number: 16, grid_position: 2, finish_position: 5, positions_gained: -3 },
      { full_name: "Lewis Hamilton", driver_number: 44, grid_position: 3, finish_position: 4, positions_gained: -1 }
    ]);
    const answer = "Leclerc lost fewer places than Hamilton.";
    const result = validateGridFinish(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some(
        (r) =>
          /kind=comparative/.test(r) &&
          /Leclerc/.test(r) &&
          /Hamilton/.test(r) &&
          /A=-3/.test(r) &&
          /B=-1/.test(r)
      ),
      `expected reason naming kind=comparative with A=-3 vs B=-1; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (d) PASS — answer makes no grid/finish claim at all → ok=true (no false positives).
test("validateGridFinish: (d) passes when answer makes no grid/finish claim at all", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, grid_position: 5, finish_position: 3 }
    ]);
    const answer = "Verstappen's best S1 was 25.123s in this stint.";
    const result = validateGridFinish(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});

// (e) FAIL — claim made against a contract that lacks grid/finish columns.
test("validateGridFinish: (e) fails when contract has no grid/finish columns", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Max Verstappen", driver_number: 1, stints: 2, pit_stops: 1 }
    ]);
    const answer = "Verstappen gained 4 places.";
    const result = validateGridFinish(answer, contract);
    assert.equal(result.ok, false);
    assert.ok(
      result.reasons.some((r) =>
        /no grid_position\/finish_position\/positions_gained column to derive from/.test(r)
      ),
      `expected umbrella "no grid/finish column" reason; got=${JSON.stringify(result.reasons)}`
    );
  });
});

// (f) PASS — "moved up 3 spots" against a +3 contract delta.
test("validateGridFinish: (f) passes when 'moved up N spots' matches contract delta", async () => {
  await withValidator(({ validateGridFinish }) => {
    const contract = makeContract([
      { full_name: "Lando Norris", driver_number: 4, grid_position: 7, finish_position: 4 }
    ]);
    const answer = "Norris moved up 3 spots from grid to finish.";
    const result = validateGridFinish(answer, contract);
    assert.equal(
      result.ok,
      true,
      `expected ok=true; got reasons=${JSON.stringify(result.reasons)}`
    );
    assert.deepEqual(result.reasons, []);
  });
});
