#!/usr/bin/env node
/**
 * fetch_f1com.mjs — Formula1.com fetcher (corpus G3).
 *
 * Discovery: the published article sitemap index (33 non-chronological
 * chunks — every chunk is scanned and filtered by lastmod + slug).
 * Curated slugs only:
 *   strategy-guide-*   → strategy_report
 *   facts-and-stats-*  → facts_stats
 * Content: one plain page GET per article; the body is embedded in the
 * page's Next.js flight data (parsed at normalize time by f1com_flight@1).
 *
 * Usage: node scripts/corpus/fetch_f1com.mjs [--season 2026] [--limit N]
 */
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "./lib/rights.mjs";
import { storeArtifact } from "./lib/artifacts.mjs";
import { politeFetch } from "./lib/http.mjs";

const SRC = "f1com";
const PURPOSE = "style_research";
const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const limit = Number(process.argv.find((a, i) => process.argv[i - 1] === "--limit") ?? Infinity);

const client = await corpusClient();
const registry = await loadRegistry(client);

assertAcquireAllowed(registry, SRC, "sitemap");
const { rows: [srcRow] } = await client.query(`SELECT config FROM raw.analyst_sources WHERE source_key = $1`, [SRC]);

const idx = await politeFetch(srcRow.config.sitemap_index, { delayMs: 0 });
if (idx.status !== 200) { console.error(`sitemap index HTTP ${idx.status}`); process.exit(1); }
const chunkUrls = [...idx.body.toString("utf8").matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
console.log(`f1com: ${chunkUrls.length} sitemap chunk(s)`);

const candidates = [];
for (const cu of chunkUrls) {
  const res = await politeFetch(cu, { delayMs: 400 });
  if (res.status !== 200) { console.error(`  ! chunk ${cu}: HTTP ${res.status}`); continue; }
  for (const m of res.body.toString("utf8").matchAll(/<url>\s*<loc>(.*?)<\/loc>\s*(?:<lastmod>(.*?)<\/lastmod>)?/gs)) {
    const url = m[1], lastmod = m[2] ?? null;
    if (!lastmod || lastmod < `${season}-01-01`) continue;
    const slug = url.split("/").pop().split(".")[0];
    let docType = null;
    if (slug.startsWith("strategy-guide-")) docType = "strategy_report";
    // 2016-2025 slug family + the 2026 "need to know" rename of Facts & Stats
    else if (slug.startsWith("facts-and-stats-")) docType = "facts_stats";
    else if (slug.startsWith("need-to-know-") && slug.includes("facts")) docType = "facts_stats";
    if (docType) candidates.push({ url, lastmod, slug, docType });
  }
}
console.log(`f1com: ${candidates.length} allowlisted candidates (season >= ${season})`);

assertAcquireAllowed(registry, SRC, "html");
let fetched = 0, unchanged = 0, failed = 0;
for (const c of candidates.slice(0, limit)) {
  const { rows: [doc] } = await client.query(
    `SELECT d.doc_id, MAX(f.fetched_at) AS last_fetch
     FROM raw.analyst_documents d LEFT JOIN raw.analyst_fetches f USING (doc_id)
     WHERE d.source_key = $1 AND d.source_id = $2 GROUP BY d.doc_id`, [SRC, c.slug]);
  if (doc?.last_fetch && c.lastmod && new Date(c.lastmod) <= new Date(doc.last_fetch)) { unchanged++; continue; }

  const res = await politeFetch(c.url);
  if (res.status !== 200 || !res.body?.length) { console.error(`  ! ${c.slug}: HTTP ${res.status}`); failed++; continue; }

  assertUseAllowed(registry, SRC, "store_full_text", PURPOSE);
  const { sha, path } = storeArtifact(SRC, res.body);
  const { rows: [{ doc_id }] } = await client.query(
    `INSERT INTO raw.analyst_documents (source_key, source_id, url, doc_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_key, source_id) DO UPDATE SET url = EXCLUDED.url
     RETURNING doc_id`, [SRC, c.slug, c.url, c.docType]);
  const ins = await client.query(
    `INSERT INTO raw.analyst_fetches (doc_id, http_status, etag, last_modified, mime_type, raw_sha256, artifact_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (doc_id, raw_sha256) DO NOTHING RETURNING fetch_id`,
    [doc_id, res.status, res.etag, res.lastModified ?? c.lastmod, res.mimeType, sha, path]);
  ins.rowCount ? fetched++ : unchanged++;
}

console.log(`f1com: ${fetched} new fetch revision(s), ${unchanged} unchanged, ${failed} failed`);
await client.end();
process.exit(failed && !fetched ? 1 : 0);
