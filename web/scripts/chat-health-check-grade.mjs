import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  gradeHealthCheckResults,
  loadBaselineRubric,
  summarizeBaselineGrades
} from "./chat-health-check-baseline.mjs";

const projectRoot = process.cwd();
const logsDir = path.join(projectRoot, "logs");

function nowStamp() {
  const iso = new Date().toISOString();
  return iso.replace(/[:.]/g, "-");
}

function escapeMarkdown(text) {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    input: null,
    rubricPath: path.join(projectRoot, "scripts", "chat-health-check.rubric.json")
  };
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "--input" || args[i] === "-i") && args[i + 1]) {
      parsed.input = args[i + 1];
      i += 1;
      continue;
    }
    if ((args[i] === "--rubric" || args[i] === "-r") && args[i + 1]) {
      parsed.rubricPath = path.resolve(args[i + 1]);
      i += 1;
    }
  }
  return parsed;
}

function sortCountEntries(counts) {
  return Object.entries(counts ?? {}).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
}

function formatQuestionIdList(ids, maxItems = 8) {
  const sorted = [...(ids ?? [])].sort((a, b) => a - b);
  if (sorted.length <= maxItems) {
    return sorted.join(", ");
  }
  return `${sorted.slice(0, maxItems).join(", ")} +${sorted.length - maxItems} more`;
}

function buildActionableSummary(results, baselineSummary) {
  const questionIdsByRootCause = new Map();
  for (const row of results) {
    const labels = Array.isArray(row.root_cause_labels) ? row.root_cause_labels : [];
    for (const label of labels) {
      if (!questionIdsByRootCause.has(label)) {
        questionIdsByRootCause.set(label, new Set());
      }
      questionIdsByRootCause.get(label).add(Number(row.id));
    }
  }

  const rootCausePriority = sortCountEntries(baselineSummary.rootCauseCounts).map(([label, count]) => ({
    label,
    count,
    question_ids: Array.from(questionIdsByRootCause.get(label) ?? []).sort((a, b) => a - b)
  }));

  return {
    answer_grade_counts: baselineSummary.answerGradeCounts ?? {},
    semantic_conformance_grade_counts: baselineSummary.semanticConformanceGradeCounts ?? {},
    answerability_outcome_counts: baselineSummary.answerability ?? {},
    root_cause_label_counts: baselineSummary.rootCauseCounts ?? {},
    root_cause_priority: rootCausePriority
  };
}

async function findLatestHealthCheckJson() {
  const files = await readdir(logsDir);
  const candidates = files
    .filter((name) => /^chat_health_check_.*\.json$/i.test(name))
    .sort((a, b) => b.localeCompare(a));
  if (candidates.length === 0) {
    throw new Error("No chat health-check JSON files found in logs/.");
  }
  return path.join(logsDir, candidates[0]);
}

function buildMarkdownReport(inputPath, results, baselineSummary, rubricPath) {
  const lines = [];
  lines.push("# Chat Health Check Baseline Regrade");
  lines.push("");
  lines.push(`Source file: \`${inputPath}\``);
  lines.push(`Rubric: \`${rubricPath}\``);
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`Total questions: ${results.length}`);
  lines.push(`Baseline grades: ${Object.entries(baselineSummary.gradeCounts).map(([g, c]) => `${g}=${c}`).join(", ")}`);
  lines.push(
    `Answer grades: ${sortCountEntries(baselineSummary.answerGradeCounts ?? {})
      .map(([g, c]) => `${g}=${c}`)
      .join(", ")}`
  );
  lines.push(
    `Semantic conformance grades: ${sortCountEntries(baselineSummary.semanticConformanceGradeCounts ?? {})
      .map(([g, c]) => `${g}=${c}`)
      .join(", ")}`
  );
  lines.push(
    `Answerability outcomes: ${sortCountEntries(baselineSummary.answerability)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`
  );
  const rootCausePairs = sortCountEntries(baselineSummary.rootCauseCounts ?? {});
  if (rootCausePairs.length) {
    lines.push(`Root causes: ${rootCausePairs.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  lines.push("");
  const actionable = buildActionableSummary(results, baselineSummary);
  if (actionable.root_cause_priority.length > 0) {
    lines.push("## Fix Priorities");
    lines.push("");
    for (const issue of actionable.root_cause_priority.slice(0, 8)) {
      lines.push(`- ${issue.label}: ${issue.count} row(s) (Q${formatQuestionIdList(issue.question_ids)})`);
    }
    lines.push("");
  }

  lines.push("## Matrix");
  lines.push("");
  lines.push(
    "| ID | Baseline | Answer Grade | Semantic Grade | Answerability | Root Causes | Quality | Original Adequacy | Rows | Session | Question | Baseline Reason | Semantic Reason |"
  );
  lines.push("|---:|---|---|---|---|---|---|---|---:|---:|---|---|---|");
  for (const item of results) {
    lines.push(
      `| ${item.id} | ${escapeMarkdown(item.baselineGrade)} | ${escapeMarkdown(item.answer_grade ?? "")} | ${escapeMarkdown(item.semantic_conformance_grade ?? "")} | ${escapeMarkdown(item.baselineAnswerability)} | ${escapeMarkdown((item.root_cause_labels ?? []).join(", "))} | ${escapeMarkdown(item.baselineQuality)} | ${escapeMarkdown(item.adequacyGrade ?? "")} | ${item.rowCount ?? ""} | ${item.sessionKey ?? ""} | ${escapeMarkdown(item.question)} | ${escapeMarkdown(item.baselineReason)} | ${escapeMarkdown(item.semantic_conformance_reason ?? "")} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  const inputPath = args.input ? path.resolve(args.input) : await findLatestHealthCheckJson();

  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(rows)) {
    throw new Error("Input JSON must be an array of health-check result rows.");
  }

  const rubric = await loadBaselineRubric(args.rubricPath);
  const graded = gradeHealthCheckResults(rows, rubric.rubricById);
  const baselineSummary = summarizeBaselineGrades(graded);
  const actionable = buildActionableSummary(graded, baselineSummary);

  await mkdir(logsDir, { recursive: true });
  const stamp = nowStamp();
  const outJson = path.join(logsDir, `chat_health_check_baseline_${stamp}.json`);
  const outSummaryJson = path.join(logsDir, `chat_health_check_baseline_${stamp}.summary.json`);
  const outMd = path.join(logsDir, `chat_health_check_baseline_${stamp}.md`);

  await writeFile(outJson, JSON.stringify(graded, null, 2), "utf8");
  await writeFile(
    outSummaryJson,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceFile: inputPath,
        rubricPath: rubric.rubricPath,
        gradingModel: "answer_semantic_split_v1",
        summary: baselineSummary,
        actionable
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(outMd, buildMarkdownReport(inputPath, graded, baselineSummary, rubric.rubricPath), "utf8");

  process.stdout.write(`Wrote ${outJson}\n`);
  process.stdout.write(`Wrote ${outSummaryJson}\n`);
  process.stdout.write(`Wrote ${outMd}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
