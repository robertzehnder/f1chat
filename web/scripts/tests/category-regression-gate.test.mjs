// Phase 19-D (rev2-rev8): tests for category_regression_gate.mjs.
// Table-driven cases covering every documented branch.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gatePath = path.resolve(__dirname, "..", "category_regression_gate.mjs");

const { runRegressionGate } = await import(gatePath);

async function withTmp(setup) {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-gate-"));
  try {
    return await setup(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const FLOORS = {
  default_floor: 0.0,
  categories: {
    pace: { floor: 0.8 },
    "Track dominance": { floor: 0.0 }
  }
};

const STATUS = {
  slices: [
    { slice_id: "21-minisector-dominance", status: "pending", merged_at: null },
    { slice_id: "21-corner-analysis", status: "merged", merged_at: "2026-05-15T00:00:00Z" }
  ]
};

function makeGraded(rows) {
  return rows;
}

async function gate(rowsArr, options = {}) {
  return await withTmp(async (dir) => {
    const gradedPath = path.join(dir, "graded.json");
    const floorsPath = path.join(dir, "floors.json");
    const statusPath = path.join(dir, "status.json");
    await writeFile(gradedPath, JSON.stringify(makeGraded(rowsArr)), "utf8");
    await writeFile(floorsPath, JSON.stringify(options.floors ?? FLOORS), "utf8");
    await writeFile(statusPath, JSON.stringify(options.status ?? STATUS), "utf8");
    // Capture stdout/stderr so test output stays clean.
    const origLog = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
      return await runRegressionGate({
        gradedPaths: [gradedPath],
        floorsPath,
        statusPath,
        verbose: false
      });
    } finally {
      process.stdout.write = origLog;
      process.stderr.write = origErr;
    }
  });
}

test("PASS — all questions meet per-question floor and category floor", async () => {
  const result = await gate([
    { id: 1, category: "pace", complexity: "low", baselineGrade: "A", expected_grade_floor: "A" },
    { id: 2, category: "pace", complexity: "low", baselineGrade: "A", expected_grade_floor: "A" }
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.categoryFails.length, 0);
  assert.equal(result.perQuestionFails.length, 0);
});

test("FAIL — category A-rate below floor", async () => {
  const result = await gate([
    { id: 1, category: "pace", complexity: "low", baselineGrade: "A", expected_grade_floor: "A" },
    { id: 2, category: "pace", complexity: "low", baselineGrade: "C", expected_grade_floor: "A" }
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.categoryFails.length, 1);
  assert.equal(result.categoryFails[0].category, "pace");
});

test("FAIL — per-question baselineGrade below string floor", async () => {
  // pace floor is 0.8. With one A and one B, A-rate = 0.5 < 0.8. To
  // isolate the per-question fail, set the category floor to 0 and only
  // test the per-question miss.
  const result = await gate(
    [
      { id: 1, category: "pace", complexity: "low", baselineGrade: "B", expected_grade_floor: "A" }
    ],
    { floors: { default_floor: 0, categories: { pace: { floor: 0.0 } } } }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.categoryFails.length, 0);
  assert.equal(result.perQuestionFails.length, 1);
  assert.equal(result.perQuestionFails[0].axis, "baselineGrade");
});

test("FAIL — per-question axis floor (factual_correctness) below object floor", async () => {
  const result = await gate(
    [
      {
        id: 1,
        category: "pace",
        complexity: "low",
        baselineGrade: "A",
        factual_correctness: { grade: "B" },
        expected_grade_floor: { baselineGrade: "A", axes: { factual_correctness: "A" } }
      }
    ],
    { floors: { default_floor: 0, categories: { pace: { floor: 0.0 } } } }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.perQuestionFails.length, 1);
  assert.equal(result.perQuestionFails[0].axis, "factual_correctness");
});

test("activation lifecycle SUPPRESSED — pending slice skips per-question floor", async () => {
  const result = await gate(
    [
      {
        id: 1701,
        category: "Track dominance",
        complexity: "medium",
        baselineGrade: "C", // would fail "A" floor
        expected_grade_floor: "A",
        floor_active_after_slice: "21-minisector-dominance" // pending in STATUS
      }
    ]
  );
  assert.equal(result.exitCode, 0, "pending slice must defer the fail");
  assert.equal(result.skippedDueToActivation.length, 1);
});

test("activation lifecycle ACTIVE — merged slice enforces per-question floor", async () => {
  const result = await gate(
    [
      {
        id: 1801,
        category: "pace",
        complexity: "low",
        baselineGrade: "B",
        expected_grade_floor: "A",
        floor_active_after_slice: null // active immediately
      }
    ],
    { floors: { default_floor: 0, categories: { pace: { floor: 0.0 } } } }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.perQuestionFails.length, 1);
});

test("rev5 fail-fast: unknown slice id in floor_active_after_slice fails the gate", async () => {
  const result = await gate([
    {
      id: 1,
      category: "pace",
      complexity: "low",
      baselineGrade: "A",
      floor_active_after_slice: "21-corner-analyses" // typo (not in STATUS)
    }
  ]);
  assert.equal(result.exitCode, 3);
  assert.equal(result.reason, "unknown_slice_id");
  assert.equal(result.unknownSliceRefs.length, 1);
  assert.equal(result.unknownSliceRefs[0].slice_id, "21-corner-analyses");
});

test("rev4 cleanup-or-fail: question still references a merged slice", async () => {
  const result = await gate([
    {
      id: 1,
      category: "pace",
      complexity: "low",
      baselineGrade: "A",
      floor_active_after_slice: "21-corner-analysis" // merged in STATUS, not cleaned up
    }
  ]);
  assert.equal(result.exitCode, 4);
  assert.equal(result.reason, "cleanup_or_fail");
  assert.equal(result.cleanupViolations.length, 1);
});

test("default floor — high complexity defaults to B", async () => {
  const result = await gate(
    [
      {
        id: 1,
        category: "pace",
        complexity: "high",
        baselineGrade: "B"
        // no expected_grade_floor — high complexity defaults to B
      }
    ],
    { floors: { default_floor: 0, categories: { pace: { floor: 0.0 } } } }
  );
  assert.equal(result.exitCode, 0, "high-complexity B grade meets default-B floor");
});

test("default floor — low complexity defaults to A", async () => {
  const result = await gate(
    [
      {
        id: 1,
        category: "pace",
        complexity: "low",
        baselineGrade: "B"
      }
    ],
    { floors: { default_floor: 0, categories: { pace: { floor: 0.0 } } } }
  );
  assert.equal(result.exitCode, 1, "low-complexity B grade fails default-A floor");
});

test("rev-codex-audit: proprietary-phrase lint catches non-proprietary file leakage", async () => {
  // Plant a fake question file in the scripts dir with a proprietary phrase
  // and assert the gate's startup lint fails with reason "proprietary_phrase_leakage".
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const scriptsDir = path.resolve(here, "..");
  const tempCategoryFile = path.join(
    scriptsDir,
    "chat-health-check.questions.proprietary_lint_test_fixture.json"
  );
  await fs.writeFile(
    tempCategoryFile,
    JSON.stringify([
      {
        id: 99001,
        category: "Test category",
        complexity: "low",
        expected_outcome: "answer",
        question: "What was the brake temperature for Verstappen at Monza?"
      }
    ]),
    "utf8"
  );
  try {
    const result = await gate(
      [
        { id: 1, category: "pace", complexity: "low", baselineGrade: "A", expected_grade_floor: "A" }
      ]
    );
    assert.equal(result.exitCode, 5);
    assert.equal(result.reason, "proprietary_phrase_leakage");
    assert.ok(
      result.proprietaryViolations.some(
        (v) => v.file.includes("proprietary_lint_test_fixture") && v.phrase === "brake temperature"
      ),
      `expected violation on planted file, got ${JSON.stringify(result.proprietaryViolations)}`
    );
  } finally {
    await fs.rm(tempCategoryFile, { force: true });
  }
});

test("rev-codex-audit: proprietary lint ignores the proprietary_no_data category file itself", async () => {
  // The actual proprietary_no_data.json contains "brake temperature" etc;
  // the lint must NOT trip on it. Since the gate scans the scripts dir
  // every run, we just verify the production category files don't trip
  // the lint when only a benign graded row is supplied.
  const result = await gate([
    { id: 1, category: "Pace", complexity: "low", baselineGrade: "A", expected_grade_floor: "A" }
  ]);
  // The production category files were written grounded in F1 journalism
  // and should pass the lint. If this fails, a category file has
  // accidentally introduced a proprietary phrase — go fix it.
  assert.notEqual(result.reason, "proprietary_phrase_leakage", "proprietary lint tripped on production files");
});
