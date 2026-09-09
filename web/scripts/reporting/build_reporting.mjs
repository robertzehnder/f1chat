#!/usr/bin/env node
/**
 * build_reporting.mjs — compile analyst/<meeting>/reporting.json from the raw
 * stores (FIA documents, X and Bluesky posts, registered articles).
 *
 *   node scripts/reporting/build_reporting.mjs --meeting 2026_1293
 *   node scripts/reporting/build_reporting.mjs --meeting 2026_1293 --add-url https://www.formula1.com/... [--role outlet]
 *
 * The committed file carries metadata, links, roles and tiers — and short
 * excerpts for official FIA documents only. Post and article text stays in
 * the git-ignored raw store; the writer request reads it via raw_ref.
 *
 * Tiers: 1 official documents · 2 registered reporting (articles) · 3 sentiment (posts).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { corpusClient } from "../corpus/lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "../corpus/lib/rights.mjs";
import { politeFetch } from "../corpus/lib/http.mjs";
import { ROOT, parseMeeting, argOpt, rawDir, readJson, writeJson, readJsonl, appendJsonl, reportingPath, textOfHtml } from "./lib/common.mjs";

const { meeting, meetingKey } = parseMeeting(argOpt("meeting"));
const rel = (p) => relative(ROOT, p);
const sha10 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 10);

/** hostname → registry source_key for article fetches (html method must be allowed). */
const HOST_SOURCE = { "www.formula1.com": "f1com", "formula1.com": "f1com", "www.the-race.com": "the_race", "the-race.com": "the_race" };

/** Pure: article HTML → { title, published_at, author, text } */
export function parseArticle(html) {
  const meta = (p) => new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]+content="([^"]*)"`, "i").exec(html)?.[1] ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${p}"`, "i").exec(html)?.[1] ?? null;
  const title = textOfHtml(meta("og:title") ?? /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const published_at = meta("article:published_time") ?? /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? null;
  const author = meta("author") ?? meta("article:author") ?? null;
  const bodyHtml = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;
  const text = textOfHtml(bodyHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
  return { title: title.trim(), published_at, author, text };
}

const addUrl = argOpt("add-url");
if (addUrl) {
  const host = new URL(addUrl).hostname;
  const sourceKey = argOpt("source-key") ?? HOST_SOURCE[host];
  if (!sourceKey) { console.error(`no registry source for ${host}; pass --source-key`); process.exit(1); }
  const client = await corpusClient();
  const registry = await loadRegistry(client);
  assertAcquireAllowed(registry, sourceKey, "html");
  assertUseAllowed(registry, sourceKey, "store_full_text", "reporting");
  await client.end();
  const dir = rawDir("articles", meeting);
  const idxPath = join(dir, "index.jsonl");
  const id = `article:${sha10(addUrl)}`;
  if (readJsonl(idxPath).some((a) => a.id === id)) { console.log(`already registered: ${id}`); }
  else {
    const r = await politeFetch(addUrl, { delayMs: 0 });
    if (r.status !== 200) { console.error(`fetch ${r.status}`); process.exit(1); }
    const html = r.body.toString("utf8");
    const a = parseArticle(html);
    writeFileSync(join(dir, `${sha10(addUrl)}.html`), html);
    writeFileSync(join(dir, `${sha10(addUrl)}.txt`), a.text);
    appendJsonl(idxPath, { id, source_key: sourceKey, role: argOpt("role", "outlet"), url: addUrl, title: a.title, author: a.author, published_at: a.published_at, text_file: `${sha10(addUrl)}.txt`, chars: a.text.length, fetched_at: new Date().toISOString() });
    console.log(`  ✅ ${id} ${a.title.slice(0, 80)} (${a.published_at ?? "date unknown"})`);
  }
}

// ---- compile
const entries = [];
const fia = readJson(join(rawDir("fia_documents", meeting), "index.json"), null);
for (const d of fia?.docs ?? []) {
  const txtPath = join(rawDir("fia_documents", meeting), d.text_file);
  const text = existsSync(txtPath) ? readFileSync(txtPath, "utf8") : "";
  // excerpt: skip the letterhead (up to the "Time hh:mm" line), keep 300 chars of body
  const body = text.split(/\nTime\s+\d{2}:\d{2}\s*\n/)[1] ?? text;
  entries.push({
    id: `fia:${meetingKey}:${d.doc_no ?? sha10(d.url)}`, tier: 1, role: "official", kind: "document", source_key: "fia_documents",
    title: d.title, doc_no: d.doc_no, doc_type: d.doc_type, cars: d.cars, url: d.url, published_at: d.published_at,
    excerpt: body.replace(/\s+/g, " ").trim().slice(0, 300), raw_ref: rel(txtPath)
  });
}
for (const a of readJsonl(join(rawDir("articles", meeting), "index.jsonl"))) {
  entries.push({ id: a.id, tier: 2, role: a.role, kind: "article", source_key: a.source_key, title: a.title, author: a.author, url: a.url, published_at: a.published_at, raw_ref: rel(join(rawDir("articles", meeting), a.text_file)) });
}
for (const [sourceKey, prefix] of [["x_reporters", "x"], ["bluesky_reporters", "bsky"]]) {
  const p = join(rawDir(sourceKey, meeting), "posts.jsonl");
  for (const t of readJsonl(p)) {
    entries.push({ id: `${prefix}:${t.id.split("/").pop()}`, tier: 3, role: t.role ?? "reporter", kind: "post", source_key: sourceKey, author: t.name, handle: t.handle, url: t.url, published_at: t.created_at, lang: t.lang ?? null, metrics: t.public_metrics ?? null, fetched_via: t.fetched_via, raw_ref: rel(p) });
  }
}
entries.sort((a, b) => String(a.published_at ?? "").localeCompare(String(b.published_at ?? "")));
const out = { meeting, meeting_key: meetingKey, built_at: new Date().toISOString(), entries };
const path = reportingPath(meeting);
const prev = readJson(path, null);
if (prev && JSON.stringify(prev.entries) === JSON.stringify(entries)) console.log(`unchanged: ${rel(path)} (${entries.length} entries)`);
else { writeJson(path, out); console.log(`✅ ${rel(path)}: ${entries.length} entries — T1 ${entries.filter((e) => e.tier === 1).length}, T2 ${entries.filter((e) => e.tier === 2).length}, T3 ${entries.filter((e) => e.tier === 3).length}`); }
