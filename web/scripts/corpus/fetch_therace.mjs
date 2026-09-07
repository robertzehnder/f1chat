#!/usr/bin/env node
/**
 * fetch_therace.mjs — The Race fetcher (corpus G2).
 *
 * Curation, not crawling: discovery walks sitemap-posts.xml and keeps ONLY
 * the allowlisted per-race analysis slugs —
 *   - 'everything-we-learned' race deep-dives         → race_analysis
 *   - 'winners-and-losers' verdict pieces             → race_analysis
 *   - Mark Hughes pieces (tokens 'mark'+'hughes')     → race_analysis
 *     (G2 probe finding: Hughes stopped per-race writing in 2026 — 3
 *      evergreen pieces vs 291 in 2023; the everything-we-learned series
 *      is The Race's 2026 per-race analysis register)
 *   - Edd Straw driver ratings ('rankings'+'edd'+'straw') → driver_ratings
 * within the season window (sitemap lastmod >= <season>-01-01).
 *
 * Content comes from the site's own `.md` endpoint (invited via /llms.txt).
 * Every request passes assertAcquireAllowed; every artifact write passes
 * assertUseAllowed(store_full_text). A changed article (new bytes) lands as
 * a NEW fetch revision; unchanged bytes land no new row (UNIQUE doc+sha).
 *
 * Usage: node scripts/corpus/fetch_therace.mjs [--season 2026] [--limit N]
 */
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "./lib/rights.mjs";
import { storeArtifact } from "./lib/artifacts.mjs";
import { politeFetch } from "./lib/http.mjs";
import { tokenize } from "./lib/meetings.mjs";

const SRC = "the_race";
const PURPOSE = "style_research"; // corpus docs serve style + eval; acquisition purpose is style_research
const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const limit = Number(process.argv.find((a, i) => process.argv[i - 1] === "--limit") ?? Infinity);

const client = await corpusClient();
const registry = await loadRegistry(client);

assertAcquireAllowed(registry, SRC, "sitemap");
const { rows: [srcRow] } = await client.query(
  `SELECT config FROM raw.analyst_sources WHERE source_key = $1`, [SRC]);
const sitemapUrl = srcRow.config.sitemap;

const sm = await politeFetch(sitemapUrl, { delayMs: 0 });
if (sm.status !== 200) { console.error(`sitemap HTTP ${sm.status}`); process.exit(1); }
const xml = sm.body.toString("utf8");
const entries = [...xml.matchAll(/<url>\s*<loc>(.*?)<\/loc>\s*(?:<lastmod>(.*?)<\/lastmod>)?/gs)]
  .map((m) => ({ url: m[1], lastmod: m[2] ?? null }));

function classify(slugTokens) {
  const has = (...ts) => ts.every((t) => slugTokens.includes(t));
  if (has("rankings", "edd", "straw")) return "driver_ratings";
  if (has("mark", "hughes")) return "race_analysis";
  if (has("everything", "we", "learned")) return "race_analysis";
  if (has("winners", "losers")) return "race_analysis";
  return null;
}

const candidates = [];
for (const e of entries) {
  if (!e.url.includes("/formula-1/")) continue;
  if (!e.lastmod || e.lastmod < `${season}-01-01`) continue;
  const slug = e.url.replace(/\/$/, "").split("/").pop();
  const docType = classify(tokenize(slug));
  if (docType) candidates.push({ ...e, slug, docType });
}
console.log(`the_race: ${candidates.length} allowlisted candidates (season >= ${season})`);

assertAcquireAllowed(registry, SRC, "md_endpoint");
let fetched = 0, unchanged = 0, failed = 0;
for (const c of candidates.slice(0, limit)) {
  // skip when we already hold a fetch and lastmod hasn't moved past it
  const { rows: [doc] } = await client.query(
    `SELECT d.doc_id, MAX(f.fetched_at) AS last_fetch
     FROM raw.analyst_documents d LEFT JOIN raw.analyst_fetches f USING (doc_id)
     WHERE d.source_key = $1 AND d.source_id = $2
     GROUP BY d.doc_id`, [SRC, c.slug]);
  if (doc?.last_fetch && c.lastmod && new Date(c.lastmod) <= new Date(doc.last_fetch)) { unchanged++; continue; }

  const mdUrl = c.url.replace(/\/$/, "") + ".md";
  const res = await politeFetch(mdUrl);
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

console.log(`the_race: ${fetched} new fetch revision(s), ${unchanged} unchanged, ${failed} failed`);
await client.end();
process.exit(failed && !fetched ? 1 : 0);
