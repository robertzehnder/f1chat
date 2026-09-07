#!/usr/bin/env node
/**
 * corpus_weekly.mjs — steady-state weekly corpus run (corpus plan).
 *
 * fetch (all approved sources) → inbox → normalize → llm_cleanup → link →
 * split-stamp → retention purge → accounting report. Continue-on-error:
 * one broken source never blocks the rest; the summary says what failed.
 *
 * Run Sunday night / Monday alongside the fantasy weekly cadence:
 *   cd web && set -a && source .env.local && set +a && node scripts/corpus/corpus_weekly.mjs
 * (Distillation and claim extraction are NOT weekly — see the plan.)
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const season = String(new Date().getFullYear());

const steps = [
  ["fetch_therace.mjs", "--season", season],
  ["fetch_f1com.mjs", "--season", season],
  ["fetch_substack.mjs"],
  ["fetch_youtube.mjs", "--season", season],
  ["process_inbox.mjs"],
  ["normalize_docs.mjs"],
  ["llm_cleanup.mjs"],
  ["link_docs.mjs", "--season", season],
  ["assign_split.mjs", "--season", season],
  ["corpus_retention.mjs"],
  ["report_accounting.mjs", "--season", season]
];

const failures = [];
for (const [script, ...args] of steps) {
  console.log(`\n════ ${script} ${args.join(" ")} ════`);
  try {
    execFileSync("node", [resolve(HERE, script), ...args], { stdio: "inherit", env: process.env, timeout: 45 * 60e3 });
  } catch {
    failures.push(script);
    console.error(`✗ ${script} failed — continuing`);
  }
}
console.log(failures.length ? `\nWEEKLY: ${failures.length} step(s) failed: ${failures.join(", ")}` : "\nWEEKLY: all steps OK");
process.exit(failures.length ? 1 : 0);
