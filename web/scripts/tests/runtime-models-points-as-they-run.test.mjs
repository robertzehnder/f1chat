// Phase 22-G (slice 22-points-as-they-run): tests for the FIA points
// formula identity model. Codex audit: ships autonomously since the
// formula is deterministic.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadModule() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-points-"));
  const indexSrc = await readFile(
    path.resolve(webRoot, "src/lib/runtimeModels/index.ts"),
    "utf8"
  );
  const pointsSrc = await readFile(
    path.resolve(webRoot, "src/lib/runtimeModels/pointsAsTheyRun.ts"),
    "utf8"
  );
  // Make `pointsAsTheyRun.ts`'s import of "./index" resolve to the file
  // we'll write below.
  const pointsRewritten = pointsSrc.replace(
    /from\s+["']\.\/index["']/g,
    `from "./index.mjs"`
  );
  const transpiledIndex = ts.transpileModule(indexSrc, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const transpiledPoints = ts.transpileModule(pointsRewritten, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "index.mjs"), transpiledIndex.outputText, "utf8");
  await writeFile(path.join(dir, "pointsAsTheyRun.mjs"), transpiledPoints.outputText, "utf8");
  const indexMod = await import(path.join(dir, "index.mjs"));
  const pointsMod = await import(path.join(dir, "pointsAsTheyRun.mjs"));
  return { indexMod, pointsMod, dir };
}

async function withModule(fn) {
  const { indexMod, pointsMod, dir } = await loadModule();
  try {
    if (typeof indexMod._resetRuntimeModelRegistryForTests === "function") {
      indexMod._resetRuntimeModelRegistryForTests();
    }
    await fn({ indexMod, pointsMod });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("computePointsAsTheyRun: race with full top-10 + fastest-lap bonus", async () => {
  await withModule(async ({ pointsMod }) => {
    const order = [
      { driverNumber: 1, position: 1, fastestLap: true },
      { driverNumber: 4, position: 2 },
      { driverNumber: 16, position: 3 },
      { driverNumber: 81, position: 4 },
      { driverNumber: 44, position: 5 },
      { driverNumber: 63, position: 6 },
      { driverNumber: 55, position: 7 },
      { driverNumber: 11, position: 8 },
      { driverNumber: 14, position: 9 },
      { driverNumber: 27, position: 10 }
    ];
    const out = pointsMod.computePointsAsTheyRun(order, "race");
    assert.equal(out[0].points, 26, "P1 + fastest lap = 25 + 1 = 26");
    assert.equal(out[0].awardedFastestLap, true);
    assert.equal(out[1].points, 18);
    assert.equal(out[2].points, 15);
    assert.equal(out[9].points, 1);
  });
});

test("computePointsAsTheyRun: sprint awards 8-7-6-5-4-3-2-1 (no fastest-lap bonus)", async () => {
  await withModule(async ({ pointsMod }) => {
    const order = [
      { driverNumber: 1, position: 1, fastestLap: true },
      { driverNumber: 4, position: 2 },
      { driverNumber: 16, position: 3 },
      { driverNumber: 81, position: 4 },
      { driverNumber: 44, position: 5 },
      { driverNumber: 63, position: 6 },
      { driverNumber: 55, position: 7 },
      { driverNumber: 11, position: 8 }
    ];
    const out = pointsMod.computePointsAsTheyRun(order, "sprint");
    assert.equal(out[0].points, 8, "no fastest-lap bonus in sprints (2025 regs)");
    assert.equal(out[0].awardedFastestLap, false);
    assert.equal(out[7].points, 1);
  });
});

test("computePointsAsTheyRun: fastest-lap outside top 10 yields no bonus", async () => {
  await withModule(async ({ pointsMod }) => {
    const order = [
      { driverNumber: 1, position: 1 },
      { driverNumber: 16, position: 2 },
      { driverNumber: 4, position: 11, fastestLap: true } // outside cutoff
    ];
    const out = pointsMod.computePointsAsTheyRun(order, "race");
    assert.equal(out[0].points, 25, "no FL bonus for P1 because fastest-lap driver was out of top 10");
    assert.equal(out[2].points, 0, "11th place gets no points");
    assert.equal(out[2].awardedFastestLap, false);
  });
});

test("computePointsAsTheyRun: DNF returns 0 points regardless of position", async () => {
  await withModule(async ({ pointsMod }) => {
    const order = [
      { driverNumber: 1, position: 1, dnf: true },
      { driverNumber: 16, position: 2 }
    ];
    const out = pointsMod.computePointsAsTheyRun(order, "race");
    assert.equal(out[0].points, 0);
    assert.equal(out[1].points, 18);
  });
});

test("dispatchRuntimeModel + POINTS_AS_THEY_RUN_MODEL: end-to-end via 22-A plumbing", async () => {
  await withModule(async ({ indexMod, pointsMod }) => {
    indexMod.registerRuntimeModel(pointsMod.POINTS_AS_THEY_RUN_MODEL);
    const out = await indexMod.dispatchRuntimeModel(
      "points_as_they_run",
      {
        sessionType: "race",
        finishingOrder: [
          { driverNumber: 1, position: 1, fastestLap: true },
          { driverNumber: 16, position: 2 }
        ]
      }
    );
    assert.equal(out.modelName, "points_as_they_run");
    assert.equal(out.payload.sessionType, "race");
    assert.equal(out.payload.totalPoints, 26 + 18);
    assert.equal(out.confidence, 1.0);
  });
});

test("POINTS_AS_THEY_RUN_MODEL.validateInput rejects bad inputs", async () => {
  await withModule(async ({ indexMod, pointsMod }) => {
    indexMod.registerRuntimeModel(pointsMod.POINTS_AS_THEY_RUN_MODEL);
    await assert.rejects(
      () =>
        indexMod.dispatchRuntimeModel("points_as_they_run", {
          sessionType: "race",
          finishingOrder: []
        }),
      /finishingOrder must be a non-empty array/
    );
    await assert.rejects(
      () =>
        indexMod.dispatchRuntimeModel("points_as_they_run", {
          sessionType: "qualifying",
          finishingOrder: [{ driverNumber: 1, position: 1 }]
        }),
      /sessionType must be 'race' or 'sprint'/
    );
  });
});
