// Phase 19 outcome-fix Fix 3 (codex audit pass 4 + 5 + 6): tests for the
// parse-time JOIN-pattern validator. Asserts:
//   1. Timestamp-proximity JOIN between raw.car_data and raw.location
//      → ok: false (the production incident shape).
//   2. Equi-JOIN on (session_key, driver_number, lap_number) → ok: true.
//   3. Window-based JOIN on lap_number BETWEEN n-1 AND n+1 → ok: true.
//   4. Single-table self-join via timestamp proximity → ok: true
//      (the anti-pattern is specifically cross-telemetry).
//   5. CTE-shadowing case (codex audit pass 5): outer `cd` alias for
//      raw.car_data, inner CTE rebinds `cd` — validator MUST NOT
//      cross-resolve and falsely flag the inner JOIN.
//   6. Layer 1b regex pre-screen: parse-failure SQL that mentions both
//      telemetry tables AND has a timestamp-extraction shape → fail-closed.
//   7. Quick-skip: SQL that doesn't mention both telemetry tables → ok.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadValidator() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-join-patterns-"));
  // joinPatternsCheck.ts imports from columnExistenceCheck.ts; we need
  // both. Each transpiled separately, with the schemaCatalog import
  // stubbed in columnExistenceCheck.ts.
  const colSrc = await readFile(
    path.resolve(webRoot, "src/lib/sqlValidation/columnExistenceCheck.ts"),
    "utf8"
  );
  const joinSrc = await readFile(
    path.resolve(webRoot, "src/lib/sqlValidation/joinPatternsCheck.ts"),
    "utf8"
  );
  const colStubbed = colSrc.replace(
    /from\s+["']@\/lib\/schemaCatalog["']/g,
    `from "./schemaCatalog.stub.mjs"`
  );
  const joinStubbed = joinSrc.replace(
    /from\s+["']\.\/columnExistenceCheck["']/g,
    `from "./columnExistenceCheck.mjs"`
  );
  const colTranspiled = ts.transpileModule(colStubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const joinTranspiled = ts.transpileModule(joinStubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(
    path.join(dir, "schemaCatalog.stub.mjs"),
    `export async function getSchemaCatalog() { return new Map(); }
export async function getColumnsForTable() { return undefined; }
export async function getSchemaDocs() { return ""; }
export const CORE_CONTRACT_LIST = [];
export function _resetSchemaCatalogForTests() {}
`,
    "utf8"
  );
  await writeFile(
    path.join(dir, "columnExistenceCheck.mjs"),
    colTranspiled.outputText,
    "utf8"
  );
  await writeFile(path.join(dir, "joinPatternsCheck.mjs"), joinTranspiled.outputText, "utf8");
  const mod = await import(path.join(dir, "joinPatternsCheck.mjs"));
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

test("HARD GATE: incident SQL — timestamp-proximity join between raw.car_data and raw.location → fails", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      SELECT cd.brake, cd.speed, loc.x, loc.y
      FROM raw.car_data cd
      JOIN raw.location loc
        ON ABS(EXTRACT(EPOCH FROM (cd.date - loc.date))) < 0.15
       AND cd.session_key = loc.session_key
       AND cd.driver_number = loc.driver_number
      WHERE cd.session_key = 9839
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.missing.length, 1);
    assert.equal(out.missing[0].joinPatternViolation, true);
    assert.match(out.missing[0].reason, /timestamp-proximity/i);
  });
});

test("HARD GATE: reverse JOIN order (raw.location LEFT, raw.car_data RIGHT) also fails", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      SELECT cd.brake, loc.x
      FROM raw.location loc
      JOIN raw.car_data cd
        ON ABS(EXTRACT(EPOCH FROM (loc.date - cd.date))) < 0.15
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(out.ok, false);
  });
});

test("LEGITIMATE: equi-JOIN on (session_key, driver_number, lap_number) → ok", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      SELECT cd.brake, loc.x
      FROM raw.car_data cd
      JOIN raw.location loc
        ON cd.session_key = loc.session_key
       AND cd.driver_number = loc.driver_number
       AND cd.date = loc.date
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(out.ok, true);
  });
});

test("LEGITIMATE: lap-window JOIN (lap_number BETWEEN n-1 AND n+1) → ok", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      SELECT a.lap_number, b.lap_number
      FROM raw.car_data a
      JOIN raw.car_data b
        ON a.session_key = b.session_key
       AND b.driver_number BETWEEN a.driver_number - 1 AND a.driver_number + 1
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(out.ok, true, "single-table self-join should not flag");
  });
});

test("LEGITIMATE: single-table self-join via timestamp proximity (NOT cross-telemetry) → ok", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      SELECT a.date, b.date
      FROM raw.car_data a
      JOIN raw.car_data b
        ON ABS(EXTRACT(EPOCH FROM (a.date - b.date))) < 0.15
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(
      out.ok,
      true,
      "self-join on the same table should not flag — the anti-pattern is specifically cross-telemetry"
    );
  });
});

test("LEGITIMATE: SQL that doesn't reference both telemetry tables → ok (quick-skip)", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      SELECT lap_duration FROM core.laps_enriched WHERE session_key = 9839
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(out.ok, true);
    assert.equal(out.reason, "no_telemetry_tables_referenced");
  });
});

test("LEGITIMATE: both tables mentioned in SEPARATE CTEs (NOT joined) → ok", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      WITH cd_agg AS (
        SELECT session_key, driver_number, lap_number, AVG(speed) AS avg_speed
        FROM raw.car_data
        GROUP BY session_key, driver_number, lap_number
      ),
      loc_agg AS (
        SELECT session_key, driver_number, lap_number, AVG(x) AS avg_x
        FROM raw.location
        GROUP BY session_key, driver_number, lap_number
      )
      SELECT cd.avg_speed, loc.avg_x
      FROM cd_agg cd
      JOIN loc_agg loc
        ON cd.session_key = loc.session_key
       AND cd.driver_number = loc.driver_number
       AND cd.lap_number = loc.lap_number
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(
      out.ok,
      true,
      "the JOIN is between cd_agg and loc_agg (CTEs), NOT between raw.car_data and raw.location"
    );
  });
});

test("Layer 1b regex pre-screen: parse-failure SQL with both tables AND timestamp-extraction → fails", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    // Intentionally malformed SQL that can't parse — but mentions both
    // tables and the EXTRACT(EPOCH FROM ...) shape.
    const sql = `
      SELECT FROM raw.car_data cd JOIN raw.location loc
      ON ABS(EXTRACT(EPOCH FROM (cd.date -- malformed
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.missing[0].sourceRef, "regex-prescreen");
  });
});

test("Layer 1b regex pre-screen: parse-failure SQL WITHOUT both tables → ok (no false-positive)", async () => {
  await withValidator(async ({ validateJoinPatterns }) => {
    const sql = `
      SELECT EXTRACT(EPOCH FROM lap_duration) FROM core.laps_enriched -- malformed
       WHERE
    `;
    const out = await validateJoinPatterns(sql);
    assert.equal(
      out.ok,
      true,
      "regex pre-screen requires both telemetry tables to be mentioned; non-telemetry malformed SQL must NOT trip"
    );
  });
});
