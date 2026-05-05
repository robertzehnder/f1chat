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
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 15000, connectionTimeoutMillis: 10000 });
try {
  // f1.track_segments
  const ts = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='f1' AND table_name='track_segments'`);
  console.log("f1.track_segments exists:", ts.rowCount > 0);
  if (ts.rowCount > 0) {
    const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='f1' AND table_name='track_segments' ORDER BY ordinal_position`);
    console.log("  columns:", cols.rows.map(r=>r.column_name).join(", "));
    const counts = await pool.query(`SELECT segment_kind, COUNT(*) FROM f1.track_segments GROUP BY segment_kind`);
    console.log("  counts by kind:", counts.rows);
    const sample = await pool.query(`SELECT * FROM f1.track_segments WHERE segment_kind='corner' LIMIT 3`);
    for (const r of sample.rows) console.log("  sample:", JSON.stringify(r));
  }
  // raw.car_data presence + simple probe
  const carData = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='raw' AND table_name='car_data'`);
  console.log("raw.car_data exists:", carData.rowCount > 0);
  // Sample lap_phase_summary which has sector phasing
  const lp = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='core' AND table_name='lap_phase_summary' ORDER BY ordinal_position`);
  console.log("core.lap_phase_summary columns:", lp.rows.map(r=>r.column_name).join(", "));
} finally { await pool.end(); }
