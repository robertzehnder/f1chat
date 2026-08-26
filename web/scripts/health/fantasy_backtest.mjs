#!/usr/bin/env node
/**
 * fantasy_backtest.mjs — Fantasy R2+R3: walk-forward backtest.
 *
 * For each completed gameday G (from 4 on, so models have history), every
 * model sees ONLY rounds < G (strict as-of), projects driver+constructor
 * points, picks a legal team at that gameday's prices (fresh team each
 * round — transfer costs excluded in v1, stated), and is scored on the
 * OFFICIAL points (raw.fantasy_feed_snapshots).
 *
 * Models:
 *   persistence   EW mean of official gameday points (halflife 3)
 *   price_implied points predicted from price rank, mapped through the
 *                 prior rounds' average points-by-price-rank curve
 *   order_mc      projection model v1: EW finish/quali ratings + DNF
 *                 hazard → 2000-run rank-noise Monte Carlo → scored with
 *                 the DB rules table (position/delta/NC components; the
 *                 overtake/FL/DotD terms are out of scope in v1)
 *
 * Metrics per model: points MAE, Spearman rank corr, executable-decision
 * points, oracle regret (oracle = optimizer fed official points).
 */
import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function loadOptimizer() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-fantasy-opt-"));
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

const season = 2026;
const client = new Client({
  host: process.env.NEON_DB_HOST,
  user: process.env.NEON_DB_USER,
  password: process.env.NEON_DB_PASSWORD,
  database: process.env.NEON_DB_NAME,
  ssl: { rejectUnauthorized: false }
});
await client.connect();
const { optimizeTeams } = await loadOptimizer();

// ── Load: official feed (points, prices, names) ────────────────────────
const feed = (
  await client.query(
    `SELECT gameday, player_id, entity_type, full_name, team_name, price, gameday_points
     FROM raw.fantasy_feed_snapshots WHERE season = $1 ORDER BY gameday`,
    [season]
  )
).rows;
const completed = [...new Set(feed.filter((r) => Number(r.gameday_points) !== 0 || r.gameday <= 12).map((r) => r.gameday))]
  .filter((g) => feed.some((r) => r.gameday === g && r.gameday_points !== null && Number(r.gameday_points) !== 0))
  .sort((a, b) => a - b);

// ── Load: warehouse finish/quali/DNF per meeting (calendar order) ──────
const wh = (
  await client.query(
    `WITH meetings AS (
       SELECT m.meeting_key, ROW_NUMBER() OVER (ORDER BY MIN(s.date_start)) AS gameday
       FROM core.sessions s JOIN raw.meetings m ON m.meeting_key = s.meeting_key
       WHERE s.year = $1 AND s.session_name = 'Race'
         AND EXISTS (SELECT 1 FROM raw.session_result sr WHERE sr.session_key = s.session_key)
       GROUP BY m.meeting_key)
     SELECT me.gameday::int AS gameday, s.session_name, sr.driver_number, sr.position, sr.status,
            LOWER(rr.full_name) AS full_name, rr.team_name
     FROM meetings me
     JOIN core.sessions s ON s.meeting_key = me.meeting_key AND s.session_name IN ('Race','Qualifying')
     JOIN raw.session_result sr ON sr.session_key = s.session_key
     LEFT JOIN (SELECT session_key, driver_number, MAX(full_name) AS full_name, MAX(team_name) AS team_name
                FROM core.session_drivers GROUP BY session_key, driver_number) rr
       ON rr.session_key = s.session_key AND rr.driver_number = sr.driver_number`,
    [season]
  )
).rows;

// Rules for the order_mc scorer.
const rules = (
  await client.query(`SELECT component, position, points FROM core.fantasy_scoring_rules WHERE season = $1`, [season])
).rows;
const posPts = (comp, p) => Number(rules.find((r) => r.component === comp && Number(r.position) === p)?.points ?? 0);
const scalar = (comp) => Number(rules.find((r) => r.component === comp && r.position === null)?.points ?? 0);

// ── Helpers ────────────────────────────────────────────────────────────
const byName = (rows, g) => new Map(rows.filter((r) => r.gameday === g).map((r) => [String(r.full_name).toLowerCase(), r]));
const ewMean = (vals, halflife = 3) => {
  if (!vals.length) return null;
  const lambda = Math.log(2) / halflife;
  let num = 0, den = 0;
  vals.forEach((v, i) => {
    const w = Math.exp(-lambda * (vals.length - 1 - i));
    num += w * v; den += w;
  });
  return num / den;
};
const spearman = (a, b) => {
  const rank = (xs) => {
    const idx = xs.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]);
    const rs = new Array(xs.length);
    idx.forEach(([, i], r) => (rs[i] = r + 1));
    return rs;
  };
  const ra = rank(a), rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
};
// Deterministic RNG (mulberry32) for reproducible MC.
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (rand) => {
  const u = Math.max(rand(), 1e-9), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// ── Models ─────────────────────────────────────────────────────────────
function persistence(g) {
  const out = { drivers: {}, constructors: {} };
  const prior = feed.filter((r) => r.gameday < g && r.gameday_points !== null);
  const groups = new Map();
  for (const r of prior) {
    const k = `${r.entity_type}|${String(r.full_name).toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(Number(r.gameday_points));
  }
  for (const r of byName(feed, g).values()) {
    const k = `${r.entity_type}|${String(r.full_name).toLowerCase()}`;
    const mu = ewMean(groups.get(k) ?? []);
    if (mu === null) continue;
    if (r.entity_type === "driver") out.drivers[r.player_id] = mu;
    else out.constructors[r.full_name] = mu;
  }
  return out;
}

function priceImplied(g) {
  const out = { drivers: {}, constructors: {} };
  for (const type of ["driver", "constructor"]) {
    // points-by-price-rank curve from prior rounds only
    const curve = new Map();
    for (let h = 1; h < g; h++) {
      const rows = feed.filter((r) => r.gameday === h && r.entity_type === type && r.gameday_points !== null);
      const ranked = rows.slice().sort((a, b) => Number(b.price) - Number(a.price));
      ranked.forEach((r, i) => {
        if (!curve.has(i)) curve.set(i, []);
        curve.get(i).push(Number(r.gameday_points));
      });
    }
    const nowRows = feed.filter((r) => r.gameday === g && r.entity_type === type);
    const rankedNow = nowRows.slice().sort((a, b) => Number(b.price) - Number(a.price));
    rankedNow.forEach((r, i) => {
      const hist = curve.get(i) ?? [];
      const mu = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
      if (type === "driver") out.drivers[r.player_id] = mu;
      else out.constructors[r.full_name] = mu;
    });
  }
  return out;
}

function orderMc(g, iterations = 2000) {
  // ratings from warehouse finishing/quali positions before g
  const prior = wh.filter((r) => r.gameday < g);
  const names = [...new Set(wh.filter((r) => r.gameday === g).map((r) => r.full_name))].filter(Boolean);
  const fieldSize = 20;
  const stats = new Map();
  for (const nm of names) {
    const rows = prior.filter((r) => r.full_name === nm).sort((a, b) => a.gameday - b.gameday);
    const race = rows.filter((r) => r.session_name === "Race");
    const quali = rows.filter((r) => r.session_name === "Qualifying");
    stats.set(nm, {
      raceMu: ewMean(race.map((r) => (r.position === null ? fieldSize : Number(r.position)))) ?? 12,
      qualiMu: ewMean(quali.map((r) => (r.position === null ? fieldSize : Number(r.position)))) ?? 12,
      dnfRate: Math.min(0.35, 0.06 + 0.6 * (race.length ? race.filter((r) => r.position === null).length / race.length : 0.08)),
      team: rows.at(-1)?.team_name ?? null
    });
  }
  const rand = rng(g * 7919);
  const acc = new Map(names.map((n) => [n, 0]));
  const conAcc = new Map();
  for (let it = 0; it < iterations; it++) {
    const qualiOrder = names
      .map((n) => ({ n, s: stats.get(n).qualiMu + gauss(rand) * 3.4 }))
      .sort((a, b) => a.s - b.s);
    const qPos = new Map(qualiOrder.map((q, i) => [q.n, i + 1]));
    const dnf = new Set(names.filter((n) => rand() < stats.get(n).dnfRate));
    const raceOrder = names
      .filter((n) => !dnf.has(n))
      .map((n) => ({ n, s: stats.get(n).raceMu + gauss(rand) * 4.2 }))
      .sort((a, b) => a.s - b.s);
    const rPos = new Map(raceOrder.map((r, i) => [r.n, i + 1]));
    const conPts = new Map();
    for (const n of names) {
      const q = qPos.get(n);
      let pts = q <= 10 ? posPts("quali_position", q) : 0;
      if (dnf.has(n)) {
        pts += scalar("race_not_classified");
      } else {
        const p = rPos.get(n);
        pts += p <= 10 ? posPts("race_position", p) : 0;
        pts += (q - p) * scalar("race_position_delta_per_place");
      }
      acc.set(n, acc.get(n) + pts);
      const team = stats.get(n).team;
      if (team) conPts.set(team, (conPts.get(team) ?? 0) + pts);
    }
    // constructor Q2/Q3 progression from sim quali
    const teams = new Map();
    for (const n of names) {
      const t = stats.get(n).team;
      if (!t) continue;
      if (!teams.has(t)) teams.set(t, []);
      teams.get(t).push(qPos.get(n));
    }
    for (const [t, ps] of teams) {
      const q2 = ps.filter((p) => p <= 15).length;
      const q3 = ps.filter((p) => p <= 10).length;
      let bonus = q2 === 0 ? scalar("constructor_q2_none") : q2 === 1 ? scalar("constructor_q2_one") : scalar("constructor_q2_both");
      bonus += q3 === 1 ? scalar("constructor_q3_one") : q3 >= 2 ? scalar("constructor_q3_both") : 0;
      conPts.set(t, (conPts.get(t) ?? 0) + bonus);
    }
    for (const [t, p] of conPts) conAcc.set(t, (conAcc.get(t) ?? 0) + p);
  }
  const out = { drivers: {}, constructors: {} };
  const feedNow = byName(feed, g);
  for (const [nm, sum] of acc) {
    const f = feedNow.get(nm);
    if (f && f.entity_type === "driver") out.drivers[f.player_id] = sum / iterations;
  }
  for (const [team, sum] of conAcc) {
    const f = [...feedNow.values()].find((r) => r.entity_type === "constructor" && (r.team_name === team || r.full_name === team));
    if (f) out.constructors[f.full_name] = sum / iterations;
  }
  return out;
}

// ── Decision layer + evaluation ────────────────────────────────────────
function decide(proj, g) {
  const nowFeed = [...byName(feed, g).values()];
  const prices = { drivers: {}, constructors: {} };
  const idToNum = new Map();
  nowFeed.forEach((r, i) => {
    if (r.entity_type === "driver") {
      const pseudo = i + 1; // player_id is a string; optimizer wants numbers
      idToNum.set(r.player_id, pseudo);
      prices.drivers[pseudo] = Number(r.price);
    } else prices.constructors[r.full_name] = Number(r.price);
  });
  const driverPoints = {};
  for (const [pid, pts] of Object.entries(proj.drivers ?? {})) {
    const n = idToNum.get(pid);
    if (n) driverPoints[n] = pts;
  }
  const teams = optimizeTeams({ driverPoints, constructorPoints: proj.constructors ?? {}, prices, topN: 1 });
  if (!teams.length) return null;
  const t = teams[0];
  const numToId = new Map([...idToNum.entries()].map(([id, n]) => [n, id]));
  return {
    driverIds: t.roster.drivers.map((n) => numToId.get(n)),
    constructors: t.roster.constructors,
    boostId: numToId.get(t.boostDriver)
  };
}

function realize(decision, g) {
  if (!decision) return null;
  const nowFeed = [...byName(feed, g).values()];
  const off = new Map(nowFeed.map((r) => [r.player_id, Number(r.gameday_points ?? 0)]));
  const offCon = new Map(nowFeed.filter((r) => r.entity_type === "constructor").map((r) => [r.full_name, Number(r.gameday_points ?? 0)]));
  let pts = 0;
  for (const id of decision.driverIds) pts += off.get(id) ?? 0;
  for (const c of decision.constructors) pts += offCon.get(c) ?? 0;
  pts += off.get(decision.boostId) ?? 0; // DRS boost doubles
  return pts;
}

function oracle(g) {
  const proj = { drivers: {}, constructors: {} };
  for (const r of byName(feed, g).values()) {
    if (r.entity_type === "driver") proj.drivers[r.player_id] = Number(r.gameday_points ?? 0);
    else proj.constructors[r.full_name] = Number(r.gameday_points ?? 0);
  }
  return realize(decide(proj, g), g);
}

const SPRINT_GAMEDAYS = new Set([2, 4, 5, 9, 12]);
const models = { persistence, price_implied: priceImplied, order_mc: orderMc };
const results = {};
for (const name of Object.keys(models)) results[name] = { mae: [], rho: [], decided: [], regret: [] };
const oraclePts = [];

const testGamedays = completed.filter((g) => g >= 4 && g <= 12);
for (const g of testGamedays) {
  const officialDrivers = [...byName(feed, g).values()].filter((r) => r.entity_type === "driver" && r.gameday_points !== null);
  const orc = oracle(g);
  oraclePts.push(orc);
  for (const [name, fn] of Object.entries(models)) {
    const proj = fn(g);
    const pairs = officialDrivers
      .map((r) => [proj.drivers[r.player_id], Number(r.gameday_points)])
      .filter(([p]) => p !== undefined);
    const mae = pairs.reduce((s, [p, o]) => s + Math.abs(p - o), 0) / pairs.length;
    const rho = spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    const dec = realize(decide(proj, g), g);
    results[name].mae.push(mae);
    results[name].rho.push(rho);
    results[name].decided.push(dec ?? 0);
    results[name].regret.push((orc ?? 0) - (dec ?? 0));
  }
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`Walk-forward gamedays ${testGamedays.join(", ")} (sprint rounds: ${testGamedays.filter((g) => SPRINT_GAMEDAYS.has(g)).join(", ")})`);
console.log(`Oracle (hindsight-optimal fresh team) avg: ${avg(oraclePts).toFixed(1)} pts/round\n`);
console.log("model          | points MAE | Spearman | decision pts/round | regret vs oracle");
for (const [name, r] of Object.entries(results)) {
  console.log(
    `${name.padEnd(14)} |   ${avg(r.mae).toFixed(1).padStart(6)}   |  ${avg(r.rho).toFixed(3)}  |      ${avg(r.decided).toFixed(1).padStart(6)}      |   ${avg(r.regret).toFixed(1)}`
  );
}
console.log("\nCaveats (v1): fresh team each round (no transfer costs); order_mc omits overtake/FL/DotD terms and sprint scoring.");
await client.end();
