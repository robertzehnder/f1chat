#!/usr/bin/env node
/**
 * corpus_g1_check.mjs — G1 exit gate (corpus plan).
 *
 * Against the live DB, with SYNTHETIC rows that are removed afterwards:
 *  1. round-trip: documents → fetch → derivation insert/read-back
 *  2. purged-derivation CHECK: status='purged' with retained text must FAIL
 *  3. retention purge: an expired fetch (youtube retention=30d) is tombstoned
 *     with an audit row, output_text nulled on caption_dedup
 *  4. shared-sha live-reference: a fresh fetch sharing the sha keeps the file
 * Plus the registry refusal paths against the REAL registry rows.
 *
 * Exit 0 iff everything passes.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusClient } from "./lib/db.mjs";
import { storeArtifact, ARTIFACT_ROOT } from "./lib/artifacts.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed, RightsError } from "./lib/rights.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const client = await corpusClient();
const failures = [];
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { failures.push(m); console.error(`  ❌ ${m}`); };

const SRC = "youtube:formula1"; // has retention_days=30
const SYNTH_PREFIX = "g1check:";

// -- registry refusals against real rows
const registry = await loadRegistry(client);
const mustThrow = (label, fn) => {
  try { fn(); fail(`${label}: did NOT refuse`); }
  catch (e) { e instanceof RightsError ? ok(`${label}: refused`) : fail(`${label}: wrong error ${e.message}`); }
};
mustThrow("acquire prohibited (reddit)", () => assertAcquireAllowed(registry, "reddit", "manual_inbox"));
mustThrow("acquire unknown source", () => assertAcquireAllowed(registry, "nope", "rss"));
mustThrow("acquire disallowed method (the_race html)", () => assertAcquireAllowed(registry, "the_race", "html"));
mustThrow("use llm on x_exemplars", () => assertUseAllowed(registry, "x_exemplars", "llm_process", "format_study"));
mustThrow("purpose style_research on x_exemplars", () => assertUseAllowed(registry, "x_exemplars", "store_full_text", "style_research"));
try {
  assertAcquireAllowed(registry, "the_race", "rss");
  assertUseAllowed(registry, "the_race", "store_full_text", "style_research");
  ok("approved paths pass (the_race rss + store)");
} catch (e) { fail(`approved path refused: ${e.message}`); }

// -- synthetic round-trip
async function cleanup() {
  await client.query(
    `DELETE FROM raw.analyst_deletions WHERE target_id IN (
       SELECT fetch_id FROM raw.analyst_fetches f JOIN raw.analyst_documents d USING (doc_id)
       WHERE d.source_id LIKE $1)
     OR target_id IN (
       SELECT derivation_id FROM raw.analyst_derivations dv JOIN raw.analyst_fetches f USING (fetch_id)
       JOIN raw.analyst_documents d USING (doc_id) WHERE d.source_id LIKE $1)`,
    [SYNTH_PREFIX + "%"]
  );
  await client.query(
    `DELETE FROM raw.analyst_derivations WHERE fetch_id IN (
       SELECT fetch_id FROM raw.analyst_fetches f JOIN raw.analyst_documents d USING (doc_id)
       WHERE d.source_id LIKE $1)`, [SYNTH_PREFIX + "%"]);
  await client.query(
    `DELETE FROM raw.analyst_fetches WHERE doc_id IN (
       SELECT doc_id FROM raw.analyst_documents WHERE source_id LIKE $1)`, [SYNTH_PREFIX + "%"]);
  await client.query(`DELETE FROM raw.analyst_documents WHERE source_id LIKE $1`, [SYNTH_PREFIX + "%"]);
}
await cleanup();

const body = Buffer.from("g1 synthetic caption text " + Date.now());
const { sha, path: artPath } = storeArtifact(SRC, body);

const { rows: [{ doc_id: docA }] } = await client.query(
  `INSERT INTO raw.analyst_documents (source_key, source_id, doc_type, title)
   VALUES ($1, $2, 'transcript', 'g1 synthetic A') RETURNING doc_id`, [SRC, SYNTH_PREFIX + "A"]);
const { rows: [{ doc_id: docB }] } = await client.query(
  `INSERT INTO raw.analyst_documents (source_key, source_id, doc_type, title)
   VALUES ($1, $2, 'transcript', 'g1 synthetic B') RETURNING doc_id`, [SRC, SYNTH_PREFIX + "B"]);

// expired fetch on docA, fresh fetch sharing the SAME sha on docB
const { rows: [{ fetch_id: fExp }] } = await client.query(
  `INSERT INTO raw.analyst_fetches (doc_id, fetched_at, http_status, raw_sha256, artifact_path)
   VALUES ($1, NOW() - INTERVAL '40 days', 200, $2, $3) RETURNING fetch_id`, [docA, sha, artPath]);
const { rows: [{ fetch_id: fFresh }] } = await client.query(
  `INSERT INTO raw.analyst_fetches (doc_id, fetched_at, http_status, raw_sha256, artifact_path)
   VALUES ($1, NOW(), 200, $2, $3) RETURNING fetch_id`, [docB, sha, artPath]);

const { rows: [{ derivation_id: dCap }] } = await client.query(
  `INSERT INTO raw.analyst_derivations (fetch_id, kind, tool_version, output_text, output_sha256)
   VALUES ($1, 'caption_dedup', 'caption_dedup@1', 'verbatim caption text', 'x') RETURNING derivation_id`, [fExp]);
await client.query(
  `INSERT INTO raw.analyst_derivations (fetch_id, parent_derivation_id, kind, tool_version, output_text, output_sha256)
   VALUES ($1, $2, 'llm_cleanup', 'llm_cleanup@1', 'cleaned transcript text', 'y')`, [fExp, dCap]);
ok("round-trip: documents → fetches → derivations (with lineage) inserted");

// purged-with-text CHECK must fail
try {
  await client.query(`UPDATE raw.analyst_derivations SET status='purged' WHERE derivation_id = $1`, [dCap]);
  fail("CHECK: purged derivation retained text without error");
  await client.query(`UPDATE raw.analyst_derivations SET status='unreviewed' WHERE derivation_id = $1`, [dCap]);
} catch { ok("CHECK: purged derivation cannot retain text"); }

// run the real retention script
execFileSync("node", [resolve(HERE, "corpus_retention.mjs")], { stdio: "inherit", env: process.env });

const { rows: [expRow] } = await client.query(
  `SELECT artifact_status, artifact_path FROM raw.analyst_fetches WHERE fetch_id = $1`, [fExp]);
expRow.artifact_status === "purged" && expRow.artifact_path === null
  ? ok("retention: expired fetch tombstoned") : fail("retention: expired fetch not tombstoned");

const { rows: [capRow] } = await client.query(
  `SELECT status, output_text FROM raw.analyst_derivations WHERE derivation_id = $1`, [dCap]);
capRow.status === "purged" && capRow.output_text === null
  ? ok("retention: caption_dedup text purged") : fail("retention: caption text not purged");

const { rows: [cleanRow] } = await client.query(
  `SELECT status FROM raw.analyst_derivations WHERE fetch_id = $1 AND kind = 'llm_cleanup'`, [fExp]);
cleanRow.status !== "purged" ? ok("retention: llm_cleanup transcript retained") : fail("retention: cleanup wrongly purged");

const { rows: audits } = await client.query(
  `SELECT target_kind FROM raw.analyst_deletions WHERE target_id IN ($1, $2)`, [fExp, dCap]);
audits.length >= 2 ? ok(`retention: ${audits.length} audit rows written`) : fail("retention: audit rows missing");

const absArt = resolve(ARTIFACT_ROOT, "..", artPath);
existsSync(absArt)
  ? ok("shared-sha live-reference: file kept while fresh fetch references it")
  : fail("shared-sha live-reference: file wrongly deleted");

const { rows: [freshRow] } = await client.query(
  `SELECT artifact_status FROM raw.analyst_fetches WHERE fetch_id = $1`, [fFresh]);
freshRow.artifact_status === "stored" ? ok("fresh fetch untouched") : fail("fresh fetch wrongly purged");

await cleanup();
await client.end();

console.log(failures.length ? `\nG1 GATE: FAIL (${failures.length})` : "\nG1 GATE: PASS");
process.exit(failures.length ? 1 : 0);
