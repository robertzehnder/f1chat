// Phase 25.2 slice 033 deploy debugging: enumerate all `core.*lap*`
// tables / views / matviews on Neon so I can pick the right source
// for analytics.stint_degradation_curve_data. The slice 033 deploy
// failed with `relation "core.laps_enriched_mat" does not exist` —
// either the storage table was never materialized on this Neon
// instance, or the schema names differ from the local migration files.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  const text = await readFile(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  await loadEnv();
  const pool = new pg.Pool({
    host: process.env.NEON_DB_HOST,
    port: Number(process.env.NEON_DB_PORT ?? 5432),
    database: process.env.NEON_DB_NAME ?? "neondb",
    user: process.env.NEON_DB_USER,
    password: process.env.NEON_DB_PASSWORD,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 15000,
    connectionTimeoutMillis: 10000
  });

  try {
    // 1) All core.* relations whose name contains "lap"
    const a = await pool.query(`
      SELECT n.nspname AS schema, c.relname AS name,
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' ELSE c.relkind::text END AS kind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('core', 'core_build', 'analytics')
         AND (c.relname LIKE '%lap%' OR c.relname LIKE '%stint%')
       ORDER BY n.nspname, c.relname
    `);
    console.log("=".repeat(60));
    console.log("[1] core/core_build/analytics relations matching lap/stint:");
    console.log("=".repeat(60));
    for (const r of a.rows) {
      console.log(`  ${r.schema}.${r.name}  (${r.kind})`);
    }

    // 2) Confirm column shape of whichever core.laps_* IS present
    const targets = ["laps_enriched", "laps_enriched_mat", "stint_summary", "stint_summary_mat"];
    for (const t of targets) {
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='core' AND table_name=$1
          ORDER BY ordinal_position`,
        [t]
      );
      if (cols.rowCount === 0) {
        console.log(`\n[2] core.${t}: (does not exist)`);
      } else {
        const interesting = cols.rows
          .map((r) => r.column_name)
          .filter((c) =>
            ["session_key", "driver_number", "driver_name", "team_name", "lap_number",
             "lap_duration", "stint_number", "compound_name", "is_valid",
             "fuel_adj_lap_time"].includes(c)
          );
        console.log(`\n[2] core.${t}: ${cols.rowCount} columns; interesting subset = ${JSON.stringify(interesting)}`);
      }
    }

    // 3) Does analytics.sector_dominance / sector_dominance_data exist?
    const ana = await pool.query(`
      SELECT n.nspname AS schema, c.relname AS name,
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' ELSE c.relkind::text END AS kind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='analytics'
       ORDER BY c.relname
    `);
    console.log("\n[3] analytics.* relations:");
    for (const r of ana.rows) {
      console.log(`  ${r.schema}.${r.name}  (${r.kind})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
