// Unit tests for buildPaceCliffInsight — the deterministic (zero-LLM) verdict
// builder for the single_driver_pace_cliff template. Transpiles the TS module
// (only `import type` deps, which erase) and checks the YES/NO branches plus
// the honest "consistent with graining" language.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadBuilder() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-pace-cliff-insight-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/synthesis/paceCliffInsight.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, "paceCliffInsight.mjs"), out, "utf8");
  const mod = await import(path.join(dir, "paceCliffInsight.mjs"));
  return { mod, dir };
}

const META = { compound_name: "MEDIUM", first_pit_lap: 13, full_name: "Oscar PIASTRI", country_name: "Italy", location: "Imola", year: 2025, session_name: "Race" };
const lap = (n, dur, opts = {}) => ({
  lap_number: n,
  lap_duration: dur,
  tyre_age_on_lap: n - 1,
  is_pit_lap: false,
  is_pit_out_lap: false,
  rolling_avg_prev3: null,
  delta_vs_rolling_avg: null,
  is_cliff_onset: false,
  ...META,
  ...opts
});

// Imola Piastri stint 1: best lap 5, cliff onset lap 10, pit lap 13.
const CLIFF_ROWS = [
  lap(5, 81.096),
  lap(8, 81.178),
  lap(9, 81.168),
  lap(10, 81.742, { is_cliff_onset: true, delta_vs_rolling_avg: 0.491 }),
  lap(11, 81.741, { delta_vs_rolling_avg: 0.378 }),
  lap(12, 81.68, { delta_vs_rolling_avg: 0.13 }),
  lap(13, 86.205, { is_pit_lap: true })
];

test("buildPaceCliffInsight — YES verdict with cliff, honest graining language", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const res = mod.buildPaceCliffInsight(CLIFF_ROWS);
    assert.ok(res, "must return a result");
    assert.equal(res.insight.verdict.label, "YES");
    assert.match(res.insight.verdict.summary, /onset lap 10/);
    assert.match(res.insight.verdict.summary, /consistent with graining/);
    // Never asserts graining as measured fact.
    assert.ok(!/graining-driven/i.test(res.insight.verdict.summary));
    assert.match(res.answer, /consistent with graining/);
    assert.match(res.answer, /inferred|isn't.*measured/i);
    // Title / subtitle use the circuit (Imola), not country.
    assert.equal(res.insight.title, "Piastri Medium Tyre Pace Cliff — Imola 2025");
    // Subtitle range reflects the actual first lap shown (lap 1 dropped upstream).
    assert.match(res.insight.subtitle, /Imola 2025 · Race · Stint 1, laps \d+–13/);
    // Metrics: cliff onset (emphasis), stint best, pit lap.
    assert.equal(res.insight.metrics[0].value, "Lap 10");
    assert.equal(res.insight.metrics[0].emphasis, true);
    assert.equal(res.insight.metrics[1].value, "1:21.096");
    assert.equal(res.insight.metrics[2].value, "Lap 13");
    assert.match(res.insight.metrics[2].context, /in-lap 1:26.205/);
    // Caveat takeaway present.
    assert.ok(res.insight.key_takeaways.some((t) => /isn't directly measured/.test(t)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildPaceCliffInsight — NO verdict when pace holds (no cliff onset)", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const flat = [lap(5, 81.1), lap(8, 81.2), lap(9, 81.15), lap(10, 81.18), lap(11, 81.2), lap(13, 86.2, { is_pit_lap: true })];
    const res = mod.buildPaceCliffInsight(flat);
    assert.ok(res);
    assert.equal(res.insight.verdict.label, "NO");
    assert.match(res.insight.verdict.summary, /No sustained pace cliff/);
    assert.match(res.answer, /no sustained pace cliff|held within/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildPaceCliffInsight — returns null for non-cliff rows", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    assert.equal(mod.buildPaceCliffInsight([]), null);
    assert.equal(mod.buildPaceCliffInsight([{ foo: 1 }]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
