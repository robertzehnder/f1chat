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
  const tests = [
    "PENALTY",
    "STEWARD",
    "WARNING",
    "SECOND",
    "TIME PENALTY",
    "DRIVE",
    "INVESTIGATION",
    "REPRIMAND",
    "GRID",
    "SAFETY CAR",
    "VIRTUAL SAFETY"
  ];
  for (const t of tests) {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS c FROM raw.race_control WHERE UPPER(message) LIKE $1`,
      [`%${t}%`]
    );
    console.log(`  message LIKE '${t}'  =>  ${res.rows[0].c} rows`);
  }
  console.log("\nsample STEWARD/INVESTIGATION/PENALTY messages (any year):");
  const sample = await pool.query(
    `SELECT message FROM raw.race_control
      WHERE UPPER(message) LIKE ANY($1::text[])
      LIMIT 20`,
    [['%PENALTY%', '%STEWARD%', '%INVESTIGATION%', '%REPRIMAND%']]
  );
  for (const r of sample.rows) console.log(" -", r.message?.slice(0, 220));
  console.log("\ndistinct categories on Neon:");
  const cats = await pool.query(`SELECT category, COUNT(*)::int AS c FROM raw.race_control GROUP BY category ORDER BY c DESC`);
  for (const r of cats.rows) console.log(" ", r.category, "=", r.c);
} finally {
  await pool.end();
}
