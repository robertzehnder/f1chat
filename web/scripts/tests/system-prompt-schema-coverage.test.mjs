// Phase 17-F: schema-coverage test. Asserts the prompt-fragment formatter in
// `schemaCatalog.ts` only emits column bullets for tables that actually
// exist in the catalog passed in, and that the column lists match. Uses an
// in-memory catalog so it runs without a live DB. Live-DB coverage is
// exercised by the chat-health-check suite.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const catalogSourcePath = path.resolve(webRoot, "src/lib/schemaCatalog.ts");

const FAKE_DB_TABLES = {
  "core.sessions": ["session_key", "year", "session_name", "country_name"],
  "core.stint_summary": [
    "session_key",
    "driver_number",
    "compound_name",
    "lap_start",
    "lap_end",
    "stint_length_laps"
  ]
};

const DB_STUB = `
const FAKE = ${JSON.stringify(FAKE_DB_TABLES)};
export async function sql(text, values) {
  // Pattern-match: information_schema.columns query.
  if (/information_schema\\.columns/.test(text) && Array.isArray(values)) {
    const rows = [];
    // Two cases: bulk (table_schema, table_name) IN (...) OR single
    // table_schema = $1 AND table_name = $2.
    if (values.length === 2 && /table_schema = \\$1/.test(text)) {
      const key = values[0] + "." + values[1];
      const cols = FAKE[key] || [];
      cols.forEach((column_name, idx) =>
        rows.push({ column_name, ordinal_position: idx + 1 })
      );
      return rows;
    }
    for (let i = 0; i < values.length; i += 2) {
      const schema = values[i];
      const table = values[i + 1];
      const key = schema + "." + table;
      const cols = FAKE[key];
      if (!cols) continue;
      cols.forEach((column_name, idx) =>
        rows.push({
          table_schema: schema,
          table_name: table,
          column_name,
          ordinal_position: idx + 1
        })
      );
    }
    return rows;
  }
  return [];
}
export const pool = { query: async () => ({ rows: [] }) };
export async function warmPool() {}
`;

async function loadCatalog() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-schema-catalog-"));
  const src = await readFile(catalogSourcePath, "utf8");
  const stubbed = src.replace(/from\s+["']@\/lib\/db["']/g, `from "./db.stub.mjs"`);
  const transpiled = ts.transpileModule(stubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "db.stub.mjs"), DB_STUB, "utf8");
  await writeFile(path.join(dir, "schemaCatalog.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "schemaCatalog.mjs"));
  return { mod, dir };
}

test("getSchemaDocs emits one bullet per existing core contract, with real columns", async () => {
  const { mod, dir } = await loadCatalog();
  try {
    mod._resetSchemaCatalogForTests();
    const docs = await mod.getSchemaDocs();
    assert.match(docs, /core\.sessions/);
    assert.match(docs, /core\.stint_summary/);
    // Real columns from the fake DB:
    assert.match(docs, /compound_name/);
    assert.match(docs, /stint_length_laps/);
    // Hallucinated columns from the production incident must NOT appear.
    assert.doesNotMatch(docs, /\bcompound\b(?!_name)/);
    assert.doesNotMatch(docs, /stint_start_lap/);
    assert.doesNotMatch(docs, /stint_end_lap/);
    // Tables we didn't seed (e.g. core.replay_lap_frames) should not appear,
    // since formatCatalogAsPromptDocs skips empty bullets.
    assert.doesNotMatch(docs, /core\.replay_lap_frames/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getColumnsForTable falls back to live lookup for non-curated tables", async () => {
  const { mod, dir } = await loadCatalog();
  try {
    mod._resetSchemaCatalogForTests();
    // Seed cache via getSchemaDocs first.
    await mod.getSchemaDocs();
    // Curated table → cached entry.
    const cached = await mod.getColumnsForTable("core", "stint_summary");
    assert.deepEqual(cached, [
      "session_key",
      "driver_number",
      "compound_name",
      "lap_start",
      "lap_end",
      "stint_length_laps"
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
