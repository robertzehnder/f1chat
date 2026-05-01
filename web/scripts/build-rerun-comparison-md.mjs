#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      args[key] = val;
      i++;
    }
  }
  return args;
}

function gradeRank(g) {
  if (g === "A") return 0;
  if (g === "B") return 1;
  if (g === "C") return 2;
  return 3;
}

function emptyCounts() {
  return { A: 0, B: 0, C: 0 };
}

function tally(rows, getter) {
  const c = emptyCounts();
  for (const r of rows) {
    const g = getter(r);
    if (g === "A" || g === "B" || g === "C") c[g]++;
  }
  return c;
}

function fmtCounts(c) {
  return `${c.A} / ${c.B} / ${c.C}`;
}

function fmtCountsSlash(c) {
  return `${c.A}/${c.B}/${c.C}`;
}

function parsePriorMatrix(mdPath) {
  const md = fs.readFileSync(mdPath, "utf8");
  const matrix = {};
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([A-D])\s*\|\s*([A-D])\s*\|\s*([A-D])\s*\|/);
    if (m) {
      matrix[parseInt(m[1], 10)] = {
        baseline: m[2],
        answer: m[3],
        semantic: m[4],
      };
    }
  }
  return matrix;
}

function buildCategoryCounts(rows, getCategory, getBaseline, getAnswer, getSemantic) {
  const cats = {};
  for (const r of rows) {
    const c = getCategory(r);
    if (!cats[c]) {
      cats[c] = {
        baseline: emptyCounts(),
        answer: emptyCounts(),
        semantic: emptyCounts(),
        total: 0,
      };
    }
    const b = getBaseline(r);
    const a = getAnswer(r);
    const s = getSemantic(r);
    if (b === "A" || b === "B" || b === "C") cats[c].baseline[b]++;
    if (a === "A" || a === "B" || a === "C") cats[c].answer[a]++;
    if (s === "A" || s === "B" || s === "C") cats[c].semantic[s]++;
    cats[c].total++;
  }
  return cats;
}

function categoryTable(cats, categoryOrder) {
  const lines = [];
  lines.push("| Category | Baseline A/B/C | Answer A/B/C | Semantic A/B/C | Total |");
  lines.push("|---|---|---|---|---:|");
  for (const c of categoryOrder) {
    const v = cats[c];
    if (!v) continue;
    lines.push(
      `| ${c} | ${fmtCountsSlash(v.baseline)} | ${fmtCountsSlash(v.answer)} | ${fmtCountsSlash(v.semantic)} | ${v.total} |`
    );
  }
  return lines.join("\n");
}

function rootCauseString(map) {
  const entries = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return "(none)";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["artifact", "prior-json", "prior-md", "questions", "output"];
  for (const k of required) {
    if (!args[k]) {
      console.error(`missing --${k}`);
      process.exit(1);
    }
  }

  const artifactPath = path.resolve(args.artifact);
  const priorJsonPath = path.resolve(args["prior-json"]);
  const priorMdPath = path.resolve(args["prior-md"]);
  const questionsPath = path.resolve(args.questions);
  const outputPath = path.resolve(args.output);

  const rows = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (!Array.isArray(rows)) {
    console.error("artifact is not an array of rows");
    process.exit(1);
  }
  const priorJson = JSON.parse(fs.readFileSync(priorJsonPath, "utf8"));
  const priorMatrix = parsePriorMatrix(priorMdPath);
  const questions = JSON.parse(fs.readFileSync(questionsPath, "utf8"));

  const idToCategory = {};
  const categoryOrder = [];
  for (const q of questions) {
    idToCategory[q.id] = q.category;
    if (!categoryOrder.includes(q.category)) categoryOrder.push(q.category);
  }

  const newOverallBaseline = tally(rows, (r) => r.baselineGrade);
  const newOverallAnswer = tally(rows, (r) => r.answer_grade);
  const newOverallSemantic = tally(rows, (r) => r.semantic_conformance_grade);
  const newRootCauses = {};
  for (const r of rows) {
    for (const rc of r.root_cause_labels || []) {
      newRootCauses[rc] = (newRootCauses[rc] || 0) + 1;
    }
  }

  const newCats = buildCategoryCounts(
    rows,
    (r) => r.category,
    (r) => r.baselineGrade,
    (r) => r.answer_grade,
    (r) => r.semantic_conformance_grade
  );

  const priorRows = Object.entries(priorMatrix).map(([id, g]) => ({
    id: parseInt(id, 10),
    category: idToCategory[parseInt(id, 10)] || "(unknown)",
    baseline: g.baseline,
    answer: g.answer,
    semantic: g.semantic,
  }));
  const priorCats = buildCategoryCounts(
    priorRows,
    (r) => r.category,
    (r) => r.baseline,
    (r) => r.answer,
    (r) => r.semantic
  );

  const priorOverallBaseline = priorJson.summary?.gradeCounts || emptyCounts();
  const priorOverallAnswer = priorJson.summary?.answerGradeCounts || emptyCounts();
  const priorOverallSemantic = priorJson.summary?.semanticConformanceGradeCounts || emptyCounts();
  const priorRootCauses = priorJson.summary?.rootCauseCounts || {};

  const improved = [];
  const unchanged = [];
  const regressed = [];
  const sortedRows = [...rows].sort((a, b) => a.id - b.id);
  for (const r of sortedRows) {
    const id = r.id;
    const newG = r.baselineGrade;
    const prior = priorMatrix[id];
    if (!prior) continue;
    const priorG = prior.baseline;
    const cmp = gradeRank(newG) - gradeRank(priorG);
    if (cmp < 0) improved.push({ id, prior: priorG, next: newG });
    else if (cmp === 0) unchanged.push({ id, prior: priorG, next: newG });
    else regressed.push({ id, prior: priorG, next: newG });
  }

  const generatedAt = new Date().toISOString();
  const sourceLog = rows.find((r) => r.requestId)?.requestId
    ? null
    : null;

  const lines = [];
  lines.push("# Phase 11 healthcheck rerun — comparison vs 2026-04-26 baseline");
  lines.push("");
  lines.push(`Source artifact: \`${args.artifact}\` (${rows.length} rows)`);
  lines.push(
    `Prior baseline: \`${args["prior-json"]}\` (summary aggregates) joined with \`${args["prior-md"]}\` (per-question matrix)`
  );
  lines.push(`Generated at: ${generatedAt}`);
  lines.push(`Generator: \`web/scripts/build-rerun-comparison-md.mjs\` (deterministic; auto-runs after gate-5 .json copy)`);
  lines.push("");
  lines.push("## New-run A/B/C counts (overall)");
  lines.push("");
  lines.push(`- Baseline grade A/B/C: ${fmtCounts(newOverallBaseline)}`);
  lines.push(`- Answer grade A/B/C: ${fmtCounts(newOverallAnswer)}`);
  lines.push(`- Semantic conformance grade A/B/C: ${fmtCounts(newOverallSemantic)}`);
  lines.push(`- Total questions: ${rows.length}`);
  lines.push(`- Root causes (rerun): ${rootCauseString(newRootCauses)}`);
  lines.push("");
  lines.push("## New-run per-category A/B/C counts");
  lines.push("");
  lines.push(categoryTable(newCats, categoryOrder));
  lines.push("");
  lines.push("## Prior-baseline A/B/C counts (overall)");
  lines.push("");
  lines.push(
    `Source: \`${args["prior-json"]}\` (\`summary.gradeCounts\`, \`summary.answerGradeCounts\`, \`summary.semanticConformanceGradeCounts\`).`
  );
  lines.push("");
  lines.push(`- Baseline grade A/B/C: ${fmtCounts(priorOverallBaseline)}`);
  lines.push(`- Answer grade A/B/C: ${fmtCounts(priorOverallAnswer)}`);
  lines.push(`- Semantic conformance A/B/C: ${fmtCounts(priorOverallSemantic)}`);
  lines.push(`- Total questions: ${priorJson.summary?.total ?? 50}`);
  lines.push(`- Root causes (prior): ${rootCauseString(priorRootCauses)}`);
  lines.push("");
  lines.push("## Prior-baseline per-category A/B/C counts");
  lines.push("");
  lines.push(
    `Source: per-question matrix in \`${args["prior-md"]}\`, aggregated by category via \`${args.questions}\`.`
  );
  lines.push("");
  lines.push(categoryTable(priorCats, categoryOrder));
  lines.push("");
  lines.push("## Per-question delta (improved / unchanged / regressed)");
  lines.push("");
  lines.push(
    `Built by joining each \`id\` in \`${args.artifact}\` against the per-question matrix in \`${args["prior-md"]}\`. The compared dimension is the **baseline grade** (severity ordering: A > B > C).`
  );
  lines.push("");
  lines.push(`### Improved (${improved.length})`);
  lines.push("");
  if (improved.length === 0) {
    lines.push("No improvements vs prior baseline this rerun.");
  } else {
    lines.push("| ID | Prior | New |");
    lines.push("|---:|---|---|");
    for (const r of improved) lines.push(`| Q${r.id} | ${r.prior} | ${r.next} |`);
  }
  lines.push("");
  lines.push(`### Unchanged (${unchanged.length})`);
  lines.push("");
  if (unchanged.length === 0) {
    lines.push("No unchanged rows vs prior baseline this rerun.");
  } else {
    const ids = unchanged.map((r) => `Q${r.id}`).join(", ");
    lines.push(`Question IDs (grade unchanged): ${ids}`);
    lines.push("");
    const nonA = unchanged.filter((r) => r.prior !== "A");
    if (nonA.length > 0) {
      lines.push("Non-A unchanged rows:");
      lines.push("");
      lines.push("| ID | Prior | New |");
      lines.push("|---:|---|---|");
      for (const r of nonA) lines.push(`| Q${r.id} | ${r.prior} | ${r.next} |`);
    }
  }
  lines.push("");
  lines.push(`### Regressed (${regressed.length})`);
  lines.push("");
  if (regressed.length === 0) {
    lines.push(
      "No per-question baseline-grade regressions vs the 2026-04-26 baseline in this rerun. (Per slice Decisions, regressions in A/B counts are findings to record rather than auto-fails; this section is retained even when empty so the deliverable's improved / unchanged / regressed structure stays intact across reruns.)"
    );
  } else {
    lines.push("| ID | Prior | New |");
    lines.push("|---:|---|---|");
    for (const r of regressed) lines.push(`| Q${r.id} | ${r.prior} | ${r.next} |`);
    lines.push("");
    lines.push(
      "Per slice Decisions, regressions in A/B counts are findings to record rather than auto-fails. The aggregate improvement direction (see below) remains the load-bearing signal for this slice."
    );
  }
  lines.push("");
  lines.push("## Aggregate delta summary");
  lines.push("");
  const deltaA = newOverallBaseline.A - priorOverallBaseline.A;
  const deltaB = newOverallBaseline.B - priorOverallBaseline.B;
  const deltaC = newOverallBaseline.C - priorOverallBaseline.C;
  const direction =
    deltaA > 0 && deltaC <= 0
      ? "clear improvement"
      : deltaA < 0 || deltaC > 0
        ? "regression in some dimension"
        : "no aggregate change";
  lines.push(
    `- Overall direction: ${direction} at the aggregate level. Baseline-grade A: ${priorOverallBaseline.A} → ${newOverallBaseline.A} (Δ${deltaA >= 0 ? "+" : ""}${deltaA}); B: ${priorOverallBaseline.B} → ${newOverallBaseline.B} (Δ${deltaB >= 0 ? "+" : ""}${deltaB}); C: ${priorOverallBaseline.C} → ${newOverallBaseline.C} (Δ${deltaC >= 0 ? "+" : ""}${deltaC}).`
  );
  lines.push(
    `- Semantic conformance: ${fmtCountsSlash(priorOverallSemantic)} → ${fmtCountsSlash(newOverallSemantic)}.`
  );
  lines.push(
    `- Per-question delta: ${improved.length} improved, ${unchanged.length} unchanged, ${regressed.length} regressed (baseline-grade dimension).`
  );
  lines.push(
    "- Per the slice Decisions, regressions are findings to record rather than auto-fails."
  );
  lines.push(
    "- Note: the benchmark is LLM-graded and non-deterministic. Per-question grades may vary between identical reruns; the aggregate direction is the load-bearing signal."
  );
  lines.push("");

  fs.writeFileSync(outputPath, lines.join("\n"));
  console.log(`OK: wrote ${outputPath}`);
}

main();
