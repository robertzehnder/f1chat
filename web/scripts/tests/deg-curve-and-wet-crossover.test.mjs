// F12 / F14 / F17 (golden-set audit 2026-07-02):
//   F12 — deg-curve SQL excludes lap 1 + SC-paced laps + raises sample
//         floors; builder refuses cliff/slope narrative on disrupted data.
//   F14 — wet-crossover SQL dedups weather_impact boundary rows.
//   F17 — wet-crossover builder distinguishes an opening-lap slick gamble
//         from a genuine drying-phase crossover.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function load(rel, outName = "mod.mjs") {
  const src = await readFile(path.resolve(webRoot, rel), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const dir = await mkdtemp(path.join(__dirname, ".tmp-degwet-"));
  const file = path.join(dir, outName);
  await writeFile(file, js, "utf8");
  return { mod: await import(file), dir };
}

const BANNED = /\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i;

// ---- F12 SQL shape ----
test("F12: deg-curve SQL excludes lap 1, filters SC-paced laps, raises floors", async () => {
  const { mod, dir } = await load("src/lib/deterministicSql/degradationCurve.ts");
  try {
    const tpl = mod.buildDegradationCurveTemplate({
      lower: "how big is the tyre cliff at jeddah 2025 show the deg curves",
      targetSession: 9900, driverA: undefined, driverB: undefined
    });
    assert.ok(tpl);
    assert.match(tpl.sql, /lap_number > 1/, "excludes the standing-start lap");
    assert.match(tpl.sql, /med \* 1\.4/, "drops SC/VSC-paced laps vs field median");
    assert.match(tpl.sql, /a\.lap_count >= 4/, "per-age bucket floor raised to 4");
    assert.match(tpl.sql, /b\.base_count >= 6/, "fresh-baseline floor raised to 6");
    assert.ok(!tpl.sql.includes(";"));
    assert.ok(!BANNED.test(tpl.sql));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- F12 builder disruption clamp ----
test("F12: builder refuses cliff/slope narrative when deltas exceed ±5s", async () => {
  const { mod, dir } = await load("src/lib/synthesis/degradationCurveInsight.ts");
  try {
    const VENUE = { country_name: "Saudi Arabia", location: "Jeddah", year: 2025, session_name: "Race" };
    const point = (compound, age, delta, laps = 8) => ({
      compound_name: compound, tyre_age: age, deg_delta_s: delta, lap_count: laps, compound_baseline_s: 95, ...VENUE
    });
    // Jeddah artifact: age≤2 baseline SC-paced, so later ages read ~-32s.
    const rows = [
      point("MEDIUM", 2, 8.2), point("MEDIUM", 5, -32.1), point("MEDIUM", 9, -30.4), point("MEDIUM", 12, -31.0)
    ];
    const res = mod.buildDegradationCurveInsight(rows);
    assert.ok(res);
    assert.match(res.answer, /can't be trusted|unreliable/i);
    assert.ok(!/FASTER with age|cliff/i.test(res.answer), "no cliff/faster-with-age claim on disrupted data");
    assert.match(res.insight.title, /unreliable/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- F14 SQL dedup ----
test("F14: wet-crossover SQL dedups boundary rows by (driver, lap)", async () => {
  const { mod, dir } = await load("src/lib/deterministicSql/wetCrossover.ts");
  try {
    const tpl = mod.buildWetCrossoverTemplate({
      lower: "on which lap did the mclarens make the inters-to-slicks crossover at australia 2025",
      targetSession: 9950, driverA: 4, driverB: 81
    });
    assert.ok(tpl);
    assert.match(tpl.sql, /ROW_NUMBER\(\) OVER \(\s*PARTITION BY w\.driver_number, w\.lap_number/);
    assert.match(tpl.sql, /WHERE r\.rn = 1/);
    assert.ok(!tpl.sql.includes(";"));
    assert.ok(!BANNED.test(tpl.sql));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- F17 builder gamble vs drying crossover ----
test("F17: an opening-lap slick gamble is labeled a gamble, not compared as a crossover", async () => {
  const { mod, dir } = await load("src/lib/synthesis/wetCrossoverInsight.ts");
  try {
    const VENUE = { country_name: "Brazil", location: "São Paulo", year: 2025, session_name: "Race" };
    // Antonelli gambles on slicks lap 3 (before wet phase); Russell genuine
    // drying crossover lap 39. wet_track=1 from lap 5 onward.
    const row = (dn, name, lap, wet, compound, crossover) => ({
      driver_number: dn, driver_name: name, lap_number: lap, wet_track: wet,
      lap_time_s: 95, compound_name: compound, inter_to_slick_crossover_lap: crossover, ...VENUE
    });
    const rows = [];
    for (let lap = 1; lap <= 45; lap += 1) {
      const wet = lap >= 5 && lap <= 38 ? 1 : 0;
      rows.push(row(12, "Kimi ANTONELLI", lap, wet, lap >= 3 && lap <= 9 ? "HARD" : "INTERMEDIATE", 3));
      rows.push(row(63, "George RUSSELL", lap, wet, lap >= 39 ? "HARD" : "INTERMEDIATE", 39));
    }
    const res = mod.buildWetCrossoverInsight(rows);
    assert.ok(res);
    // Must NOT fabricate a "differ by 36 laps — gambled earlier" comparison.
    assert.ok(
      !res.insight.key_takeaways.some((t) => /differ by 36 laps/.test(t)),
      "no spurious 36-lap spread comparison"
    );
    assert.ok(
      res.insight.key_takeaways.some((t) => /gamble/i.test(t)) || /gamble/i.test(res.answer),
      "Antonelli's early switch labeled a gamble"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
