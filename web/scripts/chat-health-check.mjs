import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  gradeHealthCheckResults,
  loadBaselineRubric,
  summarizeBaselineGrades
} from "./chat-health-check-baseline.mjs";

const baseUrl = process.env.OPENF1_CHAT_BASE_URL ?? "http://127.0.0.1:3000";
const projectRoot = process.cwd();
const logsDir = path.join(projectRoot, "logs");
const defaultQuestionsPath = path.join(projectRoot, "scripts", "chat-health-check.questions.json");
const defaultRubricPath = path.join(projectRoot, "scripts", "chat-health-check.rubric.json");
const debugTraceEnabled = /^(1|true|yes|on)$/i.test(String(process.env.OPENF1_CHAT_DEBUG_TRACE ?? ""));
const debugTraceRunId = debugTraceEnabled ? `healthcheck-${nowStamp()}` : null;

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    questionsPath: defaultQuestionsPath,
    rubricPath: defaultRubricPath
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if ((arg === "--questions" || arg === "-q") && next) {
      parsed.questionsPath = path.resolve(next);
      i += 1;
      continue;
    }
    if ((arg === "--rubric" || arg === "-r") && next) {
      parsed.rubricPath = path.resolve(next);
      i += 1;
      continue;
    }
  }

  return parsed;
}

function nowStamp() {
  const iso = new Date().toISOString();
  return iso.replace(/[:.]/g, "-");
}

function escapeMarkdown(text) {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
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

function summarizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "";
  }
  const sample = rows.slice(0, 3);
  return sample
    .map((row, index) => {
      const pairs = Object.entries(row ?? {})
        .slice(0, 6)
        .map(([key, value]) => `${key}=${value === null ? "null" : String(value)}`);
      return `${index + 1}. ${pairs.join(", ")}`;
    })
    .join("\n");
}

async function loadQuestions(questionsPath) {
  const raw = await readFile(questionsPath, "utf8");
  return JSON.parse(raw);
}

async function askQuestion(question) {
  const requestChat = async (context, attempt = "initial") => {
    const startedAt = Date.now();
    const requestBody = { message: question.question, context };
    if (debugTraceEnabled) {
      requestBody.debug = {
        trace: true,
        benchmark: true,
        questionId: question.id,
        runId: debugTraceRunId,
        attempt
      };
    }
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const rawBody = await response.text();
    let payload = {};
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = {};
    }

    const fallbackErrorText = !response.ok
      ? rawBody.slice(0, 1200).replace(/\s+/g, " ").trim()
      : "";

    return {
      startedAt,
      elapsedMs: Date.now() - startedAt,
      response,
      payload,
      fallbackErrorText
    };
  };

  const firstAttempt = await requestChat(undefined, "initial");
  const finalAttempt = firstAttempt;
  const retryAttempted = false;
  const retrySessionKey = null;

  const response = finalAttempt.response;
  const payload = finalAttempt.payload;
  const fallbackErrorText = finalAttempt.fallbackErrorText;

  return {
    id: question.id,
    category: question.category,
    question: question.question,
    ok: response.ok,
    httpStatus: response.status,
    elapsedMs: finalAttempt.elapsedMs,
    retryAttempted,
    retrySessionKey,
    adequacyGrade: payload.adequacyGrade ?? payload.responseGrade ?? (response.ok ? "?" : "F"),
    adequacyReason:
      payload.adequacyReason ?? payload.gradeReason ?? "No adequacy reason returned.",
    answer: payload.answer ?? payload.error ?? fallbackErrorText,
    answerReasoning: payload.answerReasoning ?? null,
    generationNotes: payload.generationNotes ?? null,
    generationSource: payload.generationSource ?? null,
    model: payload.model ?? null,
    requestId: payload.requestId ?? null,
    rowCount: payload.result?.rowCount ?? null,
    rowSummary: summarizeRows(payload.result?.rows ?? []),
    previewRows: Array.isArray(payload.result?.rows) ? payload.result.rows.slice(0, 3) : [],
    warnings: payload.runtime?.completeness?.warnings ?? [],
    questionType: payload.runtime?.questionType ?? null,
    resolutionStatus: payload.runtime?.resolution?.status ?? null,
    sessionKey: payload.runtime?.resolution?.selectedSession?.sessionKey ?? null,
    sql: payload.sql ?? null,
    errorBodyPreview: fallbackErrorText || null
  };
}

function buildMarkdownReport(results, baselineSummary, rubricPathUsed, questionsPathUsed) {
  const lines = [];
  lines.push("# Chat Health Check");
  lines.push("");
  lines.push(`Base URL: \`${baseUrl}\``);
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push(`Questions: \`${questionsPathUsed}\``);
  lines.push(`Baseline rubric: \`${rubricPathUsed}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");

  const total = results.length;
  const gradeCounts = results.reduce((acc, item) => {
    acc[item.adequacyGrade] = (acc[item.adequacyGrade] ?? 0) + 1;
    return acc;
  }, {});

  lines.push(`Total questions: ${total}`);
  lines.push(`Grades: ${Object.entries(gradeCounts).map(([grade, count]) => `${grade}=${count}`).join(", ")}`);
  lines.push("");
  lines.push(`Baseline grades: ${Object.entries(baselineSummary.gradeCounts).map(([grade, count]) => `${grade}=${count}`).join(", ")}`);
  lines.push(
    `Answer grades: ${sortCountEntries(baselineSummary.answerGradeCounts ?? {})
      .map(([grade, count]) => `${grade}=${count}`)
      .join(", ")}`
  );
  lines.push(
    `Semantic conformance grades: ${sortCountEntries(baselineSummary.semanticConformanceGradeCounts ?? {})
      .map(([grade, count]) => `${grade}=${count}`)
      .join(", ")}`
  );
  lines.push(
    `Baseline answerability: ${sortCountEntries(baselineSummary.answerability)
      .map(([key, count]) => `${key}=${count}`)
      .join(", ")}`
  );
  const rootCausePairs = sortCountEntries(baselineSummary.rootCauseCounts ?? {});
  if (rootCausePairs.length) {
    lines.push(`Root causes: ${rootCausePairs.map(([key, count]) => `${key}=${count}`).join(", ")}`);
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
  lines.push("| ID | Category | Adequacy | Baseline | Answer Grade | Semantic Grade | Answerability | Root Causes | Status | Rows | Question Type | Session | Question | Baseline Reason | Semantic Reason | Caveats |");
  lines.push("|---:|---|---|---|---|---|---|---|---:|---:|---|---:|---|---|---|---|");

  for (const item of results) {
    lines.push(
      `| ${item.id} | ${escapeMarkdown(item.category)} | ${escapeMarkdown(item.adequacyGrade)} | ${escapeMarkdown(item.baselineGrade ?? "")} | ${escapeMarkdown(item.answer_grade ?? "")} | ${escapeMarkdown(item.semantic_conformance_grade ?? "")} | ${escapeMarkdown(item.baselineAnswerability ?? "")} | ${escapeMarkdown((item.root_cause_labels ?? []).join(", "))} | ${item.httpStatus} | ${item.rowCount ?? ""} | ${escapeMarkdown(item.questionType ?? "")} | ${item.sessionKey ?? ""} | ${escapeMarkdown(item.question)} | ${escapeMarkdown(item.baselineReason ?? "")} | ${escapeMarkdown(item.semantic_conformance_reason ?? "")} | ${escapeMarkdown(item.warnings.join(" ; "))} |`
    );
  }

  lines.push("");
  lines.push("## Detailed Results");
  lines.push("");

  for (const item of results) {
    lines.push(`### ${item.id}. ${item.question}`);
    lines.push("");
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Adequacy grade: ${item.adequacyGrade}`);
    lines.push(`- Adequacy reason: ${item.adequacyReason}`);
    lines.push(`- Baseline grade: ${item.baselineGrade ?? "n/a"}`);
    lines.push(`- Baseline reason: ${item.baselineReason ?? "n/a"}`);
    lines.push(`- Baseline answerability: ${item.baselineAnswerability ?? "n/a"}`);
    lines.push(`- Baseline quality: ${item.baselineQuality ?? "n/a"}`);
    lines.push(`- Answer grade: ${item.answer_grade ?? "n/a"}`);
    lines.push(`- Answer grade reason: ${item.answer_grade_reason ?? "n/a"}`);
    lines.push(`- Semantic conformance grade: ${item.semantic_conformance_grade ?? "n/a"}`);
    lines.push(`- Semantic conformance reason: ${item.semantic_conformance_reason ?? "n/a"}`);
    lines.push(`- Root-cause labels: ${(item.root_cause_labels ?? []).join(", ") || "n/a"}`);
    lines.push(`- HTTP status: ${item.httpStatus}`);
    lines.push(`- Elapsed ms: ${item.elapsedMs}`);
    lines.push(`- Retry attempted: ${item.retryAttempted ? "yes" : "no"}`);
    if (item.retrySessionKey) {
      lines.push(`- Retry session key: ${item.retrySessionKey}`);
    }
    lines.push(`- Request ID: ${item.requestId ?? "n/a"}`);
    lines.push(`- Question type: ${item.questionType ?? "n/a"}`);
    lines.push(`- Resolution status: ${item.resolutionStatus ?? "n/a"}`);
    lines.push(`- Session key: ${item.sessionKey ?? "n/a"}`);
    lines.push(`- Rows: ${item.rowCount ?? "n/a"}`);
    lines.push(`- Source: ${item.generationSource ?? "n/a"}`);
    lines.push(`- Model: ${item.model ?? "n/a"}`);
    if (item.answerReasoning) {
      lines.push(`- LLM row reasoning: ${item.answerReasoning}`);
    }
    if (item.generationNotes) {
      lines.push(`- LLM generation notes: ${item.generationNotes}`);
    }
    if (item.warnings.length) {
      lines.push(`- Caveats: ${item.warnings.join(" | ")}`);
    }
    if (item.rowSummary) {
      lines.push(`- Result summary: ${item.rowSummary.replace(/\n/g, " | ")}`);
    }
    lines.push("");
    lines.push("Answer:");
    lines.push("");
    lines.push(item.answer || "(empty)");
    lines.push("");
    if (item.sql) {
      lines.push("SQL:");
      lines.push("");
      lines.push("```sql");
      lines.push(item.sql);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  let rubricById = new Map();
  let rubricPathUsed = args.rubricPath;
  try {
    const loaded = await loadBaselineRubric(rubricPathUsed);
    rubricById = loaded.rubricById;
    rubricPathUsed = loaded.rubricPath;
  } catch (error) {
    process.stdout.write(
      `Warning: failed to load baseline rubric at ${rubricPathUsed}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  const questions = await loadQuestions(args.questionsPath);
  const results = [];

  for (const question of questions) {
    process.stdout.write(`Running ${question.id}/${questions.length}: ${question.question}\n`);
    try {
      const result = await askQuestion(question);
      results.push(result);

      const fatalServerFailure = !result.ok && result.httpStatus >= 500;
      const hasNoStructuredResponse = !result.requestId && !result.questionType;
      if (fatalServerFailure && hasNoStructuredResponse) {
        process.stdout.write(
          "Stopping early because /api/chat is returning server errors without structured JSON. Check your app terminal logs.\n"
        );
        break;
      }
    } catch (error) {
      results.push({
        id: question.id,
        category: question.category,
        question: question.question,
        ok: false,
        httpStatus: 0,
        elapsedMs: 0,
        retryAttempted: false,
        retrySessionKey: null,
        adequacyGrade: "F",
        adequacyReason: "Health check request failed before a response was returned.",
        answer: error instanceof Error ? error.message : String(error),
        answerReasoning: null,
        generationNotes: null,
        generationSource: null,
        model: null,
        requestId: null,
        rowCount: null,
        rowSummary: "",
        previewRows: [],
        warnings: [],
        questionType: null,
        resolutionStatus: null,
        sessionKey: null,
        sql: null
      });
    }
  }

  await mkdir(logsDir, { recursive: true });
  const stamp = nowStamp();
  const jsonPath = path.join(logsDir, `chat_health_check_${stamp}.json`);
  const summaryJsonPath = path.join(logsDir, `chat_health_check_${stamp}.summary.json`);
  const mdPath = path.join(logsDir, `chat_health_check_${stamp}.md`);
  const gradedResults = gradeHealthCheckResults(results, rubricById);
  const baselineSummary = summarizeBaselineGrades(gradedResults);
  const actionable = buildActionableSummary(gradedResults, baselineSummary);

  await writeFile(jsonPath, JSON.stringify(gradedResults, null, 2), "utf8");
  await writeFile(
    summaryJsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        questionsPath: args.questionsPath,
        rubricPath: rubricPathUsed,
        gradingModel: "answer_semantic_split_v1",
        summary: baselineSummary,
        actionable
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    mdPath,
    buildMarkdownReport(gradedResults, baselineSummary, rubricPathUsed, args.questionsPath),
    "utf8"
  );

  process.stdout.write(`Wrote ${jsonPath}\n`);
  process.stdout.write(`Wrote ${summaryJsonPath}\n`);
  process.stdout.write(`Wrote ${mdPath}\n`);
  if (debugTraceEnabled) {
    process.stdout.write(
      `Debug trace enabled. Query traces appended to ${path.join(logsDir, "chat_query_trace.jsonl")} (runId=${debugTraceRunId}).\n`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
