#!/usr/bin/env node
/**
 * normalize_docs.mjs — deterministic normalization pass (corpus stage 2).
 *
 * For every stored fetch lacking a current-version normalization, runs the
 * source's parser (lib/parsers.mjs), persists the normalized text as a
 * derivation (assertUseAllowed store_full_text first), and updates the
 * document's mutable metadata (title/author/published_at) from the parse.
 *
 * Re-runnable: a parser version bump re-derives from stored artifacts; old
 * derivations remain for audit.
 *
 * Usage: node scripts/corpus/normalize_docs.mjs [--source <key>]
 */
import { createHash } from "node:crypto";
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertUseAllowed } from "./lib/rights.mjs";
import { readArtifact } from "./lib/artifacts.mjs";
import {
  parseTheRaceMd, THERACE_MD_VERSION,
  parseF1comFlight, F1COM_FLIGHT_VERSION,
  parseSubstackHtml, SUBSTACK_HTML_VERSION,
  parseCaptionDedup, CAPTION_DEDUP_VERSION
} from "./lib/parsers.mjs";

const PURPOSE = "style_research";
const onlySource = process.argv.find((a, i) => process.argv[i - 1] === "--source") ?? null;

const PARSERS = {
  the_race: { kind: "normalize_md", version: THERACE_MD_VERSION, fn: parseTheRaceMd },
  f1com: { kind: "normalize_md", version: F1COM_FLIGHT_VERSION, fn: parseF1comFlight },
  "substack:f1debrief": { kind: "normalize_md", version: SUBSTACK_HTML_VERSION, fn: parseSubstackHtml },
  "youtube:formula1": { kind: "caption_dedup", version: CAPTION_DEDUP_VERSION, fn: parseCaptionDedup }
};

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const client = await corpusClient();
const registry = await loadRegistry(client);

const { rows: pending } = await client.query(
  `SELECT f.fetch_id, f.doc_id, f.raw_sha256, f.artifact_path, d.source_key, d.source_id
   FROM raw.analyst_fetches f
   JOIN raw.analyst_documents d USING (doc_id)
   WHERE f.artifact_status = 'stored'
     AND ($1::text IS NULL OR d.source_key = $1)
     AND NOT EXISTS (
       SELECT 1 FROM raw.analyst_derivations dv
       WHERE dv.fetch_id = f.fetch_id
         AND dv.kind IN ('normalize_md','caption_dedup')
         AND dv.status <> 'purged'
         AND dv.tool_version = CASE d.source_key
             WHEN 'the_race' THEN '${THERACE_MD_VERSION}'
             WHEN 'f1com' THEN '${F1COM_FLIGHT_VERSION}'
             WHEN 'substack:f1debrief' THEN '${SUBSTACK_HTML_VERSION}'
             WHEN 'youtube:formula1' THEN '${CAPTION_DEDUP_VERSION}'
             END)
   ORDER BY f.fetch_id`,
  [onlySource]
);

console.log(`normalize: ${pending.length} fetch(es) pending`);
let done = 0, errors = 0, rejected = 0;
for (const f of pending) {
  const p = PARSERS[f.source_key];
  if (!p) { console.error(`  ! no parser for ${f.source_key}`); errors++; continue; }
  try {
    const raw = readArtifact(f.artifact_path);
    const { meta, text } = p.fn(raw);
    if (!text || text.length < 100) {
      // Content unavailable via permitted methods (e.g. some f1com articles
      // client-render the body from their private editorial API). Record an
      // auditable REJECTED marker — never usable as content — so the
      // accounting invariant sees the fetch as processed, not silently dropped.
      const markerText = `[content unavailable via permitted methods: parser ${p.version} extracted ${text?.length ?? 0} chars]`;
      await client.query(
        `INSERT INTO raw.analyst_derivations (fetch_id, kind, tool_version, input_sha256, output_sha256, output_text, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'rejected')`,
        [f.fetch_id, p.kind, p.version, f.raw_sha256, sha256(markerText), markerText]
      );
      console.log(`  ~ fetch ${f.fetch_id} (${f.source_key}/${f.source_id}): content unavailable, rejected marker recorded`);
      rejected++;
      continue;
    }
    assertUseAllowed(registry, f.source_key, "store_full_text", PURPOSE);
    await client.query(
      `INSERT INTO raw.analyst_derivations (fetch_id, kind, tool_version, input_sha256, output_sha256, output_text)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [f.fetch_id, p.kind, p.version, f.raw_sha256, sha256(text), text]
    );
    const sets = [];
    const vals = [];
    if (meta.title) { vals.push(meta.title); sets.push(`title = $${vals.length + 1}`); }
    if (meta.author) { vals.push(meta.author); sets.push(`author = $${vals.length + 1}`); }
    if (meta.published) { vals.push(meta.published); sets.push(`published_at = $${vals.length + 1}::timestamptz`); }
    if (sets.length) {
      await client.query(`UPDATE raw.analyst_documents SET ${sets.join(", ")} WHERE doc_id = $1`, [f.doc_id, ...vals]);
    }
    done++;
  } catch (e) {
    console.error(`  ! fetch ${f.fetch_id} (${f.source_key}/${f.source_id}): ${e.message}`);
    errors++;
  }
}
console.log(`normalize: ${done} derived, ${rejected} rejected marker(s), ${errors} error(s)`);
await client.end();
process.exit(errors ? 1 : 0);
