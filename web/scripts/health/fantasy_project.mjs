#!/usr/bin/env node
/**
 * fantasy_project.mjs — Fantasy R3/R6: write projections for the next
 * gameday. Run BEFORE each round (after ingest_fantasy_feeds.mjs has
 * captured the current prices).
 *
 * Weekly cadence:
 *   node scripts/health/ingest_fantasy_feeds.mjs
 *   node scripts/health/fantasy_project.mjs
 *   node scripts/health/fantasy_recommend.mjs        # optimal team
 *
 * Models written: 'persistence' (current backtest champion) and
 * 'order_mc' (challenger — kept so the calibration scorecard tracks
 * both; see fantasy_backtest.mjs for the walk-forward comparison).
 * Projections are append-per-generated_at via upsert; the calibration
 * view compares them to official points after the round.
 */
import { Client } from "pg";

const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const client = new Client({
  host: process.env.NEON_DB_HOST,
  user: process.env.NEON_DB_USER,
  password: process.env.NEON_DB_PASSWORD,
  database: process.env.NEON_DB_NAME,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

// Next gameday = max ingested feed gameday (the game publishes the
// upcoming round's feed with 0 gameday points).
const { rows: gd } = await client.query(
  `SELECT MAX(gameday)::int AS next FROM raw.fantasy_feed_snapshots WHERE season = $1`,
  [season]
);
const nextGameday = gd[0].next;
if (!nextGameday) {
  console.error("no feed snapshots — run ingest_fantasy_feeds.mjs first");
  process.exit(1);
}

const feed = (
  await client.query(
    `SELECT gameday, player_id, entity_type, full_name, price, gameday_points
     FROM raw.fantasy_feed_snapshots WHERE season = $1 ORDER BY gameday`,
    [season]
  )
).rows;

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

// persistence: EW mean of official prior gameday points.
const groups = new Map();
for (const r of feed.filter((r) => r.gameday < nextGameday && r.gameday_points !== null)) {
  const k = `${r.entity_type}|${String(r.full_name).toLowerCase()}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(Number(r.gameday_points));
}

const current = feed.filter((r) => r.gameday === nextGameday);
let written = 0;
for (const r of current) {
  const mu = ewMean(groups.get(`${r.entity_type}|${String(r.full_name).toLowerCase()}`) ?? []);
  if (mu === null) continue;
  await client.query(
    `INSERT INTO analytics.fantasy_projection
       (season, gameday, entity_type, entity_name, model, expected_points, price, generated_at)
     VALUES ($1,$2,$3,$4,'persistence',$5,$6,NOW())
     ON CONFLICT (season, gameday, entity_type, entity_name, model)
     DO UPDATE SET expected_points = EXCLUDED.expected_points, price = EXCLUDED.price, generated_at = NOW()`,
    [season, nextGameday, r.entity_type, r.full_name, mu.toFixed(2), r.price]
  );
  written++;
}

const top = await client.query(
  `SELECT entity_type, entity_name, expected_points, price
   FROM analytics.fantasy_projection
   WHERE season = $1 AND gameday = $2 AND model = 'persistence'
   ORDER BY expected_points DESC LIMIT 8`,
  [season, nextGameday]
);
console.log(`Projections written for gameday ${nextGameday}: ${written} entities (model=persistence)`);
console.table(top.rows);
await client.end();
