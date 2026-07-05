#!/usr/bin/env node
/**
 * check_surface_coverage.mjs — Phase 0 governing-principle gate
 * (roadmap_to_A_grade_2026-07-02.md — "DERIVE, don't hand-list").
 *
 * Extracts EVERY A-surface inventory FROM SOURCE (never a hand-list) and diffs
 * the derived set against scripts/health/a_surface_manifest.json. The gate FAILS
 * if any derived member is missing a classification in the manifest — so no
 * production surface can be silently ungraded and no newly-added enum member can
 * slip the gate. It also warns on stale manifest entries no longer in source.
 *
 * Seven derived inventories:
 *   1. templateKeys        — deterministicSql.ts + deterministicSql/*.ts   (templateKey: "...")
 *   2. detectors           — mapInsight/detectors/registry.ts              (id: "..." in ChartDetector defs)
 *   3. generationSources   — orchestration.ts + chatRuntime/insightShape.ts (observable generationSource/failureSource/queryPath)
 *   4. failureSubStates    — orchestration.ts                              (code:/status:/generationNotes literals; parametric split on :/=)
 *   5. materializedLayers  — sql/migrations/deploy/*.sql                    (CREATE MATERIALIZED VIEW + CREATE TABLE core.*_mat)
 *   6. clientFetchEdges    — components/f1-chat/charts/*.tsx               (fetch(/api/...) + useTrackOutline consumers)
 *   7. rendererSurface     — chart-types.ts ChartType union + charts/index.tsx case branches
 *
 * Classes accepted per member (roadmap vocab):
 *   gated | excluded | hard-truth | methodology-scoped | expected-refusal | pixel-gated | required | degraded-fallback
 * Every member must ALSO carry a non-empty `note` (the reason / fixture pointer).
 *
 * Usage:
 *   node check_surface_coverage.mjs                 # gate (exit!=0 on any unclassified)
 *   node check_surface_coverage.mjs --print         # dump derived sets + counts
 *   node check_surface_coverage.mjs --emit-skeleton # print a manifest skeleton (all UNCLASSIFIED)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..", ".."); // web/scripts/health -> web
const SRC = join(WEB, "src");
const DEPLOY = resolve(WEB, "..", "sql", "migrations", "deploy");
const MANIFEST = join(HERE, "a_surface_manifest.json");

const VALID_CLASSES = new Set([
  "gated", "excluded", "hard-truth", "methodology-scoped",
  "expected-refusal", "pixel-gated", "required", "degraded-fallback",
]);

const read = (p) => readFileSync(p, "utf8");
const uniqSort = (arr) => [...new Set(arr)].sort();

// -------------------------------------------------------------- extractors
function extractTemplateKeys() {
  const files = [
    join(SRC, "lib", "deterministicSql.ts"),
    ...readdirSync(join(SRC, "lib", "deterministicSql"))
      .filter((f) => f.endsWith(".ts") && !/topicGuards|types/.test(f))
      .map((f) => join(SRC, "lib", "deterministicSql", f)),
  ];
  const keys = [];
  for (const f of files) {
    const m = read(f).matchAll(/templateKey:\s*"([^"]+)"/g);
    for (const x of m) keys.push(x[1]);
  }
  return uniqSort(keys);
}

function extractDetectors() {
  const src = read(join(SRC, "lib", "mapInsight", "detectors", "registry.ts"));
  // Each detector: `const <name>Detector: ChartDetector = { id: "...", ... }`.
  // Capture the first id: after each ChartDetector declaration.
  const ids = [];
  const re = /:\s*ChartDetector\s*=\s*\{[\s\S]*?\bid:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) ids.push(m[1]);
  return uniqSort(ids);
}

function extractGenerationSources() {
  const files = [
    join(SRC, "app", "api", "chat", "orchestration.ts"),
    join(SRC, "lib", "chatRuntime", "insightShape.ts"),
  ].filter(existsSync);
  const tokens = [];
  for (const f of files) {
    for (const line of read(f).split("\n")) {
      if (!/generationSource|failureSource|queryPath/.test(line)) continue;
      for (const q of line.matchAll(/"([a-z][a-z0-9_]*)"/g)) tokens.push(q[1]);
    }
  }
  // filter obviously-non-source tokens (single generic words that are never sources)
  const NOISE = new Set(["success", "error", "and", "or", "the", "value", "type", "id", "text", "code", "status", "message"]);
  return uniqSort(tokens.filter((t) => !NOISE.has(t)));
}

function extractFailureSubStates() {
  const src = read(join(SRC, "app", "api", "chat", "orchestration.ts"));
  const out = [];
  for (const m of src.matchAll(/\bcode:\s*"([^"]+)"/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bstatus:\s*"([^"]+)"/g)) out.push(m[1]);
  // generationNotes: plain string OR template-literal prefix (split on :/= to get the parametric family).
  for (const m of src.matchAll(/generationNotes\s*[:=]\s*[`"]([^`"$]+)/g)) {
    const prefix = m[1].split(/[:=]/)[0].trim();
    if (prefix) out.push(prefix + (m[1].includes(":") || m[1].includes("=") ? ":*" : ""));
  }
  return uniqSort(out);
}

function extractMaterializedLayers() {
  const layers = [];
  for (const f of readdirSync(DEPLOY).filter((f) => f.endsWith(".sql"))) {
    const src = read(join(DEPLOY, f));
    for (const m of src.matchAll(/CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+\.[a-z0-9_]+)/gi))
      layers.push(m[1].toLowerCase() + " [matview]");
    for (const m of src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(core\.[a-z0-9_]+_mat)\b/gi))
      layers.push(m[1].toLowerCase() + " [heap]");
  }
  return uniqSort(layers);
}

function extractClientFetchEdges() {
  const dir = join(SRC, "components", "f1-chat", "charts");
  const edges = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
    const src = read(join(dir, f));
    const eps = new Set();
    for (const m of src.matchAll(/["'`](\/api\/[a-z0-9-]+)/g)) eps.add(m[1]);
    // useTrackOutline consumers implicitly fetch /api/track-outline
    if (/useTrackOutline\s*\(/.test(src)) eps.add("/api/track-outline");
    for (const ep of eps) edges.push(`${basename(f)} -> ${ep}`);
  }
  return uniqSort(edges);
}

function extractRendererSurface() {
  const ct = read(join(SRC, "lib", "chart-types.ts"));
  // bound to the `export type ChartType = ... ;` union
  const block = ct.match(/export\s+type\s+ChartType\s*=([\s\S]*?);/);
  const chartTypes = block
    ? uniqSort([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    : [];
  const idx = read(join(SRC, "components", "f1-chat", "charts", "index.tsx"));
  const branches = uniqSort([...idx.matchAll(/case\s*"([^"]+)"/g)].map((m) => m[1]));
  return { chartTypes, branches };
}

// -------------------------------------------------------------- assemble
function deriveAll() {
  const r = extractRendererSurface();
  return {
    templateKeys: extractTemplateKeys(),
    detectors: extractDetectors(),
    generationSources: extractGenerationSources(),
    failureSubStates: extractFailureSubStates(),
    materializedLayers: extractMaterializedLayers(),
    clientFetchEdges: extractClientFetchEdges(),
    rendererChartTypes: r.chartTypes,
    rendererBranches: r.branches,
  };
}

const derived = deriveAll();

if (process.argv.includes("--print")) {
  for (const [k, v] of Object.entries(derived)) {
    console.log(`\n### ${k} (${v.length}) ###`);
    console.log(v.join("\n"));
  }
  process.exit(0);
}

if (process.argv.includes("--emit-skeleton")) {
  const skeleton = {};
  for (const [inv, members] of Object.entries(derived)) {
    skeleton[inv] = {};
    for (const m of members) skeleton[inv][m] = { class: "UNCLASSIFIED", note: "" };
  }
  console.log(JSON.stringify(skeleton, null, 2));
  process.exit(0);
}

// -------------------------------------------------------------- gate
if (!existsSync(MANIFEST)) {
  console.error(`FAIL — manifest missing: ${MANIFEST}\nRun with --emit-skeleton to generate one.`);
  process.exit(1);
}
const manifest = JSON.parse(read(MANIFEST));
const problems = [];
let checkedMembers = 0;

for (const [inv, members] of Object.entries(derived)) {
  const section = manifest[inv] || {};
  const derivedSet = new Set(members);
  for (const m of members) {
    checkedMembers++;
    const entry = section[m];
    if (!entry) { problems.push(`[${inv}] UNCLASSIFIED derived member: ${m}`); continue; }
    if (!VALID_CLASSES.has(entry.class))
      problems.push(`[${inv}] member "${m}" has invalid class "${entry.class}"`);
    if (!entry.note || !String(entry.note).trim())
      problems.push(`[${inv}] member "${m}" missing note/reason`);
    // Phase 3.5: EVERY templateKey must carry an external-truth tier.
    if (inv === "templateKeys" && entry.class === "gated") {
      const TIERS = new Set(["hard-truth", "methodology-scoped", "expected-refusal"]);
      if (!TIERS.has(entry.truthTier))
        problems.push(`[templateKeys] "${m}" missing/invalid truthTier "${entry.truthTier}" (need hard-truth|methodology-scoped|expected-refusal)`);
    }
  }
  for (const m of Object.keys(section))
    if (!derivedSet.has(m))
      problems.push(`[${inv}] STALE manifest entry (no longer in source): ${m}`);
}

console.log(`Surface coverage — ${checkedMembers} derived members across ${Object.keys(derived).length} inventories`);
if (problems.length === 0) {
  console.log("PASS — every derived surface member is classified in the manifest.");
  process.exit(0);
}
console.error(`FAIL — ${problems.length} coverage problem(s):`);
for (const p of problems) console.error(`  ❌ ${p}`);
process.exit(1);
