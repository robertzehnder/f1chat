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
  assert.equal(expectedClarification.answer_grade, "A");
  assert.equal(expectedClarification.semantic_conformance_grade, "A");

  const unnecessaryClarification = rowById(graded, 102);
  assert.equal(unnecessaryClarification.baselineAnswerability, "unnecessary_clarification");
  assert.equal(unnecessaryClarification.answer_grade, "C");
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
  assert.equal(row.answer_grade, "A");
  assert.equal(row.semantic_conformance_grade, "C");
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
  const summaryFile = files
    .filter((name) => /^chat_health_check_baseline_.*\.summary\.json$/i.test(name))
    .sort()
    .pop();
  const gradedFile = files
    .filter((name) => /^chat_health_check_baseline_.*\.json$/i.test(name) && !name.includes(".summary."))
    .sort()
    .pop();
  const markdownFile = files
    .filter((name) => /^chat_health_check_baseline_.*\.md$/i.test(name))
    .sort()
    .pop();

  assert.ok(summaryFile, "Expected summary json output file");
  assert.ok(gradedFile, "Expected graded json output file");
  assert.ok(markdownFile, "Expected markdown output file");

  const summary = JSON.parse(await readFile(path.join(logsDir, summaryFile), "utf8"));
  assert.ok(summary.summary?.answerGradeCounts, "Missing summary.answerGradeCounts");
  assert.ok(summary.summary?.semanticConformanceGradeCounts, "Missing summary.semanticConformanceGradeCounts");
  assert.ok(summary.summary?.answerability, "Missing summary.answerability");
  assert.ok(summary.summary?.rootCauseCounts, "Missing summary.rootCauseCounts");
  assert.ok(summary.actionable?.answer_grade_counts, "Missing actionable.answer_grade_counts");
  assert.ok(
    summary.actionable?.semantic_conformance_grade_counts,
    "Missing actionable.semantic_conformance_grade_counts"
  );
  assert.ok(summary.actionable?.answerability_outcome_counts, "Missing actionable.answerability_outcome_counts");
  assert.ok(summary.actionable?.root_cause_label_counts, "Missing actionable.root_cause_label_counts");
  assert.ok(Array.isArray(summary.actionable?.root_cause_priority), "Missing actionable.root_cause_priority");

  const gradedRows = JSON.parse(await readFile(path.join(logsDir, gradedFile), "utf8"));
  assert.ok(Array.isArray(gradedRows), "Expected graded rows array");
  assert.ok(gradedRows.length > 0, "Expected graded rows to be non-empty");
  const sampleRow = gradedRows[0];
  assert.ok("answer_grade" in sampleRow, "Missing answer_grade field");
  assert.ok("semantic_conformance_grade" in sampleRow, "Missing semantic_conformance_grade field");
  assert.ok("baselineAnswerability" in sampleRow, "Missing baselineAnswerability field");
  assert.ok("root_cause_labels" in sampleRow, "Missing root_cause_labels field");
  assert.ok("baselineReason" in sampleRow, "Missing baselineReason field");
  assert.ok("semantic_conformance_reason" in sampleRow, "Missing semantic_conformance_reason field");

  const markdown = await readFile(path.join(logsDir, markdownFile), "utf8");
  assert.match(markdown, /Answer Grade/i);
  assert.match(markdown, /Semantic Grade/i);
  assert.match(markdown, /Answerability/i);
  assert.match(markdown, /Root Causes/i);
});
