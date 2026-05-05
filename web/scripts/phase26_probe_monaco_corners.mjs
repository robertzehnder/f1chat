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
  const r = await pool.query(`SELECT circuit_short_name, segment_index, segment_label FROM f1.track_segments WHERE segment_kind='corner' ORDER BY circuit_short_name, segment_index`);
  console.log("All seeded corners by circuit:");
  let cur = null;
  for (const row of r.rows) {
    if (row.circuit_short_name !== cur) { console.log(`\n  ${row.circuit_short_name}:`); cur = row.circuit_short_name; }
    console.log(`    Turn ${row.segment_index} ${row.segment_label}`);
  }
} finally { await pool.end(); }
