#!/usr/bin/env node
/**
 * fetch_youtube.mjs — Palmer's Analysis caption fetcher (corpus G3).
 *
 * GATED source: youtube:formula1 is approved_private by user decision
 * (2026-09-06) — private research only, ~30 videos/season cap (registry
 * config), raw VTT under 30-day retention. Every run re-checks the registry;
 * flipping rights_state kills this path.
 *
 * Discovery: one yt-dlp search per completed race meeting for the official
 * FORMULA 1 channel's "Jolyon Palmer's F1 TV Analysis" video; the linker's
 * alias check on the title is the safety net against search mismatches.
 * Auto-captions (en) are stored as the raw VTT artifact; caption_dedup +
 * llm_cleanup derivations happen downstream.
 *
 * Usage: node scripts/corpus/fetch_youtube.mjs [--season 2026] [--limit N]
 * Needs: yt-dlp on PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "./lib/rights.mjs";
import { storeArtifact } from "./lib/artifacts.mjs";
import { loadRaceMeetings } from "./lib/meetings.mjs";

const SRC = "youtube:formula1";
const PURPOSE = "style_research";
const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const limit = Number(process.argv.find((a, i) => process.argv[i - 1] === "--limit") ?? Infinity);

// Search-friendly GP names per circuit (title matching is loose; the linker verifies).
const GP_NAME = {
  "Melbourne": "Australian", "Shanghai": "Chinese", "Suzuka": "Japanese", "Miami": "Miami",
  "Montreal": "Canadian", "Monte Carlo": "Monaco", "Catalunya": "Spanish", "Spielberg": "Austrian",
  "Silverstone": "British", "Spa-Francorchamps": "Belgian", "Hungaroring": "Hungarian",
  "Zandvoort": "Dutch", "Monza": "Italian", "Madring": "Madrid", "Baku": "Azerbaijan",
  "Singapore": "Singapore", "Austin": "United States", "Mexico City": "Mexico City",
  "Interlagos": "Sao Paulo", "Las Vegas": "Las Vegas", "Lusail": "Qatar",
  "Yas Marina Circuit": "Abu Dhabi", "Kuala Lumpur": "Malaysian"
};

const client = await corpusClient();
const registry = await loadRegistry(client);
assertAcquireAllowed(registry, SRC, "yt_dlp_captions");
const { rows: [srcRow] } = await client.query(`SELECT config FROM raw.analyst_sources WHERE source_key = $1`, [SRC]);
const seasonCap = srcRow.config.max_videos_per_season ?? 30;

const { rows: [{ n: alreadyThisSeason }] } = await client.query(
  `SELECT COUNT(*)::int AS n FROM raw.analyst_documents
   WHERE source_key = $1 AND published_at >= make_date($2, 1, 1)`, [SRC, season]);

const meetings = (await loadRaceMeetings(client, season)).filter((m) => m.raceStart < new Date());
console.log(`youtube: ${meetings.length} completed meeting(s); ${alreadyThisSeason}/${seasonCap} season cap used`);

let fetched = 0, skipped = 0, failed = 0, capUsed = alreadyThisSeason;
for (const m of meetings.slice(0, limit)) {
  if (capUsed >= seasonCap) { console.log("  season cap reached — stopping"); break; }
  const gp = GP_NAME[m.circuit] ?? m.circuit;
  const sourceIdPrefix = `palmer:${season}:${m.meetingKey}`;
  const { rows: [existing] } = await client.query(
    `SELECT doc_id FROM raw.analyst_documents WHERE source_key = $1 AND source_id LIKE $2 || '%'`,
    [SRC, sourceIdPrefix]);
  if (existing) { skipped++; continue; }

  let picked = null;
  try {
    const out = execFileSync("yt-dlp", [
      "--flat-playlist", "--print", "%(id)s\t%(title)s\t%(channel)s",
      `ytsearch5:Jolyon Palmer F1 TV Analysis ${gp} Grand Prix ${season}`
    ], { encoding: "utf8", timeout: 120e3 });
    for (const line of out.trim().split("\n")) {
      const [id, title, channel] = line.split("\t");
      if (channel === "FORMULA 1" && /palmer/i.test(title) && /analysis/i.test(title)) { picked = { id, title }; break; }
    }
  } catch (e) { console.error(`  ! search ${gp}: ${e.message.slice(0, 120)}`); failed++; continue; }
  if (!picked) { console.log(`  - ${gp}: no Palmer video found`); continue; }
  // Same VIDEO already ingested under another meeting's search (search
  // sometimes returns an adjacent GP's video) — never ingest a video twice;
  // the linker assigns the meeting from the title, not the search term.
  const { rows: [dupe] } = await client.query(
    `SELECT doc_id FROM raw.analyst_documents WHERE source_key = $1 AND source_id LIKE '%:' || $2`,
    [SRC, picked.id]);
  if (dupe) { console.log(`  - ${gp}: video ${picked.id} already ingested`); skipped++; continue; }

  const tmp = mkdtempSync(join(tmpdir(), "corpus-yt-"));
  try {
    const metaOut = execFileSync("yt-dlp", [
      "--skip-download", "--write-auto-sub", "--sub-lang", "en",
      "--print", "%(upload_date)s\t%(title)s", "--no-simulate",
      "-o", join(tmp, "cap"), `https://www.youtube.com/watch?v=${picked.id}`
    ], { encoding: "utf8", timeout: 180e3 });
    const [uploadDate, fullTitle] = metaOut.trim().split("\t");
    const vttFile = readdirSync(tmp).find((f) => f.endsWith(".vtt"));
    if (!vttFile) { console.log(`  - ${gp}: no auto-captions on ${picked.id}`); continue; }
    const vtt = readFileSync(join(tmp, vttFile));

    assertUseAllowed(registry, SRC, "store_full_text", PURPOSE);
    const { sha, path } = storeArtifact(SRC, vtt);
    const publishedAt = uploadDate?.match(/^\d{8}$/)
      ? `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}T12:00:00Z` : null;
    const { rows: [{ doc_id }] } = await client.query(
      `INSERT INTO raw.analyst_documents (source_key, source_id, url, title, author, published_at, doc_type)
       VALUES ($1, $2, $3, $4, 'Jolyon Palmer', $5::timestamptz, 'transcript')
       ON CONFLICT (source_key, source_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING doc_id`,
      [SRC, `${sourceIdPrefix}:${picked.id}`, `https://www.youtube.com/watch?v=${picked.id}`, fullTitle ?? picked.title, publishedAt]);
    await client.query(
      `INSERT INTO raw.analyst_fetches (doc_id, http_status, mime_type, raw_sha256, artifact_path)
       VALUES ($1, 200, 'text/vtt', $2, $3)
       ON CONFLICT (doc_id, raw_sha256) DO NOTHING`, [doc_id, sha, path]);
    fetched++; capUsed++;
    console.log(`  + ${gp}: ${picked.id} "${(fullTitle ?? picked.title).slice(0, 60)}"`);
  } catch (e) {
    console.error(`  ! caps ${gp}/${picked.id}: ${e.message.slice(0, 120)}`); failed++;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(`youtube: ${fetched} new transcript(s), ${skipped} already present, ${failed} failed`);
await client.end();
process.exit(failed && !fetched ? 1 : 0);
