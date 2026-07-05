// F02 (golden-set audit 2026-07-02): core.grid_vs_finish.finish_position
// is stale/duplicated when raw.session_result wasn't ingested — no winner,
// duplicate positions, and a driver's "finish" == his grid slot. The
// insight builder must reconcile against the per-lap trace it already
// holds and name the finish-source caveat.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function load() {
  const src = await readFile(path.resolve(webRoot, "src/lib/synthesis/positionChangesInsight.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const dir = await mkdtemp(path.join(__dirname, ".tmp-posfin-"));
  const file = path.join(dir, "mod.mjs");
  await writeFile(file, js, "utf8");
  return { mod: await import(file), dir };
}

const VENUE = { country_name: "Brazil", location: "São Paulo", year: 2025, session_name: "Race" };
// row: one per (driver, lap) trace point; grid/finish repeated per driver.
const row = (dn, name, lap, pos, grid, finish) => ({
  driver_number: dn, driver_name: name, lap_number: lap, position: pos,
  grid_position: grid, finish_position: finish, total_laps: 71, ...VENUE
});

test("stale finish (no winner + dup positions) → winner + movers derived from trace, caveat present", async () => {
  const { mod, dir } = await load();
  try {
    // Verstappen trace P19→P3, but finish_position stuck at grid (19).
    // Norris trace holds P1 to the flag, finish_position stale at 3.
    // No driver has finish==1; P3 duplicated (VER+NOR stale).
    const rows = [
      row(1, "Max VERSTAPPEN", 0, 19, 19, 19), row(1, "Max VERSTAPPEN", 71, 3, 19, 19),
      row(4, "Lando NORRIS", 0, 1, 1, 3), row(4, "Lando NORRIS", 71, 1, 1, 3),
      row(81, "Oscar PIASTRI", 0, 2, 2, 3), row(81, "Oscar PIASTRI", 71, 2, 2, 3)
    ];
    const res = mod.buildPositionChangesInsight(rows);
    assert.ok(res);
    // Winner metric must be Norris (trace P1), not "n/a".
    const winnerMetric = res.insight.metrics.find((m) => m.label === "Winner");
    assert.equal(winnerMetric.value, "Norris");
    // Verstappen is the biggest climber P19→P3 (+16), computed off the trace.
    assert.match(res.insight.metrics[0].value, /Verstappen \+16/);
    assert.ok(
      res.insight.key_takeaways.some((t) => /Official classification was unavailable/.test(t)),
      "finish-source caveat present"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clean session (winner present, no dup finishes) → trace override does NOT fire", async () => {
  const { mod, dir } = await load();
  try {
    const rows = [
      row(4, "Lando NORRIS", 0, 3, 3, 1), row(4, "Lando NORRIS", 40, 1, 3, 1),
      row(1, "Max VERSTAPPEN", 0, 1, 1, 2),
      row(81, "Oscar PIASTRI", 0, 2, 2, 3)
    ];
    const res = mod.buildPositionChangesInsight(rows);
    assert.ok(res);
    assert.equal(res.insight.metrics.find((m) => m.label === "Winner").value, "Norris");
    assert.ok(
      !res.insight.key_takeaways.some((t) => /Official classification was unavailable/.test(t)),
      "no caveat on a clean session"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
