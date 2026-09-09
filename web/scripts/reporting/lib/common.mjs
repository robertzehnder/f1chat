/**
 * common.mjs — shared pieces for the reporting layer (owner decisions
 * 2026-09-09: tiers T0–T3; X pay-per-use lean list polled only in
 * qualifying / sprint / race windows; everything else on free paths).
 *
 * Raw text from any third-party source lives ONLY under the git-ignored
 * corpus-artifacts/<source_key>/reporting/<meeting>/ store. The committed
 * analyst/<meeting>/reporting.json carries metadata, links and short
 * excerpts of official documents — never a post's text.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..", "..", "..");
export const RAW_ROOT = join(ROOT, "corpus-artifacts");
export const CONFIG_DIR = join(ROOT, "web", "config", "reporting");
export const INBOX_DIR = join(ROOT, "corpus", "inbox");

export const X_POST_COST_USD = 0.005;
export const X_USER_COST_USD = 0.01;

/** `--meeting 2026_1293` → { meeting: "2026_1293", year: 2026, meetingKey: 1293 } */
export function parseMeeting(arg) {
  const m = /^(\d{4})_(\d+)$/.exec(String(arg ?? ""));
  if (!m) throw new Error(`--meeting must look like 2026_1293 (got ${arg})`);
  return { meeting: arg, year: Number(m[1]), meetingKey: Number(m[2]) };
}

export function argOpt(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
export const argFlag = (name) => process.argv.includes(`--${name}`);

export function rawDir(sourceKey, meeting) {
  const d = join(RAW_ROOT, sourceKey.replace(/[^a-z0-9_:-]/gi, "_"), "reporting", meeting);
  mkdirSync(d, { recursive: true });
  return d;
}
export function reportingPath(meeting) {
  return join(ROOT, "analyst", meeting, "reporting.json");
}

export function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export function appendJsonl(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(obj) + "\n");
}
export function readJson(path, dflt) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : dflt;
}
export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 1) + "\n");
}

/** Per-source cursor/state file (since ids, resolved ids) — raw store, not git. */
export function statePath(sourceKey) {
  return join(RAW_ROOT, sourceKey, "reporting", "state.json");
}
export const loadState = (sourceKey) => readJson(statePath(sourceKey), {});
export const saveState = (sourceKey, s) => writeJson(statePath(sourceKey), s);

/** Pure: polling windows for the sessions the owner pays for. Times are Date or ISO. */
export const WINDOW_RULES = {
  Race: { before_min: 30, after_min: 120 },
  Sprint: { before_min: 15, after_min: 60 },
  Qualifying: { before_min: 15, after_min: 60 },
  "Sprint Qualifying": { before_min: 15, after_min: 60 }
};
export function sessionWindows(sessions) {
  return sessions
    .filter((s) => WINDOW_RULES[s.session_name])
    .map((s) => {
      const r = WINDOW_RULES[s.session_name];
      const start = new Date(s.date_start), end = new Date(s.date_end);
      return {
        session_key: String(s.session_key), session_name: s.session_name,
        start, end,
        window_start: new Date(start.getTime() - r.before_min * 60_000),
        window_end: new Date(end.getTime() + r.after_min * 60_000)
      };
    })
    .sort((a, b) => a.window_start - b.window_start);
}
export function activeWindow(windows, now = new Date()) {
  return windows.find((w) => now >= w.window_start && now <= w.window_end) ?? null;
}
export function nextWindow(windows, now = new Date()) {
  return windows.find((w) => w.window_start > now) ?? null;
}

/** Sessions for a meeting from the warehouse (core.sessions). */
export async function loadSessions(client, meetingKey) {
  const { rows } = await client.query(
    "SELECT session_key, session_name, session_type, date_start, date_end FROM core.sessions WHERE meeting_key = $1 ORDER BY date_start",
    [meetingKey]
  );
  return rows;
}
export async function loadMeeting(client, meetingKey) {
  const { rows } = await client.query("SELECT meeting_key, meeting_name, year, date_start FROM core.meetings WHERE meeting_key = $1", [meetingKey]);
  return rows[0] ?? null;
}

export function usd(n) { return `$${n.toFixed(3)}`; }
export function logCost(sourceKey, meeting, rec) {
  appendJsonl(join(rawDir(sourceKey, meeting), "cost.jsonl"), { ts: new Date().toISOString(), ...rec });
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip tags + unescape the handful of entities oEmbed/FIA markup uses. */
export function textOfHtml(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
