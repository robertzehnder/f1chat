// Phase 19-A (rev2 + rev7): grader branch tests for `expected_outcome
// === "insufficient_data"`. Closes the gameable path codex flagged in
// rev2 ("ask for `brake_temp` → LLM hallucinates the column → 17-C
// catches it → grader awarded A on `missingColumns` populated"). The
// branch awards:
//
//   - generationSource === "no_data_refusal"           → A
//   - generationSource === "sql_generation_failed" with missingColumns → B max
//   - generationSource === "runtime_clarification"     → C
//   - normal-shaped synthesized answer                 → C
//
// rev7 also added the "survives into graded JSON" assertion so the
// allow-list patch in chat-health-check-baseline.mjs can't silently
// drop one of the new fields without this test failing.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baselinePath = path.resolve(__dirname, "..", "chat-health-check-baseline.mjs");

let gradeResultWithRubric;
let gradeHealthCheckResults;
{
  const mod = await import(baselinePath);
  gradeResultWithRubric = mod.gradeResultWithRubric;
  gradeHealthCheckResults = mod.gradeHealthCheckResults;
}

function makeRubric(overrides = {}) {
  return {
    id: 1750,
    expected_session_key: null,
    needs_clarification: false,
    should_be_answerable: true,
    ideal_tables: [],
    critical_checks: [],
    ...overrides
  };
}

function baseItem(overrides = {}) {
  return {
    id: 1750,
    category: "Proprietary no-data",
    question: "What was the brake temperature at Turn 8?",
    complexity: "low",
    expected_outcome: "insufficient_data",
    expected_path: "no_data_refusal",
    expected_grade_floor: "A",
    floor_active_after_slice: null,
    column_match_waiver: null,
    author_note: null,
    answer: "INSUFFICIENT_DATA: Brake temperatures are team-internal telemetry.",
    sql: "-- query not executed (proprietary no-data refusal)",
    rowCount: 0,
    generationSource: "no_data_refusal",
    generationNotes: "proprietary_no_data:brake temperature",
    matchedKeyword: "brake temperature",
    missingColumns: null,
    ...overrides
  };
}

test("expected_outcome=insufficient_data + generationSource=no_data_refusal → A", () => {
  const out = gradeResultWithRubric(baseItem(), makeRubric());
  assert.equal(out.baselineGrade, "A");
  assert.equal(out.factual_correctness.grade, "A");
  assert.equal(out.completeness.grade, "A");
});

test("expected_outcome=insufficient_data + sql_generation_failed with missingColumns → B max", () => {
  const item = baseItem({
    answer: "I tried to query brake_temp but that column doesn't exist.",
    sql: "SELECT brake_temp FROM core.laps_enriched",
    generationSource: "sql_generation_failed",
    matchedKeyword: null,
    missingColumns: [
      { table: "core.laps_enriched", column: "brake_temp", sourceRef: "brake_temp" }
    ]
  });
  const out = gradeResultWithRubric(item, makeRubric());
  assert.equal(out.baselineGrade, "B");
  assert.equal(out.factual_correctness.grade, "B");
  assert.equal(out.completeness.grade, "B");
  assert.ok(
    out.root_cause_labels.includes("missing_proactive_no_data_refusal"),
    `expected missing_proactive_no_data_refusal in root_cause_labels, got: ${JSON.stringify(out.root_cause_labels)}`
  );
});

test("expected_outcome=insufficient_data + runtime_clarification → C", () => {
  const item = baseItem({
    answer: "Could you clarify what telemetry channel you're asking about?",
    generationSource: "runtime_clarification",
    matchedKeyword: null,
    missingColumns: null
  });
  const out = gradeResultWithRubric(item, makeRubric());
  assert.equal(out.baselineGrade, "C");
  assert.ok(
    out.root_cause_labels.includes("wrong_refusal_class"),
    `expected wrong_refusal_class in root_cause_labels, got: ${JSON.stringify(out.root_cause_labels)}`
  );
});

test("expected_outcome=insufficient_data + normal answer (anthropic, with rows) → C", () => {
  const item = baseItem({
    answer: "Brake temperature peaked at 412°C at Turn 8 for Hamilton.",
    sql: "SELECT brake_temp_celsius FROM raw.car_data WHERE driver_number = 44",
    rowCount: 12,
    generationSource: "anthropic",
    matchedKeyword: null,
    missingColumns: null
  });
  const out = gradeResultWithRubric(item, makeRubric());
  assert.equal(out.baselineGrade, "C");
  assert.ok(
    out.root_cause_labels.includes("hallucinated_proprietary_data"),
    `expected hallucinated_proprietary_data in root_cause_labels, got: ${JSON.stringify(out.root_cause_labels)}`
  );
});

test("non-insufficient_data questions are unaffected by the new branch", () => {
  // A standard "answer" question with rows should NOT be graded by the
  // insufficient_data branch. We don't assert a specific grade here —
  // just that the branch did not short-circuit.
  const item = {
    id: 100,
    category: "Pace",
    question: "What was the fastest lap at Monza 2025?",
    complexity: "low",
    expected_outcome: "answer",
    expected_path: "anthropic",
    answer: "Verstappen set the fastest lap at 1:21.046.",
    sql: "SELECT MIN(lap_duration) FROM core.laps_enriched WHERE session_key = 9839",
    rowCount: 1,
    generationSource: "anthropic",
    missingColumns: null
  };
  const out = gradeResultWithRubric(item, makeRubric({ id: 100 }));
  // The branch returns an exact A on a no_data_refusal answer; if this
  // question were graded by that branch it would also be A regardless
  // of its actual contents. To prove the branch did NOT fire, check
  // that root_cause_labels do NOT contain any insufficient_data branch
  // label.
  const insufficientDataLabels = [
    "missing_proactive_no_data_refusal",
    "wrong_refusal_class",
    "hallucinated_proprietary_data"
  ];
  for (const label of insufficientDataLabels) {
    assert.ok(
      !out.root_cause_labels.includes(label),
      `non-insufficient_data question must not pick up label ${label}; got: ${JSON.stringify(out.root_cause_labels)}`
    );
  }
});

test("Phase 19-A schema fields survive into graded JSON (rev4 + rev7 contract)", () => {
  // rev7 made this assertion load-bearing: the gate's "skipped +
  // waiver respected" branch depends on `column_match_waiver` and
  // `author_note` reaching the graded JSON, and the activation
  // lifecycle depends on `floor_active_after_slice`. If any of these
  // fields gets dropped from PRESERVED_INPUT_FIELDS, this test fails.
  const items = [
    {
      id: 2001,
      category: "Track dominance",
      question: "Who dominated mini-sectors at Silverstone 2025?",
      complexity: "medium",
      expected_outcome: "answer",
      expected_path: "anthropic",
      expected_tables: ["analytics.minisector_dominance"],
      expected_columns: ["analytics.minisector_dominance.dominant_count"],
      expected_grade_floor: "A",
      floor_active_after_slice: "21-minisector-dominance",
      column_match_waiver: false,
      author_note: null,
      answer: "Verstappen dominated 32 minisectors.",
      sql: "SELECT * FROM analytics.minisector_dominance",
      rowCount: 1,
      generationSource: "anthropic",
      cacheHit: false,
      sqlElapsedMs: 124,
      matchedKeyword: null,
      missingColumns: null
    }
  ];
  const rubricById = new Map([[2001, makeRubric({ id: 2001 })]]);
  const graded = gradeHealthCheckResults(items, rubricById);
  const row = graded[0];

  // Every Phase 19-A schema field must survive verbatim.
  assert.equal(row.complexity, "medium");
  assert.equal(row.expected_outcome, "answer");
  assert.equal(row.expected_path, "anthropic");
  assert.deepEqual(row.expected_tables, ["analytics.minisector_dominance"]);
  assert.deepEqual(row.expected_columns, [
    "analytics.minisector_dominance.dominant_count"
  ]);
  assert.equal(row.expected_grade_floor, "A");
  assert.equal(row.floor_active_after_slice, "21-minisector-dominance");
  assert.equal(row.column_match_waiver, false);
  assert.equal(row.author_note, null);
  assert.equal(row.cacheHit, false);
  assert.equal(row.sqlElapsedMs, 124);
});

test("rev7: column_match_waiver=true with author_note also survives into graded JSON", () => {
  const items = [
    {
      id: 2002,
      category: "Corner analysis",
      question: "Compare entry speeds at Monza T1 between Verstappen and Leclerc.",
      complexity: "high",
      expected_outcome: "answer",
      expected_path: "anthropic",
      expected_tables: ["analytics.corner_analysis"],
      expected_columns: ["analytics.corner_analysis.entry_speed_kph"],
      expected_grade_floor: "B",
      floor_active_after_slice: "21-corner-analysis",
      column_match_waiver: true,
      author_note:
        "intended answer is a CTE-projected aggregation; relying on expected_tables instead",
      answer: "Verstappen averaged 285.4 kph entering T1.",
      sql: "WITH t AS (SELECT entry_speed_kph FROM analytics.corner_analysis) SELECT * FROM t",
      rowCount: 2,
      generationSource: "anthropic",
      cacheHit: false,
      sqlElapsedMs: 220,
      matchedKeyword: null,
      missingColumns: null
    }
  ];
  const rubricById = new Map([[2002, makeRubric({ id: 2002 })]]);
  const graded = gradeHealthCheckResults(items, rubricById);
  const row = graded[0];

  assert.equal(row.column_match_waiver, true);
  assert.equal(
    row.author_note,
    "intended answer is a CTE-projected aggregation; relying on expected_tables instead"
  );
});
