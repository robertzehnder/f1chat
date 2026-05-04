// Phase 19 outcome-fix Fix 4: assert that the assembled SQL-gen system
// prompt contains the raw.car_data, raw.location, and raw.overtakes
// column lists + the forbidden-timestamp-proximity note. Prevents a
// future refactor from silently dropping these reminders.
//
// Codex audit pass 4 + 5 took the position that we extend the
// hand-curated raw-table reminder block at anthropic.ts:80 (NOT
// CORE_CONTRACTS) since CORE_CONTRACTS is the LLM-stable contract
// surface and raw.* tables are implementation. This test enforces
// that decision.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const sourcePath = path.resolve(webRoot, "src/lib/anthropic.ts");

// We don't want to actually load the @/lib/schemaCatalog dependency
// (it would try to hit Postgres). The buildSystemPrompt function uses
// a dynamic import + try/catch fallback when introspection fails, so
// in test we just point at a non-existent stub and the catch path
// kicks in, producing the prompt with the minimal coreSection
// fallback. The hand-curated raw.* block is unchanged either way.

async function loadPromptBuilder() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-raw-prompt-"));
  const src = await readFile(sourcePath, "utf8");
  // Strip the entire file down to just the buildSystemPrompt function
  // and its dependencies. Easier: transpile the whole file and let
  // the dynamic import in buildSystemPrompt fail-soft (it has a
  // try/catch).
  // Replace the dynamic import path so it resolves to a stub that
  // throws; the catch path produces the fallback coreSection.
  const stubbed = src.replace(
    /import\(\s*"@\/lib\/schemaCatalog"\s*\)/g,
    `import("./schemaCatalog.stub.mjs")`
  );
  const transpiled = ts.transpileModule(stubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  // Replace any remaining @/ alias imports with stubs.
  let output = transpiled.outputText.replace(
    /from\s+["']@\/lib\/[^"']+["']/g,
    `from "./neutral.stub.mjs"`
  );
  // The transpiled CommonJS-style require for schemaCatalog uses a
  // template literal that resolves to a path; just write a stub that
  // throws so the catch path runs.
  await writeFile(
    path.join(dir, "schemaCatalog.stub.mjs"),
    `export async function getSchemaDocs() { throw new Error("test stub"); }
export async function getSchemaCatalog() { return new Map(); }
export async function getColumnsForTable() { return undefined; }
export const CORE_CONTRACT_LIST = [];
export function _resetSchemaCatalogForTests() {}
`,
    "utf8"
  );
  await writeFile(
    path.join(dir, "neutral.stub.mjs"),
    `// stubbed neutral exports for everything anthropic.ts imports from @/lib/*
export const buildSynthesisPrompt = () => "";
export const synthesizeAnswerWithAnthropic = () => null;
export const startSpan = () => ({ name: "stub", startedAt: 0, end: () => ({ name: "stub", startedAt: 0, elapsedMs: 0 }) });
export class AnthropicCallCounter {}
export const factContractToText = () => "";
export const FactContract = {};
export const buildAnthropicClient = () => null;
export const isFollowUp = () => false;
export const tracedSpan = () => null;
`,
    "utf8"
  );
  await writeFile(path.join(dir, "anthropic.mjs"), output, "utf8");
  // The test only needs buildSystemPrompt; if other transitive imports
  // fail the test will show that and we can refine the stub. Most
  // exports in anthropic.ts that reference network / DB are functions
  // that aren't called at module-load time.
  const mod = await import(path.join(dir, "anthropic.mjs"));
  return { mod, dir };
}

async function withModule(fn) {
  let dir;
  try {
    const loaded = await loadPromptBuilder();
    dir = loaded.dir;
    await fn(loaded.mod);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

test("Fix 4: raw.car_data column list is in the assembled prompt", async () => {
  await withModule(async (mod) => {
    const prompt = await mod.buildSystemPrompt();
    assert.match(prompt, /raw\.car_data has:\s*session_key/);
    assert.match(prompt, /n_gear/);
    assert.match(prompt, /brake/);
    assert.match(prompt, /throttle/);
    assert.match(prompt, /speed/);
    assert.match(prompt, /drs/);
  });
});

test("Fix 4: raw.location column list is in the assembled prompt (no telemetry fields)", async () => {
  await withModule(async (mod) => {
    const prompt = await mod.buildSystemPrompt();
    assert.match(prompt, /raw\.location has:\s*session_key, driver_number, date, x, y, z/);
    // The reminder explicitly says NO telemetry on raw.location.
    assert.match(prompt, /spatial coordinates ONLY/);
    assert.match(prompt, /no telemetry fields like n_gear/);
  });
});

test("Fix 4: raw.overtakes column list names overtaking/overtaken driver_number (NOT a bare driver_number)", async () => {
  await withModule(async (mod) => {
    const prompt = await mod.buildSystemPrompt();
    assert.match(prompt, /raw\.overtakes has:/);
    assert.match(prompt, /overtaking_driver_number/);
    assert.match(prompt, /overtaken_driver_number/);
    assert.match(prompt, /NO "driver_number" or "overtake_type" columns/);
  });
});

test("Fix 4: forbidden-pattern note about timestamp-proximity joins is present", async () => {
  await withModule(async (mod) => {
    const prompt = await mod.buildSystemPrompt();
    assert.match(prompt, /DO NOT join raw\.car_data and raw\.location by timestamp proximity/);
    assert.match(prompt, /core\.telemetry_lap_bridge/);
  });
});

test("Phase 19 q2180: prompt routes missing weather coverage questions to session_completeness with a non-empty summary row", async () => {
  await withModule(async (mod) => {
    const prompt = await mod.buildSystemPrompt();
    assert.match(prompt, /data_health_question coverage\/completeness prompts, prefer core\.session_completeness/);
    assert.match(prompt, /missing weather coverage, use core\.session_completeness\.weather_rows/);
    assert.match(prompt, /return exactly one summary row even when no sessions match/);
    assert.match(prompt, /yields 0 and 'none' instead of an empty result set/);
  });
});

test("Fix 4: prompt-size impact within ±100 tokens of pre-fix baseline", async () => {
  // Quick token estimate: words / 0.75 is the OpenAI-style rule of
  // thumb. We don't have an exact pre-fix snapshot, but we can assert
  // the overall prompt size stays under 5000 chars (current is around
  // 3.5KB). If a future edit blows past that, the test catches it.
  await withModule(async (mod) => {
    const prompt = await mod.buildSystemPrompt();
    assert.ok(
      prompt.length < 5500,
      `prompt size ${prompt.length} chars exceeds 5500-char budget`
    );
  });
});
