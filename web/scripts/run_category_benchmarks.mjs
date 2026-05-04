#!/usr/bin/env node
// Phase 19-B: per-category benchmark runner. Reuses the existing
// chat-health-check transport so cacheHit / sqlElapsedMs / spans
// capture is uniform with the curated 50-question baseline.
//
// Usage:
//   node run_category_benchmarks.mjs --category dominance,corner,braking
//   node run_category_benchmarks.mjs --category all
//   node run_category_benchmarks.mjs --category all --out diagnostic/phase_19_baseline_2026-05-02.json
//
// The runner loads `chat-health-check.questions.<category>.json` for
// each named category, runs every question through the local dev
// server, runs gradeHealthCheckResults, and writes per-category
// result JSONs (and an aggregate when run on `all`).

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradeHealthCheckResults,
  loadBaselineRubric,
  summarizeBaselineGrades
} from "./chat-health-check-baseline.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.cwd();
const baseUrl = process.env.OPENF1_CHAT_BASE_URL ?? "http://127.0.0.1:3000";
const defaultRubricPath = path.join(projectRoot, "scripts", "chat-health-check.rubric.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    categories: [],
    rubricPath: defaultRubricPath,
    outPath: null,
    dryRun: false,
    // Phase 19 outcome-fix Fix 6: optional path to a per-run snapshot
    // of `core.session_completeness` captured by phase19_baseline_run.py.
    // When supplied, the grader uses it to classify proven-data-
    // unavailable vs wrong-filter on 0-row outcomes. When absent, the
    // grader fail-safes to 'unknown' / C.
    completenessSnapshotPath: null,
    // Phase 24-A: per-question iteration mode. When set, only the
    // listed question IDs run; categories arg is ignored. Output goes
    // to a question-iteration JSON file.
    questionIds: null,
    // Phase 24-A: how many times to re-run each question; final grade
    // is the BEST grade across attempts. Default 1 (no debounce).
    retries: 1
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = args[i + 1];
    if ((a === "--category" || a === "-c") && next) {
      out.categories = next === "all" ? ["all"] : next.split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if ((a === "--rubric" || a === "-r") && next) {
      out.rubricPath = path.resolve(next);
      i += 1;
    } else if ((a === "--out" || a === "-o") && next) {
      out.outPath = path.resolve(next);
      i += 1;
    } else if (a === "--completeness-snapshot" && next) {
      out.completenessSnapshotPath = path.resolve(next);
      i += 1;
    } else if (a === "--question" && next) {
      out.questionIds = next.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      i += 1;
    } else if (a === "--retries" && next) {
      const n = Number(next);
      out.retries = Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
      i += 1;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    }
  }
  if (out.categories.length === 0) {
    out.categories = ["all"];
  }
  return out;
}

async function discoverCategoryFiles() {
  const scriptsDir = path.join(projectRoot, "scripts");
  const entries = await readdir(scriptsDir);
  const out = new Map();
  for (const entry of entries) {
    const match = /^chat-health-check\.questions\.([a-z_]+)\.json$/.exec(entry);
    if (!match) continue;
    out.set(match[1], path.join(scriptsDir, entry));
  }
  return out;
}

async function loadCategorySet(targets) {
  const all = await discoverCategoryFiles();
  const selected = targets.includes("all") ? Array.from(all.keys()) : targets;
  const missing = selected.filter((c) => !all.has(c));
  if (missing.length > 0) {
    throw new Error(
      `Unknown categories: ${missing.join(", ")}. Known: ${Array.from(all.keys()).join(", ")}`
    );
  }
  const out = [];
  for (const cat of selected) {
    const text = await readFile(all.get(cat), "utf8");
    const questions = JSON.parse(text);
    out.push({ category: cat, path: all.get(cat), questions });
  }
  return out;
}

async function askQuestion(question) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question.question })
  });
  const rawBody = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = {};
  }
  const fallbackErrorText = !response.ok
    ? rawBody.slice(0, 1200).replace(/\s+/g, " ").trim()
    : "";
  return {
    id: question.id,
    category: question.category,
    question: question.question,
    complexity: question.complexity ?? null,
    expected_outcome: question.expected_outcome ?? null,
    expected_path: question.expected_path ?? null,
    expected_tables: question.expected_tables ?? null,
    expected_columns: question.expected_columns ?? null,
    expected_grade_floor: question.expected_grade_floor ?? null,
    floor_active_after_slice: question.floor_active_after_slice ?? null,
    column_match_waiver: question.column_match_waiver ?? null,
    author_note: question.author_note ?? null,
    ok: response.ok,
    httpStatus: response.status,
    elapsedMs: Date.now() - startedAt,
    adequacyGrade: payload.adequacyGrade ?? payload.responseGrade ?? (response.ok ? "?" : "F"),
    adequacyReason: payload.adequacyReason ?? payload.gradeReason ?? "No adequacy reason returned.",
    answer: payload.answer ?? payload.error ?? fallbackErrorText,
    answerReasoning: payload.answerReasoning ?? null,
    generationNotes: payload.generationNotes ?? null,
    generationSource: payload.generationSource ?? null,
    model: payload.model ?? null,
    requestId: payload.requestId ?? null,
    cacheHit: payload.cache_hit ?? null,
    sqlElapsedMs: payload.result?.elapsedMs ?? null,
    rowCount: payload.result?.rowCount ?? null,
    rowSummary: "",
    previewRows: Array.isArray(payload.result?.rows) ? payload.result.rows.slice(0, 3) : [],
    warnings: payload.runtime?.completeness?.warnings ?? [],
    questionType: payload.runtime?.questionType ?? null,
    resolutionStatus: payload.runtime?.resolution?.status ?? null,
    sessionKey: payload.runtime?.resolution?.selectedSession?.sessionKey ?? null,
    sql: payload.sql ?? null,
    errorBodyPreview: fallbackErrorText || null,
    matchedKeyword: payload.matchedKeyword ?? null,
    missingColumns: payload.missingColumns ?? null
  };
}

const _GRADE_RANK = { A: 3, B: 2, C: 1 };
function gradeRank(g) {
  return _GRADE_RANK[g] ?? 0;
}

async function loadQuestionsByIds(ids) {
  // Phase 24-A: load only the listed question IDs, regardless of
  // category. Used by the per-question iteration loop.
  const idSet = new Set(ids);
  const all = await discoverCategoryFiles();
  const matches = [];
  const missing = new Set(ids);
  for (const [cat, p] of all.entries()) {
    const blob = JSON.parse(await readFile(p, "utf8"));
    for (const q of blob) {
      if (idSet.has(q.id)) {
        matches.push({ ...q, _sourceCategory: cat });
        missing.delete(q.id);
      }
    }
  }
  if (missing.size > 0) {
    process.stderr.write(
      `WARN: question IDs not found in any category file: ${Array.from(missing).join(", ")}\n`
    );
  }
  return matches;
}

async function main() {
  const args = parseArgs();
  process.stdout.write(`run_category_benchmarks: base=${baseUrl}\n`);

  // Phase 24-A: per-question iteration mode short-circuits the
  // category-aware path. Only the listed IDs run; output is a flat
  // graded array with iterationAttempt per row.
  if (args.questionIds && args.questionIds.length > 0) {
    const questions = await loadQuestionsByIds(args.questionIds);
    if (questions.length === 0) {
      process.stderr.write("question-iteration mode: no matching questions found\n");
      process.exit(2);
    }
    process.stdout.write(
      `question-iteration mode: ${questions.length} question(s), ${args.retries} attempt(s) each\n`
    );
    if (args.dryRun) {
      process.stdout.write(JSON.stringify(questions.map((q) => ({ id: q.id, q: q.question })), null, 2) + "\n");
      return;
    }
    const rubric = await loadBaselineRubric(args.rubricPath);
    const rubricById = new Map();
    for (const r of rubric.questions ?? []) rubricById.set(r.id, r);
    let completenessSnapshot = null;
    if (args.completenessSnapshotPath) {
      try {
        completenessSnapshot = JSON.parse(await readFile(args.completenessSnapshotPath, "utf8"));
      } catch {
        completenessSnapshot = null;
      }
    }
    const allAttempts = [];
    for (const q of questions) {
      let bestRow = null;
      for (let attempt = 1; attempt <= args.retries; attempt += 1) {
        const row = await askQuestion(q);
        const graded = gradeHealthCheckResults([row], rubricById, { completenessSnapshot })[0];
        graded.iterationAttempt = attempt;
        allAttempts.push(graded);
        process.stdout.write(`  q${q.id} attempt ${attempt}/${args.retries} → ${graded.baselineGrade} (${graded.elapsedMs}ms)\n`);
        if (
          !bestRow ||
          gradeRank(graded.baselineGrade) > gradeRank(bestRow.baselineGrade)
        ) {
          bestRow = graded;
        }
        if (graded.baselineGrade === "A") break; // best-possible; no need to retry
      }
    }
    if (args.outPath) {
      await mkdir(path.dirname(args.outPath), { recursive: true });
      await writeFile(
        args.outPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            mode: "question-iteration",
            questionIds: args.questionIds,
            retries: args.retries,
            attempts: allAttempts
          },
          null,
          2
        ),
        "utf8"
      );
      process.stdout.write(`wrote ${args.outPath}\n`);
    }
    return;
  }

  const sets = await loadCategorySet(args.categories);
  process.stdout.write(`Loaded ${sets.length} categor${sets.length === 1 ? "y" : "ies"}: ${sets.map((s) => s.category).join(", ")}\n`);

  if (args.dryRun) {
    const total = sets.reduce((acc, s) => acc + s.questions.length, 0);
    process.stdout.write(`Dry run: ${total} questions across ${sets.length} categories. Would POST to ${baseUrl}/api/chat\n`);
    process.stdout.write(JSON.stringify(sets.map((s) => ({ category: s.category, count: s.questions.length })), null, 2) + "\n");
    return;
  }

  const rubric = await loadBaselineRubric(args.rubricPath);
  const rubricById = new Map();
  for (const r of rubric.questions ?? []) rubricById.set(r.id, r);

  // Phase 19 outcome-fix Fix 6: load the per-run completeness snapshot
  // if supplied. The grader uses it to classify proven-data-
  // unavailable vs wrong-filter on 0-row outcomes. Fail-safe: missing
  // / malformed → null → grader stays at C.
  let completenessSnapshot = null;
  if (args.completenessSnapshotPath) {
    try {
      const text = await readFile(args.completenessSnapshotPath, "utf8");
      completenessSnapshot = JSON.parse(text);
      const sessionCount = Object.keys(completenessSnapshot).length;
      process.stdout.write(`Loaded completeness snapshot (${sessionCount} sessions)\n`);
    } catch (err) {
      process.stderr.write(
        `WARN: completeness snapshot load failed (grader will fail-safe to 'unknown'): ${err instanceof Error ? err.message : String(err)}\n`
      );
      completenessSnapshot = null;
    }
  }

  const aggregateResults = [];
  const perCategorySummaries = [];
  for (const set of sets) {
    process.stdout.write(`\n## ${set.category} (${set.questions.length} questions)\n`);
    const results = [];
    for (const q of set.questions) {
      try {
        const row = await askQuestion(q);
        results.push(row);
        process.stdout.write(`  ${q.id} [${row.adequacyGrade}] ${row.elapsedMs}ms\n`);
      } catch (err) {
        process.stdout.write(`  ${q.id} ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
    const graded = gradeHealthCheckResults(results, rubricById, { completenessSnapshot });
    const summary = summarizeBaselineGrades(graded);
    perCategorySummaries.push({ category: set.category, summary });
    aggregateResults.push(...graded);

    const outDir = path.join(projectRoot, "logs");
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `category_benchmark_${set.category}_${nowStamp()}.json`);
    await writeFile(outFile, JSON.stringify({ category: set.category, results: graded, summary }, null, 2), "utf8");
    process.stdout.write(`  wrote ${outFile}\n`);
  }

  if (args.outPath) {
    await mkdir(path.dirname(args.outPath), { recursive: true });
    const aggregate = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      categories: perCategorySummaries,
      results: aggregateResults
    };
    await writeFile(args.outPath, JSON.stringify(aggregate, null, 2), "utf8");
    process.stdout.write(`\nWrote aggregate to ${args.outPath}\n`);
  }
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

main().catch((err) => {
  process.stderr.write(`run_category_benchmarks: FAIL — ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
