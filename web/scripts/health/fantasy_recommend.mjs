#!/usr/bin/env node
/**
 * fantasy_recommend.mjs — Fantasy R4/R5: the decision output.
 *
 * Reads the stored projections for the upcoming gameday, runs the roster
 * optimizer at current prices, and prints the recommended team, DRS-boost
 * pick, and the top near-optimal alternatives (selection stability). Run
 * after fantasy_project.mjs.
 */
import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function loadOptimizer() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-fantasy-rec-"));
  for (const name of ["types", "optimize"]) {
    const src = await readFile(path.resolve(webRoot, `src/lib/fantasyEngine/${name}.ts`), "utf8");
    const js = ts
      .transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
      .outputText.replace(/from "\.\/types"/g, 'from "./types.mjs"');
    await writeFile(path.join(dir, `${name}.mjs`), js);
  }
  const mod = await import(path.join(dir, "optimize.mjs"));
  setTimeout(() => rm(dir, { recursive: true, force: true }), 3000);
  return mod;
}

const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const model = process.argv.find((a, i) => process.argv[i - 1] === "--model") ?? "persistence";
const client = new Client({
  host: process.env.NEON_DB_HOST,
  user: process.env.NEON_DB_USER,
  password: process.env.NEON_DB_PASSWORD,
  database: process.env.NEON_DB_NAME,
  ssl: { rejectUnauthorized: false }
});
await client.connect();
const { optimizeTeams } = await loadOptimizer();

const { rows } = await client.query(
  `SELECT gameday, entity_type, entity_name, expected_points, price
   FROM analytics.fantasy_projection
   WHERE season = $1 AND model = $2
     AND gameday = (SELECT MAX(gameday) FROM analytics.fantasy_projection WHERE season = $1 AND model = $2)`,
  [season, model]
);
if (!rows.length) {
  console.error("no projections — run fantasy_project.mjs first");
  process.exit(1);
}
const gameday = rows[0].gameday;

const names = rows.filter((r) => r.entity_type === "driver").map((r) => r.entity_name);
const idOf = new Map(names.map((n, i) => [n, i + 1]));
const nameOf = new Map([...idOf.entries()].map(([n, i]) => [i, n]));
const driverPoints = {};
const prices = { drivers: {}, constructors: {} };
const constructorPoints = {};
for (const r of rows) {
  if (r.entity_type === "driver") {
    driverPoints[idOf.get(r.entity_name)] = Number(r.expected_points);
    prices.drivers[idOf.get(r.entity_name)] = Number(r.price);
  } else {
    constructorPoints[r.entity_name] = Number(r.expected_points);
    prices.constructors[r.entity_name] = Number(r.price);
  }
}

const teams = optimizeTeams({ driverPoints, constructorPoints, prices, topN: 4 });
console.log(`Recommended teams — season ${season}, gameday ${gameday}, model=${model}, $100M cap\n`);
teams.forEach((t, i) => {
  const label = i === 0 ? "RECOMMENDED" : `alt ${i}`;
  console.log(
    `${label.padEnd(12)} $${t.cost.toFixed(1)}M  E[pts]=${t.expectedPoints.toFixed(1)}  boost=${nameOf.get(t.boostDriver)}`
  );
  console.log(`  drivers: ${t.roster.drivers.map((d) => nameOf.get(d)).join(", ")}`);
  console.log(`  constructors: ${t.roster.constructors.join(", ")}\n`);
});
console.log("Caveats: single-round EV (no transfer costs/chip calendar yet); projections are the measured-champion model — see fantasy_backtest.mjs for its scoreboard.");
await client.end();
