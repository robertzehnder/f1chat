// Unit tests for buildInferredOvertakesInsight — the deterministic (zero-LLM)
// builder for the inferred_overtakes template. Transpiles the TS module
// (only `import type` deps, which erase).

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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-inferred-overtakes-insight-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/synthesis/inferredOvertakesInsight.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, "inferredOvertakesInsight.mjs"), out, "utf8");
  const mod = await import(path.join(dir, "inferredOvertakesInsight.mjs"));
  return { mod, dir };
}

const ROWS = [
  { driver_name: "Fernando ALONSO", overtakes: 5, location: "Marina Bay", year: 2025, session_name: "Race" },
  { driver_name: "Lance STROLL", overtakes: 5, location: "Marina Bay", year: 2025, session_name: "Race" },
  { driver_name: "Alexander ALBON", overtakes: 4, location: "Marina Bay", year: 2025, session_name: "Race" },
  { driver_name: "Carlos SAINZ", overtakes: 3, location: "Marina Bay", year: 2025, session_name: "Race" }
];

test("buildInferredOvertakesInsight — total, leader, and honest unofficial/DRS caveats", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const res = mod.buildInferredOvertakesInsight(ROWS);
    assert.ok(res, "must return a result");
    assert.equal(res.insight.title, "Inferred On-Track Overtakes — Marina Bay 2025");
    // total = 5+5+4+3 = 17; leader = 5 (Alonso, first after sort).
    assert.equal(res.insight.metrics[0].value, "17");
    assert.equal(res.insight.metrics[0].label, "On-track passes");
    assert.equal(res.insight.metrics[1].value, "5");
    assert.equal(res.insight.metrics[2].value, "4"); // four drivers passed
    // Honest framing: estimate + no zone attribution.
    assert.match(res.answer, /estimate/i);
    assert.match(res.answer, /DRS-zone or corner breakdown isn't possible/i);
    assert.ok(res.insight.key_takeaways.some((t) => /Official overtake data isn't recorded/.test(t)));
    assert.ok(res.insight.key_takeaways.some((t) => /DRS zone/.test(t)));
    // No verdict — this is a count card, not yes/no.
    assert.equal(res.insight.verdict, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildInferredOvertakesInsight — returns null for non-overtake rows", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    assert.equal(mod.buildInferredOvertakesInsight([]), null);
    assert.equal(mod.buildInferredOvertakesInsight([{ foo: 1 }]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
