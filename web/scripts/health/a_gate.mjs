#!/usr/bin/env node
/**
 * a_gate.mjs — THE blocking A-gate (roadmap_to_A_grade_2026-07-02.md, Phase 0).
 *
 * One command, non-zero exit on ANY failure. This is what makes "everything is
 * an A" a MEASURED claim rather than an asserted one. Principles baked in:
 *   • No best-of retries — each step runs once; its result stands (worst-of-N,
 *     not best-of-N). A flaky pass is a fail.
 *   • Judge mandatory — when the judged sweep is wired, a judge ERROR is a gate
 *     failure (not a skip).
 *   • No silent gaps — a step that isn't implemented yet reports PENDING and the
 *     gate exits non-zero (INCOMPLETE). A gate that passes with missing checks
 *     would be the exact "asserted, not measured" failure this exists to prevent.
 *
 * Composes (roadmap Phase 0 step list):
 *   1. verify            — npm run verify (typecheck + grading tests + build)   [Phase 4/base]
 *   2. surface-coverage  — check_surface_coverage.mjs (derive-don't-hand-list)  [Phase 0]
 *   3. migration         — check_migration_chain.mjs (deploy+verify+revert RT)  [Phase 1]
 *   4. judged-sweep      — full gated surface, worst-of-N, judge mandatory      [Phase 4]  (pending)
 *   5. external-truth    — FastF1/official sample for hard-truth templates      [Phase 3.5](pending)
 *   6. pixels            — Playwright over /mock + live fixtures                [Phase 5]  (pending)
 *   7. perf-slo          — cold/warm/concurrent latency + zero timeouts         [Phase 2]  (pending)
 *
 * Exit: 0 = all required steps PASS and none pending; 1 = a step FAILED;
 *       2 = INCOMPLETE (a required step is PENDING / not yet wired).
 *
 * Flags:
 *   --only a,b,c     run only these step ids
 *   --skip a,b,c     skip these step ids (reported SKIP, not counted as pending)
 *   --fast           skip the heavy `build` inside verify (typecheck+tests only)
 *   --list           print the step table and exit
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..", ".."); // web/

const argv = process.argv.slice(2);
const getList = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(",").map((s) => s.trim()) : null;
};
const only = getList("--only");
const skip = getList("--skip") || [];
const fast = argv.includes("--fast");
const listOnly = argv.includes("--list");

/** Each step: id, phase, desc, and either cmd (argv array) or pending:true. */
const STEPS = [
  {
    id: "surface-coverage", phase: "0", desc: "derived surface manifest coverage",
    cmd: ["node", "scripts/health/check_surface_coverage.mjs"],
  },
  {
    id: "migration", phase: "1", desc: "migration chain parity + sandbox round-trip",
    cmd: ["node", "scripts/health/check_migration_chain.mjs"],
  },
  {
    id: "verify", phase: "base", desc: "typecheck + baseline-aware grading" + (fast ? "" : " + build"),
    cmd: fast
      ? ["npm", "run", "typecheck", "--silent"]
      : ["node", "scripts/health/check_verify_gate.mjs"],
  },
  {
    id: "data-invariants", phase: "3", desc: "warehouse grain invariants (unique lap grain, unique finish, …)",
    cmd: ["node", "scripts/health/check_data_invariants.mjs"],
  },
  {
    id: "external-truth", phase: "3.5", desc: "FastF1/official sample vs hard-truth templates",
    cmd: ["node", "scripts/health/check_external_truth.mjs"], optional_missing_ok: false,
  },
  {
    id: "judged-sweep", phase: "4", desc: "full judged sweep (worst-of-N, judge mandatory)",
    cmd: ["node", "scripts/health/a_gate_sweep.mjs"],
  },
  {
    id: "perf-slo", phase: "2", desc: "cold/warm/concurrent latency + zero timeouts",
    cmd: ["node", "scripts/health/check_perf_slo.mjs"],
  },
  {
    // no --silent: npm's "Missing script" message must reach stderr so the
    // step is detected as PENDING (not FAIL) until Phase 5 adds verify:pixels.
    id: "pixels", phase: "5", desc: "Playwright visual regression (/mock + live)",
    cmd: ["npm", "run", "verify:pixels"],
  },
];

function selected(step) {
  if (only) return only.includes(step.id);
  if (skip.includes(step.id)) return false;
  return true;
}

if (listOnly) {
  console.log("A-gate steps:");
  for (const s of STEPS) console.log(`  [${s.phase.padEnd(4)}] ${s.id.padEnd(18)} ${s.desc}`);
  process.exit(0);
}

const results = [];
for (const step of STEPS) {
  if (!selected(step)) { results.push({ ...step, status: "SKIP" }); continue; }
  process.stdout.write(`▶ [${step.phase}] ${step.id} … `);
  try {
    execFileSync(step.cmd[0], step.cmd.slice(1), {
      cwd: WEB, stdio: ["ignore", "ignore", "pipe"], env: process.env,
    });
    console.log("PASS");
    results.push({ ...step, status: "PASS" });
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`;
    // A missing script (ENOENT / "Cannot find module") means the step's phase
    // isn't wired yet → PENDING (incomplete), distinct from a real FAIL.
    const notWired = e.code === "ENOENT"
      || /Cannot find module|MODULE_NOT_FOUND|Missing script|command not found/i.test(out);
    if (notWired) {
      console.log("PENDING (not wired)");
      results.push({ ...step, status: "PENDING", detail: firstLine(out) });
    } else {
      console.log("FAIL");
      results.push({ ...step, status: "FAIL", detail: tail(out) });
    }
  }
}

// -------------------------------------------------------------- report
console.log("\n──────── A-GATE SUMMARY ────────");
for (const r of results) {
  const mark = { PASS: "✅", FAIL: "❌", PENDING: "⏳", SKIP: "➖" }[r.status];
  console.log(`${mark} [${r.phase.padEnd(4)}] ${r.id.padEnd(18)} ${r.status}`);
  if (r.status === "FAIL" && r.detail) console.log(r.detail);
}
const failed = results.filter((r) => r.status === "FAIL");
const pending = results.filter((r) => r.status === "PENDING");
console.log("────────────────────────────────");

if (failed.length) {
  console.error(`\nA-GATE: FAIL — ${failed.length} step(s) failed: ${failed.map((s) => s.id).join(", ")}`);
  process.exit(1);
}
if (pending.length) {
  console.error(`\nA-GATE: INCOMPLETE — ${pending.length} step(s) not yet wired: ${pending.map((s) => s.id).join(", ")}`);
  console.error("(These are the remaining roadmap phases. The gate cannot certify an A until every step PASSES.)");
  process.exit(2);
}
console.log("\nA-GATE: PASS — every gated dimension measured green. ✅");
process.exit(0);

function tail(s, n = 15) { return String(s).trim().split("\n").slice(-n).map((l) => "    " + l).join("\n"); }
function firstLine(s) { return "    " + String(s).trim().split("\n")[0]; }
