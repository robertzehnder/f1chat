#!/usr/bin/env node
/**
 * scripts/ingest.mjs — OpenF1 race-data ingest CLI.
 *
 * Phase 13 sub-decision (b): the canonical ingest path going forward.
 * Replaces the legacy openf1-full-history-extract.py for the targeted
 * Phase 13 endpoints (meetings + session_result). Pulls from
 * https://api.openf1.org/v1, transforms to warehouse shape, writes
 * CSVs to data/ingest/<endpoint>_<scope>.csv, and runs `psql \\copy`
 * to land them in raw.* — preserving the existing column contracts.
 *
 * Endpoints supported in v1:
 *   - meetings        (per year)
 *   - session_result  (per session_key; transforms dnf/dns/dsq -> status, classified)
 *
 * Reads DB connection from .env (DB_HOST/PORT/NAME/USER/PASSWORD) or
 * from process env directly. Designed to be safe to re-run: writes
 * are idempotent (DELETE + COPY for the affected scope, OR ON
 * CONFLICT logic where a uniqueness constraint exists).
 *
 * Usage:
 *   node scripts/ingest.mjs meetings --years 2023,2024,2025,2026
 *   node scripts/ingest.mjs session_result --years 2025
 *   node scripts/ingest.mjs session_result --session-keys 9636,9637
 *
 * Env overrides:
 *   OPENF1_API_BASE       (default https://api.openf1.org/v1)
 *   OPENF1_INGEST_DATA_DIR (default ./data/ingest)
 *   OPENF1_INGEST_RPS     (default 3 — requests per second cap)
 *   OPENF1_INGEST_DRY_RUN (default 0 — set 1 to skip the psql \copy)
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (or DATABASE_URL)
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ----------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_BASE = process.env.OPENF1_API_BASE ?? "https://api.openf1.org/v1";
const DATA_DIR = path.resolve(process.env.OPENF1_INGEST_DATA_DIR ?? path.join(REPO_ROOT, "data", "ingest"));
const REQS_PER_SECOND = Number(process.env.OPENF1_INGEST_RPS ?? 3);
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.OPENF1_INGEST_DRY_RUN ?? ""));

// Endpoint specs: column lists must EXACTLY match the destination
// raw.* table's `\copy` target list. Transforms are applied per-row
// via the `transform` callback before CSV emission.
const ENDPOINTS = {
  meetings: {
    apiPath: "meetings",
    table: "raw.meetings",
    columns: [
      "meeting_key",
      "year",
      "meeting_name",
      "meeting_official_name",
      "location",
      "country_code",
      "country_name",
      "circuit_key",
      "circuit_short_name",
      "date_start",
      "gmt_offset",
    ],
    // Idempotency: DELETE rows for the affected year before COPY.
    deleteSql: ({ year }) => `DELETE FROM raw.meetings WHERE year = ${Number(year)};`,
    transform: (row) => ({
      meeting_key: row.meeting_key,
      year: row.year,
      meeting_name: row.meeting_name,
      meeting_official_name: row.meeting_official_name,
      location: row.location,
      country_code: row.country_code,
      country_name: row.country_name,
      circuit_key: row.circuit_key,
      circuit_short_name: row.circuit_short_name,
      date_start: row.date_start,
      gmt_offset: row.gmt_offset,
    }),
  },
  session_result: {
    apiPath: "session_result",
    table: "raw.session_result",
    columns: [
      "session_key",
      "meeting_key",
      "driver_number",
      "position",
      "points",
      "status",
      "classified",
      "number_of_laps",
      "duration",
      "gap_to_leader",
      "source_file",
    ],
    // Idempotency: DELETE rows for the affected session_key before COPY.
    deleteSql: ({ sessionKey }) => `DELETE FROM raw.session_result WHERE session_key = ${Number(sessionKey)};`,
    transform: (row, { sessionKey }) => {
      const dsq = !!row.dsq;
      const dns = !!row.dns;
      const dnf = !!row.dnf;
      const status = dsq ? "DSQ" : dns ? "DNS" : dnf ? "DNF" : "Finished";
      const classified = !(dnf || dns || dsq);
      return {
        session_key: row.session_key ?? sessionKey,
        meeting_key: row.meeting_key,
        driver_number: row.driver_number,
        position: row.position,
        points: row.points,
        status,
        classified,
        number_of_laps: row.number_of_laps,
        duration: row.duration,
        gap_to_leader: row.gap_to_leader,
        source_file: `openf1_api_session_result_${row.session_key ?? sessionKey}`,
      };
    },
  },
};

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

class RateLimiter {
  constructor(rps) {
    this.intervalMs = 1000 / Math.max(1, rps);
    this.next = Date.now();
  }
  async wait() {
    const now = Date.now();
    const sleep = Math.max(0, this.next - now);
    if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
    this.next = Math.max(now, this.next) + this.intervalMs;
  }
}

async function loadEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return;
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function fetchEndpoint(apiPath, params, limiter) {
  const url = new URL(`${API_BASE}/${apiPath}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  await limiter.wait();
  const res = await fetch(url.toString(), { headers: { "User-Agent": "openf1-ingest/1.0" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url.toString()} -> ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(columns, rows) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(row[c])).join(",")).join("\n");
  return rows.length ? `${header}\n${body}\n` : `${header}\n`;
}

function dbConnArgs() {
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = process.env.DB_PORT ?? "5432";
  const db = process.env.DB_NAME ?? "openf1";
  const user = process.env.DB_USER ?? "openf1";
  return ["-h", host, "-p", port, "-U", user, "-d", db, "-X", "-v", "ON_ERROR_STOP=1"];
}

async function psqlExec(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [...dbConnArgs(), "-c", sql], {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`psql exit=${code}: ${stderr.trim()}`))));
  });
}

async function psqlCopy(table, columns, csvPath) {
  const colList = columns.join(", ");
  const sql = `\\copy ${table} (${colList}) FROM '${csvPath}' WITH (FORMAT csv, HEADER true)`;
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [...dbConnArgs(), "-c", sql], {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(`\\copy ${table} exit=${code}: ${stderr.trim()}`))
    );
  });
}

// ----------------------------------------------------------------------
// Per-endpoint runners
// ----------------------------------------------------------------------

async function runMeetings(years, limiter) {
  const spec = ENDPOINTS.meetings;
  await mkdir(DATA_DIR, { recursive: true });

  for (const year of years) {
    process.stdout.write(`[meetings] year=${year} `);
    const apiRows = await fetchEndpoint(spec.apiPath, { year }, limiter);
    const transformed = apiRows.map((row) => spec.transform(row, { year }));
    const csv = rowsToCsv(spec.columns, transformed);
    const csvPath = path.join(DATA_DIR, `meetings_${year}.csv`);
    await writeFile(csvPath, csv, "utf8");
    process.stdout.write(`fetched=${transformed.length} `);

    if (DRY_RUN) {
      console.log(`csv=${csvPath} (dry-run; psql skipped)`);
      continue;
    }

    await psqlExec(spec.deleteSql({ year }));
    const copyOut = await psqlCopy(spec.table, spec.columns, csvPath);
    console.log(`csv=${csvPath} ${copyOut}`);
  }
}

async function runSessionResult(sessionKeys, limiter) {
  const spec = ENDPOINTS.session_result;
  await mkdir(DATA_DIR, { recursive: true });
  let total = 0;
  let errors = 0;

  for (const sessionKey of sessionKeys) {
    process.stdout.write(`[session_result] session_key=${sessionKey} `);
    let apiRows;
    try {
      apiRows = await fetchEndpoint(spec.apiPath, { session_key: sessionKey }, limiter);
    } catch (err) {
      console.log(`ERROR ${err.message}`);
      errors += 1;
      continue;
    }
    if (!Array.isArray(apiRows) || apiRows.length === 0) {
      console.log("empty");
      continue;
    }
    const transformed = apiRows.map((row) => spec.transform(row, { sessionKey }));
    const csv = rowsToCsv(spec.columns, transformed);
    const csvPath = path.join(DATA_DIR, `session_result_${sessionKey}.csv`);
    await writeFile(csvPath, csv, "utf8");
    total += transformed.length;
    process.stdout.write(`fetched=${transformed.length} `);

    if (DRY_RUN) {
      console.log(`csv=${csvPath} (dry-run; psql skipped)`);
      continue;
    }

    await psqlExec(spec.deleteSql({ sessionKey }));
    const copyOut = await psqlCopy(spec.table, spec.columns, csvPath);
    console.log(`csv=${csvPath} ${copyOut}`);
  }
  console.log(`[session_result] done total_rows=${total} errors=${errors}`);
  if (errors > 0) process.exitCode = 1;
}

// Resolve session_keys from years if --session-keys not provided.
async function sessionKeysForYears(years) {
  const where = `WHERE year = ANY(ARRAY[${years.map((y) => Number(y)).join(",")}]::int[])`;
  const sql = `SELECT session_key FROM raw.sessions ${where} ORDER BY date_start NULLS LAST`;
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [...dbConnArgs(), "-A", "-t", "-c", sql], {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`psql session_keys exit=${code}: ${err.trim()}`));
      const keys = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && /^[0-9]+$/.test(l))
        .map(Number);
      resolve(keys);
    });
  });
}

// ----------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--years" || a === "--session-keys") {
      args[a.slice(2)] = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  console.error(`Usage:
  scripts/ingest.mjs meetings --years 2023,2024,2025,2026
  scripts/ingest.mjs session_result --years 2025
  scripts/ingest.mjs session_result --session-keys 9636,9637

Env:
  OPENF1_INGEST_DRY_RUN=1   skip the psql \\copy step (CSV-only)
  OPENF1_INGEST_RPS=3       request rate limit
  DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (or .env)
`);
}

async function main() {
  await loadEnv();
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.help || args._.length === 0) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  const cmd = args._[0];
  const limiter = new RateLimiter(REQS_PER_SECOND);

  if (cmd === "meetings") {
    if (!args.years || args.years.length === 0) {
      console.error("meetings: --years required");
      process.exit(1);
    }
    await runMeetings(args.years.map(Number), limiter);
    return;
  }

  if (cmd === "session_result") {
    let sessionKeys = (args["session-keys"] ?? []).map(Number);
    if (sessionKeys.length === 0) {
      if (!args.years || args.years.length === 0) {
        console.error("session_result: --years or --session-keys required");
        process.exit(1);
      }
      console.log(`[session_result] resolving session_keys for years=${args.years.join(",")}...`);
      sessionKeys = await sessionKeysForYears(args.years);
      console.log(`[session_result] found ${sessionKeys.length} session_keys`);
    }
    await runSessionResult(sessionKeys, limiter);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? String(err));
  process.exit(1);
});
