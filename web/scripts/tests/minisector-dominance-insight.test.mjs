// Unit tests for buildMinisectorDominanceInsight — deterministic (zero-LLM)
// builder for the minisector_dominance template.

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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-minisector-insight-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/synthesis/minisectorDominanceInsight.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, "minisectorDominanceInsight.mjs"), out, "utf8");
  return { mod: await import(path.join(dir, "minisectorDominanceInsight.mjs")), dir };
}

const A = "Max VERSTAPPEN";
const B = "Lando NORRIS";
const seg = (name, leader, delta) => ({
  minisector_index: 0, name, leader, delta_ms: delta, delta_unit: "km/h",
  driver_a: A, driver_b: B, location: "Silverstone", year: 2025
});
const ROWS = [
  seg("Maggotts", A, 22),
  seg("Becketts", A, 28),
  seg("Chapel", A, 16),
  seg("Stowe", B, 14)
];

test("buildMinisectorDominanceInsight — counts, leader gains, and honest caveats", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const res = mod.buildMinisectorDominanceInsight(ROWS);
    assert.ok(res);
    assert.equal(res.insight.title, "Minisector Dominance — Silverstone 2025");
    // Verstappen leads 3 of 4.
    assert.equal(res.insight.metrics[0].value, "3");
    assert.match(res.insight.metrics[0].label, /Verstappen/);
    assert.equal(res.insight.metrics[1].value, "1");
    assert.equal(res.insight.metrics[2].value, "4");
    // Strongest-gains call-out ordered by delta (Becketts 28 first).
    assert.ok(res.insight.key_takeaways.some((t) => /Becketts/.test(t)));
    // Honest: best-run speed (not lap time) + whole-lap (no sector isolation).
    assert.match(res.answer, /best run.*not lap time/i);
    assert.ok(res.insight.key_takeaways.some((t) => /no sector \(1\/2\/3\) mapping/i.test(t)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildMinisectorDominanceInsight — null for non-minisector rows", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    assert.equal(mod.buildMinisectorDominanceInsight([]), null);
    assert.equal(mod.buildMinisectorDominanceInsight([{ foo: 1 }]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
