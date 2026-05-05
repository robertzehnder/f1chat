import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() { const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; } }
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  const r = await pool.query(`SELECT COUNT(*)::int AS rows, COUNT(DISTINCT session_key)::int AS sessions FROM analytics.traction_analysis_data`);
  console.log("traction_analysis total:", r.rows[0]);
  const sess = await pool.query(`SELECT session_key, COUNT(*)::int AS rows FROM analytics.traction_analysis_data GROUP BY session_key ORDER BY session_key`);
  console.log("\nper-session row counts:");
  for (const row of sess.rows) console.log(" ", JSON.stringify(row));
} finally { await pool.end(); }
