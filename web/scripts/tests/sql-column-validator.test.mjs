// Phase 17-C: pre-execute column-existence validator tests. Hits the
// pgsql-ast-parser layer with the production-incident SQL plus alias-form,
// JOIN-ON, CTE, and unqualified-ref fixtures. Mocks the schema catalog so
// the test does not require a live DB.

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
    "core.stint_summary",
    [
      "session_key",
      "meeting_key",
      "year",
      "session_name",
      "session_type",
      "country_name",
      "location",
      "driver_number",
      "driver_name",
      "team_name",
      "stint_number",
      "compound_name",
      "lap_start",
      "lap_end",
      "tyre_age_at_start",
      "fresh_tyre",
      "stint_length_laps",
      "lap_count",
      "valid_lap_count",
      "avg_lap",
      "best_lap",
      "avg_valid_lap",
      "best_valid_lap"
    ]
  ],
  [
    "core.session_drivers",
    [
      "session_key",
      "meeting_key",
      "driver_number",
      "full_name",
      "team_name",
      "broadcast_name",
      "name_acronym"
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

async function loadValidator() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-sql-validator-"));
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

async function withValidator(fn) {
  const { mod, dir } = await loadValidator();
  try {
    await fn(mod);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("incident-replay fixture: catches all four hallucinated columns from 2026-05-02", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const sql = `SELECT ss.driver_number, ss.stint_number, ss.compound,
                        ss.stint_start_lap, ss.stint_end_lap, ss.stint_lap_count
                 FROM core.stint_summary ss
                 WHERE ss.session_key = 9662`;
    const result = await validateColumnExistence(sql);
    assert.equal(result.ok, false);
    if (result.ok === true) return;
    const refs = result.missing.map((m) => m.sourceRef).sort();
    assert.deepEqual(refs, [
      "ss.compound",
      "ss.stint_end_lap",
      "ss.stint_lap_count",
      "ss.stint_start_lap"
    ]);
    for (const m of result.missing) {
      assert.equal(m.table, "core.stint_summary");
    }
  });
});

test("alias form: AS ss → catches missing column", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const result = await validateColumnExistence(
      "SELECT ss.compound FROM core.stint_summary AS ss"
    );
    assert.equal(result.ok, false);
    if (result.ok === true) return;
    assert.equal(result.missing[0].column, "compound");
    assert.equal(result.missing[0].table, "core.stint_summary");
  });
});

test("alias form: implicit alias (no AS) → catches missing column", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const result = await validateColumnExistence("SELECT ss.compound FROM core.stint_summary ss");
    assert.equal(result.ok, false);
  });
});

test("alias form: no alias, unqualified ref → resolves to single FROM table", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const result = await validateColumnExistence("SELECT compound FROM core.stint_summary");
    assert.equal(result.ok, false);
    if (result.ok === true) return;
    assert.equal(result.missing[0].column, "compound");
  });
});

test("multi-table FROM: catches alias-qualified miss, allows real cols", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const sql = `SELECT ss.compound, sd.full_name
                 FROM core.stint_summary ss
                 JOIN core.session_drivers sd ON ss.session_key = sd.session_key`;
    const result = await validateColumnExistence(sql);
    assert.equal(result.ok, false);
    if (result.ok === true) return;
    const refs = result.missing.map((m) => m.sourceRef);
    assert.ok(refs.includes("ss.compound"));
    assert.ok(!refs.includes("sd.full_name"));
  });
});

test("JOIN-ON predicate: missing column on left of = is caught", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const sql = `SELECT ss.compound_name FROM core.stint_summary ss
                 JOIN core.session_drivers sd ON ss.fake_driver = sd.driver_number`;
    const result = await validateColumnExistence(sql);
    assert.equal(result.ok, false);
    if (result.ok === true) return;
    const refs = result.missing.map((m) => m.sourceRef);
    assert.ok(refs.includes("ss.fake_driver"));
  });
});

test("JOIN-ON predicate: missing column on right of = is caught", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const sql = `SELECT ss.compound_name FROM core.stint_summary ss
                 JOIN core.session_drivers sd ON ss.session_key = sd.bogus_key`;
    const result = await validateColumnExistence(sql);
    assert.equal(result.ok, false);
    if (result.ok === true) return;
    const refs = result.missing.map((m) => m.sourceRef);
    assert.ok(refs.includes("sd.bogus_key"));
  });
});

test("JOIN-ON predicate: compound AND-joined predicate catches missing column", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const sql = `SELECT ss.compound_name FROM core.stint_summary ss
                 LEFT JOIN core.session_drivers sd
                 ON ss.session_key = sd.session_key AND sd.invalid_col IS NOT NULL`;
    const result = await validateColumnExistence(sql);
    assert.equal(result.ok, false);
    if (result.ok === true) return;
    const refs = result.missing.map((m) => m.sourceRef);
    assert.ok(refs.includes("sd.invalid_col"));
  });
});

test("negative coverage: all real columns → ok:true", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const sql = `SELECT ss.compound_name, ss.lap_start, ss.stint_length_laps
                 FROM core.stint_summary ss`;
    const result = await validateColumnExistence(sql);
    assert.equal(result.ok, true);
  });
});

test("CTE alias is treated as derived, not validated against information_schema", async () => {
  await withValidator(async ({ validateColumnExistence }) => {
    const sql = `WITH foo AS (SELECT 1 AS x) SELECT foo.x FROM foo`;
    const result = await validateColumnExistence(sql);
    assert.equal(result.ok, true);
  });
});
