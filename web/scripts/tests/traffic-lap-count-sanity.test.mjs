// F03 (golden-set audit 2026-07-02): analytics.traffic_adjusted_pace lap
// counts are 2x-inflated by duplicate laps_enriched rows (84 clean + 24
// traffic = 108 for a ~54-lap race). The stacked-bar detector halves any
// row whose total exceeds the max plausible race distance.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function loadRegistry() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-traffic-"));
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

test("inflated lap counts (108 total) are halved in the stacked bar", async () => {
  const { runDetectorRegistry, dir } = await loadRegistry();
  try {
    const rows = [{ driver_name: "Lando NORRIS", clean_air_laps: "84", traffic_laps: "24" }];
    const det = runDetectorRegistry(rows, { question: "How many laps did Norris spend in clean air during his winning Mexico GP 2025 stint?" });
    assert.equal(det.detectorId, "stacked_horizontal_bar");
    const clean = det.spec.series.find((s) => s.name === "Clean Air").values[0];
    const traffic = det.spec.series.find((s) => s.name === "In Traffic").values[0];
    assert.equal(clean, 42, "84 halved to 42");
    assert.equal(traffic, 12, "24 halved to 12");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("plausible lap counts (66 total) are left untouched", async () => {
  const { runDetectorRegistry, dir } = await loadRegistry();
  try {
    const rows = [{ driver_name: "Lando NORRIS", clean_air_laps: "50", traffic_laps: "16" }];
    const det = runDetectorRegistry(rows, { question: "clean air laps Mexico 2025" });
    assert.equal(det.detectorId, "stacked_horizontal_bar");
    assert.equal(det.spec.series.find((s) => s.name === "Clean Air").values[0], 50);
    assert.equal(det.spec.series.find((s) => s.name === "In Traffic").values[0], 16);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
