import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadModule(relativePath, outName) {
  const dir = await mkdtemp(path.join(__dirname, `.tmp-${outName}-`));
  const src = await readFile(path.resolve(webRoot, relativePath), "utf8");
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, `${outName}.mjs`), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, `${outName}.mjs`));
  return { dir, mod };
}

async function withChatRuntimeModules(run) {
  const classification = await loadModule("src/lib/chatRuntime/classification.ts", "classification");
  const resolution = await loadModule("src/lib/chatRuntime/resolution.ts", "resolution");
  try {
    await run({ classification: classification.mod, resolution: resolution.mod });
  } finally {
    await rm(classification.dir, { recursive: true, force: true });
    await rm(resolution.dir, { recursive: true, force: true });
  }
}

const FIXTURES = [
  "List all sprint weekends on the 2025 calendar.",
  "Which sprint weekends are on the 2025 calendar?"
];

const CROSS_SESSION_AGGREGATE_FIXTURE =
  "Across all 2025 race weekends, which venue had the largest gap between FP1 and qualifying conditions (track temp delta) and what sessions were affected?";

test("Phase 19 q1901: 2025 sprint-weekend calendar questions classify as metadata lookup", async () => {
  await withChatRuntimeModules(async ({ classification }) => {
    for (const question of FIXTURES) {
      assert.equal(classification.classifyQuestion(question), "metadata_lookup");
    }
  });
});

test("Phase 19 q1901: 2025 sprint-weekend calendar questions bypass session clarification", async () => {
  await withChatRuntimeModules(async ({ classification, resolution }) => {
    for (const question of FIXTURES) {
      const normalized = question.toLowerCase();
      const questionType = classification.classifyQuestion(question);
      assert.equal(
        resolution.requiresResolvedSession(questionType, normalized),
        false,
        `expected direct-answer path for: "${question}"`
      );
    }
  });
});

test("Phase 19 q1906: 2025 cross-session aggregate questions bypass session clarification", async () => {
  await withChatRuntimeModules(async ({ classification, resolution }) => {
    const questionType = classification.classifyQuestion(CROSS_SESSION_AGGREGATE_FIXTURE);
    assert.equal(
      resolution.requiresResolvedSession(questionType, CROSS_SESSION_AGGREGATE_FIXTURE.toLowerCase()),
      false
    );
  });
});
