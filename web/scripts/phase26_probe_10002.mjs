import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() { const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; } }
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  const ses = await pool.query(`SELECT session_key, session_name, circuit_short_name, year FROM core.sessions WHERE session_key=10002`);
  console.log("session 10002:", ses.rows[0]);
  const cd = await pool.query(`SELECT COUNT(*)::int AS samples FROM raw.car_data WHERE session_key=10002 AND driver_number=1`);
  console.log("raw.car_data session 10002 driver 1:", cd.rows[0]);
  const le = await pool.query(`SELECT COUNT(*)::int AS laps, MIN(lap_start_ts) AS first, MAX(lap_end_ts) AS last FROM core.laps_enriched WHERE session_key=10002 AND driver_number=1`);
  console.log("core.laps_enriched session 10002 driver 1:", le.rows[0]);
  const cdlp = await pool.query(`SELECT COUNT(*)::int FROM core.car_data_lap_position WHERE session_key=10002 AND driver_number=1`);
  console.log("core.car_data_lap_position session 10002 driver 1:", cdlp.rows[0]);
} finally { await pool.end(); }
