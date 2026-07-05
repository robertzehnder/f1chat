// Phase 18-A: enumerate every `templateKey:` literal across the
// deterministic-SQL files and require that each one is annotated in
// TEMPLATE_TOPICS or explicitly listed in TEMPLATE_TOPICS_EXEMPT. This
// fails when a future template is added without a topic guard, so the
// false-match class can't silently regress.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

const SCAN_FILES = [
  "src/lib/deterministicSql.ts",
  "src/lib/deterministicSql/pace.ts",
  "src/lib/deterministicSql/strategy.ts",
  "src/lib/deterministicSql/pitCycle.ts",
  "src/lib/deterministicSql/paceCliff.ts",
  "src/lib/deterministicSql/inferredOvertakes.ts",
  "src/lib/deterministicSql/minisectorDominance.ts",
  "src/lib/deterministicSql/stintDelta.ts",
  "src/lib/deterministicSql/strategySplit.ts",
  "src/lib/deterministicSql/performanceRadar.ts",
  "src/lib/deterministicSql/raceControlIncidents.ts",
  "src/lib/deterministicSql/telemetryWeatherGap.ts",
  "src/lib/deterministicSql/lap1Positions.ts",
  "src/lib/deterministicSql/wetCrossover.ts",
  "src/lib/deterministicSql/brakeZones.ts",
  "src/lib/deterministicSql/cornerDelta.ts",
  "src/lib/deterministicSql/sectorDominance.ts",
  "src/lib/deterministicSql/speedMap.ts",
  "src/lib/deterministicSql/raceTrace.ts",
  "src/lib/deterministicSql/degradationCurve.ts",
  "src/lib/deterministicSql/positionChanges.ts",
  "src/lib/deterministicSql/telemetryOverlay.ts",
  "src/lib/deterministicSql/result.ts",
  "src/lib/deterministicSql/telemetry.ts",
  "src/lib/deterministicSql/dataHealth.ts",
  "src/lib/deterministicSql/sessionTypeShare.ts"
];

async function collectTemplateKeys() {
  const keys = new Set();
  for (const rel of SCAN_FILES) {
    const src = await readFile(path.resolve(webRoot, rel), "utf8");
    const re = /templateKey\s*:\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      keys.add(m[1]);
    }
  }
  return [...keys].sort();
}

async function loadTopicGuards() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-topic-coverage-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/deterministicSql/topicGuards.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, "topicGuards.mjs"), out, "utf8");
  const mod = await import(path.join(dir, "topicGuards.mjs"));
  return { mod, dir };
}

test("every templateKey is annotated in TEMPLATE_TOPICS (or exempted)", async () => {
  const found = await collectTemplateKeys();
  const { mod, dir } = await loadTopicGuards();
  try {
    const annotated = new Set(Object.keys(mod.TEMPLATE_TOPICS));
    const exempt = new Set(mod.TEMPLATE_TOPICS_EXEMPT);
    const missing = found.filter((k) => !annotated.has(k) && !exempt.has(k));
    assert.deepEqual(
      missing,
      [],
      `templateKeys missing topic annotation:\n${missing.join("\n")}\n\nAdd them to TEMPLATE_TOPICS in web/src/lib/deterministicSql/topicGuards.ts.`
    );
    // Inverse: annotations referencing a templateKey that no longer exists.
    const stale = [...annotated].filter((k) => !found.includes(k));
    assert.deepEqual(stale, [], `stale TEMPLATE_TOPICS entries: ${stale.join(", ")}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("at least one template is annotated (sanity)", async () => {
  const found = await collectTemplateKeys();
  assert.ok(found.length >= 10, `expected ≥ 10 templateKeys, got ${found.length}`);
});
