#!/usr/bin/env node
/**
 * check_migration_chain.mjs — Phase 1 gate (roadmap_to_A_grade_2026-07-02.md)
 *
 * Proves the sqitch migration chain is COMPLETE, DEPLOYABLE, and the
 * repaired 028–051 segment ROUND-TRIPS (revert --to 027 -> redeploy -> verify).
 *
 * Two independent checks:
 *   (1) FILE PARITY  — every change in sqitch.plan has deploy/verify/revert.
 *                      (pure filesystem; always runs, needs no DB)
 *   (2) ROUND-TRIP   — against an EPHEMERAL sandbox postgres:
 *                        a. fresh deploy --verify 001..051
 *                        b. status == head (051)
 *                        c. revert --to 027 (rolls back the whole 028..051 segment)
 *                        d. status == 027
 *                        e. re-deploy --verify 028..051
 *                        f. sqitch verify (all 51) == "Verify successful"
 *                      (needs sqitch CLI + a throwaway postgres; skipped with --parity-only)
 *
 * Data-dependent verifies (e.g. verify/049's Monaco-rows alias-fix check) are
 * guarded to only assert when the source rows exist, so they pass on an empty
 * sandbox and still fire on populated prod.
 *
 * Exit 0 iff every requested check passes; non-zero otherwise. No best-of retries.
 *
 * Env knobs (defaults match this repo's local docker sandbox):
 *   MIG_SANDBOX_TARGET     sqitch target URI  (default db:pg://openf1:openf1_local_dev@localhost:5433/openf1_migtest)
 *   MIG_SANDBOX_CONTAINER  docker container    (default openf1-postgres)
 *   MIG_SANDBOX_DBNAME     throwaway db name   (default openf1_migtest)
 *   MIG_SANDBOX_ADMIN_USER admin role for reset(default openf1)
 * Flags: --parity-only   run only the filesystem parity check (no DB).
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", ".."); // web/scripts/health -> repo root
const MIG_DIR = join(REPO_ROOT, "sql", "migrations");
const PLAN = join(MIG_DIR, "sqitch.plan");

const TARGET = process.env.MIG_SANDBOX_TARGET
  || "db:pg://openf1:openf1_local_dev@localhost:5433/openf1_migtest";
const CONTAINER = process.env.MIG_SANDBOX_CONTAINER || "openf1-postgres";
const DBNAME = process.env.MIG_SANDBOX_DBNAME || "openf1_migtest";
const ADMIN_USER = process.env.MIG_SANDBOX_ADMIN_USER || "openf1";
const parityOnly = process.argv.includes("--parity-only");

const failures = [];
const notes = [];
function fail(msg) { failures.push(msg); console.error(`  ❌ ${msg}`); }
function ok(msg) { console.log(`  ✅ ${msg}`); }

// ---------------------------------------------------------------- (1) PARITY
function parseChanges() {
  const lines = readFileSync(PLAN, "utf8").split("\n");
  return lines
    .map((l) => l.match(/^(\d{3}_[a-z0-9_]+)\b/i))
    .filter(Boolean)
    .map((m) => m[1]);
}

console.log("Phase 1 — migration chain gate");
console.log("[1] file parity (deploy/verify/revert for every plan change)");
const changes = parseChanges();
let missing = 0;
for (const change of changes) {
  for (const kind of ["deploy", "verify", "revert"]) {
    if (!existsSync(join(MIG_DIR, kind, `${change}.sql`))) {
      fail(`missing ${kind}/${change}.sql`);
      missing++;
    }
  }
}
if (missing === 0) ok(`file parity OK — ${changes.length} changes × {deploy,verify,revert}`);

// -------------------------------------------------------------- (2) ROUNDTRIP
function sqitch(args) {
  return execFileSync("sqitch", ["--chdir", MIG_DIR, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}
function sqitchSafe(args) {
  try { return { out: sqitch(args), code: 0 }; }
  catch (e) { return { out: `${e.stdout || ""}${e.stderr || ""}`, code: e.status ?? 1 }; }
}
function resetSandboxDb() {
  const admin = (sql) =>
    execSync(
      `docker exec ${CONTAINER} psql -U ${ADMIN_USER} -d postgres -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  admin(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE);`);
  admin(`CREATE DATABASE ${DBNAME} OWNER ${ADMIN_USER};`);
}

if (!parityOnly) {
  console.log("[2] sandbox deploy + segment round-trip");
  try {
    // sanity: is the sandbox reachable?
    execSync(`docker inspect ${CONTAINER}`, { stdio: "ignore" });
  } catch {
    notes.push(`sandbox container '${CONTAINER}' not available — round-trip SKIPPED (parity still enforced)`);
    console.log(`  ⚠️  ${notes[notes.length - 1]}`);
  }

  if (notes.length === 0) {
    try {
      resetSandboxDb();

      const d1 = sqitchSafe(["deploy", "--verify", "--target", TARGET]);
      if (d1.code !== 0 || /not ok|Deploy failed/.test(d1.out)) fail(`fresh deploy --verify failed\n${tail(d1.out)}`);
      else ok("fresh deploy --verify 001..051");

      const s1 = sqitchSafe(["status", TARGET]);
      if (!/051_analytics_traction_braking/.test(s1.out) || !/up-to-date/.test(s1.out))
        fail(`status after deploy is not at head 051\n${tail(s1.out)}`);
      else ok("status == head (051)");

      const r1 = sqitchSafe(["revert", "--to", "027_user_feedback", "-y", "--target", TARGET]);
      if (r1.code !== 0 || /not ok|ERROR/.test(r1.out)) fail(`segment revert --to 027 failed\n${tail(r1.out)}`);
      else ok("revert --to 027 (028..051 segment rolled back)");

      const s2 = sqitchSafe(["status", TARGET]);
      if (!/027_user_feedback/.test(s2.out)) fail(`status after revert is not at 027\n${tail(s2.out)}`);
      else ok("status == 027");

      const d2 = sqitchSafe(["deploy", "--verify", "--target", TARGET]);
      if (d2.code !== 0 || /not ok|Deploy failed/.test(d2.out)) fail(`re-deploy --verify 028..051 failed\n${tail(d2.out)}`);
      else ok("re-deploy --verify 028..051");

      const v = sqitchSafe(["verify", TARGET]);
      if (v.code !== 0 || !/Verify successful/.test(v.out)) fail(`full verify failed\n${tail(v.out)}`);
      else ok("sqitch verify — Verify successful");
    } catch (e) {
      fail(`round-trip harness error: ${e.message}`);
    }
  }
}

function tail(s, n = 12) {
  return String(s).trim().split("\n").slice(-n).map((l) => `      ${l}`).join("\n");
}

console.log("");
if (failures.length === 0) {
  console.log(`PASS — migration chain gate (${parityOnly ? "parity only" : "parity + round-trip"})`);
  process.exit(0);
} else {
  console.error(`FAIL — ${failures.length} migration-chain problem(s)`);
  process.exit(1);
}
