// Phase 19 outcome-fix Fix 2: race-shaped venue+year resolver
// guardrails. Asserts:
//   - Positive fixtures: questions that are race-shaped + name a
//     venue+year + don't contain a session-type-sensitive marker
//     resolve to race-shaped intent.
//   - Negative fixtures: questions with quali/pole/sprint/FP/practice/
//     long-run markers do NOT resolve to race-shaped intent (they
//     keep clarification).
//   - The 50q rubric clarification ids 8/9/15/17 are deliberately
//     underspecified and do NOT name a venue+year, so the heuristic
//     leaves them in the clarification path (assertion: race-shaped
//     intent returns false on those questions).
//
// This test exercises the intent-detection helper directly via its
// exports (`isRaceShapedVenueYearIntent`, `RACE_SHAPED_MARKERS`,
// `SESSION_TYPE_SENSITIVE_MARKERS`). Loading the full
// `buildChatRuntime` pipeline would require Postgres; the helper is
// pure and can be tested in isolation.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadHelper() {
  // The helper lives in chatRuntime.ts. We extract just the
  // exported function blocks by transpiling the slice between the
  // RACE_SHAPED_MARKERS / SESSION_TYPE_SENSITIVE_MARKERS exports
  // and the end of `isRaceShapedVenueYearIntent`. Robust extraction
  // is via a marker pair we know is unique to this region.
  const src = await readFile(
    path.resolve(webRoot, "src/lib/chatRuntime.ts"),
    "utf8"
  );
  const startMarker = "export const RACE_SHAPED_MARKERS";
  const endMarker = "function parseYear(text: string)";
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) throw new Error("could not find RACE_SHAPED_MARKERS");
  const endIdx = src.indexOf(endMarker, startIdx);
  if (endIdx < 0) throw new Error("could not find parseYear marker");
  const slice = src.slice(startIdx, endIdx);
  const transpiled = ts.transpileModule(slice, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const dir = await mkdtemp(path.join(__dirname, ".tmp-race-shaped-"));
  await writeFile(path.join(dir, "raceShaped.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "raceShaped.mjs"));
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

const POSITIVE_FIXTURES = [
  "At Suzuka 2025, did Red Bull's narrow setup window restrict Verstappen to a shorter optimal stint length?",
  "Across the closing laps of the Abu Dhabi 2025 race, who gained ground on Norris?",
  "How did Hamilton's race pace compare to Russell across the first stint at Monza 2025?",
  "Compare Verstappen's first-stint pace to Norris at Bahrain 2025.",
  "Did Mercedes need more warmup laps on the hard at Silverstone 2025 vs McLaren in stint 1?",
  "What was the closing-stint hard-tyre pace at Hungary 2025?",
  "How many pit stops did Verstappen make at the Monaco 2025 race?",
  "How many pit stops did Lando Norris make in the 2025 Monaco Grand Prix?",
  "What was Verstappen's first-stop lap number in the 2025 Canadian Grand Prix?",
  "What was the fastest lap of the 2025 Italian Grand Prix race?",
  "How long was Verstappen's medium stint at Silverstone 2025 before he switched to inters?",
  // Phase 25.1 q1941: `start on` race-shaped marker
  "What compound did Verstappen start on at the 2025 Singapore GP?",
  "What compound did Norris start on at Monza 2025?",
  "What compound did Hamilton run wet on at Spa 2025?",
  // Phase 25.1 q2120: `run wet` / `run dry` race-shaped markers
  "Was the 2025 Hungarian Grand Prix run wet or dry?",
  "Did the 2025 Belgian Grand Prix run dry from start to finish?"
];

const NEGATIVE_FIXTURES_SESSION_TYPE = [
  "What was Verstappen's pole lap time at Suzuka 2025?",
  "Compare Q3 sector dominance at Silverstone 2025 between Verstappen and Norris.",
  "Show me Verstappen's FP2 long-run pace at Spa 2025.",
  "How many sprint races has Norris won in 2025?",
  "What was Hamilton's quickest qualifying lap at Monza 2025?",
  "What was Norris's qualifying result at the 2025 Monaco Grand Prix?",
  // Phase 25.1 deny-list dominance over the new `start on` marker:
  // a `start on` phrase combined with a session-type-sensitive
  // marker (pole/qualifying/sprint) MUST still clarify.
  "What compound did Verstappen start on for his pole lap at Singapore 2025?",
  "What compound did Norris start on for the sprint at Spa 2025?",
  "What compound did Hamilton start on in qualifying at Monza 2025?"
];

const NEGATIVE_FIXTURES_NO_VENUE_YEAR = [
  // The existing 50q rubric clarification ids 8/9/15/17 are
  // underspecified — no venue+year. Race-shaped check returns false
  // because hasVenueYearAnchor is false.
  "Which drivers participated in a given session?",
  "Which teams were present in a given session?",
  "Which sessions is a specific driver missing from, despite the session existing?",
  "What is the roster for a given race session, with driver and team names?"
];

test("Positive fixtures (race-shaped + venue+year, no session-type marker) resolve true", async () => {
  await withHelper(async (mod) => {
    for (const q of POSITIVE_FIXTURES) {
      const out = mod.isRaceShapedVenueYearIntent(q.toLowerCase(), true);
      assert.equal(
        out,
        true,
        `expected race-shaped intent for: "${q}"`
      );
    }
  });
});

test("Negative fixtures (session-type-sensitive marker present) resolve false", async () => {
  await withHelper(async (mod) => {
    for (const q of NEGATIVE_FIXTURES_SESSION_TYPE) {
      const out = mod.isRaceShapedVenueYearIntent(q.toLowerCase(), true);
      assert.equal(
        out,
        false,
        `expected NO race-shaped intent (session-type-sensitive marker should win): "${q}"`
      );
    }
  });
});

test("Negative fixtures (no venue+year anchor) resolve false (50q rubric ids 8/9/15/17)", async () => {
  await withHelper(async (mod) => {
    for (const q of NEGATIVE_FIXTURES_NO_VENUE_YEAR) {
      // Pass hasVenueYearAnchor=false to simulate the actual upstream
      // check at runtime — these questions don't name a venue+year.
      const out = mod.isRaceShapedVenueYearIntent(q.toLowerCase(), false);
      assert.equal(
        out,
        false,
        `expected NO race-shaped intent (no venue+year anchor): "${q}"`
      );
    }
  });
});

test("Both race-shaped AND session-type-sensitive markers: deny-list wins", async () => {
  await withHelper(async (mod) => {
    // "qualifying lap times in the race" — race-shaped marker AND
    // qualifying marker. Per plan rev: deny-list wins.
    const q = "What were the qualifying lap times in the race at Monza 2025?";
    const out = mod.isRaceShapedVenueYearIntent(q.toLowerCase(), true);
    assert.equal(
      out,
      false,
      "session-type-sensitive marker must win when both kinds are present"
    );
  });
});

test("RACE_SHAPED_MARKERS and SESSION_TYPE_SENSITIVE_MARKERS exports are non-empty", async () => {
  await withHelper(async (mod) => {
    assert.ok(Array.isArray(mod.RACE_SHAPED_MARKERS) && mod.RACE_SHAPED_MARKERS.length > 0);
    assert.ok(
      Array.isArray(mod.SESSION_TYPE_SENSITIVE_MARKERS) &&
        mod.SESSION_TYPE_SENSITIVE_MARKERS.length > 0
    );
  });
});

// Phase 25.1 (codex audit pass 9): demonym -> country/circuit alias
// expansion. Without this, "Hungarian Grand Prix" derives only the
// `hungarian` token, which doesn't match the `hungary` /
// `hungaroring` aliases in core.session_search_lookup. The chat
// resolver then falls through to generic-token matches and tie-breaks
// to the latest 2025 race (Abu Dhabi 9839).
//
// This test covers the helper indirectly via assertions on the
// `RACE_SHAPED_MARKERS` plus a structural check: the helper module
// must export a `VENUE_DEMONYM_ALIASES` table (or an equivalent
// expansion mechanism) with entries for the demonyms that block
// Phase 25.1's escalated questions. The behavioural test that
// each demonym actually fires lives in the alias-derivation probe
// script (web/scripts/phase25_probe_alias_derivation.mjs); this
// unit test pins the contract that the table exists and covers the
// known-broken demonyms.
test("Phase 25.1 demonym alias expansion: hungarian/australian/italian/imola map to country+circuit aliases", async () => {
  const src = await readFile(
    path.resolve(webRoot, "src/lib/chatRuntime.ts"),
    "utf8"
  );
  // Each demonym must appear as a `trigger` and the country alias
  // must be in its expansion list. We check the source directly so
  // the test stays robust to module-load idiosyncrasies.
  const cases = [
    { trigger: "hungarian", mustInclude: "hungary" },
    { trigger: "australian", mustInclude: "australia" },
    { trigger: "italian", mustInclude: "italy" },
    { trigger: "british", mustInclude: "silverstone" },
    { trigger: "belgian", mustInclude: "belgium" },
    { trigger: "dutch", mustInclude: "zandvoort" },
    { trigger: "japanese", mustInclude: "suzuka" },
    { trigger: "imola", mustInclude: "emilia romagna" }
  ];
  const tableMatch = src.match(/VENUE_DEMONYM_ALIASES[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(tableMatch, "VENUE_DEMONYM_ALIASES table must exist in chatRuntime.ts");
  const table = tableMatch[1];
  for (const { trigger, mustInclude } of cases) {
    const triggerRe = new RegExp(`trigger:\\s*"${trigger}"\\s*,\\s*aliases:\\s*\\[([^\\]]*)\\]`);
    const entry = table.match(triggerRe);
    assert.ok(entry, `expected VENUE_DEMONYM_ALIASES entry for trigger="${trigger}"`);
    assert.match(
      entry[1],
      new RegExp(`"${mustInclude}"`),
      `trigger="${trigger}" must include alias "${mustInclude}"`
    );
  }
});
