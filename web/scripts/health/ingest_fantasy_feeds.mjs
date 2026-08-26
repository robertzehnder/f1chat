#!/usr/bin/env node
/**
 * ingest_fantasy_feeds.mjs — Fantasy R1 ingest.
 *
 * Pulls the official game's per-gameday driver/constructor feed
 * (fantasy.formula1.com/feeds/drivers/<gameday>_en.json) and upserts into
 * raw.fantasy_feed_snapshots. Feed N is gameday N of the CURRENT season;
 * the walk stops at the first 403/404 (future gameday not yet published).
 *
 * Idempotent: re-running refreshes existing gamedays (prices/ownership can
 * shift between fetches for the upcoming round; historical gamedays are
 * stable). Run before each round to capture the as-of-deadline snapshot.
 *
 * Usage: node scripts/health/ingest_fantasy_feeds.mjs [--season 2026]
 * Env: NEON_DB_* (web/.env.local)
 */
import { Client } from "pg";

const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const BASE = "https://fantasy.formula1.com/feeds/drivers";

const client = new Client({
  host: process.env.NEON_DB_HOST,
  user: process.env.NEON_DB_USER,
  password: process.env.NEON_DB_PASSWORD,
  database: process.env.NEON_DB_NAME,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

let total = 0;
for (let gameday = 1; gameday <= 40; gameday++) {
  const res = await fetch(`${BASE}/${gameday}_en.json`).catch(() => null);
  if (!res || !res.ok) {
    console.log(`gameday ${gameday}: HTTP ${res?.status ?? "ERR"} — stopping walk`);
    break;
  }
  const body = await res.json().catch(() => null);
  const rows = body?.Data?.Value;
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`gameday ${gameday}: empty payload — stopping walk`);
    break;
  }
  for (const r of rows) {
    await client.query(
      `INSERT INTO raw.fantasy_feed_snapshots
         (season, gameday, player_id, entity_type, full_name, driver_tla, team_name,
          price, gameday_points, overall_points, quali_points, race_points,
          sprint_points, selected_pct, captain_pct, is_active, payload, ingested_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,NOW())
       ON CONFLICT (season, gameday, player_id) DO UPDATE SET
         price = EXCLUDED.price,
         gameday_points = EXCLUDED.gameday_points,
         overall_points = EXCLUDED.overall_points,
         quali_points = EXCLUDED.quali_points,
         race_points = EXCLUDED.race_points,
         sprint_points = EXCLUDED.sprint_points,
         selected_pct = EXCLUDED.selected_pct,
         captain_pct = EXCLUDED.captain_pct,
         is_active = EXCLUDED.is_active,
         payload = EXCLUDED.payload,
         ingested_at = NOW()`,
      [
        season,
        gameday,
        String(r.PlayerId),
        r.PositionName === "CONSTRUCTOR" ? "constructor" : "driver",
        r.FUllName ?? r.DisplayName ?? null,
        r.DriverTLA ?? null,
        r.TeamName ?? null,
        num(r.Value),
        num(r.GamedayPoints),
        num(r.OverallPpints),
        num(r.QualifyingPoints),
        num(r.RacePoints),
        num(r.SprintPoints),
        num(r.SelectedPercentage),
        num(r.CaptainSelectedPercentage),
        typeof r.IsActive === "boolean" ? r.IsActive : null,
        JSON.stringify(r)
      ]
    );
    total++;
  }
  console.log(`gameday ${gameday}: ${rows.length} entities upserted`);
  await new Promise((r) => setTimeout(r, 400));
}

const summary = await client.query(
  `SELECT gameday, COUNT(*) AS entities,
          ROUND(AVG(price) FILTER (WHERE entity_type='driver'), 1) AS avg_driver_price
   FROM raw.fantasy_feed_snapshots WHERE season = $1
   GROUP BY gameday ORDER BY gameday`,
  [season]
);
console.table(summary.rows);
console.log(`DONE: ${total} rows upserted for season ${season}`);
await client.end();
