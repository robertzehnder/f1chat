#!/usr/bin/env node
/**
 * check_data_invariants.mjs — Phase 3 data-correctness gate
 * (roadmap_to_A_grade_2026-07-02.md — "Data-invariant verifies per migration").
 *
 * Asserts warehouse GRAIN invariants against the live Neon warehouse. These are
 * DATA checks (need a populated DB), so they live here rather than in the sqitch
 * structural verifies (which run on an empty sandbox). Exit non-zero on any
 * violation — no best-of retries.
 *
 * Invariants:
 *   INV1  laps_enriched has unique grain (session_key, driver_number, lap_number)
 *         — the compound_alias_lookup 2× fanout regression guard.
 *   INV2  no driver has > 87 laps in a single session (max plausible F1 race laps).
 *   INV3  grid_vs_finish has no duplicate finish_position within a session
 *         (non-NULL) — one classification per position.
 *   INV4  core.compound_alias_lookup is unique on raw_compound.
 *   INV5  core.valid_lap_policy has exactly one default row.
 *   INV6  expected populations — a known 2025 race (Monaco 9979) has laps.
 *
 * INV1/INV2/INV3 sample the most recent N 2025 race sessions (full scans of
 * laps_enriched are expensive); pass --full to scan every session.
 *
 * Creds: NEON_DB_* from web/.env.local.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..", "..");
const full = process.argv.includes("--full");
const SAMPLE_N = 12;

function loadEnv() {
  const raw = readFileSync(join(WEB, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const client = new pg.Client({
  host: env.NEON_DB_HOST,
  port: Number(env.NEON_DB_PORT || 5432),
  database: env.NEON_DB_NAME,
  user: env.NEON_DB_USER,
  password: env.NEON_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const problems = [];
const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { problems.push(m); console.error(`  ❌ ${m}`); };

async function q(sql, params) { return (await client.query(sql, params)).rows; }

async function sampledSessions() {
  const rows = await q(
    `SELECT s.session_key FROM core.sessions s
     WHERE s.year = 2025 AND (lower(coalesce(s.session_name,''))='race' OR lower(coalesce(s.session_type,''))='race')
     ORDER BY s.date_start DESC NULLS LAST ${full ? "" : `LIMIT ${SAMPLE_N}`}`,
  );
  return rows.map((r) => r.session_key);
}

async function main() {
  await client.connect();
  console.log(`Phase 3 — data invariants (${full ? "FULL" : `sampled ${SAMPLE_N}`} race sessions)`);
  const sessions = await sampledSessions();
  if (!sessions.length) fail("no 2025 race sessions found (unexpected)");

  // INV1 — unique lap grain
  const dupGrain = await q(
    `SELECT session_key, driver_number, lap_number, COUNT(*) c
     FROM core.laps_enriched WHERE session_key = ANY($1)
     GROUP BY 1,2,3 HAVING COUNT(*) > 1 LIMIT 5`, [sessions]);
  if (dupGrain.length)
    fail(`INV1 laps_enriched non-unique grain — e.g. sk=${dupGrain[0].session_key} dn=${dupGrain[0].driver_number} lap=${dupGrain[0].lap_number} ×${dupGrain[0].c}`);
  else pass(`INV1 laps_enriched unique grain across ${sessions.length} sessions`);

  // INV2 — no driver > 87 laps in a session
  const tooMany = await q(
    `SELECT session_key, driver_number, COUNT(DISTINCT lap_number) laps
     FROM core.laps_enriched WHERE session_key = ANY($1)
     GROUP BY 1,2 HAVING COUNT(DISTINCT lap_number) > 87 ORDER BY laps DESC LIMIT 5`, [sessions]);
  if (tooMany.length)
    fail(`INV2 driver with >87 laps — sk=${tooMany[0].session_key} dn=${tooMany[0].driver_number} laps=${tooMany[0].laps}`);
  else pass("INV2 no driver exceeds 87 laps in a session");

  // INV3 — no duplicate finish_position within a session (non-NULL)
  const dupFinish = await q(
    `SELECT session_key, finish_position, COUNT(*) c
     FROM core.grid_vs_finish WHERE session_key = ANY($1) AND finish_position IS NOT NULL
     GROUP BY 1,2 HAVING COUNT(*) > 1 LIMIT 5`, [sessions]);
  if (dupFinish.length)
    fail(`INV3 duplicate finish_position — sk=${dupFinish[0].session_key} pos=${dupFinish[0].finish_position} ×${dupFinish[0].c}`);
  else pass("INV3 no duplicate finish positions within a session");

  // INV4 — compound_alias_lookup unique on raw_compound
  const [ca] = await q(
    `SELECT COUNT(*)::int total, COUNT(DISTINCT raw_compound)::int distinct_rc FROM core.compound_alias_lookup`);
  if (ca.total !== ca.distinct_rc) fail(`INV4 compound_alias_lookup dup: ${ca.total} rows / ${ca.distinct_rc} distinct raw_compound`);
  else pass(`INV4 compound_alias_lookup unique on raw_compound (${ca.total})`);

  // INV5 — single default policy
  const [pol] = await q(`SELECT COUNT(*) FILTER (WHERE is_default)::int d FROM core.valid_lap_policy`);
  if (pol.d !== 1) fail(`INV5 valid_lap_policy default rows = ${pol.d} (expected 1)`);
  else pass("INV5 valid_lap_policy has exactly one default");

  // INV6 — expected population
  const [pop] = await q(`SELECT COUNT(*)::int c FROM core.laps_enriched WHERE session_key = 9979`);
  if (pop.c < 100) fail(`INV6 Monaco 9979 laps_enriched underpopulated: ${pop.c} rows`);
  else pass(`INV6 expected population OK (Monaco 9979 = ${pop.c} laps)`);

  await client.end();
  console.log("");
  if (problems.length === 0) { console.log("PASS — all data invariants hold."); process.exit(0); }
  console.error(`FAIL — ${problems.length} invariant violation(s).`);
  process.exit(1);
}

main().catch((e) => { console.error("data-invariants harness error:", e.message); process.exit(1); });
