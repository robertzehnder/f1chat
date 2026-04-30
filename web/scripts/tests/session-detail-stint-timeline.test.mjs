import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const sessionsQueriesUrl = new URL("../../src/lib/queries/sessions.ts", import.meta.url);
const stintTimelineUrl = new URL("../../src/app/sessions/[sessionKey]/StintTimeline.tsx", import.meta.url);
const pageUrl = new URL("../../src/app/sessions/[sessionKey]/page.tsx", import.meta.url);

const STINT_COLUMNS = [
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
  "best_valid_lap",
  "degradation_per_lap"
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

function extractBraceExpression(source, openBraceIndex) {
  assert.equal(source[openBraceIndex], "{", "extractBraceExpression must start at an opening brace");
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, i);
      }
    }
  }
  throw new Error("could not locate end of brace-balanced expression");
}

test("G1: getSessionStintTimeline queries core.stint_summary with all required columns", () => {
  const source = readFileSync(sessionsQueriesUrl, "utf8");

  const decl = source.indexOf("export async function getSessionStintTimeline");
  assert.notEqual(
    decl,
    -1,
    "sessions.ts must declare `export async function getSessionStintTimeline`"
  );

  const body = extractFunctionBody(source, decl);

  assert.ok(
    body.includes("FROM core.stint_summary"),
    "getSessionStintTimeline body must select FROM core.stint_summary"
  );
  assert.ok(
    body.includes("WHERE session_key = $1"),
    "getSessionStintTimeline body must filter `WHERE session_key = $1`"
  );
  assert.ok(
    !body.includes("raw.stints"),
    "getSessionStintTimeline must not reference raw.stints (Phase 10 requires the materialized core.* contract)"
  );

  for (const column of STINT_COLUMNS) {
    assert.ok(
      body.includes(column),
      `getSessionStintTimeline body must reference column \`${column}\``
    );
  }
});

test("G2: StintTimeline is a Gantt-style component and bar's title binds compound_name + stint_length_laps", () => {
  assert.ok(existsSync(stintTimelineUrl), "StintTimeline.tsx must exist");

  const src = readFileSync(stintTimelineUrl, "utf8");

  assert.ok(
    /export\s+default\s+function\b/.test(src),
    "StintTimeline.tsx must export a default function"
  );

  const requiredSubstrings = [
    'data-testid="stint-row"',
    'data-testid="stint-bar"',
    "lap_start",
    "stint_length_laps",
    "compound_name"
  ];
  for (const needle of requiredSubstrings) {
    assert.ok(
      src.includes(needle),
      `StintTimeline.tsx must contain literal substring \`${needle}\``
    );
  }

  const barIdx = src.indexOf('data-testid="stint-bar"');
  assert.ok(barIdx >= 0, "StintTimeline.tsx must contain a `data-testid=\"stint-bar\"` element");

  const closeIdx = src.indexOf("/>", barIdx);
  assert.ok(
    closeIdx >= 0,
    "the `data-testid=\"stint-bar\"` element must be a self-closing JSX element ending in `/>`"
  );

  const barWindow = src.slice(barIdx, closeIdx);
  const titleMarker = "title={";
  const titleRel = barWindow.indexOf(titleMarker);
  assert.ok(
    titleRel >= 0,
    "stint-bar element must contain a `title={...}` JSX expression as its second attribute"
  );

  const titleOpenBraceAbs = barIdx + titleRel + (titleMarker.length - 1);
  const titleExpr = extractBraceExpression(src, titleOpenBraceAbs);

  assert.ok(
    titleExpr.includes("compound_name"),
    "stint-bar `title={...}` expression must reference `compound_name`"
  );
  assert.ok(
    titleExpr.includes("stint_length_laps"),
    "stint-bar `title={...}` expression must reference `stint_length_laps`"
  );
});

test("G3: page.tsx wires the awaited getSessionStintTimeline result into <StintTimeline rows={...}> via a shared identifier", () => {
  const source = readFileSync(pageUrl, "utf8");

  assert.ok(
    /import\s*\{[^}]*\bgetSessionStintTimeline\b[^}]*\}\s*from\s*["']@\/lib\/queries(?:\/sessions)?["']/.test(source),
    "page.tsx must import `getSessionStintTimeline` from `@/lib/queries` or the sessions submodule"
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
    /await\s+Promise\.all\(\[[\s\S]*?getSessionStintTimeline\(/.test(source),
    "page.tsx `Promise.all([...])` must call `getSessionStintTimeline(...)` inside its argument list"
  );

  const expectedRowsBinding = `<StintTimeline rows={${captured}}`;
  assert.ok(
    source.includes(expectedRowsBinding),
    `page.tsx must pass the destructured identifier into StintTimeline: expected substring \`${expectedRowsBinding}\``
  );
});

test("G4: page.tsx default-imports StintTimeline from the sibling module path", () => {
  const source = readFileSync(pageUrl, "utf8");
  assert.ok(
    /import\s+StintTimeline\s+from\s+["']\.\/StintTimeline["']/.test(source),
    "page.tsx must default-import `StintTimeline` from `./StintTimeline`"
  );
});

test("G5: page.tsx renders <StintTimeline> after <PaceTable rows={pace}> and before the weather/race-control two-col block", () => {
  const src = readFileSync(pageUrl, "utf8");

  const destructureRegex = /const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/;
  const destructureMatch = src.match(destructureRegex);
  assert.ok(destructureMatch, "page.tsx must destructure Promise.all(...)");
  const captured = destructureMatch[1];

  const idxPace = src.indexOf("<PaceTable rows={pace}");
  const idxStint = src.indexOf(`<StintTimeline rows={${captured}}`);
  const idxWeather = src.indexOf("Weather Preview");

  assert.ok(idxPace >= 0, "page.tsx must contain `<PaceTable rows={pace}`");
  assert.ok(idxStint >= 0, `page.tsx must contain \`<StintTimeline rows={${captured}}\``);
  assert.ok(idxWeather >= 0, "page.tsx must contain the `Weather Preview` title text marking the weather/race-control two-col block");

  assert.ok(
    idxPace < idxStint,
    "<StintTimeline> must be rendered after <PaceTable rows={pace}>"
  );
  assert.ok(
    idxStint < idxWeather,
    "<StintTimeline> must be rendered before the weather/race-control two-col block (marked by `Weather Preview`)"
  );
});
