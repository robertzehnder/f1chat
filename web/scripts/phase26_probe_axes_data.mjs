import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function loadEnv() { const text = await readFile(path.resolve(__dirname, "..", ".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { if (!line || line.startsWith("#")) continue; const eq = line.indexOf("="); if (eq < 0) continue; const k = line.slice(0, eq).trim(); const v = line.slice(eq+1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; } }
await loadEnv();
const pool = new pg.Pool({ host: process.env.NEON_DB_HOST, port: Number(process.env.NEON_DB_PORT ?? 5432), database: process.env.NEON_DB_NAME ?? "neondb", user: process.env.NEON_DB_USER, password: process.env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: true }, statement_timeout: 30000 });
try {
  // Check stint_degradation_curve actual deg distribution
  const deg = await pool.query(`SELECT MIN(degradation_per_lap_s)::numeric, MAX(degradation_per_lap_s)::numeric, percentile_cont(0.5) WITHIN GROUP (ORDER BY degradation_per_lap_s)::numeric AS median, percentile_cont(0.95) WITHIN GROUP (ORDER BY degradation_per_lap_s)::numeric AS p95 FROM analytics.stint_degradation_curve WHERE valid_lap_count > 5 AND degradation_per_lap_s IS NOT NULL`);
  console.log("stint_degradation_curve degradation_per_lap_s distribution (valid_lap_count > 5):", deg.rows[0]);
  // raw.starting_grid + session_result for 2025
  const sg = await pool.query(`SELECT COUNT(*)::int AS rows, COUNT(DISTINCT sg.driver_number)::int AS drivers FROM raw.starting_grid sg JOIN core.sessions s ON s.session_key=sg.session_key WHERE s.year=2025 AND s.session_name='Race' AND sg.grid_position IS NOT NULL`);
  console.log("\nraw.starting_grid 2025 Race rows:", sg.rows[0]);
  const sr = await pool.query(`SELECT COUNT(*)::int AS rows, COUNT(DISTINCT sr.driver_number)::int AS drivers FROM raw.session_result sr JOIN core.sessions s ON s.session_key=sr.session_key WHERE s.year=2025 AND s.session_name='Race' AND sr.position IS NOT NULL`);
  console.log("raw.session_result 2025 Race rows:", sr.rows[0]);
  // Sample
  const sample = await pool.query(`SELECT driver_number, AVG(grid_position::int)::numeric AS avg_grid FROM raw.starting_grid sg JOIN core.sessions s ON s.session_key=sg.session_key WHERE s.year=2025 AND s.session_name='Race' AND sg.grid_position IS NOT NULL GROUP BY driver_number ORDER BY driver_number LIMIT 5`);
  console.log("\nstarting_grid avg per driver (sample 5):");
  for (const r of sample.rows) console.log(" ", JSON.stringify(r));
} finally { await pool.end(); }
