import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const routeUrl = new URL("../../src/app/api/saved-analyses/route.ts", import.meta.url);
const listUrl = new URL("../../src/app/saved-analyses/SavedAnalysesList.tsx", import.meta.url);
const pageUrl = new URL("../../src/app/saved-analyses/page.tsx", import.meta.url);
const sqlUrl = new URL("../../../sql/021_saved_analysis.sql", import.meta.url);

test("G1: api/saved-analyses/route.ts wires GET+POST handlers to core.saved_analysis via the sql helper", () => {
  assert.ok(existsSync(routeUrl), "route.ts must exist");
  const src = readFileSync(routeUrl, "utf8");

  assert.ok(
    src.includes('export const dynamic = "force-dynamic"'),
    "route.ts must declare `export const dynamic = \"force-dynamic\"`"
  );
  assert.ok(
    /export\s+async\s+function\s+GET\b/.test(src),
    "route.ts must export an async GET handler"
  );
  assert.ok(
    /export\s+async\s+function\s+POST\b/.test(src),
    "route.ts must export an async POST handler"
  );
  assert.ok(
    /import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*["']@\/lib\/db["']/.test(src),
    "route.ts must import the `sql` helper from `@/lib/db`"
  );

  const requiredSubstrings = [
    "core.saved_analysis",
    "INSERT INTO core.saved_analysis",
    "SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis",
    "WHERE id = $1",
    "ORDER BY created_at DESC",
    "RETURNING id, name, payload, created_at, updated_at"
  ];
  for (const needle of requiredSubstrings) {
    assert.ok(
      src.includes(needle),
      `route.ts must contain literal substring \`${needle}\``
    );
  }

  assert.ok(
    !src.includes("Saved analyses persistence is not wired yet."),
    "route.ts must not retain the placeholder stub message"
  );
});

test("G2: SavedAnalysesList.tsx exists, default-exports a function, and renders id/name/created_at with required testids", () => {
  assert.ok(existsSync(listUrl), "SavedAnalysesList.tsx must exist");
  const src = readFileSync(listUrl, "utf8");

  assert.ok(
    /export\s+default\s+function\b/.test(src),
    "SavedAnalysesList.tsx must export a default function"
  );

  const requiredSubstrings = [
    'data-testid="saved-analysis-row"',
    'data-testid="saved-analysis-empty"',
    "id",
    "name",
    "created_at"
  ];
  for (const needle of requiredSubstrings) {
    assert.ok(
      src.includes(needle),
      `SavedAnalysesList.tsx must contain literal substring \`${needle}\``
    );
  }
});

test("G3: page.tsx wires the awaited sql() result into <SavedAnalysesList rows={...}> via a name binding", () => {
  assert.ok(existsSync(pageUrl), "page.tsx must exist");
  const src = readFileSync(pageUrl, "utf8");

  assert.ok(
    /import\s+SavedAnalysesList\s+from\s+["']\.\/SavedAnalysesList["']/.test(src),
    "page.tsx must default-import `SavedAnalysesList` from `./SavedAnalysesList`"
  );
  assert.ok(
    src.includes('export const dynamic = "force-dynamic"'),
    "page.tsx must declare `export const dynamic = \"force-dynamic\"`"
  );
  assert.ok(
    /import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*["']@\/lib\/db["']/.test(src),
    "page.tsx must import the `sql` helper from `@/lib/db`"
  );
  assert.ok(
    /\bsql\s*[<(]/.test(src),
    "page.tsx must invoke `sql<...>(...)` or `sql(...)`"
  );
  assert.ok(
    src.includes("FROM core.saved_analysis"),
    "page.tsx must reference `FROM core.saved_analysis`"
  );

  const jsxMatch = src.match(/<SavedAnalysesList\s+rows=\{(\w+)\}/);
  assert.ok(
    jsxMatch,
    "page.tsx must render `<SavedAnalysesList rows={<binding>}>`"
  );
  const binding = jsxMatch[1];
  assert.ok(binding && binding.length > 0, "JSX rows binding must be a non-empty identifier");

  const constRegex = new RegExp(`const\\s+${binding}\\s*=\\s*await\\s+sql\\s*[<(]`);
  assert.ok(
    constRegex.test(src),
    `page.tsx must declare \`const ${binding} = await sql<...>(...)\` so the rows prop is bound to the awaited rows-array result by name`
  );
});

test("G4: sql/021_saved_analysis.sql declares core.saved_analysis with the required schema", () => {
  assert.ok(existsSync(sqlUrl), "sql/021_saved_analysis.sql must exist");
  const src = readFileSync(sqlUrl, "utf8");

  const requiredSubstrings = [
    "CREATE TABLE IF NOT EXISTS core.saved_analysis",
    "id BIGSERIAL PRIMARY KEY",
    "name TEXT NOT NULL",
    "payload JSONB NOT NULL",
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC)",
    "saved_analysis_name_nonempty",
    "CHECK (length(btrim(name)) > 0)",
    "BEGIN;",
    "COMMIT;"
  ];
  for (const needle of requiredSubstrings) {
    assert.ok(
      src.includes(needle),
      `021_saved_analysis.sql must contain literal substring \`${needle}\``
    );
  }
});

test("G5: route.ts surfaces invalid_name and invalid_payload validation tokens", () => {
  const src = readFileSync(routeUrl, "utf8");
  assert.ok(
    src.includes("invalid_name"),
    "route.ts must reject empty name with the literal substring `invalid_name`"
  );
  assert.ok(
    src.includes("invalid_payload"),
    "route.ts must reject missing payload with the literal substring `invalid_payload`"
  );
});
