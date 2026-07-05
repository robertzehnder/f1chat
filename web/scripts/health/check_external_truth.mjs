#!/usr/bin/env node
/**
 * check_external_truth.mjs — Phase 3.5 external-ground-truth gate
 * (roadmap_to_A_grade_2026-07-02.md).
 *
 * Validates the warehouse's HARD-TRUTH tier against OFFICIAL results (the
 * jolpica Ergast mirror, https://api.jolpi.ca/ergast) for a sample of 2025
 * races — "rows vs reality", the check the sweep's answer-vs-rows consistency
 * can't do. Compares our core.grid_vs_finish provisional finishing order to the
 * official classification: winner, podium set, and full-order agreement.
 *
 * Round↔session mapping is by CHRONOLOGICAL ORDER (Ergast round N ↔ our Nth
 * 2025 race by date_start) — unambiguous even with 3 US / 2 Italy races.
 * Driver identity is the car number (Ergast Results[].number == driver_number).
 *
 * Because finish is a position_history PROXY (session_result un-ingested), exact
 * agreement isn't expected for lapped/DNF cars; the gate asserts the signals a
 * good proxy must get right and reports the rest:
 *   GATE: winner matches official for EVERY sampled race; podium (top-3 set)
 *         matches for >= PODIUM_MIN of them; mean top-10 position agreement
 *         >= TOP10_MIN.
 *
 * Env: NEON_DB_* from web/.env.local. Flags: --rounds a,b,c (override sample),
 *      --all (every round). Network required.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..", "..");
const ERGAST = "https://api.jolpi.ca/ergast/f1/2025";
const SEASON_ROUNDS_DEFAULT = [1, 4, 7, 10, 13, 16, 19, 22];
const PODIUM_MIN = 0.75; // >=75% of sampled races must have the exact podium set
const TOP10_MIN = 0.7;   // mean fraction of top-10 finishers at the right position

const argv = process.argv.slice(2);
const roundsArg = (() => { const i = argv.indexOf("--rounds"); return i >= 0 ? argv[i + 1].split(",").map(Number) : null; })();

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(WEB, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const client = new pg.Client({
  host: env.NEON_DB_HOST, port: Number(env.NEON_DB_PORT || 5432), database: env.NEON_DB_NAME,
  user: env.NEON_DB_USER, password: env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "openf1-truth-check" } });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 1000 * (i + 1))); }
  }
}

async function main() {
  await client.connect();
  // Our 2025 races in chronological order → index i is round (i+1).
  const ours = (await client.query(
    `SELECT session_key, country_name, location FROM core.sessions
     WHERE year=2025 AND lower(coalesce(session_name,''))='race' ORDER BY date_start`)).rows;

  const total = argv.includes("--all") ? ours.length : null;
  const rounds = roundsArg || (total ? Array.from({ length: total }, (_, i) => i + 1) : SEASON_ROUNDS_DEFAULT)
    .filter((r) => r >= 1 && r <= ours.length);

  console.log(`Phase 3.5 — external truth vs official (jolpica Ergast), ${rounds.length} sampled 2025 races`);
  const results = [];
  for (const round of rounds) {
    const session = ours[round - 1];
    if (!session) continue;
    let official;
    try {
      const j = await fetchJson(`${ERGAST}/${round}/results.json?limit=100`);
      const race = j.MRData.RaceTable.Races[0];
      if (!race) { console.log(`  ⚠️  round ${round}: no official results yet — skipped`); continue; }
      official = { name: race.raceName, rows: race.Results.map((x) => ({ pos: Number(x.position), num: Number(x.number), code: x.Driver.code })) };
    } catch (e) { console.log(`  ⚠️  round ${round}: fetch failed (${e.message}) — skipped`); continue; }

    const ourRows = (await client.query(
      `SELECT driver_number, finish_position FROM core.grid_vs_finish
       WHERE session_key=$1 AND finish_position IS NOT NULL`, [session.session_key])).rows;
    const ourByNum = new Map(ourRows.map((r) => [Number(r.driver_number), Number(r.finish_position)]));

    const offWinner = official.rows.find((r) => r.pos === 1);
    const ourWinnerNum = [...ourByNum.entries()].find(([, p]) => p === 1)?.[0];
    const winnerMatch = offWinner && ourWinnerNum === offWinner.num;

    const offPodium = new Set(official.rows.filter((r) => r.pos <= 3).map((r) => r.num));
    const ourPodium = new Set([...ourByNum.entries()].filter(([, p]) => p <= 3).map(([n]) => n));
    const podiumMatch = offPodium.size === 3 && [...offPodium].every((n) => ourPodium.has(n));

    const top10 = official.rows.filter((r) => r.pos <= 10);
    const top10Hits = top10.filter((r) => ourByNum.get(r.num) === r.pos).length;
    const top10Agree = top10.length ? top10Hits / top10.length : 0;

    results.push({ round, name: official.name, winnerMatch, podiumMatch, top10Agree, ourWinnerNum, offWinner: offWinner?.num });
    const mk = (b) => (b ? "✓" : "✗");
    console.log(`  R${String(round).padStart(2)} ${official.name.padEnd(28)} winner ${mk(winnerMatch)} podium ${mk(podiumMatch)} top10 ${(top10Agree * 100).toFixed(0)}%`);
  }
  await client.end();

  if (!results.length) { console.error("FAIL — no races could be validated (network?)"); process.exit(1); }
  const winnersOk = results.every((r) => r.winnerMatch);
  const podiumRate = results.filter((r) => r.podiumMatch).length / results.length;
  const top10Mean = results.reduce((a, r) => a + r.top10Agree, 0) / results.length;

  console.log(`\n  winner match: ${results.filter((r) => r.winnerMatch).length}/${results.length}` +
    ` | podium set: ${(podiumRate * 100).toFixed(0)}% (min ${PODIUM_MIN * 100}%)` +
    ` | mean top-10 order: ${(top10Mean * 100).toFixed(0)}% (min ${TOP10_MIN * 100}%)`);

  const problems = [];
  if (!winnersOk) problems.push(`winner mismatch in: ${results.filter((r) => !r.winnerMatch).map((r) => `R${r.round}(ours#${r.ourWinnerNum} vs #${r.offWinner})`).join(", ")}`);
  if (podiumRate < PODIUM_MIN) problems.push(`podium set match ${(podiumRate * 100).toFixed(0)}% < ${PODIUM_MIN * 100}%`);
  if (top10Mean < TOP10_MIN) problems.push(`mean top-10 order agreement ${(top10Mean * 100).toFixed(0)}% < ${TOP10_MIN * 100}%`);

  if (problems.length === 0) { console.log("\nPASS — warehouse finishing order matches official within tolerance."); process.exit(0); }
  console.error("\nFAIL — external-truth divergence:");
  for (const p of problems) console.error(`  ❌ ${p}`);
  process.exit(1);
}
main().catch((e) => { console.error("external-truth harness error:", e.message); process.exit(1); });
