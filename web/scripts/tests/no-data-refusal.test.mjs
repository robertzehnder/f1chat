// Phase 19-A (rev3): tests for the deterministic pre-SQL
// `PROPRIETARY_NO_DATA_TOPICS` keyword guard. Two-direction coverage:
// MUST trip on real proprietary phrasings, MUST NOT trip on legitimate
// analytics phrasings that share substrings (the rev3 "adjacency
// negative" set — bare-token matching like "brake" / "fuel" / "slip"
// would false-trigger and was rejected).

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const detectorSourcePath = path.resolve(
  webRoot,
  "src/lib/chatRuntime/proprietaryNoData.ts"
);

async function loadDetector() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-no-data-refusal-"));
  const src = await readFile(detectorSourcePath, "utf8");
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "proprietaryNoData.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "proprietaryNoData.mjs"));
  return { mod, dir };
}

async function withDetector(fn) {
  const { mod, dir } = await loadDetector();
  try {
    await fn(mod);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const MUST_TRIP = [
  ["What was the brake temperature at Turn 8?", "brake temperature"],
  ["What is the brake temp on Hamilton's car right now?", "brake temp"],
  ["How much fuel did Verstappen burn in stint 2?", "fuel burn"],
  ["What was Leclerc's fuel mass at the start of lap 25?", "fuel mass"],
  ["What was the slip angle through Eau Rouge?", "slip angle"],
  ["What was the battery state at the start of lap 30?", "battery state"],
  ["Battery SOC for Norris in Q3?", "battery soc"],
  ["What ERS deployment did Hamilton use in Q3?", "ers deployment"],
  ["Show me the steering angle through Parabolica.", "steering angle"],
  ["Damage state on the McLarens after lap 1.", "damage state"],
  ["What was the engine RPM at the speed trap?", "engine rpm"],
  ["What's the differential setting on the Ferrari?", "differential setting"],
  // Phase 19 outcome-fix plan, Fix 1 (codex audit pass 6): plural
  // variants must trip. The id=1758 baseline failure was caused by
  // "differential settings" (plural) not matching the singular phrase.
  ["Compare the differential settings between Verstappen and Norris.", "differential settings"],
  ["Show me the brake temperatures across the field.", "brake temperatures"],
  ["What battery states did the Mercedes pair end the race on?", "battery states"],
  ["Compare slip angles through Eau Rouge.", "slip angles"],
  ["How many ERS deployments did the McLarens stack on the final lap?", "ers deployments"]
];

const MUST_NOT_TRIP = [
  // rev3 adjacency negatives — these phrases share substrings with
  // proprietary topics but are legitimate analytics. Bare-token
  // matching ("brake", "fuel", "slip") would false-trigger. Phrase-
  // level matching does not.
  "How late does Norris brake at Turn 1?",
  "Compare fuel-corrected pace for Verstappen and Leclerc at Silverstone.",
  "Who had the best traction on corner exit at Monza?",
  "Did Hamilton get a slipstream on the main straight?",
  "Who set the fastest lap at Monza?",
  // Generic pace / stint phrasings that should never trip.
  "Show me the stints for Verstappen at Abu Dhabi 2025.",
  "What was the average lap time in Q3 at Spa?",
  "Compare Norris and Piastri's pace in stint 2.",
  // Phrases like "fuel-saving" share a token with "fuel mass"/"fuel burn"
  // but are not in the keyword list — must not trip.
  "Was Verstappen quick on the long fuel-saving stint?"
];

test("MUST trip on proprietary phrasings", async () => {
  await withDetector(async ({ detectProprietaryNoDataMatch }) => {
    for (const [message, expectedKeyword] of MUST_TRIP) {
      const hit = detectProprietaryNoDataMatch(message);
      assert.ok(
        hit !== null,
        `expected guard to trip on: "${message}" (keyword "${expectedKeyword}")`
      );
      assert.equal(
        hit.matchedKeyword,
        expectedKeyword,
        `wrong keyword for "${message}": expected "${expectedKeyword}", got "${hit.matchedKeyword}"`
      );
      assert.ok(typeof hit.refusalReason === "string" && hit.refusalReason.length > 0);
    }
  });
});

test("MUST NOT trip on legitimate analytics phrasings (rev3 adjacency negatives)", async () => {
  await withDetector(async ({ detectProprietaryNoDataMatch }) => {
    for (const message of MUST_NOT_TRIP) {
      const hit = detectProprietaryNoDataMatch(message);
      assert.equal(
        hit,
        null,
        `false-positive: guard tripped on legitimate analytics question: "${message}" (matched "${hit?.matchedKeyword}")`
      );
    }
  });
});

test("phrase match is case-insensitive", async () => {
  await withDetector(async ({ detectProprietaryNoDataMatch }) => {
    assert.ok(detectProprietaryNoDataMatch("BRAKE TEMPERATURE at turn 1?"));
    assert.ok(detectProprietaryNoDataMatch("Slip Angle through Eau Rouge."));
    assert.ok(detectProprietaryNoDataMatch("BATTERY soc for Norris."));
  });
});

test("multi-word phrase tolerates extra whitespace", async () => {
  await withDetector(async ({ detectProprietaryNoDataMatch }) => {
    assert.ok(detectProprietaryNoDataMatch("brake   temperature at turn 1"));
    assert.ok(detectProprietaryNoDataMatch("fuel  mass at lap 25"));
  });
});
