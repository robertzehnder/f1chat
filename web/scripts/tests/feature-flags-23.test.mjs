// Phase 23 feature-flag gate unit tests. Codex audit said Phase 23
// ships behind `analyticsv2` flag with per-surface flags overriding
// the umbrella. This test asserts the precedence rule.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const sourcePath = path.resolve(webRoot, "src/lib/featureFlags.ts");

async function loadModule() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-feature-flags-"));
  const src = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "featureFlags.mjs"), transpiled.outputText, "utf8");
  // Each test starts with a fresh import. Node ESM dedupes by URL — we
  // append a query string to defeat the cache.
  const cacheBuster = `?t=${Date.now()}_${Math.random()}`;
  const mod = await import(`${path.join(dir, "featureFlags.mjs")}${cacheBuster}`);
  return { mod, dir };
}

async function withModule(envOverrides, fn) {
  const saved = {};
  const flagKeys = Object.keys(envOverrides);
  for (const k of flagKeys) {
    saved[k] = process.env[k];
    if (envOverrides[k] === null) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  const { mod, dir } = await loadModule();
  try {
    await fn(mod);
  } finally {
    for (const k of flagKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("umbrella flag OFF → every surface OFF", async () => {
  await withModule(
    {
      OPENF1_FEATURE_ANALYTICSV2: null,
      OPENF1_FEATURE_ANALYTICSV2_TRACK_DOMINANCE_MAP: null
    },
    (mod) => {
      assert.equal(mod.isFeatureEnabled("analyticsv2"), false);
      assert.equal(mod.isFeatureEnabled("analyticsv2_track_dominance_map"), false);
    }
  );
});

test("umbrella flag ON → every surface ON by default", async () => {
  await withModule(
    {
      OPENF1_FEATURE_ANALYTICSV2: "1",
      OPENF1_FEATURE_ANALYTICSV2_TRACK_DOMINANCE_MAP: null
    },
    (mod) => {
      assert.equal(mod.isFeatureEnabled("analyticsv2"), true);
      assert.equal(mod.isFeatureEnabled("analyticsv2_track_dominance_map"), true);
    }
  );
});

test("per-surface flag OFF overrides umbrella ON", async () => {
  await withModule(
    {
      OPENF1_FEATURE_ANALYTICSV2: "1",
      OPENF1_FEATURE_ANALYTICSV2_STRATEGY_SIMULATOR: "0"
    },
    (mod) => {
      assert.equal(mod.isFeatureEnabled("analyticsv2"), true);
      assert.equal(mod.isFeatureEnabled("analyticsv2_strategy_simulator"), false);
    }
  );
});

test("per-surface flag ON overrides umbrella OFF", async () => {
  await withModule(
    {
      OPENF1_FEATURE_ANALYTICSV2: "0",
      OPENF1_FEATURE_ANALYTICSV2_CORNER_ANALYSIS_PAGE: "1"
    },
    (mod) => {
      assert.equal(mod.isFeatureEnabled("analyticsv2"), false);
      assert.equal(mod.isFeatureEnabled("analyticsv2_corner_analysis_page"), true);
    }
  );
});

test("various ON-like values are recognized (1, true, yes, on)", async () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    await withModule({ OPENF1_FEATURE_ANALYTICSV2: value }, (mod) => {
      assert.equal(mod.isFeatureEnabled("analyticsv2"), true, `expected ON for value: ${value}`);
    });
  }
});
