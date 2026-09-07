# G0 Capability Matrix + Rights Registry (2026-09-06)

G0 exit artifact for diagnostic/analyst-corpus-ingestion-plan-2026-09-06.md.
Step 1 (no-fetch preflight: ToS/robots read, user sign-offs) and Step 2 (probe
of approved sources across Spielberg [ordinary, 1288], Zandvoort [sprint,
1292], Spa→Hungaroring [double-header, 1290/1291]) are COMPLETE.
**G0 EXIT: PASS.** Schema and estimates may now lock (G1 next).

## Rights registry — FINAL rows (user signed off 2026-09-06)

| source_key | rights_state | approved_uses | allowed_methods | full_text | llm | retention | rights_basis (risk decision by owner, not permission) |
|---|---|---|---|---|---|---|---|
| the_race | approved_private | style_research, eval_reference | {rss, md_endpoint, sitemap} | yes | yes | indefinite | Terms = personal-use license, no scraping/TDM clause; robots permissive; **site publishes /llms.txt explicitly offering "Public Ghost content for AI and LLM tooling"** + `.md` endpoints — strongest possible signal short of a license. Commercial re-review gate stands. |
| f1com | approved_private | style_research, eval_reference | {sitemap, html} | yes | yes | indefinite | Legal notices = personal, non-commercial; automation clause is App-specific; no TDM clause; robots permissive with published sitemap. Commercial re-review gate stands. |
| substack:f1debrief | approved_private | style_research, eval_reference | {rss} | yes | yes | indefinite | Substack ToS bans page crawling and storing "any significant portion" of platform content; RSS is published for syndication, volume is one newsletter's free posts (~40/yr) — not a significant portion. RSS ONLY, never HTML. |
| youtube:formula1 | approved_private | style_research, eval_reference | {yt_dlp_captions} | yes (VTT: 30d) | yes | VTT 30d, transcripts indefinite | **User decision 2026-09-06: approved for private research.** yt-dlp captions are not an authorized API path (YouTube ToS permits access only "as expressly authorized"); risk accepted at ~30 videos/season, no republication, raw VTT purged at 30 days, HARD re-review before any commercial/public use of transcript-derived text. |
| reddit | **prohibited** | question_mining (manual only) | {} | no | no | — | **User decision 2026-09-06: manual substitute confirmed.** API terms restrict AI use of user content + deletion flow-down incompatible with immutable snapshots. Substitute: hand-written per-race question notes in corpus/questions/ (owner's own words, no stored user content). |
| x_exemplars | approved_private | format_study | {manual_inbox} | yes | no (format notes only) | indefinite | Manual screenshots for format study only; never enters distillation/eval (purpose-gated). |

## Capability matrix (probe evidence in scratchpad g0probe/; all fetches with descriptive UA + contact email)

### the_race (Ghost CMS on Fastly)
- **Discovery:** `/rss/` (301 from /feed/) — 15 items, FULL TEXT in content:encoded (3–9K chars), dc:creator authors, GMT pubDates. Backfill/history: `/sitemap-posts.xml` — **24,400 posts back to 2023**, 14,474 under /formula-1/, lastmod per URL.
- **Content:** append `.md` to any post URL → clean markdown WITH metadata header: canonical URL, **Published AND Updated timestamps** (correction detection solved), Author, Tags incl. GP-specific tags like `#italian-grand-prix` (linker evidence solved). No HTML parsing needed.
- **Conditional GET:** honored — If-None-Match returned **304** (verified).
- **Stable identity:** Ghost object-id GUIDs in RSS; canonical URLs in .md header.
- **Author coverage (per-race, probe weekends):** Edd Straw driver rankings = stable slug `f1-<year>-<gp>-driver-rankings-edd-straw`, present for ALL FOUR probe weekends. Mark Hughes = 453 posts, race-report slugs present for Dutch(6)/Belgian(5)/Hungarian(4)/Austrian(3); Monza piece not yet published on race night (typical Monday landing → linker window +7d correct). Gary Anderson tech pieces present.
- **Expected coverage:** 100+ posts per GP weekend; every 2026 round covered.
- **Failure modes observed:** author RSS (`/author/<slug>/rss/`) redirects to homepage — per-author discovery must go through sitemap + slug/author filter. `/llms-full.txt` exists but is bulk — avoid (curation over crawling).

### f1com (Next.js App Router behind Fastly)
- **Discovery:** `/en/latest/article/sitemap.xml` → 33 chunk sitemaps × ~1,000 entries, lastmod fresh to race night. Chunks are NOT chronological — weekly scan filters all chunks by lastmod window (33 cheap requests).
- **Content:** article body is NOT in rendered markup but IS fully embedded in the initial HTML via `self.__next_f.push` flight-data chunks (verified: full Dutch GP strategy-guide text recovered from one plain GET). Parser: decode escaped chunks (mind UTF-8 mojibake: decode escapes then latin-1→utf-8), extract rich-text nodes. ld+json NewsArticle carries datePublished/**dateModified** (correction detection).
- **Session classification:** slug/title patterns (`strategy-guide-…`, `facts-and-stats-…`, qualifying/sprint wording). Facts & Stats slugs not present in the two probed chunks — confirm pattern during G2 full-chunk scan (flagged, not blocking).
- **Expected coverage:** strategy guide per race confirmed; 40–55 articles per GP.
- **Failure modes:** flight-data format is a Next.js internal — parser MUST have fixture tests; a site rebuild will break it loudly.

### substack:f1debrief (Rory Mitchell, f1debrief.substack.com)
- **Discovery/content:** `/feed` — 20 items, FULL TEXT (16–25K chars), ETag present. Active and near-per-race: Monza quali piece Sep 5, Zandvoort Aug 25, Hungary Jul 25.
- **Expected coverage:** most but not all rounds (~1 piece/week) — coverage baseline "most races", full-accounting gate handles gaps.
- **Notes:** "Musings on Formula 1" (formula1.substack.com) probed DORMANT (last post Nov 2023) — excluded. Additional newsletters get their own registry rows when found; discovery is manual curation (Substack search is weak).

### youtube:formula1 (FORMULA 1 channel, Palmer's Analysis)
- **Tooling:** yt-dlp installed (brew). Palmer 2026 Dutch GP analysis located on the FORMULA 1 channel (id t3bQZDeI_2A, uploaded 2026-08-25, 20 min).
- **Captions:** `en` + `en-orig` auto-captions available in vtt/srt/json3 (verified; sample VTT downloaded, 225KB). Rolling-duplicate cue structure confirmed → the plan's `caption_dedup` (verbatim de-dup, keep timestamps) is exactly right.
- **Discovery:** channel/playlist flat-list + title filter ("Jolyon Palmer's F1 TV Analysis" naming is consistent).
- **Expected coverage:** per-race Palmer videos; Tech Talk most weekends.
- **Retention control:** raw VTT retention_days=30 per registry; normalized transcript retained.

## Probe-weekend selection (from core.sessions)
- Ordinary: Spielberg, meeting_key 1288 (2026-06-26)
- Sprint: Zandvoort, meeting_key 1292 (2026-08-21)
- Double-header: Spa 1290 (2026-07-17) → Hungaroring 1291 (2026-07-24)

## Notable side-findings
- The Race's llms.txt + `.md` endpoints remove the HTML-normalization work for
  our highest-value source entirely; `normalize_md` for the_race is a
  metadata-header parse, not an HTML strip.
- 2026 season color (from probe content, for later eval sanity checks):
  Antonelli won Monza from 19th after a Leclerc red-flag crash; Gasly took a
  shock Alpine pole; Norris won the Dutch GP after a Verstappen crash;
  title fight involves Russell/Norris/Antonelli; Tsunoda standing in at
  Racing Bulls; Audi/Cadillac on grid.

## G0 exit checklist
- [x] No-fetch preflight before any probe (ToS/robots read first; probes only on approved sources)
- [x] User sign-off: YouTube → approved_private; Reddit → prohibited + manual substitute
- [x] Capability matrix written (this doc)
- [x] Discovery, full-text, identity, correction-detection, conditional-GET, session-scope evidence, coverage baseline per source
- [x] Registry rows final
- [ ] G1: migration 061 (full sqitch set), enforcement helpers + refusal tests, purge round-trip
