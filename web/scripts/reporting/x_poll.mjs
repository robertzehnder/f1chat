#!/usr/bin/env node
/**
 * x_poll.mjs — X (pay-per-use) lean-list poller, sessions only.
 *
 *   node scripts/reporting/x_poll.mjs --meeting 2026_1294            # run for the weekend: sleeps until each
 *                                                                     # qualifying / sprint / race window, polls
 *                                                                     # every --interval-min inside it, exits after
 *                                                                     # the last window
 *   node scripts/reporting/x_poll.mjs --meeting 2026_1294 --once      # one poll pass if a window is open now
 *   node scripts/reporting/x_poll.mjs --meeting 2026_1294 --force     # one pass now, last 2 h, ignoring windows
 *   node scripts/reporting/x_poll.mjs --meeting 2026_1294 --dry-run   # print windows + accounts, no API calls
 *   node scripts/reporting/x_poll.mjs --meeting 2026_1294 --resolve   # handles → ids (one user read each), exit
 *
 * Cost discipline (owner decision 2026-09-09): per-account timelines (never
 * search), original posts only, since_id cursors, NO expansions, a hard
 * --max-posts budget per run (default 2000 ≈ $10), and a cost line per poll.
 * Post text goes to the git-ignored raw store only.
 *
 * Env: X_BEARER_TOKEN (app-only) + NEON_DB_* in web/.env.local.
 */
import { join } from "node:path";
import { corpusClient } from "../corpus/lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "../corpus/lib/rights.mjs";
import {
  CONFIG_DIR, X_POST_COST_USD, X_USER_COST_USD, parseMeeting, argOpt, argFlag, rawDir, readJsonl, appendJsonl,
  readJson, writeJson, loadState, saveState, sessionWindows, activeWindow, nextWindow, loadSessions, usd, logCost, sleep
} from "./lib/common.mjs";

const SOURCE = "x_reporters";
const { meeting, meetingKey } = parseMeeting(argOpt("meeting"));
const ONCE = argFlag("once"), FORCE = argFlag("force"), DRY = argFlag("dry-run"), RESOLVE = argFlag("resolve");
const MAX_POSTS = Number(argOpt("max-posts", 2000));
const INTERVAL_MIN = Number(argOpt("interval-min", 10));
const TOKEN = process.env.X_BEARER_TOKEN;
if (!TOKEN && !DRY) { console.error("X_BEARER_TOKEN missing (web/.env.local)"); process.exit(1); }

const accountsPath = join(CONFIG_DIR, "x_accounts.json");
const config = readJson(accountsPath, { accounts: [] });
const accounts = config.accounts.filter((a) => a.enabled !== false);

// rights gate first, then the session windows, then release the DB (long-running loop).
const client = await corpusClient();
const registry = await loadRegistry(client);
assertAcquireAllowed(registry, SOURCE, "x_api_v2");
assertUseAllowed(registry, SOURCE, "store_full_text", "reporting");
const windows = sessionWindows(await loadSessions(client, meetingKey));
await client.end();
if (!windows.length) { console.error(`no qualifying/sprint/race sessions for meeting ${meetingKey}`); process.exit(1); }

async function xget(path, params) {
  const url = new URL(`https://api.x.com/2${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}`, "user-agent": "f1chat-reporting/0.1 (personal research)" } });
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-rate-limit-reset") ?? 0) * 1000;
      const wait = Math.max(5_000, reset - Date.now());
      console.log(`  rate limited; sleeping ${Math.round(wait / 1000)} s`);
      await sleep(wait); continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`X ${res.status} ${path}: ${body.title ?? ""} ${body.detail ?? ""}`.trim());
    return body;
  }
  throw new Error(`X: gave up on ${path} after rate limits`);
}

if (RESOLVE) {
  const valid = (h) => /^[A-Za-z0-9_]{1,15}$/.test(h);
  for (const a of accounts.filter((a) => !valid(a.handle))) console.log(`  ✗ @${a.handle}: not a valid X handle (1–15 chars, letters/digits/_) — skipped`);
  const need = accounts.filter((a) => !a.id && valid(a.handle));
  console.log(`resolving ${need.length} handle(s) (${usd(need.length * X_USER_COST_USD)})`);
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const j = await xget("/users/by", { usernames: chunk.map((a) => a.handle).join(","), "user.fields": "name,description" });
    for (const u of j.data ?? []) {
      const a = config.accounts.find((x) => x.handle.toLowerCase() === u.username.toLowerCase());
      if (a) { a.id = u.id; a.name = u.name; a.description = (u.description ?? "").slice(0, 120); a.resolved_at = new Date().toISOString(); }
    }
    for (const e of j.errors ?? []) console.log(`  ✗ ${e.value ?? ""}: ${e.detail ?? e.title}`);
    logCost(SOURCE, meeting, { op: "resolve", users: chunk.length, usd: chunk.length * X_USER_COST_USD });
  }
  writeJson(accountsPath, config);
  console.table(config.accounts.map((a) => ({ handle: a.handle, id: a.id ?? "—", name: a.name ?? "UNRESOLVED", role: a.role })));
  console.log("check each resolved name is the person intended; remove any that are not.");
  process.exit(0);
}

console.log(`meeting ${meeting}: ${windows.length} paid window(s)`);
for (const w of windows) console.log(`  ${w.session_name.padEnd(18)} ${w.window_start.toISOString()} → ${w.window_end.toISOString()}`);
console.log(`accounts: ${accounts.length} (${accounts.filter((a) => a.id).length} resolved); budget ${MAX_POSTS} posts ≈ ${usd(MAX_POSTS * X_POST_COST_USD)}`);
if (DRY) process.exit(0);

const state = loadState(SOURCE); state.since ??= {};
const rawPath = join(rawDir(SOURCE, meeting), "posts.jsonl");
const seen = new Set(readJsonl(rawPath).map((p) => p.id));
let budget = MAX_POSTS;
const newer = (a, b) => (!a ? b : a.length !== b.length ? (a.length > b.length ? a : b) : a > b ? a : b);

async function pollAccount(a, w) {
  // Cursor per account AND window: the first poll of a window starts at the
  // window start (never back-fills days of posts); later polls use since_id.
  const key = `${a.id}:${w.session_key ?? w.session_name}`;
  const params = { max_results: 100, exclude: "replies,retweets", "tweet.fields": "created_at,lang,public_metrics,entities,conversation_id" };
  if (state.since[key]) params.since_id = state.since[key]; else params.start_time = w.window_start.toISOString();
  let token, got = 0, fresh = 0;
  do {
    if (budget <= 0) break;
    if (token) params.pagination_token = token;
    const j = await xget(`/users/${a.id}/tweets`, params);
    const data = j.data ?? [];
    budget -= data.length; got += data.length;
    for (const t of data) {
      if (seen.has(t.id)) continue;
      seen.add(t.id); fresh++;
      appendJsonl(rawPath, {
        id: t.id, author_id: a.id, handle: a.handle, name: a.name ?? null, role: a.role,
        text: t.text, created_at: t.created_at, lang: t.lang ?? null, public_metrics: t.public_metrics ?? null,
        urls: (t.entities?.urls ?? []).map((u) => u.expanded_url ?? u.url), conversation_id: t.conversation_id ?? null,
        url: `https://x.com/${a.handle}/status/${t.id}`, fetched_via: "x_api_v2", fetched_at: new Date().toISOString()
      });
    }
    if (j.meta?.newest_id) state.since[key] = newer(state.since[key], j.meta.newest_id);
    token = j.meta?.next_token;
  } while (token && budget > 0);
  return { got, fresh };
}

async function pollAll(w) {
  let got = 0, fresh = 0;
  for (const a of accounts) {
    if (!a.id) { console.log(`  skip @${a.handle}: unresolved (run --resolve)`); continue; }
    try { const r = await pollAccount(a, w); got += r.got; fresh += r.fresh; }
    catch (e) { console.log(`  ✗ @${a.handle}: ${e.message}`); }
    if (budget <= 0) { console.log(`  budget of ${MAX_POSTS} posts exhausted — stopping`); break; }
  }
  saveState(SOURCE, state);
  logCost(SOURCE, meeting, { op: "poll", session: w.session_name, posts: got, fresh, usd: got * X_POST_COST_USD, budget_left: budget });
  console.log(`${new Date().toISOString()} ${w.session_name}: ${got} post(s) fetched, ${fresh} new, ${usd(got * X_POST_COST_USD)}; budget left ${budget}`);
}

if (ONCE || FORCE) {
  const w = activeWindow(windows) ?? (FORCE ? { session_name: "forced", window_start: new Date(Date.now() - 2 * 3600_000) } : null);
  if (!w) { console.log("no paid window is open now (use --force for a one-off pass over the last 2 h)"); process.exit(0); }
  await pollAll(w);
  process.exit(0);
}

for (;;) {
  const now = new Date();
  const w = activeWindow(windows, now);
  if (w) {
    await pollAll(w);
    if (budget <= 0) break;
    await sleep(INTERVAL_MIN * 60_000);
    continue;
  }
  const nw = nextWindow(windows, now);
  if (!nw) { console.log("last window closed — done"); break; }
  const wait = Math.min(nw.window_start - now, 30 * 60_000);
  console.log(`${now.toISOString()} idle; next window ${nw.session_name} opens ${nw.window_start.toISOString()} (sleeping ${Math.round(wait / 60_000)} min)`);
  await sleep(wait);
}
