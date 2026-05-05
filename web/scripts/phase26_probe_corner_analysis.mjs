import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() {
  const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; }
}
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  const totalRows = await pool.query("SELECT COUNT(*)::int FROM analytics.corner_analysis_data");
  console.log("total rows:", totalRows.rows[0].count);
  const distinct = await pool.query(`SELECT COUNT(DISTINCT corner_id)::int AS corners, COUNT(DISTINCT session_key)::int AS sessions, COUNT(DISTINCT driver_number)::int AS drivers FROM analytics.corner_analysis_data`);
  console.log("distinct:", distinct.rows[0]);
  // sample for Suzuka 2025 race driver 1 corner 1
  const sample = await pool.query(`SELECT lap_number, corner_label, entry_speed_kph, apex_min_speed_kph, exit_speed_kph, sample_count FROM analytics.corner_analysis WHERE session_key=10006 AND driver_number=1 AND corner_label ILIKE '%Turn 8%' ORDER BY lap_number LIMIT 5`);
  console.log("\nSuzuka 2025 Race driver 1 Turn 8 (sample):");
  for (const r of sample.rows) console.log(" ", JSON.stringify(r));
} finally { await pool.end(); }
