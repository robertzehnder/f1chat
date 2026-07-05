// Baseline sweep: run every in-scope v0-brief sample prompt (M01–M22,
// excl. deferred M07/M23) through the live /api/chat pipeline, run the
// client chart-detector registry over the returned rows, and grade the
// response against the mock's expected shape.
//
// Usage: node scripts/health/baseline_sweep.mjs [--only M08,M10]
// Output: /tmp/baseline-sweep.json + a compact table on stdout.

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const API = process.env.SWEEP_API ?? "http://localhost:3000/api/chat";

// Sample prompts verbatim from diagnostic/phase26_v0_visualization_brief_2026-05-05.md.
// `expect` = chart detector id the mock corresponds to; null = card-only
// (hero / verdict / refusal) where no chart is required.
const BASELINES = [
  { id: "M01", qid: 1922, expect: null, kind: "hero", prompt: "What was Verstappen's pole lap time at Suzuka 2025?" },
  // M02 now routes to the deterministic race-trace card (pit-cycle mode)
  // with a computed over-cut verdict — the LLM verdict flake is gone.
  { id: "M02", qid: 2062, expect: "race_trace", kind: "verdict", prompt: "Did Russell's covering stop on the lap after Verstappen in Canada 2025 successfully execute the over-cut?" },
  // Second-wave race-analysis cards (2026-06-10).
  { id: "R01", qid: 0, expect: "race_trace", kind: "chart", prompt: "Show the race trace for Bahrain 2025" },
  { id: "R02", qid: 0, expect: "degradation_curve", kind: "chart", prompt: "How big is the tyre cliff at Bahrain 2025 — show the deg curves" },
  { id: "R03", qid: 0, expect: "position_changes", kind: "chart", prompt: "Show the position changes at Silverstone 2025" },
  { id: "R04", qid: 0, expect: "telemetry_overlay", kind: "chart", prompt: "Show the lap telemetry comparison for Verstappen and Norris at the Suzuka 2025 race" },
  { id: "M03", qid: 1960, expect: null, kind: "metric_grid", prompt: "What was Verstappen's brake-zone speed drop into Turn 22 in Saudi Arabia 2025 long runs?" },
  { id: "M04", qid: 1717, expect: "grouped_bar", kind: "chart", prompt: "Across Turns 7, 8, 9 (Sector 2 high-speed esses) at Suzuka 2025, where did Verstappen lose time to Norris on entry vs apex?" },
  // M05 renders the mock's signed per-zone delta bars (diverging), not
  // grouped absolute speeds — the question asks about the DELTAS.
  { id: "M05", qid: 1969, expect: "brake_zone_delta", kind: "chart", prompt: "Across the three heaviest brake zones at Bahrain 2025, did Piastri's lap-1 brake-zone delta to Norris foreshadow lap-pace deficit?" },
  { id: "M06", qid: 2080, expect: "horizontal_bar", kind: "chart", prompt: "How many on-track overtakes did the 2025 Imola Grand Prix produce?" },
  { id: "M08", qid: 1943, expect: "stint_gantt", kind: "chart", prompt: "Did Mercedes split strategies between Russell and Hamilton at Spa 2025?" },
  // M09 accepts the stint-marker variant too — same multi-line renderer,
  // and the LLM path includes pit-lap flags that add the markers.
  { id: "M09", qid: 1924, expect: ["line", "line_with_stint_markers"], kind: "chart", prompt: "How did Hamilton's race pace compare to Russell across the first stint at Monza 2025?" },
  // M10's mock drew two absolute lap-time lines; the shipped card uses a
  // single delta-to-zero line (same renderer, stronger encoding for a
  // reversal question) — signed off 2026-06-09.
  { id: "M10", qid: 2027, expect: "stint_delta_line", kind: "chart", prompt: "Across stints 1, 2 and 3 at Bahrain 2025, did Hamilton's middle-stint medium deltas to Leclerc reverse on the final hard stint?" },
  { id: "M11", qid: 2024, expect: "scatter_with_regression", kind: "chart", prompt: "Compare medium-compound deg curves between McLaren and Red Bull in stint 2 at Jeddah 2025 — was the gap aero-driven?" },
  { id: "M12", qid: 2103, expect: "horizontal_bar_diverging", kind: "chart", prompt: "On the lap-1 launch at Australia 2025, did Norris or Verstappen gain more positions before the first SC?" },
  { id: "M13", qid: 2041, expect: "stacked_horizontal_bar", kind: "chart", prompt: "How many laps did Norris spend in clean air during his winning Mexico GP 2025 stint?" },
  { id: "M14", qid: 2123, expect: "line_dual_axis", kind: "chart", prompt: "What was the inter-to-slick crossover lap for the McLarens at Australia 2025?" },
  { id: "M15", qid: 2140, expect: "event_timeline", kind: "chart", prompt: "How many penalty points were issued by stewards at the 2025 São Paulo Grand Prix?" },
  { id: "M16", qid: 1706, expect: "track_heatmap", kind: "chart", prompt: "Which corners did Verstappen gain on Norris through Sector 2 at Silverstone 2025 — Maggotts, Becketts, or Chapel?" },
  { id: "M17", qid: 2162, expect: "radar", kind: "chart", prompt: "Where does Verstappen's edge over Norris come from in 2025 — qualifying axis or race-pace axis?" },
  { id: "M18", qid: 2186, expect: "status_grid", kind: "chart", prompt: "Across the 2025 season, which sessions have telemetry but no matching weather data?" },
  // M19's donut mock assumes per-zone overtake attribution, which the
  // data doesn't carry (positions feed only). The honest A is the
  // inferred-overtakes card with its explicit no-location caveat.
  { id: "M19", qid: 2085, expect: "horizontal_bar", kind: "chart", prompt: "At Singapore 2025, compare the percentage of overtakes completed inside the new fourth DRS zone vs the original three." },
  { id: "M20", qid: 2200, expect: null, kind: "composite", prompt: "At Imola 2025, did the front-right graining that forced Piastri into an early stop also coincide with a pace cliff in the laps before the stop?" },
  { id: "M21", qid: 1750, expect: null, kind: "refusal", prompt: "What was the brake temperature on Hamilton's car at Turn 8 in Monza 2025?" },
  { id: "M22", qid: 2061, expect: "pit_event_strip", kind: "chart", prompt: "What was Verstappen's first-stop lap number in the 2025 Canadian Grand Prix?" },
  // Wave 5 honesty-regression block (golden-set audit 2026-07-02, §5 #1/#11).
  // H01–H03: a resolved 2025 session must NEVER be declared absent (F01);
  // the gradeItem gate flags any fabricated-absence text over non-empty rows.
  { id: "H01", qid: 0, expect: null, kind: "chart", prompt: "Did Mercedes split strategies between Russell and Hamilton at Spa 2025?" },
  { id: "H02", qid: 0, expect: null, kind: "chart", prompt: "Show the sector dominance between Hamilton and Norris in qualifying at Silverstone 2025" },
  { id: "H03", qid: 0, expect: null, kind: "chart", prompt: "Across stints 1, 2 and 3 at Abu Dhabi 2025, did Hamilton's medium deltas to Leclerc reverse on the final hard stint?" },
  // H04: genuine-absence positive control — 2019 is NOT in the warehouse,
  // so an honest refusal here proves the clamp didn't over-suppress refusals.
  { id: "H04", qid: 0, expect: null, kind: "refusal", prompt: "Show the race trace for the 2019 Emilia Romagna Grand Prix at Imola." }
];

async function loadRegistry() {
  const dir = await mkdtemp(path.join(webRoot, "scripts", ".tmp-sweep-"));
  for (const [rel, out] of [
    ["src/lib/f1-team-colors.ts", "colors.mjs"],
    ["src/lib/mapInsight/detectors/types.ts", "types.mjs"],
    ["src/lib/mapInsight/detectors/registry.ts", "registry.mjs"]
  ]) {
    let js = ts.transpileModule(await readFile(path.resolve(webRoot, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    js = js
      .replace(/@\/lib\/f1-team-colors/g, "./colors.mjs")
      .replace(/@\/lib\/chart-types/g, "./types.mjs")
      .replace(/\.\/types"/g, './types.mjs"');
    await writeFile(path.join(dir, out), js, "utf8");
  }
  const mod = await import(path.join(dir, "registry.mjs"));
  return { runDetectorRegistry: mod.runDetectorRegistry, dir };
}

function gradeItem(item, r, detectorId) {
  const problems = [];
  const answer = r.answer ?? "";
  if (item.kind === "refusal") {
    if (!/INSUFFICIENT_DATA|not in dataset|no .*data|cannot/i.test(answer) && r.result?.rowCount > 0) {
      problems.push("expected a refusal but got rows + answer");
    }
    return problems;
  }
  if (r.error) {
    problems.push(`request error: ${r.error}`);
    return problems;
  }
  if (!answer || /^No rows matched/i.test(answer)) problems.push("empty/no-rows answer");
  if (/INSUFFICIENT_DATA/.test(answer)) problems.push("refused (insufficient data)");
  if ((r.result?.rowCount ?? 0) === 0) problems.push("0 rows");
  // Wave 1 permanent gate (golden-set audit 2026-07-02): the P0 class was
  // an answer that fabricated data absence while the app had resolved the
  // session. If a session was pinned (rows carry year/venue) and the answer
  // claims the data is missing/not-ingested, that's the regression.
  const src = r.generationSource ?? "";
  if (/heuristic_after_template_failure|heuristic_after_sql_timeout|heuristic_fallback/.test(src)) {
    problems.push(`degraded generation source: ${src}`);
  }
  if (
    (r.result?.rowCount ?? 0) > 0 &&
    /not (in|part of) the dataset|not (yet )?(been )?ingested|does not (contain|include)|may not (yet )?be ingested/i.test(answer)
  ) {
    problems.push("fabricated data-absence claim over non-empty rows (F01 regression)");
  }
  if (item.expect) {
    const accepted = Array.isArray(item.expect) ? item.expect : [item.expect];
    if (!accepted.includes(detectorId)) {
      problems.push(`chart: got ${detectorId ?? "none"}, want ${accepted.join("|")}`);
    }
  }
  // Verdict-shaped prompts (yes/no questions) should carry a verdict.
  if (/^(Did|Was|Were|Is|Are|Do|Does)\b/.test(item.prompt) && !r.insight?.verdict && item.kind !== "refusal") {
    problems.push("yes/no question without verdict");
  }
  // Hedged-answer + verdict contradiction (the M10 incident class).
  if (r.insight?.verdict && /cannot (be )?(confirm|determin)|insufficient|only covers/i.test(answer)) {
    problems.push("verdict over hedged answer");
  }
  return problems;
}

const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : null;

const { runDetectorRegistry, dir } = await loadRegistry();
const results = [];
try {
  for (const item of BASELINES) {
    if (only && !only.has(item.id)) continue;
    const started = Date.now();
    let r;
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: item.prompt }),
        signal: AbortSignal.timeout(150000)
      });
      r = await res.json();
    } catch (err) {
      r = { error: String(err) };
    }
    const rows = r.result?.rows;
    const det = rows?.length ? runDetectorRegistry(rows, { question: item.prompt }) : undefined;
    const problems = gradeItem(item, r, det?.spec ? det.detectorId : undefined);
    results.push({
      id: item.id,
      qid: item.qid,
      prompt: item.prompt,
      expect: item.expect,
      kind: item.kind,
      elapsedMs: Date.now() - started,
      source: r.generationSource ?? null,
      notes: r.generationNotes ?? null,
      rowCount: r.result?.rowCount ?? null,
      detector: det?.detectorId ?? null,
      verdict: r.insight?.verdict ?? null,
      title: r.insight?.title ?? null,
      metricsCount: r.insight?.metrics?.length ?? 0,
      takeawaysCount: r.insight?.key_takeaways?.length ?? 0,
      answerHead: (r.answer ?? "").slice(0, 220),
      error: r.error ?? null,
      problems,
      grade: problems.length === 0 ? "A" : problems.length === 1 ? "B" : "C"
    });
    const last = results[results.length - 1];
    console.log(
      `${item.id} [${last.grade}] src=${last.source} rows=${last.rowCount} chart=${last.detector ?? "-"} ` +
        `${last.verdict ? "verdict=" + last.verdict.label : ""} ${problems.length ? "⚠ " + problems.join(" | ") : "✓"}`
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
// Wave 5 (golden-set audit 2026-07-02): surface the generationSource
// distribution so a drift toward degraded/heuristic sources is visible per
// run, and a hard summary line for the honesty regression.
const grades = results.reduce((m, r) => ((m[r.grade] = (m[r.grade] ?? 0) + 1), m), {});
const sources = results.reduce((m, r) => ((m[r.source ?? "none"] = (m[r.source ?? "none"] ?? 0) + 1), m), {});
const honestyRegressions = results.filter((r) =>
  (r.problems ?? []).some((p) => /fabricated data-absence|degraded generation source/.test(p))
);
console.log(`\nGrades: ${Object.entries(grades).map(([g, n]) => `${g}:${n}`).join(" ")}`);
console.log(`Sources: ${Object.entries(sources).map(([s, n]) => `${s}=${n}`).join(" ")}`);
console.log(`Honesty regressions (F01 gate): ${honestyRegressions.length}${honestyRegressions.length ? " ⚠ " + honestyRegressions.map((r) => r.id).join(",") : " ✓"}`);
await writeFile("/tmp/baseline-sweep.json", JSON.stringify(results, null, 2), "utf8");
console.log(`\nWrote /tmp/baseline-sweep.json (${results.length} items)`);
