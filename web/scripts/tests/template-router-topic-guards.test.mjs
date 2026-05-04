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
    "src/lib/deterministicSql/result.ts",
    "src/lib/deterministicSql/dataHealth.ts",
    "src/lib/deterministicSql/telemetry.ts",
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
    rewritten = rewritten.replace(/from\s+["']\.\/result["']/g, 'from "./result.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/dataHealth["']/g, 'from "./dataHealth.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/telemetry["']/g, 'from "./telemetry.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/topicGuards["']/g, 'from "./topicGuards.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/types["']/g, 'from "./types.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/pace["']/g, 'from "./pace.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/strategy["']/g, 'from "./strategy.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/result["']/g, 'from "./result.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/dataHealth["']/g, 'from "./dataHealth.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/telemetry["']/g, 'from "./telemetry.mjs"');
    await writeFile(path.join(dir, flat), rewritten, "utf8");
  }
  const mod = await import(path.join(dir, "deterministicSql.mjs"));
  return { mod, dir };
}

test("incident phrasing: tyre-stint comparison no longer falls into pace template", async () => {
  const { mod, dir } = await loadDeterministicSql();
  try {
    const result = mod.buildDeterministicSqlTemplate(
      "Compare the tyre stint strategies of Yuki Tsunoda and Oscar Piastri in the Bahrain Grand Prix 2025 race.",
      { sessionKey: 9839, driverNumbers: [22, 81] }
    );
    assert.equal(result, null, "tyre-stint comparison must NOT match a pace template");
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
