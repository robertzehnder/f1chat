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
  const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='raw' AND table_name='race_control' ORDER BY ordinal_position");
  console.log("raw.race_control columns:");
  for (const r of cols.rows) console.log("  -", r.column_name);
  const sample = await pool.query("SELECT category, flag, message, driver_number, lap_number FROM raw.race_control WHERE session_key=9928 ORDER BY date LIMIT 30");
  console.log("\nsample rows (Hungary 2025 Race):");
  for (const r of sample.rows) console.log(" ", JSON.stringify(r));
  const cats = await pool.query("SELECT category, COUNT(*) FROM raw.race_control WHERE session_key=9928 GROUP BY category ORDER BY 2 DESC");
  console.log("\nHungary 2025 Race categories:");
  for (const r of cats.rows) console.log(" ", r.category, "=", r.count);
  const penalty = await pool.query("SELECT message FROM raw.race_control WHERE message ILIKE '%PENALTY POINT%' LIMIT 8");
  console.log("\nsample 'penalty point' messages:");
  for (const r of penalty.rows) console.log(" -", r.message?.slice(0, 200));
} finally {
  await pool.end();
}
