// Unit tests for buildInterruptionsInsight — the deterministic (zero-LLM)
// builder for the session_interruptions template (analyst probe honesty
// fix G3). Transpiles the TS module (only `import type` deps, which erase).

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
  const dir = await mkdtemp(path.join(__dirname, ".tmp-interruptions-insight-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/synthesis/interruptionsInsight.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, "interruptionsInsight.mjs"), out, "utf8");
  const mod = await import(path.join(dir, "interruptionsInsight.mjs"));
  return { mod, dir };
}

const VENUE = { race_control_rows: 157, location: "Monza", country_name: "Italy", year: 2026, session_name: "Race" };
const MONZA_ROWS = [
  { lap: 3, driver: "Race control", kind: "sc", message: "SAFETY CAR DEPLOYED", end_lap: 3, laps_affected: 1, duration_s: 54, endpoint_inferred: "superseded_by_red", ...VENUE },
  { lap: 3, driver: "Race control", kind: "red", message: "RED FLAG - RACE SUSPENDED", end_lap: 4, laps_affected: 2, duration_s: 1577, endpoint_inferred: "resumption_state_msg", ...VENUE },
  { lap: 28, driver: "Race control", kind: "vsc", message: "VSC DEPLOYED", end_lap: 29, laps_affected: 2, duration_s: 117, endpoint_inferred: null, ...VENUE }
];

test("buildInterruptionsInsight — counts periods, laps affected, names inferred endpoints, refutes pure-pace framing", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const res = mod.buildInterruptionsInsight(MONZA_ROWS);
    assert.ok(res);
    assert.equal(res.insight.title, "Interruptions — Monza 2026");
    assert.equal(res.insight.metrics[0].value, "3");
    assert.match(res.insight.metrics[0].context, /SC 1 · VSC 1 · red 1/);
    assert.equal(res.insight.metrics[1].value, "5");
    assert.match(res.insight.metrics[1].context, /2 endpoint\(s\) inferred/);
    assert.match(res.answer, /Virtual safety car: laps 28–29/);
    assert.match(res.answer, /VSC-priced pit stops/, "pure-pace framing is challenged when a VSC exists");
    assert.ok(res.insight.key_takeaways.some((t) => /inferred/.test(t)), "inferred endpoints are named");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildInterruptionsInsight — sentinel 'none' row yields a QUERIED absence, never a guessed one", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    const res = mod.buildInterruptionsInsight([{ lap: 0, driver: "Race control", kind: "none", message: "no SC / VSC / red-flag period in the race-control feed", end_lap: null, laps_affected: 0, duration_s: null, endpoint_inferred: null, ...VENUE, race_control_rows: 120 }]);
    assert.ok(res);
    assert.equal(res.insight.metrics[0].value, "0");
    assert.match(res.answer, /queried absence/);
    assert.match(res.answer, /120 messages/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildInterruptionsInsight — returns null on unrelated rows (no kind/race_control_rows)", async () => {
  const { mod, dir } = await loadBuilder();
  try {
    assert.equal(mod.buildInterruptionsInsight([{ driver_name: "x", lap_time: 80 }]), null);
    assert.equal(mod.buildInterruptionsInsight([]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
