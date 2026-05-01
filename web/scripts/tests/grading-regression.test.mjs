import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  loadBaselineRubric,
  gradeHealthCheckResults,
  summarizeBaselineGrades
} from "../chat-health-check-baseline.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");
const gradeScriptPath = path.resolve(__dirname, "..", "chat-health-check-grade.mjs");

async function readJsonFixture(fileName) {
  const filePath = path.join(fixturesDir, fileName);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function gradeFixtureRows({ inputFixture, rubricFixture }) {
  const rows = await readJsonFixture(inputFixture);
  const rubricPath = path.join(fixturesDir, rubricFixture);
  const { rubricById } = await loadBaselineRubric(rubricPath);
  const graded = gradeHealthCheckResults(rows, rubricById);
  return { graded, summary: summarizeBaselineGrades(graded) };
}

function rowById(rows, id) {
  const row = rows.find((item) => Number(item.id) === Number(id));
  assert.ok(row, `Expected row for id=${id}`);
  return row;
}

test("clarification policy fixture catches expected vs unnecessary clarification", async () => {
  const { graded } = await gradeFixtureRows({
    inputFixture: "clarification.fixture.json",
    rubricFixture: "clarification.rubric.json"
  });

  const expectedClarification = rowById(graded, 101);
  assert.equal(expectedClarification.baselineAnswerability, "expected_clarification_met");
  assert.equal(expectedClarification.factual_correctness.grade, "A");
  assert.equal(expectedClarification.completeness.grade, "A");
  assert.ok(["A", "B"].includes(expectedClarification.clarity.grade), "clarity must be A or B");

  const unnecessaryClarification = rowById(graded, 102);
  assert.equal(unnecessaryClarification.baselineAnswerability, "unnecessary_clarification");
  assert.equal(unnecessaryClarification.factual_correctness.grade, "C");
  assert.ok(
    unnecessaryClarification.root_cause_labels.includes("unnecessary_clarification"),
    "Expected unnecessary_clarification root-cause label"
  );
});

test("semantic conformance fixture catches strict semantic/raw regression drift", async () => {
  const { graded } = await gradeFixtureRows({
    inputFixture: "semantic.fixture.json",
    rubricFixture: "semantic.rubric.json"
  });

  const row = rowById(graded, 201);
  assert.equal(row.factual_correctness.grade, "A");
  assert.equal(row.completeness.grade, "C");
  assert.ok(["A", "B"].includes(row.clarity.grade), "clarity must be A or B");
  assert.ok(
    row.root_cause_labels.includes("semantic_contract_missed"),
    "Expected semantic_contract_missed root-cause label"
  );
  assert.ok(
    row.root_cause_labels.includes("raw_table_regression"),
    "Expected raw_table_regression root-cause label"
  );
});

test("synthesis/root-cause fixture catches row-dump and evidence handling regressions", async () => {
  const { graded } = await gradeFixtureRows({
    inputFixture: "synthesis.fixture.json",
    rubricFixture: "synthesis.rubric.json"
  });

  const rowDump = rowById(graded, 301);
  assert.ok(
    rowDump.root_cause_labels.includes("structured_rows_summarized"),
    "Expected structured_rows_summarized root-cause label"
  );

  const strategyEvidence = rowById(graded, 302);
  assert.ok(
    strategyEvidence.root_cause_labels.includes("evidence_required_for_strategy_claim"),
    "Expected evidence_required_for_strategy_claim root-cause label"
  );
  assert.ok(
    strategyEvidence.root_cause_labels.includes("insufficient_evidence_handling"),
    "Expected insufficient_evidence_handling root-cause label"
  );

  const stopCount = rowById(graded, 303);
  assert.ok(
    stopCount.root_cause_labels.includes("stop_count_consistent_with_stints"),
    "Expected stop_count_consistent_with_stints root-cause label"
  );
  assert.ok(
    stopCount.root_cause_labels.includes("synthesis_contradiction"),
    "Expected synthesis_contradiction root-cause label"
  );
});

test("report generation fixture preserves summary/output shape", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "openf1-grading-regression-"));
  const inputPath = path.join(fixturesDir, "report.fixture.json");
  const rubricPath = path.join(fixturesDir, "report.rubric.json");

  const run = spawnSync(process.execPath, [gradeScriptPath, "--input", inputPath, "--rubric", rubricPath], {
    cwd,
    encoding: "utf8"
  });
  assert.equal(run.status, 0, `grade script failed: ${run.stderr || run.stdout}`);

  const logsDir = path.join(cwd, "logs");
  const files = await readdir(logsDir);
  const mergedFile = files
    .filter((name) => /^chat_health_check_baseline_.*\.json$/i.test(name) && !name.includes(".summary."))
    .sort()
    .pop();
  const markdownFile = files
    .filter((name) => /^chat_health_check_baseline_.*\.md$/i.test(name))
    .sort()
    .pop();

  assert.ok(mergedFile, "Expected merged graded json output file");
  assert.ok(markdownFile, "Expected markdown output file");

  const merged = JSON.parse(await readFile(path.join(logsDir, mergedFile), "utf8"));
  assert.ok(typeof merged === "object" && !Array.isArray(merged), "Expected merged JSON object root");
  assert.ok(merged.summary?.factualCorrectnessCounts, "Missing summary.factualCorrectnessCounts");
  assert.ok(merged.summary?.completenessCounts, "Missing summary.completenessCounts");
  assert.ok(merged.summary?.clarityCounts, "Missing summary.clarityCounts");
  assert.ok(merged.summary?.answerability, "Missing summary.answerability");
  assert.ok(merged.summary?.rootCauseCounts, "Missing summary.rootCauseCounts");
  assert.ok(merged.actionable?.factual_correctness_grade_counts, "Missing actionable.factual_correctness_grade_counts");
  assert.ok(merged.actionable?.completeness_grade_counts, "Missing actionable.completeness_grade_counts");
  assert.ok(merged.actionable?.clarity_grade_counts, "Missing actionable.clarity_grade_counts");
  assert.ok(merged.actionable?.answerability_outcome_counts, "Missing actionable.answerability_outcome_counts");
  assert.ok(merged.actionable?.root_cause_label_counts, "Missing actionable.root_cause_label_counts");
  assert.ok(Array.isArray(merged.actionable?.root_cause_priority), "Missing actionable.root_cause_priority");

  assert.ok(Array.isArray(merged.results), "Expected merged.results array");
  assert.ok(merged.results.length > 0, "Expected merged.results to be non-empty");
  const sampleRow = merged.results[0];
  assert.ok("factual_correctness" in sampleRow, "Missing factual_correctness field");
  assert.ok("completeness" in sampleRow, "Missing completeness field");
  assert.ok("clarity" in sampleRow, "Missing clarity field");
  assert.ok(["A", "B", "C"].includes(sampleRow.factual_correctness.grade), "factual_correctness.grade must be A/B/C");
  assert.ok(["A", "B", "C"].includes(sampleRow.completeness.grade), "completeness.grade must be A/B/C");
  assert.ok(["A", "B"].includes(sampleRow.clarity.grade), "clarity.grade must be A or B");
  assert.ok(typeof sampleRow.factual_correctness.reason === "string" && sampleRow.factual_correctness.reason.length > 0, "factual_correctness.reason must be non-empty string");
  assert.ok(typeof sampleRow.completeness.reason === "string" && sampleRow.completeness.reason.length > 0, "completeness.reason must be non-empty string");
  assert.ok(typeof sampleRow.clarity.reason === "string" && sampleRow.clarity.reason.length > 0, "clarity.reason must be non-empty string");
  assert.ok("baselineAnswerability" in sampleRow, "Missing baselineAnswerability field");
  assert.ok("root_cause_labels" in sampleRow, "Missing root_cause_labels field");
  assert.ok("baselineReason" in sampleRow, "Missing baselineReason field");

  const markdown = await readFile(path.join(logsDir, markdownFile), "utf8");
  assert.match(markdown, /Factual Correctness/i);
  assert.match(markdown, /Completeness/i);
  assert.match(markdown, /Clarity/i);
  assert.match(markdown, /Answerability/i);
  assert.match(markdown, /Root Causes/i);
});
