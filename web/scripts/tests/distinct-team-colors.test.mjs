// Teammate color differentiation: two drivers from the same team must not
// render as identical lines (2025 Bahrain incident: Hamilton vs Leclerc as
// two indistinguishable Ferrari-red traces).

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadColors() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-team-colors-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/f1-team-colors.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  await writeFile(path.join(dir, "colors.mjs"), out, "utf8");
  const mod = await import(path.join(dir, "colors.mjs"));
  return { mod, dir };
}

test("teammates get distinct colors; alphabetically-first keeps team color (F28: order-independent)", async () => {
  const { mod, dir } = await loadColors();
  try {
    const colors = mod.getDistinctTeamColors(["Lewis Hamilton", "Charles Leclerc"]);
    // F28: assignment is by sorted name, not input order — "Charles" < "Lewis",
    // so Leclerc keeps the base Ferrari red on EVERY card regardless of order.
    assert.equal(colors["Charles Leclerc"], "#E8002D", "alphabetically-first Ferrari driver keeps Ferrari red");
    assert.notEqual(colors["Lewis Hamilton"], colors["Charles Leclerc"], "teammate must differ");
    assert.match(colors["Lewis Hamilton"], /^#[0-9A-F]{6}$/, "teammate color is a valid hex");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F28: color assignment is stable across input order (the whole point)", async () => {
  const { mod, dir } = await loadColors();
  try {
    const fwd = mod.getDistinctTeamColors(["Lewis Hamilton", "Charles Leclerc"]);
    const rev = mod.getDistinctTeamColors(["Charles Leclerc", "Lewis Hamilton"]);
    assert.equal(fwd["Lewis Hamilton"], rev["Lewis Hamilton"], "Hamilton's color must not depend on order");
    assert.equal(fwd["Charles Leclerc"], rev["Charles Leclerc"], "Leclerc's color must not depend on order");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uppercase warehouse names (Lewis HAMILTON) resolve to the same team and still differ", async () => {
  const { mod, dir } = await loadColors();
  try {
    const colors = mod.getDistinctTeamColors(["Lewis HAMILTON", "Charles LECLERC"]);
    // "Charles LECLERC" < "Lewis HAMILTON" → Leclerc keeps the base.
    assert.equal(colors["Charles LECLERC"], "#E8002D");
    assert.notEqual(colors["Lewis HAMILTON"], colors["Charles LECLERC"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("drivers from different teams keep their plain team colors", async () => {
  const { mod, dir } = await loadColors();
  try {
    const colors = mod.getDistinctTeamColors(["Max Verstappen", "Lando Norris"]);
    assert.equal(colors["Max Verstappen"], mod.getTeamColor("Max Verstappen"));
    assert.equal(colors["Lando Norris"], mod.getTeamColor("Lando Norris"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("three unknown drivers (default color) still get three distinct colors", async () => {
  const { mod, dir } = await loadColors();
  try {
    const colors = mod.getDistinctTeamColors(["Driver One", "Driver Two", "Driver Three"]);
    const values = Object.values(colors);
    assert.equal(new Set(values).size, 3, "all distinct");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
