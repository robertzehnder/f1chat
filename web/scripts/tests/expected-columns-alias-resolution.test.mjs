// Phase 19-A (rev5 + rev6): tests for the exported
// `extractQualifiedColumnRefs` helper. Slice 19-D's expected-columns
// matcher consumes only this helper, so the alias-resolution behaviour
// across explicit-AS / implicit-alias / unaliased-direct-table /
// CTE-projected forms is the contract gate for Phase 19's "the LLM
// picked the right contract" assertion.
//
// rev6 introduced tri-state outcome semantics (pass | fail | skipped).
// The matcher itself ships with Slice 19-D; this test verifies the
// helper layer produces the right `refs` / `unresolvedAliases` so the
// matcher can implement the tri-state correctly without touching the
// parser layer.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const validatorSourcePath = path.resolve(webRoot, "src/lib/sqlValidation/columnExistenceCheck.ts");

const FAKE_CATALOG_ENTRIES = [
  [
    "analytics.corner_analysis",
    [
      "session_key",
      "driver_number",
      "circuit_short_name",
      "corner_id",
      "entry_speed_kph",
      "apex_min_speed_kph",
      "exit_speed_kph"
    ]
  ],
  [
    "analytics.sector_dominance",
    [
      "session_key",
      "driver_number",
      "sector_index",
      "dominant_count"
    ]
  ]
];

const SCHEMA_CATALOG_STUB = `
const FAKE_CATALOG = new Map(${JSON.stringify(FAKE_CATALOG_ENTRIES)});
export async function getSchemaCatalog() { return FAKE_CATALOG; }
export async function getColumnsForTable(schema, table) {
  return FAKE_CATALOG.get(schema + "." + table);
}
export async function getSchemaDocs() { return ""; }
export const CORE_CONTRACT_LIST = [];
export function _resetSchemaCatalogForTests() {}
`;

async function loadHelper() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-extract-refs-"));
  const validatorSrc = await readFile(validatorSourcePath, "utf8");
  const stubbed = validatorSrc.replace(
    /from\s+["']@\/lib\/schemaCatalog["']/g,
    `from "./schemaCatalog.stub.mjs"`
  );
  const transpiled = ts.transpileModule(stubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "schemaCatalog.stub.mjs"), SCHEMA_CATALOG_STUB, "utf8");
  await writeFile(path.join(dir, "columnExistenceCheck.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "columnExistenceCheck.mjs"));
  return { mod, dir };
}

async function withHelper(fn) {
  const { mod, dir } = await loadHelper();
  try {
    await fn(mod);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function refKeys(refs) {
  return refs.map((r) => `${r.schema}.${r.table}.${r.column}`).sort();
}

test("explicit alias (FROM analytics.corner_analysis AS ca) resolves through the alias map", async () => {
  await withHelper(async ({ extractQualifiedColumnRefs }) => {
    const sql = `SELECT ca.entry_speed_kph, ca.apex_min_speed_kph
                 FROM analytics.corner_analysis AS ca
                 WHERE ca.session_key = 9839`;
    const out = await extractQualifiedColumnRefs(sql);
    assert.equal(out.ok, true);
    assert.deepEqual(refKeys(out.refs), [
      "analytics.corner_analysis.apex_min_speed_kph",
      "analytics.corner_analysis.entry_speed_kph",
      "analytics.corner_analysis.session_key"
    ]);
    assert.deepEqual(out.unresolvedAliases, []);
    for (const ref of out.refs) {
      assert.equal(ref.resolvedFromAlias, true);
    }
  });
});

test("implicit alias (no AS) resolves identically", async () => {
  await withHelper(async ({ extractQualifiedColumnRefs }) => {
    const sql = `SELECT ca.entry_speed_kph
                 FROM analytics.corner_analysis ca`;
    const out = await extractQualifiedColumnRefs(sql);
    assert.equal(out.ok, true);
    assert.deepEqual(refKeys(out.refs), ["analytics.corner_analysis.entry_speed_kph"]);
    assert.deepEqual(out.unresolvedAliases, []);
  });
});

test("unaliased direct table (FROM analytics.corner_analysis) resolves via single-FROM rule", async () => {
  await withHelper(async ({ extractQualifiedColumnRefs }) => {
    const sql = `SELECT entry_speed_kph FROM analytics.corner_analysis`;
    const out = await extractQualifiedColumnRefs(sql);
    assert.equal(out.ok, true);
    assert.deepEqual(refKeys(out.refs), ["analytics.corner_analysis.entry_speed_kph"]);
    for (const ref of out.refs) {
      assert.equal(ref.resolvedFromAlias, false);
    }
  });
});

test("table.column reference without alias still resolves", async () => {
  await withHelper(async ({ extractQualifiedColumnRefs }) => {
    const sql = `SELECT corner_analysis.entry_speed_kph FROM analytics.corner_analysis`;
    const out = await extractQualifiedColumnRefs(sql);
    assert.equal(out.ok, true);
    const keys = refKeys(out.refs);
    assert.ok(keys.includes("analytics.corner_analysis.entry_speed_kph"), `got: ${JSON.stringify(keys)}`);
  });
});

test("CTE alias is reported in unresolvedAliases — does NOT crash, does NOT false-resolve", async () => {
  await withHelper(async ({ extractQualifiedColumnRefs }) => {
    const sql = `WITH ce AS (
                   SELECT session_key, driver_number, AVG(entry_speed_kph) AS avg_entry
                   FROM analytics.corner_analysis
                   GROUP BY session_key, driver_number
                 )
                 SELECT ce.avg_entry FROM ce WHERE ce.session_key = 9839`;
    const out = await extractQualifiedColumnRefs(sql);
    assert.equal(out.ok, true, "CTE-projected SQL must not crash");
    // The CTE body's column refs ARE resolved (analytics.corner_analysis.entry_speed_kph etc.).
    const keys = refKeys(out.refs);
    assert.ok(
      keys.includes("analytics.corner_analysis.entry_speed_kph"),
      `expected base-table refs from CTE body, got: ${JSON.stringify(keys)}`
    );
    // But ce.avg_entry MUST NOT resolve to a base-table ref — it's CTE-projected.
    assert.ok(
      !keys.some((k) => k.endsWith(".avg_entry")),
      "CTE-projected column ce.avg_entry must NOT resolve to a base-table ref"
    );
    // And ce should appear in unresolvedAliases so Slice 19-D's matcher can
    // emit kind: "skipped" with reason: "cte_unresolved".
    assert.ok(
      out.unresolvedAliases.includes("ce"),
      `expected "ce" in unresolvedAliases, got: ${JSON.stringify(out.unresolvedAliases)}`
    );
  });
});

test("malformed SQL returns ok:false (so matcher emits kind:'skipped' reason:'parse_failed')", async () => {
  await withHelper(async ({ extractQualifiedColumnRefs }) => {
    const out = await extractQualifiedColumnRefs("SELECT FROM WHERE");
    assert.equal(out.ok, false);
    assert.deepEqual(out.refs, []);
    assert.deepEqual(out.unresolvedAliases, []);
  });
});

test("multi-table JOIN resolves each alias to its own owning table", async () => {
  await withHelper(async ({ extractQualifiedColumnRefs }) => {
    const sql = `SELECT ca.entry_speed_kph, sd.dominant_count
                 FROM analytics.corner_analysis AS ca
                 JOIN analytics.sector_dominance AS sd
                   ON ca.session_key = sd.session_key
                  AND ca.driver_number = sd.driver_number`;
    const out = await extractQualifiedColumnRefs(sql);
    assert.equal(out.ok, true);
    const keys = refKeys(out.refs);
    assert.ok(keys.includes("analytics.corner_analysis.entry_speed_kph"));
    assert.ok(keys.includes("analytics.sector_dominance.dominant_count"));
    assert.ok(keys.includes("analytics.corner_analysis.session_key"));
    assert.ok(keys.includes("analytics.sector_dominance.session_key"));
  });
});

test("validateColumnExistence still passes valid SQL after the refactor", async () => {
  await withHelper(async ({ validateColumnExistence }) => {
    const sql = `SELECT ca.entry_speed_kph
                 FROM analytics.corner_analysis AS ca
                 WHERE ca.session_key = 9839`;
    const out = await validateColumnExistence(sql);
    assert.equal(out.ok, true);
  });
});

test("validateColumnExistence catches a hallucinated column on the new helper", async () => {
  await withHelper(async ({ validateColumnExistence }) => {
    const sql = `SELECT ca.brake_temperature_celsius
                 FROM analytics.corner_analysis AS ca`;
    const out = await validateColumnExistence(sql);
    assert.equal(out.ok, false);
    if (out.ok === true) return;
    assert.equal(out.missing[0].column, "brake_temperature_celsius");
    assert.equal(out.missing[0].table, "analytics.corner_analysis");
  });
});
