// Phase 25.1: probe `buildLookupAliasCandidates` + `extractVenueHints`
// against the 6 escalated questions to confirm the chat alias-derivation
// is the actual blocker (DB and SQL already confirmed healthy via
// phase25_probe_session_search_lookup.mjs).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");

async function loadHelpers() {
  const src = await readFile(path.resolve(webRoot, "src/lib/chatRuntime.ts"), "utf8");
  const startMarker = "const LOOKUP_ALIAS_STOPWORDS";
  const endMarker = "// Phase 19 outcome-fix Fix 2: race-shaped";
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker, startIdx);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error("could not locate alias-helper region in chatRuntime.ts");
  }
  // Make non-exported helpers exportable so we can import them.
  const slice = src
    .slice(startIdx, endIdx)
    .replace(/^function (extractVenueHints|buildLookupAliasCandidates|hasGrandPrixVenueAlias|hasExplicitGrandPrixVenueYearAnchor|normalize|unique)\b/gm, "export function $1")
    .replace(/^const (LOOKUP_ALIAS_STOPWORDS|RACE_SHAPED_MARKERS|SESSION_TYPE_SENSITIVE_MARKERS)\b/gm, "export const $1");
  const transpiled = ts.transpileModule(slice, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const dir = await mkdtemp(path.join(__dirname, ".tmp-alias-probe-"));
  await writeFile(path.join(dir, "helpers.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "helpers.mjs"));
  return { mod, dir };
}

function normalize(text) {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const QUESTIONS = [
  ["q1940", "How long was Norris's first stint at the 2025 Hungarian Grand Prix?"],
  ["q1941", "What compound did Verstappen start on at the 2025 Singapore GP?"],
  ["q1945", "Was Piastri's first stint at Imola 2025 cut short by graining on the front-right?"],
  ["q2120", "Was the 2025 Hungarian Grand Prix run wet or dry?"],
  ["q2121", "Who pitted first for intermediates at the 2025 Australian GP late-race rain shower?"],
  ["q2184", "Show 2025 weekends where pit-stop timing data is incomplete vs the official FIA pit log."]
];

const { mod, dir } = await loadHelpers();
try {
  for (const [tag, question] of QUESTIONS) {
    const norm = normalize(question);
    const venueHints = mod.extractVenueHints(norm);
    const candidates = mod.buildLookupAliasCandidates(norm);
    const merged = Array.from(new Set([...venueHints, ...candidates]));
    const matchedVenue = merged.filter((alias) =>
      ["hungary", "hungaroring", "hungarian", "singapore", "marina bay", "imola", "emilia", "australia", "melbourne"].includes(alias)
    );
    console.log(`\n${tag}:  ${question}`);
    console.log(`  normalized: '${norm}'`);
    console.log(`  venueHints (${venueHints.length}): ${JSON.stringify(venueHints)}`);
    console.log(`  candidates (${candidates.length}): ${JSON.stringify(candidates.slice(0, 24))}${candidates.length > 24 ? ` ... +${candidates.length - 24} more` : ""}`);
    console.log(`  merged-and-matching-known-venue: ${JSON.stringify(matchedVenue)}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
