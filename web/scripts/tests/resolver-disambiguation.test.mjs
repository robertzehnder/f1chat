import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const resolutionSourcePath = path.resolve(webRoot, "src/lib/chatRuntime/resolution.ts");

async function loadResolutionModule() {
  const sourceText = await readFile(resolutionSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const dir = await mkdtemp(path.join(__dirname, ".tmp-resolution-"));
  const outFile = path.join(dir, "resolution.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

async function withResolutionModule(run) {
  const loaded = await loadResolutionModule();
  try {
    await run(loaded.mod);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

const MAX_VERSTAPPEN = {
  driver_number: 1,
  full_name: "Max Verstappen",
  first_name: "Max",
  last_name: "Verstappen",
  name_acronym: "VER",
  broadcast_name: "M VERSTAPPEN",
  team_name: "Red Bull Racing"
};

const JOS_VERSTAPPEN = {
  driver_number: 33,
  full_name: "Jos Verstappen",
  first_name: "Jos",
  last_name: "Verstappen",
  name_acronym: "VER",
  broadcast_name: "J VERSTAPPEN",
  team_name: "Minardi"
};

const CHARLES_LECLERC = {
  driver_number: 16,
  full_name: "Charles Leclerc",
  first_name: "Charles",
  last_name: "Leclerc",
  name_acronym: "LEC",
  broadcast_name: "C LECLERC",
  team_name: "Ferrari"
};

const CARLOS_SAINZ = {
  driver_number: 55,
  full_name: "Carlos Sainz",
  first_name: "Carlos",
  last_name: "Sainz",
  name_acronym: "SAI",
  broadcast_name: "C SAINZ",
  team_name: "Ferrari"
};

test("Case A: bare-Verstappen + sessionYear=2024 boosts Max to top of scoredCandidates", async () => {
  await withResolutionModule((mod) => {
    const { scoredCandidates, ambiguousSurnames } = mod.disambiguateDrivers(
      [MAX_VERSTAPPEN, JOS_VERSTAPPEN],
      "verstappen lap times",
      2024
    );
    assert.equal(
      scoredCandidates[0].row.driver_number,
      1,
      "Max (#1) must be ranked first when bare 'Verstappen' appears in a 2024 session"
    );
    assert.ok(
      scoredCandidates[0].matchedOn.includes("bare_verstappen_2024_default"),
      `top candidate matchedOn must include bare_verstappen_2024_default; got ${JSON.stringify(scoredCandidates[0].matchedOn)}`
    );
    assert.equal(
      ambiguousSurnames.length,
      0,
      "no ambiguity should be flagged when the year-aware default applies"
    );
  });
});

test("Case B: bare-Verstappen + pre-2024 flags ambiguity without dropping candidates", async () => {
  await withResolutionModule((mod) => {
    const { scoredCandidates, ambiguousSurnames } = mod.disambiguateDrivers(
      [MAX_VERSTAPPEN, JOS_VERSTAPPEN],
      "verstappen lap times",
      2003
    );
    assert.equal(
      ambiguousSurnames.length,
      1,
      "ambiguity must be flagged for bare 'Verstappen' in a pre-2024 session"
    );
    assert.equal(ambiguousSurnames[0].surname, "verstappen");
    const ambiguousNumbers = ambiguousSurnames[0].rows
      .map((r) => r.driver_number)
      .sort((a, b) => a - b);
    assert.deepEqual(
      ambiguousNumbers,
      [1, 33],
      "both Verstappens must appear in ambiguousSurnames[0].rows"
    );
    const scoredNumbers = scoredCandidates.map((c) => c.row.driver_number).sort((a, b) => a - b);
    assert.deepEqual(
      scoredNumbers,
      [1, 33],
      "both Verstappens must remain in scoredCandidates so the caller can clarify"
    );
    for (const candidate of scoredCandidates) {
      assert.ok(
        !candidate.matchedOn.includes("bare_verstappen_2024_default"),
        `pre-2024 path must not stamp bare_verstappen_2024_default; got ${JSON.stringify(candidate.matchedOn)}`
      );
    }
  });
});

test("Case C: explicit 'max verstappen' surfaces Max via canonical_full_name_match regardless of year", async () => {
  await withResolutionModule((mod) => {
    const { scoredCandidates, ambiguousSurnames } = mod.disambiguateDrivers(
      [MAX_VERSTAPPEN, JOS_VERSTAPPEN],
      "max verstappen pace",
      2003
    );
    assert.equal(
      scoredCandidates[0].row.driver_number,
      1,
      "Max (#1) must be ranked first when the message names him explicitly"
    );
    assert.ok(
      scoredCandidates[0].matchedOn.includes("canonical_full_name_match"),
      `top candidate matchedOn must include canonical_full_name_match; got ${JSON.stringify(scoredCandidates[0].matchedOn)}`
    );
    assert.equal(
      ambiguousSurnames.length,
      0,
      "explicit naming must not trigger ambiguity even in a pre-2024 session"
    );
  });
});

test("Case D: Q26 comparison_analysis preserves both Max and Charles in scoredCandidates", async () => {
  await withResolutionModule((mod) => {
    const q26 =
      "Within the Abu Dhabi 2025 weekend, which session had the smallest spread between the fastest and slowest competitive laps, and how did Max Verstappen and Charles Leclerc compare in that session?";
    const { scoredCandidates, ambiguousSurnames } = mod.disambiguateDrivers(
      [MAX_VERSTAPPEN, JOS_VERSTAPPEN, CHARLES_LECLERC, CARLOS_SAINZ],
      q26.toLowerCase(),
      2025
    );
    const top4Numbers = scoredCandidates.slice(0, 4).map((c) => c.row.driver_number);
    assert.ok(
      top4Numbers.includes(1),
      `top 4 must include Max (#1); got ${JSON.stringify(top4Numbers)}`
    );
    assert.ok(
      top4Numbers.includes(16),
      `top 4 must include Charles Leclerc (#16); got ${JSON.stringify(top4Numbers)}`
    );
    const max = scoredCandidates.find((c) => c.row.driver_number === 1);
    const charles = scoredCandidates.find((c) => c.row.driver_number === 16);
    assert.ok(max && max.score > 0, "Max must have a positive score");
    assert.ok(charles && charles.score > 0, "Charles must have a positive score");
    assert.equal(
      ambiguousSurnames.length,
      0,
      "comparison_analysis with explicit 'Max Verstappen' must not flag Verstappen as ambiguous"
    );
  });
});
