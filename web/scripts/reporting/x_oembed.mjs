#!/usr/bin/env node
/**
 * x_oembed.mjs — resolve hand-picked X posts (free, official oEmbed endpoint).
 *
 * Drop post URLs one per line into corpus/inbox/x_urls.txt (a share-sheet
 * shortcut can append there; `#` lines are comments), then:
 *
 *   node scripts/reporting/x_oembed.mjs --meeting 2026_1294
 *
 * Each URL is resolved via https://publish.x.com/oembed (author, date, text)
 * into the raw store for the meeting; processed lines move to
 * corpus/inbox/x_urls.done.txt. No API key, no cost.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { corpusClient } from "../corpus/lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "../corpus/lib/rights.mjs";
import { INBOX_DIR, parseMeeting, argOpt, rawDir, readJsonl, appendJsonl, textOfHtml, sleep } from "./lib/common.mjs";

const SOURCE = "x_reporters";
const { meeting } = parseMeeting(argOpt("meeting"));
const inbox = join(INBOX_DIR, "x_urls.txt");
const done = join(INBOX_DIR, "x_urls.done.txt");
const lines = existsSync(inbox) ? readFileSync(inbox, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
if (!lines.length) { console.log(`nothing to resolve (${inbox})`); process.exit(0); }

const client = await corpusClient();
const registry = await loadRegistry(client);
assertAcquireAllowed(registry, SOURCE, "x_oembed");
assertUseAllowed(registry, SOURCE, "store_full_text", "reporting");
await client.end();

/** Pure: oEmbed payload → post record (exported for tests via --self-test). */
export function parseOembed(j, url) {
  const id = /status\/(\d+)/.exec(url)?.[1] ?? null;
  const html = j.html ?? "";
  const text = textOfHtml(/<p[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "");
  const handle = /x\.com\/([A-Za-z0-9_]+)/.exec(j.author_url ?? "")?.[1] ?? null;
  const dateText = [...html.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]).pop() ?? null;
  const d = dateText ? new Date(dateText) : null;
  return {
    id, handle, name: j.author_name ?? null, text, created_at: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null, created_text: dateText,
    url: j.url ?? url, fetched_via: "x_oembed", fetched_at: new Date().toISOString()
  };
}

const rawPath = join(rawDir(SOURCE, meeting), "posts.jsonl");
const seen = new Set(readJsonl(rawPath).map((p) => p.id));
const remaining = [];
for (const url of lines) {
  if (!/^(https?:\/\/)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(url)) { console.log(`  ✗ not a post URL: ${url}`); remaining.push(url); continue; }
  try {
    const res = await fetch(`https://publish.x.com/oembed?omit_script=true&url=${encodeURIComponent(url)}`, { headers: { "user-agent": "f1chat-reporting/0.1 (personal research)" } });
    if (!res.ok) throw new Error(`oembed ${res.status}`);
    const rec = parseOembed(await res.json(), url);
    if (!rec.id) throw new Error("no post id");
    if (!seen.has(rec.id)) { appendJsonl(rawPath, { ...rec, role: "hand-picked" }); seen.add(rec.id); }
    appendFileSync(done, `${new Date().toISOString()} ${url}\n`);
    console.log(`  ✅ @${rec.handle} ${rec.created_at ?? ""}: ${rec.text.slice(0, 70).replace(/\n/g, " ")}`);
  } catch (e) { console.log(`  ✗ ${url}: ${e.message}`); remaining.push(url); }
  await sleep(400);
}
writeFileSync(inbox, remaining.length ? remaining.join("\n") + "\n" : "");
console.log(`${lines.length - remaining.length} resolved, ${remaining.length} left in the inbox`);
