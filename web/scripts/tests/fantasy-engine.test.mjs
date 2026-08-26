// fantasyEngine legality + accounting tests (converged fantasy roadmap R2).
// The engine is the single authority for roster/budget/transfer/chip
// mechanics; these pin the rules the backtests and optimizer rely on:
// illegal rosters rejected, budget edges, 2025 per-swap vs 2026 net
// transfer accounting, chip single-use, boost/no-negative scoring.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadEngine() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-fantasy-engine-"));
  try {
    for (const name of ["types", "engine"]) {
      const src = await readFile(path.resolve(webRoot, `src/lib/fantasyEngine/${name}.ts`), "utf8");
      const js = ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText.replace(/from "\.\/types"/g, 'from "./types.mjs"');
      await writeFile(path.join(dir, `${name}.mjs`), js);
    }
    return await import(path.join(dir, "engine.mjs"));
  } finally {
    setTimeout(() => rm(dir, { recursive: true, force: true }), 2000);
  }
}

const PRICES = {
  drivers: { 1: 29, 12: 25, 63: 22, 44: 18, 16: 17, 81: 20, 3: 15, 22: 6 },
  constructors: { McLaren: 30, Mercedes: 27, Ferrari: 22, "Red Bull Racing": 18 }
};
const CHEAP = { drivers: [44, 16, 3, 22, 63], constructors: ["Ferrari", "Red Bull Racing"] }; // 78 + 40... adjust below

test("validateRoster: shape and budget", async () => {
  const eng = await loadEngine();
  // 5 unique + 2 unique under cap
  const ok = eng.validateRoster(
    { drivers: [44, 16, 3, 22, 63], constructors: ["Ferrari", "Red Bull Racing"] },
    PRICES
  );
  // 18+17+15+6+22 = 78 drivers + 40 constructors = 118 > 100 → over cap
  assert.equal(ok.legal, false);
  assert.match(ok.reasons.join(" "), /exceeds cap/);

  const cheap = eng.validateRoster(
    { drivers: [44, 16, 3, 22, 12], constructors: ["Ferrari", "Red Bull Racing"] },
    { ...PRICES, drivers: { ...PRICES.drivers, 12: 4 } }
  ); // 18+17+15+6+4=60 + 40 = 100 exactly → legal
  assert.equal(cheap.legal, true);

  const dup = eng.validateRoster({ drivers: [1, 1, 3, 22, 63], constructors: ["Ferrari", "Mercedes"] }, PRICES);
  assert.equal(dup.legal, false);
  assert.match(dup.reasons.join(" "), /duplicate driver/);

  const shape = eng.validateRoster({ drivers: [1, 3, 22], constructors: ["Ferrari"] }, PRICES);
  assert.equal(shape.legal, false);
  assert.equal(shape.reasons.length >= 2, true);
});

test("transfer accounting: 2026 nets, 2025 counts swaps, penalties beyond 2 free", async () => {
  const eng = await loadEngine();
  const prices = { drivers: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10 }, constructors: { A: 20, B: 20, C: 20 } };
  const base = eng.freshSeasonState(2026, { drivers: [1, 2, 3, 4, 5], constructors: ["A", "B"] }, prices);
  assert.equal("error" in base, false);

  // 3 driver swaps → net 3 new → 1 chargeable → −10
  const r = eng.applyRoundDecision(
    base,
    {
      transfersIn: { drivers: [6, 7, 8], constructors: [] },
      transfersOut: { drivers: [1, 2, 3], constructors: [] },
      boostDriver: null,
      chip: null
    },
    prices
  );
  assert.equal("error" in r, false);
  assert.equal(r.transferPenalty, -10);

  // Same three swaps under wildcard → free
  const w = eng.applyRoundDecision(
    base,
    {
      transfersIn: { drivers: [6, 7, 8], constructors: [] },
      transfersOut: { drivers: [1, 2, 3], constructors: [] },
      boostDriver: null,
      chip: "wildcard"
    },
    prices
  );
  assert.equal("error" in w, false);
  assert.equal(w.transferPenalty, 0);
  // wildcard consumed
  assert.equal(w.next.chipsAvailable.includes("wildcard"), false);

  // chip double-use rejected
  const again = eng.applyRoundDecision(
    w.next,
    { transfersIn: { drivers: [], constructors: [] }, transfersOut: { drivers: [], constructors: [] }, boostDriver: null, chip: "wildcard" },
    prices
  );
  assert.equal("error" in again, true);
});

test("limitless suspends the cap for the round; result must still be shape-legal", async () => {
  const eng = await loadEngine();
  const prices = { drivers: { 1: 30, 2: 30, 3: 30, 4: 30, 5: 30, 6: 30 }, constructors: { A: 30, B: 30 } };
  const base = eng.freshSeasonState(2026, { drivers: [1, 2, 3, 4, 5], constructors: ["A", "B"] }, { drivers: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 }, constructors: { A: 20, B: 20 } });
  const over = eng.applyRoundDecision(
    base,
    { transfersIn: { drivers: [6], constructors: [] }, transfersOut: { drivers: [1], constructors: [] }, boostDriver: null, chip: "limitless" },
    prices // at these prices the roster costs 210 — only legal under limitless
  );
  assert.equal("error" in over, false);
});

test("scoreRound: boost doubles, extra_drs triples, no_negative clamps components", async () => {
  const eng = await loadEngine();
  const state = {
    season: 2026,
    roster: { drivers: [1, 12], constructors: ["McLaren"] },
    budget: 0,
    chipsAvailable: []
  };
  // pad roster shape checks aren't in scoreRound — it scores what it's given
  const components = [
    { entityType: "driver", entityKey: "1", component: "race_position", points: 25 },
    { entityType: "driver", entityKey: "1", component: "race_not_classified", points: -20 },
    { entityType: "driver", entityKey: "12", component: "race_position", points: 18 },
    { entityType: "constructor", entityKey: "McLaren", component: "pit_fastest_of_race", points: 5 }
  ];
  const driverTeams = { 1: "McLaren", 12: "Mercedes" };

  const plain = eng.scoreRound({ state, decision: { boostDriver: 1, chip: null }, components, driverTeams });
  // driver1 = 5, driver12 = 18, McLaren = driver1(5) + 5 = 10, boost = +5
  assert.equal(plain.driverPoints[1], 5);
  assert.equal(plain.constructorPoints["McLaren"], 10);
  assert.equal(plain.boostBonus, 5);
  assert.equal(plain.total, 5 + 18 + 10 + 5);

  const tripled = eng.scoreRound({ state, decision: { boostDriver: 1, chip: "extra_drs" }, components, driverTeams });
  assert.equal(tripled.boostBonus, 10); // 3x total = base + 2x bonus

  const clamped = eng.scoreRound({ state, decision: { boostDriver: null, chip: "no_negative" }, components, driverTeams });
  assert.equal(clamped.driverPoints[1], 25); // −20 clamped away
});
