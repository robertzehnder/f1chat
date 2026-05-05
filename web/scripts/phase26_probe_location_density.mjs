import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() {
  const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
await loadEnv();
const pool = new pg.Pool({
  host: process.env.NEON_DB_HOST,
  port: Number(process.env.NEON_DB_PORT ?? 5432),
  database: process.env.NEON_DB_NAME ?? "neondb",
  user: process.env.NEON_DB_USER,
  password: process.env.NEON_DB_PASSWORD,
  ssl: { rejectUnauthorized: true },
  statement_timeout: 30000,
  connectionTimeoutMillis: 10000
});
try {
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='raw' AND table_name='location' ORDER BY ordinal_position`);
  console.log("raw.location columns:", cols.rows.map(r=>r.column_name).join(", "));
  // density per session_key + driver_number for Suzuka 2025 race (10006)
  const density = await pool.query(`SELECT driver_number, COUNT(*)::int AS samples FROM raw.location WHERE session_key=10006 GROUP BY driver_number ORDER BY driver_number LIMIT 25`);
  console.log("\nSuzuka 2025 Race (session_key=10006) raw.location density per driver:");
  for (const r of density.rows) console.log(`  driver=${r.driver_number}: ${r.samples} samples`);
  // Per-lap density for one driver
  const perLap = await pool.query(`
    WITH driver_loc AS (
      SELECT date, x, y, z FROM raw.location WHERE session_key=10006 AND driver_number=1 ORDER BY date
    ),
    laps AS (
      SELECT lap_number, lap_start_ts, lap_end_ts FROM core.laps_enriched
      WHERE session_key=10006 AND driver_number=1 ORDER BY lap_number LIMIT 5
    )
    SELECT l.lap_number, COUNT(dl.date)::int AS samples
    FROM laps l
    LEFT JOIN driver_loc dl ON dl.date >= l.lap_start_ts AND dl.date < l.lap_end_ts
    GROUP BY l.lap_number ORDER BY l.lap_number
  `);
  console.log("\nSuzuka 2025 Race driver_number=1 — first 5 laps' raw.location sample counts:");
  for (const r of perLap.rows) console.log(`  lap ${r.lap_number}: ${r.samples} samples`);
  // Sample x/y/z range
  const range = await pool.query(`SELECT MIN(x)::int AS min_x, MAX(x)::int AS max_x, MIN(y)::int AS min_y, MAX(y)::int AS max_y, MIN(z)::int AS min_z, MAX(z)::int AS max_z FROM raw.location WHERE session_key=10006`);
  console.log("\nSuzuka 2025 Race xyz ranges:", range.rows[0]);
} finally { await pool.end(); }
