#!/usr/bin/env node
// Phase 19-D (rev3-rev8): two-layer category regression gate. Reads:
//   - graded healthcheck JSON (--graded <path>): output of
//     gradeHealthCheckResults() carrying baselineGrade, factual_correctness,
//     completeness, clarity per question
//   - category_a_rate_floors.json: per-category A-rate minimums
//   - slices_status.json: machine-readable slice merge registry
//
// Two layers:
//   1. Category-level: A-rate per category vs declared floor (rev2).
//   2. Per-question: each question's `expected_grade_floor` (string or
//      object form with optional axis floors) vs the question's
//      `baselineGrade` (rev3 — NOT `adequacyGrade`).
//
// Activation lifecycle (rev3 + rev4 + rev5 + rev6):
//   - `floor_active_after_slice` defers per-question floor enforcement
//     until the named slice has flipped to "merged" in slices_status.json.
//   - rev5: at startup, every non-null `floor_active_after_slice` MUST
//     resolve to a row in the registry; unknowns fail the gate.
//   - rev4 cleanup-or-fail: a slice marked "merged" must have its
//     `floor_active_after_slice` cleanup applied — the gate fails if
//     any question still references a "merged" slice.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_FLOORS_PATH = path.resolve(__dirname, "category_a_rate_floors.json");
const DEFAULT_STATUS_PATH = path.resolve(REPO_ROOT, "diagnostic/slices_status.json");
const QUESTIONS_DIR = __dirname;

const GRADE_RANK = { A: 3, B: 2, C: 1 };

// Phase 19-D codex audit (HIGH): proprietary-phrase lint. Mirrors the
// PROPRIETARY_NO_DATA_TOPICS list in
// web/src/lib/chatRuntime/proprietaryNoData.ts. Any question outside
// `chat-health-check.questions.proprietary_no_data.json` that matches
// one of these phrases would silently route to the no_data_refusal
// arm at runtime regardless of declared `expected_path`, gameably
// satisfying the gate while never exercising the analytics layer.
const PROPRIETARY_PHRASES = [
  "brake temperature",
  "brake temp",
  "tyre temperature",
  "tire temperature",
  "battery state",
  "battery soc",
  "battery charge",
  "ers deployment",
  "ers harvest",
  "fuel mass",
  "fuel burn",
  "fuel load",
  "steering angle",
  "slip angle",
  "slip ratio",
  "damage state",
  "front-wing damage",
  "front wing damage",
  "engine rpm",
  "shift map",
  "differential setting",
  "diff setting"
];

function buildProprietaryPattern(phrase) {
  const escaped = phrase
    .toLowerCase()
    .replace(/[\\.*+?^${}()|[\]]/g, "\\$&")
    .replace(/[\s-]+/g, "[\\s-]+");
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");
}
const PROPRIETARY_PATTERNS = PROPRIETARY_PHRASES.map((phrase) => ({
  phrase,
  pattern: buildProprietaryPattern(phrase)
}));

async function lintProprietaryPhrasesInQuestionFiles() {
  const violations = [];
  let entries;
  try {
    entries = await readdir(QUESTIONS_DIR);
  } catch {
    return violations;
  }
  for (const name of entries) {
    if (!/^chat-health-check\.questions\.[a-z_]+\.json$/.test(name)) continue;
    if (name.includes("proprietary_no_data")) continue;
    if (name.includes("casual_") || name.includes("variant_") || name.includes("llm_contracts")) continue;
    let blob;
    try {
      blob = JSON.parse(await readFile(path.join(QUESTIONS_DIR, name), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(blob)) continue;
    for (const entry of blob) {
      const q = String(entry.question ?? "").toLowerCase();
      for (const { phrase, pattern } of PROPRIETARY_PATTERNS) {
        if (pattern.test(q)) {
          violations.push({ file: name, id: entry.id, phrase, question: entry.question });
          break;
        }
      }
    }
  }
  return violations;
}

function meetsGrade(actual, floor) {
  const a = GRADE_RANK[actual] ?? 0;
  const f = GRADE_RANK[floor] ?? 0;
  return a >= f;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    gradedPaths: [],
    floorsPath: DEFAULT_FLOORS_PATH,
    statusPath: DEFAULT_STATUS_PATH,
    verbose: false
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = args[i + 1];
    if ((a === "--graded" || a === "-g") && next) {
      out.gradedPaths.push(path.resolve(next));
      i += 1;
    } else if (a === "--floors" && next) {
      out.floorsPath = path.resolve(next);
      i += 1;
    } else if (a === "--status" && next) {
      out.statusPath = path.resolve(next);
      i += 1;
    } else if (a === "--verbose" || a === "-v") {
      out.verbose = true;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else {
      // Positional graded paths.
      out.gradedPaths.push(path.resolve(a));
    }
  }
  return out;
}

function printUsage() {
  process.stdout.write(`category_regression_gate.mjs — Phase 19-D PR-time gate

Usage:
  node category_regression_gate.mjs [--graded <path>...] [--floors <path>] [--status <path>] [-v]

Reads graded healthcheck JSON files and asserts:
  1. Per-category A-rate >= declared floor in category_a_rate_floors.json
  2. Per-question baselineGrade >= expected_grade_floor (with rev5 unknown-slice
     fail-fast and rev4 cleanup-or-fail backstop)

Exits 0 on pass, non-zero on any fail.
`);
}

async function loadJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

function flattenGraded(loaded) {
  // Loaded JSONs may be either a top-level array of graded rows OR an
  // object with `results` / `graded` arrays. Accept both shapes.
  const out = [];
  for (const blob of loaded) {
    if (Array.isArray(blob)) {
      out.push(...blob);
    } else if (Array.isArray(blob?.results)) {
      out.push(...blob.results);
    } else if (Array.isArray(blob?.graded)) {
      out.push(...blob.graded);
    } else {
      throw new Error(
        `unrecognized graded JSON shape: expected array OR {results}/{graded}, got ${typeof blob}`
      );
    }
  }
  return out;
}

function categoryKey(question) {
  // category names in question files are human-readable (e.g. "Track
  // dominance", "Lap pace and fastest-lap analysis"). The floors file
  // uses lowercase short keys. We match by exact key first, then fall
  // through to a snake-case-then-prefix-token heuristic.
  const raw = String(question.category ?? "").trim();
  return raw;
}

function lookupFloor(floors, category) {
  if (!category) return floors.default_floor ?? 0;
  const direct = floors.categories?.[category];
  if (direct?.floor !== undefined) return direct.floor;
  const lower = category.toLowerCase();
  if (floors.categories?.[lower]?.floor !== undefined) return floors.categories[lower].floor;
  // Try first-token snake-case (e.g. "Track dominance" → "track").
  const firstToken = lower.replace(/[^a-z0-9_]+/g, "_").split("_")[0];
  if (firstToken && floors.categories?.[firstToken]?.floor !== undefined) {
    return floors.categories[firstToken].floor;
  }
  return floors.default_floor ?? 0;
}

function defaultFloorForComplexity(complexity) {
  if (complexity === "high") return "B";
  return "A"; // low / medium / unknown
}

function normalizeFloorShape(floor, complexity) {
  if (floor === undefined || floor === null) {
    return { baselineGrade: defaultFloorForComplexity(complexity), axes: {} };
  }
  if (typeof floor === "string") {
    return { baselineGrade: floor, axes: {} };
  }
  return {
    baselineGrade: floor.baselineGrade ?? defaultFloorForComplexity(complexity),
    axes: floor.axes ?? {}
  };
}

export async function runRegressionGate(options) {
  const opts = options ?? parseArgs();
  if (opts.gradedPaths.length === 0) {
    process.stderr.write(
      "category_regression_gate: no --graded files supplied — pass at least one graded healthcheck JSON.\n"
    );
    return { exitCode: 2, reason: "no_graded_files" };
  }

  const floors = await loadJson(opts.floorsPath);
  const status = await loadJson(opts.statusPath);
  const sliceById = new Map(status.slices.map((s) => [s.slice_id, s]));

  // Phase 19-D codex audit (HIGH): proprietary-phrase lint. Runs at
  // gate startup so a question that would silently route to the
  // no_data_refusal arm cannot reach the per-question floor check.
  const proprietaryViolations = await lintProprietaryPhrasesInQuestionFiles();
  if (proprietaryViolations.length > 0) {
    process.stderr.write(
      `category_regression_gate: FAIL — ${proprietaryViolations.length} non-proprietary question(s) contain PROPRIETARY_NO_DATA_TOPICS phrases:\n`
    );
    for (const v of proprietaryViolations) {
      process.stderr.write(
        `  ${v.file}#${v.id}: matched "${v.phrase}" in: ${v.question}\n`
      );
    }
    return { exitCode: 5, reason: "proprietary_phrase_leakage", proprietaryViolations };
  }

  const grades = flattenGraded(await Promise.all(opts.gradedPaths.map(loadJson)));

  // rev5 fail-fast: every non-null `floor_active_after_slice` MUST
  // resolve to a row in the registry. Typos or never-landed slice ids
  // would otherwise silently suppress the per-question floor forever.
  const unknownSliceRefs = [];
  for (const q of grades) {
    const slice = q.floor_active_after_slice;
    if (slice && !sliceById.has(slice)) {
      unknownSliceRefs.push({ id: q.id, category: q.category, slice_id: slice });
    }
  }
  if (unknownSliceRefs.length > 0) {
    process.stderr.write(
      `category_regression_gate: FAIL — ${unknownSliceRefs.length} unknown slice id(s) in floor_active_after_slice:\n`
    );
    for (const r of unknownSliceRefs) {
      process.stderr.write(`  question ${r.id} [${r.category}] → ${r.slice_id}\n`);
    }
    return { exitCode: 3, reason: "unknown_slice_id", unknownSliceRefs };
  }

  // rev4 cleanup-or-fail: a slice marked "merged" must have its
  // floor_active_after_slice cleaned up on every question targeting it.
  const cleanupViolations = [];
  for (const q of grades) {
    const slice = q.floor_active_after_slice;
    if (!slice) continue;
    const sliceRow = sliceById.get(slice);
    if (sliceRow?.status === "merged") {
      cleanupViolations.push({ id: q.id, category: q.category, slice_id: slice });
    }
  }
  if (cleanupViolations.length > 0) {
    process.stderr.write(
      `category_regression_gate: FAIL — ${cleanupViolations.length} question(s) still reference merged slice(s) via floor_active_after_slice (cleanup commit forgotten):\n`
    );
    for (const r of cleanupViolations) {
      process.stderr.write(`  question ${r.id} [${r.category}] → ${r.slice_id} (status: merged)\n`);
    }
    return { exitCode: 4, reason: "cleanup_or_fail", cleanupViolations };
  }

  // Layer 1: category-level A-rate.
  const categoryStats = new Map();
  for (const q of grades) {
    const cat = categoryKey(q);
    const stat = categoryStats.get(cat) ?? { total: 0, aCount: 0 };
    stat.total += 1;
    if (q.baselineGrade === "A") stat.aCount += 1;
    categoryStats.set(cat, stat);
  }

  const categoryFails = [];
  for (const [cat, stat] of categoryStats.entries()) {
    const floor = lookupFloor(floors, cat);
    const aRate = stat.total === 0 ? 0 : stat.aCount / stat.total;
    if (aRate < floor - 1e-9) {
      categoryFails.push({
        category: cat,
        aCount: stat.aCount,
        total: stat.total,
        aRate,
        floor
      });
    }
  }

  // Layer 2: per-question floor.
  const perQuestionFails = [];
  const skippedDueToActivation = [];
  for (const q of grades) {
    const slice = q.floor_active_after_slice;
    if (slice) {
      const sliceRow = sliceById.get(slice);
      if (!sliceRow || sliceRow.status !== "merged") {
        skippedDueToActivation.push({
          id: q.id,
          category: q.category,
          slice_id: slice,
          status: sliceRow?.status ?? "unknown"
        });
        continue;
      }
    }
    const floor = normalizeFloorShape(q.expected_grade_floor, q.complexity);
    if (!meetsGrade(q.baselineGrade, floor.baselineGrade)) {
      perQuestionFails.push({
        id: q.id,
        category: q.category,
        question_preview: String(q.question ?? "").slice(0, 80),
        measured: q.baselineGrade,
        floor: floor.baselineGrade,
        slice_id: slice ?? null,
        axis: "baselineGrade"
      });
      continue;
    }
    for (const [axisName, axisFloor] of Object.entries(floor.axes)) {
      const measured = q[axisName]?.grade ?? null;
      if (measured && !meetsGrade(measured, axisFloor)) {
        perQuestionFails.push({
          id: q.id,
          category: q.category,
          question_preview: String(q.question ?? "").slice(0, 80),
          measured,
          floor: axisFloor,
          slice_id: slice ?? null,
          axis: axisName
        });
      }
    }
  }

  // Reporting.
  const out = process.stdout;
  out.write("# category_regression_gate report\n");
  out.write(`Graded files: ${opts.gradedPaths.length}\n`);
  out.write(`Total graded questions: ${grades.length}\n`);
  out.write(`Categories observed: ${categoryStats.size}\n`);
  out.write(`Per-question checks skipped (activation lifecycle): ${skippedDueToActivation.length}\n`);
  out.write("\n");

  if (categoryFails.length > 0) {
    out.write(`## Category-level fails (${categoryFails.length})\n`);
    for (const f of categoryFails) {
      out.write(
        `  - ${f.category}: ${f.aCount}/${f.total} A (${(f.aRate * 100).toFixed(1)}%) < floor ${(f.floor * 100).toFixed(1)}%\n`
      );
    }
    out.write("\n");
  } else {
    out.write("## Category-level: all categories meet their floors\n\n");
  }

  if (perQuestionFails.length > 0) {
    out.write(`## Per-question fails (${perQuestionFails.length})\n`);
    for (const f of perQuestionFails) {
      out.write(
        `  - id=${f.id} [${f.category}] axis=${f.axis} measured=${f.measured} floor=${f.floor}${f.slice_id ? ` (after-slice: ${f.slice_id})` : ""}\n    "${f.question_preview}"\n`
      );
    }
    out.write("\n");
  } else {
    out.write("## Per-question: all questions meet their floors\n\n");
  }

  if (opts.verbose && skippedDueToActivation.length > 0) {
    out.write(`## Skipped due to activation lifecycle (${skippedDueToActivation.length})\n`);
    for (const s of skippedDueToActivation) {
      out.write(`  - id=${s.id} [${s.category}] waiting on ${s.slice_id} (status: ${s.status})\n`);
    }
    out.write("\n");
  }

  const exitCode = categoryFails.length > 0 || perQuestionFails.length > 0 ? 1 : 0;
  out.write(exitCode === 0 ? "RESULT: PASS\n" : "RESULT: FAIL\n");
  return {
    exitCode,
    reason: exitCode === 0 ? "pass" : "regression",
    categoryFails,
    perQuestionFails,
    skippedDueToActivation
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1] === __filename;
if (isMain) {
  const result = await runRegressionGate();
  process.exit(result.exitCode);
}
