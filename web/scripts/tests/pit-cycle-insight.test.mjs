// Unit tests for buildPitCycleInsight — the deterministic (zero-LLM) insight
// builder for the single_driver_pit_cycle template. Transpiles the TS module
// in-place (it only has `import type` deps, which erase) and exercises the
// "full position flow" and "position gap" branches.

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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-pit-cycle-insight-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/synthesis/pitCycleInsight.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, "pitCycleInsight.mjs"), out, "utf8");
  const mod = await import(path.join(dir, "pitCycleInsight.mjs"));
  return { mod, dir };
}

// VER first stop — before_position is a data gap (null).
const verRows = [
  { phase_label: "In-lap (11)", duration_sec: "76.991", stop_lap: 12, total_pit_loss_s: "23.604", stationary_s: null, before_position: null, after_position: 8, recovered_by_lap: null, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Max VERSTAPPEN", pit_sequence: 1, country_name: "Canada", year: 2025, session_name: "Race" },
  { phase_label: "Pit lane", duration_sec: "23.604", stop_lap: 12, total_pit_loss_s: "23.604", stationary_s: null, before_position: null, after_position: 8, recovered_by_lap: null, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Max VERSTAPPEN", pit_sequence: 1, country_name: "Canada", year: 2025, session_name: "Race" }
];

// Antonelli first stop — full position flow present.
const antRows = [
  { phase_label: "In-lap (13)", duration_sec: "77.730", stop_lap: 14, total_pit_loss_s: "23.320", stationary_s: null, before_position: 2, after_position: 7, recovered_by_lap: 37, compound_before: "MEDIUM", compound_after: "HARD", full_name: "Andrea Kimi ANTONELLI", pit_sequence: 1, country_name: "Canada", year: 2025, session_name: "Race" }
];

test("buildPitCycleInsight — title, metrics, and gap takeaway (before_position null)", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const res = mod.buildPitCycleInsight(verRows);
    assert.ok(res, "builder must return a result");
    assert.equal(res.insight.title, "Verstappen First Stop — Canada 2025");
    assert.match(res.insight.subtitle, /2025 Canada Grand Prix · Race/);
    // 3 tiles: Stop Lap (emphasis), Pit-Lane Loss, Tyre Swap.
    assert.equal(res.insight.metrics.length, 3);
    assert.equal(res.insight.metrics[0].label, "Stop Lap");
    assert.equal(res.insight.metrics[0].value, "12");
    assert.equal(res.insight.metrics[0].emphasis, true);
    assert.equal(res.insight.metrics[1].value, "23.6");
    assert.equal(res.insight.metrics[2].value, "Medium → Hard");
    // No "stationary" tile is ever invented.
    assert.ok(!res.insight.metrics.some((m) => /stationary/i.test(m.label)));
    // Gap is flagged, not faked.
    assert.ok(res.insight.key_takeaways.some((t) => /isn't captured in the data/.test(t)));
    assert.ok(!res.insight.key_takeaways.some((t) => /cycled P/.test(t)));
    assert.match(res.answer, /Medium to a fresh Hard/);
    assert.match(res.answer, /isn't fully captured in the data/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildPitCycleInsight — position-cycle takeaway when before/after present", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const res = mod.buildPitCycleInsight(antRows);
    assert.ok(res);
    assert.ok(res.insight.key_takeaways.some((t) => /P2 → P7.*back to P2 by lap 37/.test(t)));
    assert.match(res.answer, /cycled from P2 to P7, recovering to P2 by lap 37/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildPitCycleInsight — returns null for non-pit-cycle rows", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    assert.equal(mod.buildPitCycleInsight([]), null);
    assert.equal(mod.buildPitCycleInsight([{ foo: "bar" }]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
