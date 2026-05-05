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
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 15000 });
try {
  for (const t of ["starting_grid", "session_result"]) {
    const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='raw' AND table_name=$1 ORDER BY ordinal_position`, [t]);
    console.log(`raw.${t}:`, cols.rows.map(r=>r.column_name).join(", "));
  }
} finally { await pool.end(); }
