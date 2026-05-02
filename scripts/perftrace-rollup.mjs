#!/usr/bin/env node
/**
 * scripts/perftrace-rollup.mjs — Phase 16-1
 *
 * Roll up cache-hit-rate, p50/p95 latency, and per-stage breakdown
 * from the running perfTrace + chat_query_trace JSONL streams.
 * Writes a daily artifact at
 * diagnostic/artifacts/perf/cache-hit-rate-<date>.json.
 *
 * Usage:
 *   node scripts/perftrace-rollup.mjs                    # today's window
 *   node scripts/perftrace-rollup.mjs --date 2026-05-02
 *   node scripts/perftrace-rollup.mjs --window 24        # last N hours
 *
 * Reads:
 *   web/logs/chat_query_trace.jsonl   (per-request trace incl. cache_hit)
 *   web/logs/chat_query_trace_perf.jsonl (per-request span timings, optional)
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_DIR = path.join(REPO_ROOT, "diagnostic", "artifacts", "perf");
const TRACE_FILE = path.join(REPO_ROOT, "web", "logs", "chat_query_trace.jsonl");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--date") args.date = argv[++i];
    else if (a === "--window") args.windowHours = Number(argv[++i]);
  }
  return args;
}

function pct(arr, p) {
  if (arr.length === 0) return null;
  const i = Math.min(arr.length - 1, Math.floor(p * arr.length));
  return arr[i];
}

async function readTrace(filterFn) {
  let data;
  try {
    data = await readFile(TRACE_FILE, "utf8");
  } catch {
    return [];
  }
  const lines = data.split("\n").filter((l) => l.length > 0);
  const out = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (filterFn(row)) out.push(row);
    } catch {
      // skip malformed
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const windowMs =
    args.windowHours != null ? args.windowHours * 3600 * 1000 : 24 * 3600 * 1000;
  const cutoff = now - windowMs;

  const dateStr = args.date ?? new Date(now).toISOString().slice(0, 10);

  const rows = await readTrace((r) => {
    const ts = Date.parse(r.ts ?? "");
    return Number.isFinite(ts) && ts >= cutoff;
  });

  if (rows.length === 0) {
    console.error(`No trace rows in last ${windowMs / 3600000}h`);
    process.exit(0);
  }

  // Cache-hit breakdown
  const cacheHitCount = rows.filter((r) => r.cache_hit === true).length;
  const totalRequests = rows.length;
  const cacheHitRate = cacheHitCount / totalRequests;

  // generationSource breakdown
  const sourceCounts = {};
  for (const r of rows) {
    const s = r.generationSource ?? "unknown";
    sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
  }

  // total elapsedMs from the totalRequestMs field
  const elapsed = rows
    .map((r) => Number(r.totalRequestMs))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const summary = {
    generated_at: new Date(now).toISOString(),
    window_hours: windowMs / 3600000,
    request_count: totalRequests,
    cache_hit_rate: Number(cacheHitRate.toFixed(3)),
    cache_hit_count: cacheHitCount,
    generation_source_breakdown: sourceCounts,
    latency_ms:
      elapsed.length > 0
        ? {
            min: elapsed[0],
            p50: pct(elapsed, 0.5),
            p95: pct(elapsed, 0.95),
            p99: pct(elapsed, 0.99),
            max: elapsed[elapsed.length - 1],
            mean: Math.round(elapsed.reduce((a, b) => a + b, 0) / elapsed.length)
          }
        : null
  };

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const outPath = path.join(ARTIFACT_DIR, `cache-hit-rate-${dateStr}.json`);
  await writeFile(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${outPath}`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? String(err));
  process.exit(1);
});
