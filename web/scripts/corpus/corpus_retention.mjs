#!/usr/bin/env node
/**
 * corpus_retention.mjs — weekly retention purge (corpus plan, principle 4).
 *
 * For every source with retention_days set, purges expired content:
 *  - fetches older than the window: artifact file physically deleted ONLY
 *    after a live-reference check (no other non-purged fetch row shares
 *    raw_sha256), artifact_path nulled, artifact_status='purged';
 *  - derivations attached to those fetches whose kind holds raw-equivalent
 *    text (caption_dedup keeps VERBATIM caption text, so it expires with
 *    the raw VTT; normalize_md/llm_cleanup/claim_extraction are retained
 *    transformations): output_text nulled, status='purged' (table CHECK
 *    enforces the pairing).
 * Every purge writes a raw.analyst_deletions audit row.
 *
 * NOTE on youtube:formula1 — retention_days=30 applies to the raw VTT and
 * its verbatim caption_dedup text; the derived llm_cleanup transcript is
 * the retained normalized form per the registry decision.
 *
 * Usage: node scripts/corpus/corpus_retention.mjs [--dry-run]
 */
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { corpusClient } from "./lib/db.mjs";
import { ARTIFACT_ROOT } from "./lib/artifacts.mjs";

const dryRun = process.argv.includes("--dry-run");
const client = await corpusClient();

const { rows: expired } = await client.query(`
  SELECT f.fetch_id, f.doc_id, f.raw_sha256, f.artifact_path, d.source_key
  FROM raw.analyst_fetches f
  JOIN raw.analyst_documents d USING (doc_id)
  JOIN raw.analyst_sources s USING (source_key)
  WHERE s.retention_days IS NOT NULL
    AND f.artifact_status = 'stored'
    AND f.fetched_at < NOW() - make_interval(days => s.retention_days)
  ORDER BY f.fetch_id`);

console.log(`retention: ${expired.length} expired fetch(es)${dryRun ? " [dry-run]" : ""}`);
let purgedFiles = 0, purgedDerivs = 0;

for (const f of expired) {
  if (dryRun) { console.log(`  would purge fetch ${f.fetch_id} (${f.source_key})`); continue; }
  await client.query("BEGIN");
  try {
    // Live-reference check: does any OTHER stored fetch share these bytes?
    const { rows: [{ n }] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM raw.analyst_fetches
       WHERE raw_sha256 = $1 AND artifact_status = 'stored' AND fetch_id <> $2`,
      [f.raw_sha256, f.fetch_id]
    );
    const lastReference = n === 0;

    const { rows: derivs } = await client.query(
      `UPDATE raw.analyst_derivations
       SET output_text = NULL, output_sha256 = NULL, status = 'purged'
       WHERE fetch_id = $1 AND kind = 'caption_dedup' AND status <> 'purged'
       RETURNING derivation_id`,
      [f.fetch_id]
    );
    for (const d of derivs) {
      await client.query(
        `INSERT INTO raw.analyst_deletions (target_kind, target_id, artifact_sha256, reason)
         VALUES ('derivation_text', $1, $2, 'retention_days expiry (verbatim caption text)')`,
        [d.derivation_id, f.raw_sha256]
      );
      purgedDerivs++;
    }

    await client.query(
      `UPDATE raw.analyst_fetches SET artifact_path = NULL, artifact_status = 'purged' WHERE fetch_id = $1`,
      [f.fetch_id]
    );
    await client.query(
      `INSERT INTO raw.analyst_deletions (target_kind, target_id, artifact_sha256, reason)
       VALUES ('fetch_artifact', $1, $2, $3)`,
      [f.fetch_id, f.raw_sha256, `retention_days expiry${lastReference ? "" : " (file kept: shared sha still referenced)"}`]
    );
    await client.query("COMMIT");

    if (lastReference && f.artifact_path) {
      const abs = resolve(ARTIFACT_ROOT, "..", f.artifact_path);
      if (existsSync(abs)) { unlinkSync(abs); purgedFiles++; }
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

console.log(`retention: purged ${expired.length} fetch row(s), ${purgedDerivs} derivation text(s), ${purgedFiles} file(s)`);
await client.end();
