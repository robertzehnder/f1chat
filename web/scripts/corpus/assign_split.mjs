#!/usr/bin/env node
/**
 * assign_split.mjs — the leakage boundary (corpus G4).
 *
 * Partitions a season's RACE meetings (phantom/cancelled meetings excluded
 * by the no-Race-session/no-laps guard upstream) into dev/validation/holdout
 * ~60/20/20 with a deterministic seeded shuffle, writes the tamper-evident
 * list to corpus/splits/<season>.json (committed to git), and stamps
 * corpus_split on every linked document. Races not yet run are assigned NOW
 * so the holdout embargo holds from the start of the season.
 *
 * Style distillation reads ONLY dev docs; the paired agent-vs-pro quality
 * eval runs ONLY on holdout races; claim triage may use all races.
 *
 * Re-running NEVER reassigns an existing season file (tamper-evident);
 * delete the file deliberately to re-partition (new season policy only).
 *
 * Usage: node scripts/corpus/assign_split.mjs [--season 2026]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusClient } from "./lib/db.mjs";
import { loadRaceMeetings } from "./lib/meetings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const OUT = resolve(HERE, "..", "..", "..", "corpus", "splits", `${season}.json`);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedFrom = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 2166136261);

const client = await corpusClient();
let split;
if (existsSync(OUT)) {
  split = JSON.parse(readFileSync(OUT, "utf8"));
  console.log(`split: ${OUT} already exists (tamper-evident) — applying, not reassigning`);
} else {
  const meetings = await loadRaceMeetings(client, season);
  const keys = meetings.map((m) => m.meetingKey).sort((a, b) => a - b);
  const rng = mulberry32(seedFrom(`corpus-${season}`));
  const shuffled = [...keys];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const nDev = Math.round(shuffled.length * 0.6);
  const nVal = Math.round(shuffled.length * 0.2);
  split = {
    season,
    seed: `corpus-${season}`,
    assigned_at: new Date().toISOString(),
    dev: shuffled.slice(0, nDev).sort((a, b) => a - b),
    validation: shuffled.slice(nDev, nDev + nVal).sort((a, b) => a - b),
    holdout: shuffled.slice(nDev + nVal).sort((a, b) => a - b),
    note: "Assigned once per season before any distillation. Style guide reads dev only; paired quality eval holdout only; claim triage all. Never reassign mid-season."
  };
  writeFileSync(OUT, JSON.stringify(split, null, 2) + "\n");
  console.log(`split: wrote ${OUT}`);
}

for (const [name, keys] of [["dev", split.dev], ["validation", split.validation], ["holdout", split.holdout]]) {
  const { rowCount } = await client.query(
    `UPDATE raw.analyst_documents SET corpus_split = $1
     WHERE meeting_key = ANY($2::int[]) AND corpus_split IS DISTINCT FROM $1`, [name, keys]);
  console.log(`  ${name}: meetings [${keys.join(", ")}] — ${rowCount} doc(s) stamped`);
}
await client.end();
