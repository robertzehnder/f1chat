// F04 (golden-set audit 2026-07-02): deterministic templates were making
// redundant full scans of the large unmaterialized core.laps_enriched
// view, running at the edge of the 15s statement timeout. These assert
// the scan-count reductions so a future edit can't silently reintroduce
// a second scan.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function loadTemplate(rel, fnName) {
  const src = await readFile(path.resolve(webRoot, rel), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const dir = await mkdtemp(path.join(__dirname, ".tmp-scan-"));
  const file = path.join(dir, "mod.mjs");
  await writeFile(file, js, "utf8");
  const mod = await import(file);
  return { fn: mod[fnName], dir };
}

const countScans = (sql) => (sql.match(/FROM\s+core\.laps_enriched/gi) ?? []).length;

test("pitCycle scans core.laps_enriched at most once (venue CTE moved to core.sessions)", async () => {
  const { fn, dir } = await loadTemplate("src/lib/deterministicSql/pitCycle.ts", "buildPitCycleTemplate");
  try {
    const tpl = fn({ lower: "what was verstappen's first stop lap in canada 2025", targetSession: 9963, driverNumber: 1 });
    assert.ok(tpl, "template should fire");
    assert.equal(countScans(tpl.sql), 1, `expected 1 laps_enriched scan, got ${countScans(tpl.sql)}`);
    assert.match(tpl.sql, /FROM core\.sessions/, "venue metadata now comes from core.sessions");
    assert.ok(!tpl.sql.includes(";"), "no statement separator");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stintDelta scans core.laps_enriched exactly once for both drivers", async () => {
  const { fn, dir } = await loadTemplate("src/lib/deterministicSql/stintDelta.ts", "buildStintDeltaTemplate");
  try {
    const tpl = fn({
      lower: "across stints 1 2 and 3 at bahrain 2025 did hamilton's medium deltas to leclerc reverse on the final hard stint",
      targetSession: 10014,
      driverA: 44,
      driverB: 16
    });
    assert.ok(tpl, "template should fire");
    assert.equal(countScans(tpl.sql), 1, `expected 1 laps_enriched scan (merged both_laps), got ${countScans(tpl.sql)}`);
    assert.match(tpl.sql, /driver_number IN \(44, 16\)/, "single scan reads both drivers");
    assert.ok(!tpl.sql.includes(";"), "no statement separator");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
