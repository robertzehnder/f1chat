#!/usr/bin/env node
/**
 * fetch_substack.mjs — Substack newsletter fetcher (corpus G3).
 *
 * RSS ONLY per the rights registry (never HTML pages). Every enabled
 * substack:* source's feed is pulled; each item's content:encoded HTML is
 * the stored artifact (full text ships in the feed for free posts).
 * History is bounded by feed depth (~20 items) — the accounting gate's
 * coverage baseline for substack is "most recent posts", not all-season.
 *
 * Usage: node scripts/corpus/fetch_substack.mjs
 */
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "./lib/rights.mjs";
import { storeArtifact } from "./lib/artifacts.mjs";
import { politeFetch } from "./lib/http.mjs";

const PURPOSE = "style_research";
const client = await corpusClient();
const registry = await loadRegistry(client);

const { rows: sources } = await client.query(
  `SELECT source_key, config FROM raw.analyst_sources
   WHERE source_key LIKE 'substack:%' AND enabled`);

let fetched = 0, unchanged = 0, failed = 0;
for (const src of sources) {
  assertAcquireAllowed(registry, src.source_key, "rss");
  const res = await politeFetch(src.config.feed, { delayMs: 0 });
  if (res.status !== 200) { console.error(`${src.source_key}: HTTP ${res.status}`); failed++; continue; }
  const xml = res.body.toString("utf8");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  console.log(`${src.source_key}: ${items.length} feed item(s)`);
  for (const it of items) {
    const link = it.match(/<link>(.*?)<\/link>/)?.[1]?.trim();
    const title = it.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]?.trim();
    const author = it.match(/<dc:creator><!\[CDATA\[([\s\S]*?)\]\]><\/dc:creator>/)?.[1]?.trim();
    const pub = it.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim();
    const content = it.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1];
    if (!link || !content || content.length < 500) continue; // teaser/short note
    const slug = link.replace(/\/$/, "").split("/").pop();

    assertUseAllowed(registry, src.source_key, "store_full_text", PURPOSE);
    const { sha, path } = storeArtifact(src.source_key, Buffer.from(content, "utf8"));
    const { rows: [{ doc_id }] } = await client.query(
      `INSERT INTO raw.analyst_documents (source_key, source_id, url, title, author, published_at, doc_type)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 'race_analysis')
       ON CONFLICT (source_key, source_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING doc_id`, [src.source_key, slug, link, title, author, pub ? new Date(pub).toISOString() : null]);
    const ins = await client.query(
      `INSERT INTO raw.analyst_fetches (doc_id, http_status, etag, mime_type, raw_sha256, artifact_path)
       VALUES ($1, $2, $3, 'text/html', $4, $5)
       ON CONFLICT (doc_id, raw_sha256) DO NOTHING RETURNING fetch_id`,
      [doc_id, res.status, res.etag, sha, path]);
    ins.rowCount ? fetched++ : unchanged++;
  }
}
console.log(`substack: ${fetched} new fetch revision(s), ${unchanged} unchanged, ${failed} failed feed(s)`);
await client.end();
process.exit(failed && !fetched ? 1 : 0);
