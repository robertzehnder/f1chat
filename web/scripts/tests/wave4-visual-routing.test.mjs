// Wave 4 (golden-set audit 2026-07-02) regressions:
//   F11 — team-comparison / stint-scoped / named-turn phrasings must NOT
//         hijack the deg-curve or sector-dominance templates.
//   F13 — radar detector drops a season_year (off-scale) axis.
//   F16 — team aliases ("Red Bull") resolve via scoreDriverCandidate.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function loadModule(rel, rewrite = (s) => s) {
  const src = rewrite(await readFile(path.resolve(webRoot, rel), "utf8"));
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const dir = await mkdtemp(path.join(__dirname, ".tmp-wave4-"));
  const file = path.join(dir, "mod.mjs");
  await writeFile(file, js, "utf8");
  return { mod: await import(file), dir };
}

// ---- F11: deg-curve template rejects team-comparison + stint-scoped ----
test("F11: deg-curve template does not hijack team-vs-team or stint-scoped questions", async () => {
  const { mod, dir } = await loadModule("src/lib/deterministicSql/degradationCurve.ts");
  try {
    // M11 phrasing → must return null (LLM path handles scatter+regression).
    assert.equal(
      mod.buildDegradationCurveTemplate({
        lower: "compare medium-compound deg curves between mclaren and red bull in stint 2 at jeddah 2025 was the gap aero-driven",
        targetSession: 9900, driverA: undefined, driverB: undefined
      }),
      null
    );
    // A plain deg-curve question still fires.
    assert.ok(
      mod.buildDegradationCurveTemplate({
        lower: "how big is the tyre cliff at bahrain 2025 show the deg curves",
        targetSession: 10014, driverA: undefined, driverB: undefined
      })
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- F11: sector-dominance rejects named-turn / corner-phase ----
test("F11: sector-dominance template does not hijack named-turn/corner-phase questions", async () => {
  const { mod, dir } = await loadModule("src/lib/deterministicSql/sectorDominance.ts");
  try {
    // M04 phrasing → null (per-corner entry/apex is an LLM-path question).
    assert.equal(
      mod.buildSectorDominanceTemplate({
        lower: "across turns 7, 8, 9 sector 2 high-speed esses at suzuka 2025 where did verstappen lose time to norris on entry vs apex",
        targetSession: 10006, driverA: 1, driverB: 4
      }),
      null
    );
    // A plain sector-dominance question still fires.
    assert.ok(
      mod.buildSectorDominanceTemplate({
        lower: "show the sector dominance between verstappen and norris in qualifying at silverstone 2025",
        targetSession: 9947, driverA: 1, driverB: 4
      })
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- F13: radar detector drops season_year axis ----
test("F13: radar drops a season_year axis (off-scale) and keeps the real ones", async () => {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-wave4reg-"));
  try {
    for (const [rel, out] of [
      ["src/lib/f1-team-colors.ts", "colors.mjs"],
      ["src/lib/mapInsight/detectors/types.ts", "types.mjs"],
      ["src/lib/mapInsight/detectors/registry.ts", "registry.mjs"]
    ]) {
      let js = ts.transpileModule(await readFile(path.resolve(webRoot, rel), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText;
      js = js.replace(/@\/lib\/f1-team-colors/g, "./colors.mjs").replace(/@\/lib\/chart-types/g, "./types.mjs").replace(/\.\/types"/g, './types.mjs"');
      await writeFile(path.join(dir, out), js, "utf8");
    }
    const { runDetectorRegistry } = await import(path.join(dir, "registry.mjs"));
    const rows = [
      { driver_name: "Max VERSTAPPEN", season_year: 2025, qualifying_axis: 82, race_pace_axis: 78, restart_axis: 60, tyre_management_axis: 71 },
      { driver_name: "Lando NORRIS", season_year: 2025, qualifying_axis: 80, race_pace_axis: 81, restart_axis: 55, tyre_management_axis: 74 }
    ];
    const det = runDetectorRegistry(rows, { question: "Where does Verstappen's edge over Norris come from in 2025 — qualifying axis or race-pace axis?" });
    assert.equal(det.detectorId, "radar");
    assert.ok(!det.spec.axes.some((a) => /season|year/i.test(a)), "no season/year axis");
    for (const s of det.spec.series) {
      for (const v of s.values) assert.ok(v <= det.spec.max_value, `every value ≤ ${det.spec.max_value}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- F16: team alias resolution ----
test("F16: 'Red Bull' matches the 'red bull racing' team via alias", async () => {
  // scoreDriverCandidate is exported from resolution.ts; transpile it alone
  // (it imports types only from resolver — erased at transpile).
  const { mod, dir } = await loadModule("src/lib/chatRuntime/resolution.ts");
  try {
    const row = { full_name: "Max Verstappen", team_name: "Red Bull Racing", driver_number: 1 };
    const withAlias = mod.scoreDriverCandidate(row, "how did red bull compare to mclaren at monza 2025");
    assert.ok(withAlias.matchedOn.includes("team_name"), "Red Bull alias matched the full team name");
    // "verb" must NOT trigger the "rb" alias (word boundary).
    const rbRow = { full_name: "Liam Lawson", team_name: "Racing Bulls", driver_number: 30 };
    const noFalse = mod.scoreDriverCandidate(rbRow, "he used a verb in the sentence");
    assert.ok(!noFalse.matchedOn.includes("team_name"), "'verb' must not match the 'rb' alias");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
