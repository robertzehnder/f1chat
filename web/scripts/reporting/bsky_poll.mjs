#!/usr/bin/env node
/**
 * bsky_poll.mjs — Bluesky curated list, free public API (no auth, no cost).
 *
 *   node scripts/reporting/bsky_poll.mjs --meeting 2026_1294              # posts since the meeting's first session − 1 day
 *   node scripts/reporting/bsky_poll.mjs --meeting 2026_1294 --since 2026-09-11T00:00:00Z
 *   node scripts/reporting/bsky_poll.mjs --search "the race"              # find handles for web/config/reporting/bluesky_accounts.json
 *
 * Original posts only (no replies); reposts skipped. Text goes to the raw store.
 */
import { join } from "node:path";
import { corpusClient } from "../corpus/lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "../corpus/lib/rights.mjs";
import { CONFIG_DIR, parseMeeting, argOpt, rawDir, readJsonl, appendJsonl, readJson, loadSessions, sleep } from "./lib/common.mjs";

const SOURCE = "bluesky_reporters";
const API = "https://public.api.bsky.app/xrpc";
const UA = { "user-agent": "f1chat-reporting/0.1 (personal research)" };

const search = argOpt("search");
if (search) {
  const j = await (await fetch(`${API}/app.bsky.actor.searchActors?q=${encodeURIComponent(search)}&limit=10`, { headers: UA })).json();
  console.table((j.actors ?? []).map((a) => ({ handle: a.handle, name: a.displayName ?? "", followers: a.followersCount ?? "", bio: (a.description ?? "").replace(/\s+/g, " ").slice(0, 60) })));
  process.exit(0);
}

const { meeting, meetingKey } = parseMeeting(argOpt("meeting"));
const client = await corpusClient();
const registry = await loadRegistry(client);
assertAcquireAllowed(registry, SOURCE, "bsky_public_api");
assertUseAllowed(registry, SOURCE, "store_full_text", "reporting");
const sessions = await loadSessions(client, meetingKey);
await client.end();
const since = new Date(argOpt("since") ?? new Date(new Date(sessions[0]?.date_start ?? Date.now()).getTime() - 24 * 3600_000));

const accounts = readJson(join(CONFIG_DIR, "bluesky_accounts.json"), { accounts: [] }).accounts.filter((a) => a.enabled !== false);
const rawPath = join(rawDir(SOURCE, meeting), "posts.jsonl");
const seen = new Set(readJsonl(rawPath).map((p) => p.id));
let fresh = 0;
for (const a of accounts) {
  let cursor, pages = 0;
  do {
    const u = new URL(`${API}/app.bsky.feed.getAuthorFeed`);
    u.searchParams.set("actor", a.handle); u.searchParams.set("limit", "100"); u.searchParams.set("filter", "posts_no_replies");
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u, { headers: UA });
    if (!res.ok) { console.log(`  ✗ ${a.handle}: ${res.status}`); break; }
    const j = await res.json();
    let older = false;
    for (const item of j.feed ?? []) {
      if (item.reason) continue; // repost
      const p = item.post, rec = p.record ?? {};
      const created = new Date(rec.createdAt);
      if (created < since) { older = true; continue; }
      if (seen.has(p.uri)) continue;
      seen.add(p.uri); fresh++;
      appendJsonl(rawPath, {
        id: p.uri, handle: p.author?.handle ?? a.handle, name: p.author?.displayName ?? null, role: a.role, text: rec.text ?? "",
        created_at: rec.createdAt, lang: (rec.langs ?? [])[0] ?? null,
        public_metrics: { likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0, replies: p.replyCount ?? 0 },
        url: `https://bsky.app/profile/${p.author?.handle ?? a.handle}/post/${p.uri.split("/").pop()}`, fetched_via: "bsky_public_api", fetched_at: new Date().toISOString()
      });
    }
    cursor = older ? null : j.cursor; pages++;
    await sleep(300);
  } while (cursor && pages < 20);
  console.log(`  ${a.handle}: done`);
}
console.log(`${fresh} new post(s) since ${since.toISOString()} → ${rawPath}`);
