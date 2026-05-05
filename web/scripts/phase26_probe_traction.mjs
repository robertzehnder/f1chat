import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() { const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; } }
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  const sk = await pool.query(`SELECT session_key, session_name FROM core.sessions WHERE year=2025 AND circuit_short_name='Suzuka' AND session_name='Qualifying'`);
  console.log("Suzuka 2025 Qualifying session keys:", sk.rows);
  const data = await pool.query(`SELECT corner_label, exit_speed_kph FROM analytics.traction_analysis WHERE session_key=10002 AND driver_number=1 ORDER BY corner_label`);
  console.log("\nq1980 traction_analysis rows for session 10002 driver 1:");
  for (const r of data.rows) console.log(" ", JSON.stringify(r));
} finally { await pool.end(); }
