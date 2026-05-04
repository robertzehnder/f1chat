// Phase 22-A (slice 22-A-runtime-model-tool-plumbing): tests for the
// runtime-model dispatch interface. Codex audit said 22-A and
// 22-points-as-they-run can ship autonomously; the 5 ML model slices
// (22-tyre-deg-bayesian etc.) need operator review for held-out
// validation.
//
// 22-A acceptance from the plan:
//   1. A stub model lands AND is invokable end-to-end via the dispatch.
//   2. A unit test asserts the dispatch validates input, enforces the
//      runtime budget, and surfaces the model's payload.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const sourcePath = path.resolve(webRoot, "src/lib/runtimeModels/index.ts");

async function loadModule() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-runtime-models-"));
  const src = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "runtimeModels.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "runtimeModels.mjs"));
  return { mod, dir };
}

async function withModule(fn) {
  const { mod, dir } = await loadModule();
  try {
    if (typeof mod._resetRuntimeModelRegistryForTests === "function") {
      mod._resetRuntimeModelRegistryForTests();
    }
    await fn(mod);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("registerRuntimeModel + getRuntimeModel round-trip", async () => {
  await withModule(async (mod) => {
    const { registerRuntimeModel, getRuntimeModel, STUB_MODEL } = mod;
    registerRuntimeModel(STUB_MODEL);
    const out = getRuntimeModel("stub_model_22a");
    assert.equal(out.name, "stub_model_22a");
  });
});

test("registerRuntimeModel rejects duplicate registration", async () => {
  await withModule(async (mod) => {
    const { registerRuntimeModel, STUB_MODEL } = mod;
    registerRuntimeModel(STUB_MODEL);
    assert.throws(() => registerRuntimeModel(STUB_MODEL), /already registered/);
  });
});

test("dispatchRuntimeModel returns the stub model's fixed payload", async () => {
  await withModule(async (mod) => {
    const { registerRuntimeModel, dispatchRuntimeModel, STUB_MODEL } = mod;
    registerRuntimeModel(STUB_MODEL);
    const out = await dispatchRuntimeModel("stub_model_22a", { question: "test?" });
    assert.equal(out.modelName, "stub_model_22a");
    assert.equal(out.payload.echoedQuestion, "test?");
    assert.equal(typeof out.elapsedMs, "number");
    assert.equal(out.confidence, 1.0);
  });
});

test("dispatchRuntimeModel rejects unknown model name", async () => {
  await withModule(async (mod) => {
    const { dispatchRuntimeModel } = mod;
    await assert.rejects(
      () => dispatchRuntimeModel("nonexistent_model", { question: "hi" }),
      /not registered/
    );
  });
});

test("dispatchRuntimeModel rejects invalid input via the model's validate", async () => {
  await withModule(async (mod) => {
    const { registerRuntimeModel, dispatchRuntimeModel, STUB_MODEL } = mod;
    registerRuntimeModel(STUB_MODEL);
    await assert.rejects(
      () => dispatchRuntimeModel("stub_model_22a", {}),
      /input invalid: missing required field: question/
    );
  });
});

test("dispatchRuntimeModel enforces runtime budget via timeout", async () => {
  await withModule(async (mod) => {
    const { registerRuntimeModel, dispatchRuntimeModel } = mod;
    const slowModel = {
      name: "slow_model",
      description: "intentionally slow",
      keywords: [],
      validateInput: () => null,
      run: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                modelName: "slow_model",
                payload: {},
                elapsedMs: 0
              }),
            500
          )
        )
    };
    registerRuntimeModel(slowModel);
    await assert.rejects(
      () => dispatchRuntimeModel("slow_model", {}, { runtimeBudgetMs: 50 }),
      /model_timeout/
    );
  });
});

test("detectRuntimeModelMatch picks up keyword fingerprints, ignores unmatched messages", async () => {
  await withModule(async (mod) => {
    const { registerRuntimeModel, detectRuntimeModelMatch, STUB_MODEL } = mod;
    registerRuntimeModel(STUB_MODEL);
    assert.equal(
      detectRuntimeModelMatch("Use the stub model 22a for this query")?.name,
      "stub_model_22a"
    );
    assert.equal(detectRuntimeModelMatch("What was the fastest lap?"), null);
  });
});
