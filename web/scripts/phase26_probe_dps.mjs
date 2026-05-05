import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() { const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; } }
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  const r = await pool.query(`SELECT driver_number, driver_name, qualifying_axis, race_pace_axis, tyre_management_axis, restart_axis, traffic_handling_axis, overtake_difficulty_axis, error_rate_axis, avg_deg_s FROM analytics.driver_performance_score WHERE season_year=2025 AND driver_number IN (1,4,16,55,63,81,44) ORDER BY driver_number`);
  console.log("driver_performance_score (key drivers, 2025):");
  for (const row of r.rows) console.log(" ", JSON.stringify(row));
} finally { await pool.end(); }
