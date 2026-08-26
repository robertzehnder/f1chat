#!/usr/bin/env node
/**
 * fantasy_reconcile.mjs — Fantasy R0 reconciliation harness.
 *
 * Compares the warehouse-reconstructed ledger totals
 * (analytics.fantasy_points_by_round) against the OFFICIAL game points
 * (raw.fantasy_feed_snapshots.gameday_points) per driver per round.
 * Gameday N = the N-th meeting of the season in calendar order.
 *
 * Output: per-round MAE, share of drivers within ±3, and the worst
 * per-driver deltas — the work queue for fixing rules-table values and
 * quantifying proxy-component error (overtakes, FL, deltas).
 *
 * Usage: node scripts/health/fantasy_reconcile.mjs [--season 2026]
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

const { rows } = await client.query(
  `
  WITH meetings AS (
    SELECT m.meeting_key,
           ROW_NUMBER() OVER (ORDER BY MIN(s.date_start)) AS gameday
    FROM core.sessions s
    JOIN raw.meetings m ON m.meeting_key = s.meeting_key
    WHERE s.year = $1 AND s.session_name = 'Race'
      AND EXISTS (SELECT 1 FROM raw.session_result sr WHERE sr.session_key = s.session_key)
    GROUP BY m.meeting_key
  ),
  ours AS (
    SELECT me.gameday, fr.circuit_short_name, fr.entity_name, fr.points AS our_points
    FROM analytics.fantasy_points_by_round fr
    JOIN meetings me ON me.meeting_key = fr.meeting_key
    WHERE fr.year = $1 AND fr.entity_type = 'driver'
  ),
  official AS (
    SELECT gameday, full_name, gameday_points
    FROM raw.fantasy_feed_snapshots
    WHERE season = $1 AND entity_type = 'driver' AND gameday_points IS NOT NULL
  )
  SELECT o.gameday, o.circuit_short_name, o.entity_name,
         o.our_points, f.gameday_points AS official_points,
         o.our_points - f.gameday_points AS delta
  FROM ours o
  JOIN official f
    ON f.gameday = o.gameday
   AND LOWER(f.full_name) = LOWER(o.entity_name)
  ORDER BY o.gameday, ABS(o.our_points - f.gameday_points) DESC
  `,
  [season]
);

if (rows.length === 0) {
  console.log("No joined rows — check name matching / season.");
  process.exit(1);
}

const byRound = new Map();
for (const r of rows) {
  const k = `${r.gameday} ${r.circuit_short_name}`;
  if (!byRound.has(k)) byRound.set(k, []);
  byRound.get(k).push(Number(r.delta));
}
console.log("Per-round reconciliation (our reconstructed vs official):");
for (const [k, deltas] of byRound) {
  const mae = deltas.reduce((a, d) => a + Math.abs(d), 0) / deltas.length;
  const within3 = deltas.filter((d) => Math.abs(d) <= 3).length;
  console.log(
    `  ${k.padEnd(24)} n=${String(deltas.length).padStart(2)}  MAE=${mae.toFixed(1).padStart(5)}  within±3: ${within3}/${deltas.length}`
  );
}

const overall = rows.map((r) => Math.abs(Number(r.delta)));
console.log(`\nOverall: n=${rows.length} MAE=${(overall.reduce((a, b) => a + b, 0) / overall.length).toFixed(2)}`);
console.log("\nWorst 12 deltas (our − official):");
for (const r of [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12)) {
  console.log(
    `  gd${String(r.gameday).padStart(2)} ${r.circuit_short_name.padEnd(18)} ${r.entity_name.padEnd(20)} ours=${String(r.our_points).padStart(4)} official=${String(r.official_points).padStart(4)} Δ=${r.delta}`
  );
}
await client.end();
