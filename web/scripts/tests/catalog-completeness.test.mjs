import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const sessionsQueriesUrl = new URL("../../src/lib/queries/sessions.ts", import.meta.url);
const completenessTableUrl = new URL("../../src/app/catalog/completeness/CompletenessTable.tsx", import.meta.url);
const pageUrl = new URL("../../src/app/catalog/completeness/page.tsx", import.meta.url);

const COMPLETENESS_COLUMNS = [
  "session_key",
  "meeting_key",
  "year",
  "meeting_name",
  "session_name",
  "normalized_session_type",
  "country_name",
  "date_start",
  "completeness_status",
  "completeness_score",
  "has_core_analysis_pack",
  "has_drivers",
  "has_laps",
  "has_pit",
  "has_stints",
  "has_weather",
  "has_team_radio",
  "has_position_history",
  "has_intervals",
  "has_car_data",
  "has_location",
  "has_session_result",
  "has_starting_grid",
  "has_race_control"
];

const HAS_FLAG_COLUMNS = [
  "has_core_analysis_pack",
  "has_drivers",
  "has_laps",
  "has_pit",
  "has_stints",
  "has_weather",
  "has_team_radio",
  "has_position_history",
  "has_intervals",
  "has_car_data",
  "has_location",
  "has_session_result",
  "has_starting_grid",
  "has_race_control"
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

test("G1: getCatalogCompleteness queries core.session_completeness with the required SQL contract", () => {
  const source = readFileSync(sessionsQueriesUrl, "utf8");

  const decl = source.indexOf("export async function getCatalogCompleteness");
  assert.notEqual(
    decl,
    -1,
    "sessions.ts must declare `export async function getCatalogCompleteness`"
  );

  const body = extractFunctionBody(source, decl);

  assert.ok(
    body.includes("FROM core.session_completeness"),
    "getCatalogCompleteness body must select FROM core.session_completeness"
  );
  assert.ok(
    body.includes("WHERE"),
    "getCatalogCompleteness body must include a WHERE clause"
  );
  assert.ok(
    !body.includes("raw."),
    "getCatalogCompleteness must not reference any raw.* table (Phase 10 requires the materialized core.session_completeness view)"
  );

  for (const column of COMPLETENESS_COLUMNS) {
    assert.ok(
      body.includes(column),
      `getCatalogCompleteness body must reference column \`${column}\``
    );
  }

  const locationMatches = (body.match(/location/g) ?? []).length;
  assert.ok(
    locationMatches >= 2,
    `getCatalogCompleteness body must reference both bare \`location\` and \`has_location\` (saw ${locationMatches} occurrences of /location/)`
  );

  assert.ok(
    body.includes("$1::int IS NULL OR year = $1"),
    "getCatalogCompleteness body must include the year-filter predicate `$1::int IS NULL OR year = $1`"
  );
  assert.ok(
    body.includes("$2::text IS NULL OR completeness_status = $2"),
    "getCatalogCompleteness body must include the status-filter predicate `$2::text IS NULL OR completeness_status = $2`"
  );
  assert.ok(
    body.includes("ORDER BY date_start DESC NULLS LAST, session_key DESC"),
    "getCatalogCompleteness body must include `ORDER BY date_start DESC NULLS LAST, session_key DESC`"
  );
  assert.ok(
    body.includes("safeLimit"),
    "getCatalogCompleteness body must reference `safeLimit` (bounded LIMIT)"
  );
  assert.ok(
    body.includes("clampInt"),
    "getCatalogCompleteness body must reference `clampInt` (bounded OFFSET)"
  );
});

test("G2: CompletenessTable.tsx exists, exports a default function, and references all required columns + has_* flags", () => {
  assert.ok(existsSync(completenessTableUrl), "CompletenessTable.tsx must exist");

  const src = readFileSync(completenessTableUrl, "utf8");

  assert.ok(
    /export\s+default\s+function\b/.test(src),
    "CompletenessTable.tsx must export a default function"
  );

  const requiredSubstrings = [
    'data-testid="completeness-row"',
    'data-testid="completeness-status"',
    'data-testid="completeness-coverage"',
    "session_key",
    "year",
    "meeting_name",
    "normalized_session_type",
    "completeness_status",
    "completeness_score"
  ];
  for (const needle of requiredSubstrings) {
    assert.ok(
      src.includes(needle),
      `CompletenessTable.tsx must contain literal substring \`${needle}\``
    );
  }

  for (const flag of HAS_FLAG_COLUMNS) {
    assert.ok(
      src.includes(flag),
      `CompletenessTable.tsx must reference contract-coverage column identifier \`${flag}\``
    );
  }
});

test("G3: page.tsx wires the awaited getCatalogCompleteness result into <CompletenessTable rows={...}> via a name binding", () => {
  const source = readFileSync(pageUrl, "utf8");

  assert.ok(
    /import\s*\{[^}]*\bgetCatalogCompleteness\b[^}]*\}\s*from\s*["']@\/lib\/queries\/sessions["']/.test(source),
    "page.tsx must import `getCatalogCompleteness` from `@/lib/queries/sessions` (per-module path)"
  );

  assert.ok(
    /getCatalogCompleteness\(/.test(source),
    "page.tsx must call `getCatalogCompleteness(...)`"
  );

  const jsxMatch = source.match(/<CompletenessTable\s+rows=\{(\w+)\}/);
  assert.ok(
    jsxMatch,
    "page.tsx must render a `<CompletenessTable rows={<binding>}` JSX element"
  );
  const binding = jsxMatch[1];
  assert.ok(binding && binding.length > 0, "JSX rows binding must be a non-empty identifier");

  const constRegex = new RegExp(
    `const\\s+${binding}\\s*=\\s*await\\s+getCatalogCompleteness\\(`
  );
  assert.ok(
    constRegex.test(source),
    `page.tsx must declare \`const ${binding} = await getCatalogCompleteness(...)\` so the JSX rows prop is bound to the awaited query result by name`
  );
});

test("G4: page.tsx default-imports CompletenessTable from the sibling module path", () => {
  const source = readFileSync(pageUrl, "utf8");
  assert.ok(
    /import\s+CompletenessTable\s+from\s+["']\.\/CompletenessTable["']/.test(source),
    "page.tsx must default-import `CompletenessTable` from `./CompletenessTable`"
  );
});

test("G5: page.tsx declares `export const dynamic = \"force-dynamic\"`", () => {
  const source = readFileSync(pageUrl, "utf8");
  assert.ok(
    source.includes('export const dynamic = "force-dynamic"'),
    "page.tsx must declare `export const dynamic = \"force-dynamic\"` (matches the convention of the existing /catalog route)"
  );
});
