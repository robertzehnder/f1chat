import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() { const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; } }
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  const sessions = await pool.query(`SELECT session_key FROM core.sessions WHERE year=2025 AND circuit_short_name='Monaco' ORDER BY session_key`);
  console.log("Monaco 2025 session_keys:", sessions.rows.map(r=>r.session_key).join(','));
  const data = await pool.query(`SELECT session_key, COUNT(*)::int AS rows, COUNT(DISTINCT driver_number)::int AS drivers FROM analytics.corner_analysis_data WHERE session_key IN (${sessions.rows.map(r=>r.session_key).join(',')}) GROUP BY session_key`);
  console.log("\ncorner_analysis_data rows for Monaco 2025 sessions:");
  for (const r of data.rows) console.log(" ", JSON.stringify(r));
  const sample = await pool.query(`SELECT corner_label, COUNT(*) FROM analytics.corner_analysis_data WHERE session_key=9979 GROUP BY corner_label`);
  console.log("\nSession 9979 (Monaco Race) corners present:");
  for (const r of sample.rows) console.log(" ", JSON.stringify(r));
} finally { await pool.end(); }
