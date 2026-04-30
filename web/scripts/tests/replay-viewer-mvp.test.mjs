import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const sessionsQueriesUrl = new URL("../../src/lib/queries/sessions.ts", import.meta.url);
const replayViewerUrl = new URL("../../src/app/replay/[sessionId]/ReplayViewer.tsx", import.meta.url);
const replayPageUrl = new URL("../../src/app/replay/[sessionId]/page.tsx", import.meta.url);

const PROGRESSION_COLUMNS = [
  "driver_number",
  "driver_name",
  "team_name",
  "lap_number",
  "frame_time",
  "position_end_of_lap",
  "previous_position",
  "positions_gained_this_lap",
  "opening_position",
  "latest_position",
  "best_position",
  "worst_position"
];

const FRAMES_COLUMNS = [
  "lap_number",
  "frame_time",
  "leader_driver_number",
  "leader_position",
  "best_valid_lap_on_lap",
  "avg_valid_lap_on_lap",
  "weather_track_temperature",
  "weather_air_temperature",
  "race_control_flag"
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

test("G1: getSessionRaceProgression queries core.race_progression_summary with all required columns", () => {
  const source = readFileSync(sessionsQueriesUrl, "utf8");

  const decl = source.indexOf("export async function getSessionRaceProgression");
  assert.notEqual(
    decl,
    -1,
    "sessions.ts must declare `export async function getSessionRaceProgression`"
  );

  const body = extractFunctionBody(source, decl);

  assert.ok(
    body.includes("FROM core.race_progression_summary"),
    "getSessionRaceProgression body must select FROM core.race_progression_summary"
  );
  assert.ok(
    body.includes("WHERE session_key = $1"),
    "getSessionRaceProgression body must filter `WHERE session_key = $1`"
  );
  assert.ok(
    !body.includes("raw.laps"),
    "getSessionRaceProgression must not reference raw.laps (Phase 10 requires the materialized core.* contract)"
  );
  assert.ok(
    !body.includes("raw.position_history"),
    "getSessionRaceProgression must not reference raw.position_history (Phase 10 requires the materialized core.* contract)"
  );

  for (const column of PROGRESSION_COLUMNS) {
    assert.ok(
      body.includes(column),
      `getSessionRaceProgression body must reference column \`${column}\``
    );
  }
});

test("G2a: getSessionReplayFrames queries core.replay_lap_frames with all required columns", () => {
  const source = readFileSync(sessionsQueriesUrl, "utf8");

  const decl = source.indexOf("export async function getSessionReplayFrames");
  assert.notEqual(
    decl,
    -1,
    "sessions.ts must declare `export async function getSessionReplayFrames`"
  );

  const body = extractFunctionBody(source, decl);

  assert.ok(
    body.includes("FROM core.replay_lap_frames"),
    "getSessionReplayFrames body must select FROM core.replay_lap_frames"
  );
  assert.ok(
    body.includes("WHERE session_key = $1"),
    "getSessionReplayFrames body must filter `WHERE session_key = $1`"
  );
  assert.ok(
    !body.includes("raw.weather"),
    "getSessionReplayFrames must not reference raw.weather (Phase 10 requires the materialized core.* contract)"
  );
  assert.ok(
    !body.includes("raw.race_control"),
    "getSessionReplayFrames must not reference raw.race_control (Phase 10 requires the materialized core.* contract)"
  );

  for (const column of FRAMES_COLUMNS) {
    assert.ok(
      body.includes(column),
      `getSessionReplayFrames body must reference column \`${column}\``
    );
  }
});

test("G2b: ReplayViewer is a positions-over-time component with required test ids and replay-frame descriptors", () => {
  assert.ok(existsSync(replayViewerUrl), "ReplayViewer.tsx must exist");

  const src = readFileSync(replayViewerUrl, "utf8");

  assert.ok(
    /export\s+default\s+function\b/.test(src),
    "ReplayViewer.tsx must export a default function"
  );

  const requiredSubstrings = [
    'data-testid="replay-driver-row"',
    'data-testid="replay-track"',
    'data-testid="replay-lap-marker"',
    "lap_number",
    "position_end_of_lap",
    "numDrivers"
  ];
  for (const needle of requiredSubstrings) {
    assert.ok(
      src.includes(needle),
      `ReplayViewer.tsx must contain literal substring \`${needle}\``
    );
  }
});

test("G2c: replay-lap-marker title={...} expression binds both lap_number and position_end_of_lap", () => {
  const src = readFileSync(replayViewerUrl, "utf8");

  const markerIdx = src.indexOf('data-testid="replay-lap-marker"');
  assert.ok(markerIdx >= 0, "ReplayViewer.tsx must contain a `data-testid=\"replay-lap-marker\"` element");

  const closeIdx = src.indexOf("/>", markerIdx);
  assert.ok(
    closeIdx >= 0,
    "the `data-testid=\"replay-lap-marker\"` element must be a self-closing JSX element ending in `/>`"
  );

  const markerWindow = src.slice(markerIdx, closeIdx);
  const titleMarker = "title={";
  const titleRel = markerWindow.indexOf(titleMarker);
  assert.ok(
    titleRel >= 0,
    "replay-lap-marker element must contain a `title={...}` JSX expression as its second attribute"
  );

  const titleOpenBraceAbs = markerIdx + titleRel + (titleMarker.length - 1);
  const titleExpr = extractBraceExpression(src, titleOpenBraceAbs);

  assert.ok(
    titleExpr.includes("lap_number"),
    "replay-lap-marker `title={...}` expression must reference `lap_number`"
  );
  assert.ok(
    titleExpr.includes("position_end_of_lap"),
    "replay-lap-marker `title={...}` expression must reference `position_end_of_lap`"
  );
});

test("G3: ReplayViewer per-lap frames strip references leader_driver_number and race_control_flag", () => {
  const src = readFileSync(replayViewerUrl, "utf8");

  const required = [
    'data-testid="replay-frame-strip"',
    'data-testid="replay-frame"',
    "leader_driver_number",
    "race_control_flag"
  ];
  for (const needle of required) {
    assert.ok(
      src.includes(needle),
      `ReplayViewer.tsx must contain literal substring \`${needle}\``
    );
  }
});

test("G4: page.tsx wires Promise.all destructure into <ReplayViewer> via shared identifiers", () => {
  const source = readFileSync(replayPageUrl, "utf8");

  assert.ok(
    /import\s*\{[^}]*\bgetSessionRaceProgression\b[^}]*\bgetSessionReplayFrames\b[^}]*\}\s*from\s*["']@\/lib\/queries\/sessions["']/.test(source),
    "page.tsx must import both `getSessionRaceProgression` and `getSessionReplayFrames` from `@/lib/queries/sessions`"
  );

  const destructureRegex = /const\s+\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/;
  const destructureMatch = source.match(destructureRegex);
  assert.ok(
    destructureMatch,
    "page.tsx must destructure `const [<a>, <b>] = await Promise.all(...)`"
  );
  const groupOne = destructureMatch[1];
  const groupTwo = destructureMatch[2];
  assert.ok(groupOne && groupOne.length > 0, "destructure regex must capture a non-empty first identifier");
  assert.ok(groupTwo && groupTwo.length > 0, "destructure regex must capture a non-empty second identifier");

  assert.ok(
    /await\s+Promise\.all\(\[[\s\S]*?getSessionRaceProgression\([\s\S]*?getSessionReplayFrames\(/.test(source),
    "page.tsx `Promise.all([...])` must call both `getSessionRaceProgression(...)` and `getSessionReplayFrames(...)` inside its argument list"
  );

  const expectedBinding = `<ReplayViewer progression={${groupOne}} frames={${groupTwo}}`;
  assert.ok(
    source.includes(expectedBinding),
    `page.tsx must wire the destructured identifiers into ReplayViewer: expected substring \`${expectedBinding}\``
  );

  assert.ok(
    /import\s+ReplayViewer\s+from\s+["']\.\/ReplayViewer["']/.test(source),
    "page.tsx must default-import `ReplayViewer` from `./ReplayViewer`"
  );
});

test("G5: page.tsx renders <ReplayViewer> after the <section className=\"hero\"> open", () => {
  const src = readFileSync(replayPageUrl, "utf8");

  const destructureRegex = /const\s+\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/;
  const destructureMatch = src.match(destructureRegex);
  assert.ok(destructureMatch, "page.tsx must destructure Promise.all(...)");
  const groupOne = destructureMatch[1];
  const groupTwo = destructureMatch[2];

  const idxHero = src.indexOf('<section className="hero"');
  const idxViewer = src.indexOf(`<ReplayViewer progression={${groupOne}} frames={${groupTwo}}`);

  assert.ok(idxHero >= 0, "page.tsx must contain `<section className=\"hero\"`");
  assert.ok(
    idxViewer >= 0,
    `page.tsx must contain \`<ReplayViewer progression={${groupOne}} frames={${groupTwo}}\``
  );
  assert.ok(
    idxHero < idxViewer,
    "<ReplayViewer> must be rendered after the `<section className=\"hero\"` open"
  );
});
