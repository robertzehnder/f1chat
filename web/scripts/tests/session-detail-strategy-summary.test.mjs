import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const sessionsQueriesUrl = new URL("../../src/lib/queries/sessions.ts", import.meta.url);
const strategySummaryUrl = new URL("../../src/app/sessions/[sessionKey]/StrategySummary.tsx", import.meta.url);
const pageUrl = new URL("../../src/app/sessions/[sessionKey]/page.tsx", import.meta.url);

const STRATEGY_COLUMNS = [
  "driver_number",
  "driver_name",
  "team_name",
  "total_stints",
  "pit_stop_count",
  "compounds_used",
  "strategy_type",
  "total_pit_duration_seconds",
  "pit_laps"
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

test("G1: getSessionStrategySummary queries core.strategy_summary with all required columns", () => {
  const source = readFileSync(sessionsQueriesUrl, "utf8");

  const decl = source.indexOf("export async function getSessionStrategySummary");
  assert.notEqual(
    decl,
    -1,
    "sessions.ts must declare `export async function getSessionStrategySummary`"
  );

  const body = extractFunctionBody(source, decl);

  assert.ok(
    body.includes("FROM core.strategy_summary"),
    "getSessionStrategySummary body must select FROM core.strategy_summary"
  );
  assert.ok(
    body.includes("WHERE session_key = $1"),
    "getSessionStrategySummary body must filter `WHERE session_key = $1`"
  );
  assert.ok(
    !body.includes("raw.stints"),
    "getSessionStrategySummary must not reference raw.stints (Phase 10 requires the materialized core.* contract)"
  );
  assert.ok(
    !body.includes("raw.pit"),
    "getSessionStrategySummary must not reference raw.pit (Phase 10 requires the materialized core.* contract)"
  );

  for (const column of STRATEGY_COLUMNS) {
    assert.ok(
      body.includes(column),
      `getSessionStrategySummary body must reference column \`${column}\``
    );
  }
});

test("G2: StrategySummary.tsx exists, exports a default function, and contains required substrings", () => {
  assert.ok(existsSync(strategySummaryUrl), "StrategySummary.tsx must exist");

  const src = readFileSync(strategySummaryUrl, "utf8");

  assert.ok(
    /export\s+default\s+function\b/.test(src),
    "StrategySummary.tsx must export a default function"
  );

  const requiredSubstrings = [
    'data-testid="strategy-row"',
    'data-testid="strategy-type"',
    "compounds_used",
    "pit_stop_count",
    "strategy_type"
  ];
  for (const needle of requiredSubstrings) {
    assert.ok(
      src.includes(needle),
      `StrategySummary.tsx must contain literal substring \`${needle}\``
    );
  }
});

test("G3: page.tsx wires the awaited getSessionStrategySummary result into <StrategySummary rows={...}> via a destructured identifier", () => {
  const source = readFileSync(pageUrl, "utf8");

  assert.ok(
    /import\s*\{[^}]*\bgetSessionStrategySummary\b[^}]*\}\s*from\s*["']@\/lib\/queries\/sessions["']/.test(source),
    "page.tsx must import `getSessionStrategySummary` from `@/lib/queries/sessions` (per-module path)"
  );

  assert.ok(
    /await\s+Promise\.all\(\[[\s\S]*?getSessionStrategySummary\(/.test(source),
    "page.tsx `Promise.all([...])` must call `getSessionStrategySummary(...)` inside its argument list"
  );

  const jsxMatch = source.match(/<StrategySummary\s+rows=\{(\w+)\}/);
  assert.ok(
    jsxMatch,
    "page.tsx must render a `<StrategySummary rows={<binding>}` JSX element"
  );
  const binding = jsxMatch[1];
  assert.ok(binding && binding.length > 0, "JSX rows binding must be a non-empty identifier");

  const destructureRegex = /const\s+\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(/;
  const destructureMatch = source.match(destructureRegex);
  assert.ok(
    destructureMatch,
    "page.tsx must destructure the awaited `Promise.all(...)` result"
  );
  const destructuredNames = destructureMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.ok(
    destructuredNames.includes(binding),
    `page.tsx must include the JSX rows binding \`${binding}\` among the destructured identifiers; saw [${destructuredNames.join(", ")}]`
  );
});

test("G4: page.tsx default-imports StrategySummary from the sibling module path", () => {
  const source = readFileSync(pageUrl, "utf8");
  assert.ok(
    /import\s+StrategySummary\s+from\s+["']\.\/StrategySummary["']/.test(source),
    "page.tsx must default-import `StrategySummary` from `./StrategySummary`"
  );
});

test("G5: page.tsx renders <StrategySummary> after <StintTimeline rows={ and before the Weather Preview two-col block", () => {
  const src = readFileSync(pageUrl, "utf8");

  const jsxMatch = src.match(/<StrategySummary\s+rows=\{(\w+)\}/);
  assert.ok(jsxMatch, "page.tsx must render `<StrategySummary rows={<binding>}`");
  const binding = jsxMatch[1];

  const idxStint = src.indexOf("<StintTimeline rows={");
  const idxStrategy = src.indexOf(`<StrategySummary rows={${binding}}`);
  const idxWeather = src.indexOf("Weather Preview");

  assert.ok(idxStint >= 0, "page.tsx must contain `<StintTimeline rows={` as a literal substring");
  assert.ok(idxStrategy >= 0, `page.tsx must contain \`<StrategySummary rows={${binding}}\``);
  assert.ok(idxWeather >= 0, "page.tsx must contain the `Weather Preview` title text marking the weather/race-control two-col block");

  assert.ok(
    idxStint < idxStrategy,
    "<StrategySummary> must be rendered after <StintTimeline rows={...}>"
  );
  assert.ok(
    idxStrategy < idxWeather,
    "<StrategySummary> must be rendered before the weather/race-control two-col block (marked by `Weather Preview`)"
  );
});
