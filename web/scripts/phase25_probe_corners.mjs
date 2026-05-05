import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() {
  const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("="); if (eq < 0) continue;
    const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 15000 });
try {
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='f1' AND table_name='track_segments' ORDER BY ordinal_position`);
  console.log("f1.track_segments columns:", cols.rows.map(r=>r.column_name).join(", "));
  const counts = await pool.query(`SELECT segment_kind, COUNT(*)::int FROM f1.track_segments GROUP BY segment_kind`);
  console.log("counts:", counts.rows);
  const sample = await pool.query(`SELECT * FROM f1.track_segments WHERE segment_kind='corner' LIMIT 4`);
  for (const r of sample.rows) console.log(" sample:", JSON.stringify(r));
} finally { await pool.end(); }
