// Phase 18-A: regression test for template-router topic guards.
// Verifies the 2026-05-02 false-match phrasing now correctly returns null
// (so LLM-gen takes over), while a clean pace-comparison phrasing still
// hits the templated path.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadDeterministicSql() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-template-router-"));
  const files = [
    "src/lib/deterministicSql/types.ts",
    "src/lib/deterministicSql/topicGuards.ts",
    "src/lib/deterministicSql/pace.ts",
    "src/lib/deterministicSql/strategy.ts",
    "src/lib/deterministicSql/pitCycle.ts",
    "src/lib/deterministicSql/paceCliff.ts",
    "src/lib/deterministicSql/inferredOvertakes.ts",
    "src/lib/deterministicSql/minisectorDominance.ts",
    "src/lib/deterministicSql/stintDelta.ts",
    "src/lib/deterministicSql/strategySplit.ts",
    "src/lib/deterministicSql/performanceRadar.ts",
    "src/lib/deterministicSql/raceControlIncidents.ts",
    "src/lib/deterministicSql/telemetryWeatherGap.ts",
    "src/lib/deterministicSql/lap1Positions.ts",
    "src/lib/deterministicSql/wetCrossover.ts",
    "src/lib/deterministicSql/brakeZones.ts",
    "src/lib/deterministicSql/cornerDelta.ts",
    "src/lib/deterministicSql/sectorDominance.ts",
    "src/lib/deterministicSql/speedMap.ts",
    "src/lib/deterministicSql/raceTrace.ts",
    "src/lib/deterministicSql/degradationCurve.ts",
    "src/lib/deterministicSql/positionChanges.ts",
    "src/lib/deterministicSql/telemetryOverlay.ts",
    "src/lib/deterministicSql/result.ts",
    "src/lib/deterministicSql/dataHealth.ts",
    "src/lib/deterministicSql/telemetry.ts",
    "src/lib/deterministicSql/sessionTypeShare.ts",
    "src/lib/deterministicSql.ts"
  ];
  for (const rel of files) {
    const src = await readFile(path.resolve(webRoot, rel), "utf8");
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const flat = rel.endsWith("deterministicSql.ts")
      ? "deterministicSql.mjs"
      : path.basename(rel).replace(/\.ts$/, ".mjs");
    // Rewrite imports to point at flat sibling .mjs files in the tmp dir.
    let rewritten = out;
    rewritten = rewritten.replace(/from\s+["']\.\/types["']/g, 'from "./types.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/topicGuards["']/g, 'from "./topicGuards.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/pace["']/g, 'from "./pace.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/strategy["']/g, 'from "./strategy.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/pitCycle["']/g, 'from "./pitCycle.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/paceCliff["']/g, 'from "./paceCliff.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/inferredOvertakes["']/g, 'from "./inferredOvertakes.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/minisectorDominance["']/g, 'from "./minisectorDominance.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/stintDelta["']/g, 'from "./stintDelta.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/strategySplit["']/g, 'from "./strategySplit.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/(performanceRadar|raceControlIncidents|telemetryWeatherGap|lap1Positions|wetCrossover|brakeZones|cornerDelta|sectorDominance|speedMap|raceTrace|degradationCurve|positionChanges|telemetryOverlay)["']/g, 'from "./$1.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/result["']/g, 'from "./result.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/dataHealth["']/g, 'from "./dataHealth.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/telemetry["']/g, 'from "./telemetry.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/sessionTypeShare["']/g, 'from "./sessionTypeShare.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/topicGuards["']/g, 'from "./topicGuards.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/types["']/g, 'from "./types.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/pace["']/g, 'from "./pace.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/strategy["']/g, 'from "./strategy.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/pitCycle["']/g, 'from "./pitCycle.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/paceCliff["']/g, 'from "./paceCliff.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/inferredOvertakes["']/g, 'from "./inferredOvertakes.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/minisectorDominance["']/g, 'from "./minisectorDominance.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/stintDelta["']/g, 'from "./stintDelta.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/strategySplit["']/g, 'from "./strategySplit.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/(performanceRadar|raceControlIncidents|telemetryWeatherGap|lap1Positions|wetCrossover|brakeZones|cornerDelta|sectorDominance|speedMap|raceTrace|degradationCurve|positionChanges|telemetryOverlay)["']/g, 'from "./$1.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/result["']/g, 'from "./result.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/dataHealth["']/g, 'from "./dataHealth.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/telemetry["']/g, 'from "./telemetry.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/sessionTypeShare["']/g, 'from "./sessionTypeShare.mjs"');
    await writeFile(path.join(dir, flat), rewritten, "utf8");
  }
  const mod = await import(path.join(dir, "deterministicSql.mjs"));
  return { mod, dir };
}

test("incident phrasing: tyre-stint comparison routes to strategy-split, not a pace template", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "Compare the tyre stint strategies of Yuki Tsunoda and Oscar Piastri in the Bahrain Grand Prix 2025 race.",
      { sessionKey: 9839, driverNumbers: [22, 81] }
    );
    // Historically this asserted null (the fix for the pace-template
    // false match dropped it to LLM-gen). The driver_pair_strategy_split
    // card now owns this phrasing deterministically.
    assert.ok(result, "tyre-stint strategy comparison must hit the strategy-split card");
    assert.equal(result.templateKey, "driver_pair_strategy_split");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clean pace comparison still matches a pace template", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "Compare the lap pace of Max Verstappen and Charles Leclerc in the Abu Dhabi 2025 race.",
      { sessionKey: 9839, driverNumbers: [1, 16] }
    );
    assert.ok(result, "pace comparison must hit a deterministic template");
    assert.match(result.templateKey, /lap_pace|avg_clean_lap_pace|fastest_lap/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dataHealth canonical-id lookup is not blocked by topic guards", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "What session corresponds to Abu Dhabi 2025 Race in canonical IDs?",
      {}
    );
    assert.ok(result, "canonical-id lookup must still hit deterministic_template");
    assert.equal(result.templateKey, "canonical_id_lookup_abu_dhabi_2025_race");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Monaco 2025 telemetry coverage phrasing routes to the scoped data-health template", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "Which session at Monaco 2025 had the most complete telemetry coverage across all 20 drivers?",
      {}
    );
    assert.ok(result, "Monaco telemetry coverage query must hit a deterministic template");
    assert.equal(result.templateKey, "monaco_2025_sessions_most_complete_telemetry_coverage");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("single-driver pit-cycle phrasing routes to single_driver_pit_cycle", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "What was Verstappen's first stop lap number at Canada 2025 and what happened in the cycle?",
      { sessionKey: 9963, driverNumbers: [1] }
    );
    assert.ok(result, "pit-cycle question must hit a deterministic template");
    assert.equal(result.templateKey, "single_driver_pit_cycle");
    assert.match(result.sql, /pit_sequence = 1/);
    assert.match(result.sql, /phase_label/);
    // The read-only SQL guard rejects multi-statement input by splitting on
    // ";" — a stray semicolon anywhere (even in a comment) fails the template
    // at execution and silently drops to the heuristic fallback. Guard it.
    assert.ok(!result.sql.includes(";"), "template SQL must contain no semicolons");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pit-cycle ordinal + last selector resolve the right pit_sequence", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const second = mod.buildDeterministicSqlTemplate(
      "Hamilton's second pit stop at Canada 2025 — what happened in the cycle?",
      { sessionKey: 9963, driverNumbers: [44] }
    );
    assert.equal(second?.templateKey, "single_driver_pit_cycle");
    assert.match(second.sql, /pit_sequence = 2/);
    const last = mod.buildDeterministicSqlTemplate(
      "Russell's last pit stop cycle at Canada 2025",
      { sessionKey: 9963, driverNumbers: [63] }
    );
    assert.equal(last?.templateKey, "single_driver_pit_cycle");
    assert.match(last.sql, /MAX\(pit_sequence\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pace-cliff / graining phrasing routes to single_driver_pace_cliff", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "Did Piastri's front-right graining at Imola coincide with a pace cliff before his stop?",
      { sessionKey: 9987, driverNumbers: [81] }
    );
    assert.ok(result, "pace-cliff question must hit a deterministic template");
    assert.equal(result.templateKey, "single_driver_pace_cliff");
    assert.match(result.sql, /is_cliff_onset/);
    assert.match(result.sql, /rolling_avg_prev3/);
    assert.ok(!result.sql.includes(";"), "template SQL must contain no semicolons");
    // The read-only guard scans the whole text (incl. comments) for banned
    // DDL/DML keywords — a stray "drop"/"create"/etc. fails the query.
    assert.ok(
      !/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i.test(result.sql),
      "template SQL must not contain banned SQL keywords (check comments)"
    );
    // Must not collide with the pit-cycle template.
    const pitCycle = mod.buildDeterministicSqlTemplate(
      "What was Verstappen's first stop lap at Canada 2025 and what happened in the cycle?",
      { sessionKey: 9963, driverNumbers: [1] }
    );
    assert.equal(pitCycle?.templateKey, "single_driver_pit_cycle");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("overtake phrasing routes to inferred_overtakes (session-scoped)", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "What percentage of Singapore 2025 overtakes happened in the new fourth DRS zone?",
      { sessionKey: 9896, driverNumbers: [] }
    );
    assert.ok(result, "overtake question must hit a deterministic template");
    assert.equal(result.templateKey, "inferred_overtakes");
    assert.match(result.sql, /position_history/);
    assert.match(result.sql, /pit_laps/);
    assert.ok(!result.sql.includes(";"), "template SQL must contain no semicolons");
    assert.ok(
      !/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i.test(result.sql),
      "template SQL must not contain banned SQL keywords"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("minisector phrasing routes to minisector_dominance (driver pair)", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "Which minisectors did Verstappen dominate vs Norris in Sector 2 at Silverstone qualifying?",
      { sessionKey: 9943, driverNumbers: [1, 4] }
    );
    assert.ok(result, "minisector question must hit a deterministic template");
    assert.equal(result.templateKey, "minisector_dominance");
    assert.match(result.sql, /minisector_dominance/);
    assert.match(result.sql, /track_segments/);
    assert.ok(!result.sql.includes(";"), "template SQL must contain no semicolons");
    assert.ok(
      !/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i.test(result.sql),
      "template SQL must not contain banned SQL keywords"
    );
    // Needs a pair: a single driver must NOT fire it.
    const single = mod.buildDeterministicSqlTemplate(
      "Which minisectors did Verstappen dominate at Silverstone qualifying?",
      { sessionKey: 9943, driverNumbers: [1] }
    );
    assert.notEqual(single?.templateKey, "minisector_dominance");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pit-cycle template does NOT fire for pair questions or count questions", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    // Two drivers resolved → single-driver branch skipped.
    const pair = mod.buildDeterministicSqlTemplate(
      "Compare Verstappen and Leclerc first stop at Canada 2025",
      { sessionKey: 9963, driverNumbers: [1, 16] }
    );
    assert.notEqual(pair?.templateKey, "single_driver_pit_cycle");
    // "how many" is a count question, not a single-cycle detail.
    const count = mod.buildDeterministicSqlTemplate(
      "How many pit stops did Verstappen make at Canada 2025?",
      { sessionKey: 9963, driverNumbers: [1] }
    );
    assert.notEqual(count?.templateKey, "single_driver_pit_cycle");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("telemetry top-speed phrasing matched by the inline template clears the guard", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    // Uses the exact phrase the inline template matches on
    // (`deterministicSql.ts:464` — "higher top speed").
    const result = mod.buildDeterministicSqlTemplate(
      "Who had the higher top speed between Max Verstappen and Charles Leclerc at Abu Dhabi 2025?",
      { sessionKey: 9839, driverNumbers: [1, 16] }
    );
    assert.ok(result, "top-speed comparison must hit a deterministic template");
    assert.equal(result.templateKey, "max_leclerc_top_speed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
