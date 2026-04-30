import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const sessionsQueriesUrl = new URL("../../src/lib/queries/sessions.ts", import.meta.url);
const paceTableUrl = new URL("../../src/app/sessions/[sessionKey]/PaceTable.tsx", import.meta.url);
const pageUrl = new URL("../../src/app/sessions/[sessionKey]/page.tsx", import.meta.url);

const PACE_COLUMNS = [
  "driver_number",
  "driver_name",
  "team_name",
  "lap_count",
  "valid_lap_count",
  "best_lap",
  "median_lap",
  "avg_lap",
  "best_valid_lap",
  "median_valid_lap",
  "best_s1",
  "best_s2",
  "best_s3",
  "avg_s1",
  "avg_s2",
  "avg_s3"
];

function extractFunctionBody(source, declarationStart) {
  const openBrace = source.indexOf("{", declarationStart);
  assert.notEqual(openBrace, -1, "could not find function opening brace");
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace, i + 1);
      }
    }
  }
  throw new Error("could not locate end of function body");
}

test("getSessionDriverPace queries core.driver_session_summary with all required columns", () => {
  const source = readFileSync(sessionsQueriesUrl, "utf8");

  const decl = source.indexOf("export async function getSessionDriverPace");
  assert.notEqual(
    decl,
    -1,
    "sessions.ts must declare `export async function getSessionDriverPace`"
  );

  const body = extractFunctionBody(source, decl);

  assert.ok(
    body.includes("FROM core.driver_session_summary"),
    "getSessionDriverPace body must select FROM core.driver_session_summary"
  );
  assert.ok(
    body.includes("WHERE session_key = $1"),
    "getSessionDriverPace body must filter `WHERE session_key = $1`"
  );
  assert.ok(
    !body.includes("raw.laps"),
    "getSessionDriverPace must not reference raw.laps (Phase 10 requires the materialized core.* contract)"
  );

  for (const column of PACE_COLUMNS) {
    assert.ok(
      body.includes(column),
      `getSessionDriverPace body must reference column \`${column}\``
    );
  }
});

test("PaceTable renders DataTable with a rows prop and exports a default function", () => {
  assert.ok(existsSync(paceTableUrl), "PaceTable.tsx must exist");

  const source = readFileSync(paceTableUrl, "utf8");

  assert.ok(
    /from\s+["']@\/components\/DataTable["']/.test(source),
    "PaceTable.tsx must import from `@/components/DataTable`"
  );
  assert.ok(
    /export\s+default\s+function\b/.test(source),
    "PaceTable.tsx must export a default function"
  );
  assert.ok(
    source.includes("<DataTable"),
    "PaceTable.tsx must render a `<DataTable` element"
  );
  assert.ok(
    source.includes("rows={"),
    "PaceTable.tsx must pass a `rows={...}` prop so visible columns are derived by DataTable"
  );
});

test("page.tsx wires the awaited getSessionDriverPace result into <PaceTable rows={...}> via a shared identifier", () => {
  const source = readFileSync(pageUrl, "utf8");

  assert.ok(
    /import\s*\{[^}]*\bgetSessionDriverPace\b[^}]*\}\s*from\s*["']@\/lib\/queries(?:\/sessions)?["']/.test(source),
    "page.tsx must import `getSessionDriverPace` from `@/lib/queries` or the sessions submodule"
  );

  const destructureRegex = /const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/;
  const destructureMatch = source.match(destructureRegex);
  assert.ok(
    destructureMatch,
    "page.tsx must destructure the awaited `Promise.all(...)` result with a final identifier"
  );
  const captured = destructureMatch[1];
  assert.ok(captured && captured.length > 0, "destructure regex must capture a non-empty identifier");

  assert.ok(
    /await\s+Promise\.all\(\[[\s\S]*?getSessionDriverPace\(/.test(source),
    "page.tsx `Promise.all([...])` must call `getSessionDriverPace(...)` inside its argument list"
  );

  const expectedRowsBinding = `<PaceTable rows={${captured}}`;
  assert.ok(
    source.includes(expectedRowsBinding),
    `page.tsx must pass the destructured identifier into PaceTable: expected substring \`${expectedRowsBinding}\``
  );
});
