import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() { const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; } }
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  const r = await pool.query(`SELECT DISTINCT circuit_short_name FROM core.sessions WHERE year=2025 ORDER BY circuit_short_name`);
  console.log("core.sessions 2025 circuit_short_name values:");
  for (const row of r.rows) console.log(" ", JSON.stringify(row.circuit_short_name));
  const ts = await pool.query(`SELECT DISTINCT circuit_short_name FROM f1.track_segments WHERE segment_kind='corner' ORDER BY circuit_short_name`);
  console.log("\nf1.track_segments circuit_short_name values:");
  for (const row of ts.rows) console.log(" ", JSON.stringify(row.circuit_short_name));
} finally { await pool.end(); }
