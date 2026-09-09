# Visuals in chat + a permanent blog home — plan (revision 2, 2026-09-09)

Owner ask: (A) every visual the analyst article needs is available in chat or otherwise; (B) a blog
section on F1 Chat where a post and its visuals live permanently; (C) yellow and red flag conditions
(and SC/VSC) are represented well.

Revision 2 integrates a GPT-5.6 Sol review (REVISE) of draft 1. The architecture survived; the
sequencing, the race-state semantics, the renderer assumptions and the publication gates changed.

## 0. What is true today (verified in code, 2026-09-09; two corrections from review)

| Fact | Where | Consequence |
|---|---|---|
| Chart type is derived from SQL result-row column shape; the LLM never picks a chart | `mapInsight.ts`, `detectors/registry.ts` | A figure cannot be "asked for"; it comes from a deterministic template or a spec built outside chat |
| Caution shading on lap-axis charts comes from `buildCautionBands(rows)` reading `track_flag` per lap from `core.laps_enriched`. Migration 006 derives `track_flag` as the **latest race-control flag message at or before lap end, with no lap-start bound** | `registry.ts:1090`, `006_semantic_lap_layer.sql:241` | VSC rows carry `category='SafetyCar', flag=NULL`, so **VSCs never shade**; sector yellows collapse to a lap-level "Yellow"; a flag can bleed into later laps |
| `race_trace` shades `neutralized_laps` from a 1.25× field-median lap-time heuristic | `raceTrace.ts`, `race-trace-chart.tsx:36` | Heuristic, not record; a short VSC (Monza L28–29) may not trip it |
| `analytics.racing_state_intervals` (062) keeps `start_ts/end_ts`, lap bounds, `endpoint_inferred`, `opened_by_message/closed_by_message` | `062_…sql:168` | Honest source exists; no chart reads it |
| The analyst packet builds its **own** SC/VSC/red intervals in JS (`race_packet.mjs:49`), from which 062 was derived | `lib/packet.mjs` | Two interpreters of the same feed; they can drift |
| Sector yellows are race-control `Flag` messages with `scope=Sector` (Monza: 58) | packet `timeline.events[type=flag_sector]` | Observations (issue messages); the feed has clears, but no interval object exists |
| Chat race trace derives gaps from **cumulative lap durations**; the packet's `position_trace.gap` samples **`raw.intervals`** (~4 s cadence) mapped into laps | `raceTrace.ts:64`, `race_packet.mjs:70` | Different measurements of "gap"; a shared renderer does not make them equal |
| `race-trace-chart.tsx` sets x = index+1 (a lap-20–53 series would be labelled 1–34), joins across missing values, draws pit dots without labels; `position-changes-chart.tsx` dashed bridges mean *missing*, not *carried* | `race-trace-chart.tsx:24`, `position-changes-chart.tsx:81` | Renderers need explicit lap coordinates, point-quality metadata and annotations before the article figures work |
| `ChartSpec` includes types that **fetch live data at render** (`telemetry_overlay` → `/api/lap-telemetry`, `track_speed_map`/track-map → `/api/track-outline`) | `chart-types.ts:187`, `telemetry-overlay-chart.tsx:132` | Not every spec is self-contained; a "permanent" figure must be restricted to embedded-data types or materialised |
| `verify_draft.mjs` checks that a number occurs *somewhere* in the packet and that referenced paths exist; it does not check that a caption's number equals the value at its cited path | `verify_draft.mjs:31` | A wrong driver's value can pass; figure verification must be stricter |
| `/api/saved-analyses` has **no auth and no ownership**: GET lists everything, POST accepts anything | `api/saved-analyses/route.ts:15` | Not a publication surface and not private either; the blog needs its own guarded model |
| `getSessionUserId()` falls back to `"guest"` on any failure | `auth/server.ts:37` | Owner-only routes must use a fail-closed allowlist check, never "not guest" |
| Playwright is a dev dependency; the app deploys as Next 15 serverless; `public/` is baked at build | `package.json` | PNG export is offline, and exported assets need durable storage or a deploy step |

## 1. Design principle (unchanged, with two constraints added)

**One figure spec, two producers, one renderer.** `ChartSpec` stays the contract, fed by chat detectors
(SQL rows) or by a packet→spec compiler. Same renderers, colours, honesty captions. The blog persists
the **spec with data embedded** plus a **static export** of the rendered figure, so neither a matview
rebuild nor a renderer change can silently alter a published figure.

Constraints from review:
- Only **self-contained** chart types may be published (no render-time fetches). The publishable set
  is enumerated in code (`PUBLISHABLE_CHART_TYPES`) and enforced at publish.
- Every published figure carries `spec_version`, `compiler_version`, `renderer_version` and a
  `content_sha256` over spec+caption+alt+provenance.

## 2. Build order: one vertical slice first, then widen

The review's strongest point: prove the chain end to end on the hardest figure before building four
figures, two producers and a blog in parallel. Effort is re-estimated after the slice.

### S1 — Vertical slice: hero figure → verified draft → export → guarded publish → public page (est. 5 d)

**S1.1 Racing-state layer, minimum honest version (1.5 d)**
- Spec: `racing_state.periods[]` = `{kind: sc|vsc|red, start_ts, end_ts|null, from_lap, to_lap|null, endpoint_inferred|null, opened_by, closed_by|null}` — the 062 row, not a lossy lap band. `racing_state.sector_flags[]` = `{lap, sector, level: yellow|double_yellow, issued_at}` labelled as **observations**. `racing_state.source = available | absent | incomplete | failed`.
- **Lap projection and overlap rule** (Monza L3–4 is the test case: SC → red → SC in two laps): periods are drawn in **time order as stacked thin bands at the top of the plot** when they share a lap, and as one full-height band when they do not. Sequence is never collapsed into one "SC/Red" band. Unclosed periods (`to_lap = null`) run to the last lap with the inferred-end glyph.
- **Inferred endpoint**: a visible glyph at the band's right edge (dotted terminal rule + "?" mark), plus one `chart_note` line: "VSC end inferred at end of lap 29 (feed has no VSC ENDED message)". Fading alone was judged too ambiguous; the fade is dropped. Tested in light, dark and PNG.
- **Red flag**: hatched red band, restart rule at the resumption lap. **No unconditional "gaps reset" label** — a discontinuity annotation is drawn only when the plotted metric is actually discontinuous across the red (chat's cumulative-time gap is; the packet's sampled gap is not necessarily).
- **SC vs VSC**: SC solid amber; VSC lighter amber with dashed edges.
- **Sector yellows**: a single **flag strip** under the x-axis, one tick per (lap, sector), single yellow light / double dark, sector number shown on hover and in the PNG legend when ≤ 3 distinct sectors. Ticks mean "a yellow was issued in sector N during lap L", nothing about duration. Per-sector lanes are an expanded mode, not the default (an article figure cannot afford 8+ lanes).
- **Source contract**: `loadRacingState(sessionKey)` reads `analytics.racing_state_intervals` + `raw.race_control` sector flags. Attachment requires a **trusted session key** (deterministic template context or a single distinct `session_key` in the rows); ambiguous or multi-session results get no layer and `source = absent`. `failed` (query error) sets `chart_note` "race-control state unavailable; cautions not shown". `available` with zero periods draws nothing and says nothing.
- **Packet parity**: `race_packet.mjs` reads periods from the 062 view instead of its own builder, with a parity test that the JS builder and the view agree on Monza; the JS builder is kept only for the test until the view has been exercised on three races, then deleted.

**S1.2 Renderer work the hero figure needs (1 d)**
- `race_trace` (and `line`): explicit `x` per point (`lap`), an x-domain, and `point_quality` per value (`observed | carried | missing`) — observed solid, carried dotted, missing gaps not bridged. Pit markers accept a label (`"stop · VSC"`).
- Typed `annotations[]` on lap-axis charts: `{lap, text, kind: deletion|note}` for "L49 track limits, T1".
- The hero figure's metric is defined: **gap between the two drivers** (one line, Antonelli − Russell, sign convention: positive = Antonelli behind), from the packet's sampled `interval` at lap end, with the sampling caveat in `chart_note`. Chat's cumulative-time gap is a different quantity and keeps its own name ("race trace"); the two are never mixed on one axis.

**S1.3 Packet → figure compiler, one recipe (0.5 d)**
`scripts/analyst/figures.mjs --session 11361 --figure gap_trace --drivers RUS,ANT --laps 20-53` writes
`analyst/<meeting>/figures/gap_trace.json` = `{chart, caption, alt, claims[], provenance}`.
Every number on the figure (caption, annotation, marker label) is a `claim` with `{value, packet_path, driver, lap, unit}`. Estimates are drawn as labelled estimates, never as data points.

**S1.4 Figure verifier (0.5 d)**
`verify_draft.mjs --figures`: for each claim, the value at `packet_path` must **equal** the claimed value (unit-aware, tolerance for rounding), driver/lap identity must match, and derived values must recompute from named inputs. This is stricter than the prose pass and is documented as such. The sidecar gets a `figures` block; the prose pass is unchanged.

**S1.5 Blog data model and guarded publish (1 d)**
- Migration 063: `core.blog_post (id, slug unique, status draft|published, current_revision_id, author_user_id, meeting_key, session_key, created_at)`; `core.blog_post_revision (id, post_id, title, dek, body_md, hero_figure_name, content_sha256, verified_sha256|null, verified_at, created_at)`; `core.blog_figure (id, post_id, name, revision_id, chart jsonb, caption, alt, chart_type, spec_version, compiler_version, renderer_version, provenance jsonb, content_sha256, png_light_url, png_dark_url, created_at)`. Figure names are stable per post; `{{fig:name}}` resolves to the figure row bound to the **current revision**. Errata = a new revision (and figure rows) that becomes current; old revisions stay readable at `?rev=`. The permanent URL always shows `current_revision_id`.
- **Verification is bound to content**: `publish_post.mjs` computes `content_sha256` over body + figures + captions + alt + provenance, runs verify_draft (prose + figures), style_lint and similarity guard, and records `verified_sha256`. The publish transition (draft → published) is a single SQL statement that requires `verified_sha256 = content_sha256`. Any edit produces a new revision with `verified_sha256 = null`.
- **Auth**: writes require a Neon Auth session whose user id is in `BLOG_AUTHOR_IDS` (env, fail closed; `"guest"` never passes). The CLI authenticates with a scoped bearer token (`BLOG_PUBLISH_TOKEN`, env) checked server-side; no token → 401.
- **Visibility on every surface**: post page, figure page, JSON, exports and metadata all check `status = published` unless the requester is an allowlisted author with `?preview=1`. The figure route verifies the figure belongs to the requested post's current revision.
- **Markdown**: rendered with a sanitising renderer (no raw HTML); an unresolved `{{fig:…}}` fails the publish gate.

**S1.6 Export and deployment (0.5 d)**
`export_figures.mjs --slug` drives Playwright against `/blog/[slug]/figure/[name]?theme=light|dark` (fixed 1200×675, animations disabled, waits for fonts and hydration, caption included), uploads PNGs to **Vercel Blob** with immutable content-addressed URLs, and writes the URLs to the figure row. `og:image` = hero light PNG. The bare figure page includes `<img>` fallback to the PNG when JS is off.

**S1.7 Public page (0.5 d, inside the slice)**
`/blog/[slug]`: server component, ISR with `revalidateTag('blog:'+slug)` called on publish/revision; previews uncached and `noindex`; canonical URL, OpenGraph/Twitter tags, `/sitemap.xml` includes published posts; theme tokens shared with chat; figures at article width, captions and `chart_note` always visible; alt text is a required field authored in the figure JSON, not copied from the caption.

**Slice acceptance**: `/blog/monza-2026` shows v8 with the hero figure; red L3–4 and SC L3/L4 drawn in sequence, VSC L28–29 with the inferred-end glyph and note, lap-1 sector yellows on the strip; the figure verifier passes with value-at-path checks; the PNGs exist on Blob; the page is public, the draft was not; light and dark correct.

### S2 — Widen to the remaining article figures (est. 1.5 d, re-estimate after S1)
- `closing_rate`: per-lap **pace** delta (lap time Antonelli − Russell), laps 40–48, pit/interrupted laps excluded and said so; needs `lap_s` added to `position_trace` in `lib/packet.mjs`. Named "pace delta", not "gap change".
- `strategy_split`: `stint_gantt` + stop markers with caution class, top 8. Needs the gantt to accept `racing_state`.
- `charge`: `position_changes` for 1–3 drivers with `point_quality` (carried dotted), grid from `grid_penalties`.

### S3 — Chat availability (est. 1.5 d)
- New template `driver_pair_gap_trace` (closes probe gap G5), using the packet's metric definition and the racing-state layer.
- `session_race_trace`, `race_position_changes`, `driver_pair_strategy_split`, `driver_pair_stint_delta` gain the racing-state layer through S1.1 with no other change; `buildCautionBands`/`track_flag` path deleted; `neutralized_laps` heuristic demoted to a `slow_laps` overlay used only when `source = absent`.
- One suggestion chip for interruptions. `a_surface_manifest.json` updated. W0 baseline check (confirm the VSC does not shade today) becomes the first test in this stream.

### S4 — Deferred
- "Add to post" from an insight card: deferred until S1 has exposed the renderer and publication work; when built it must go through the same publishable-type filter, a new revision, and re-verification.
- Track-outline mini-map for sector yellows: only if an article needs "where the yellow was".

## 3. Not proposed
Request-time PNG rendering; LLM-chosen chart types or LLM-authored captions; in-browser figure editing; public authoring.

## 4. Open decisions for the owner
1. URL path: `/blog` or `/analysis`.
2. Racing-state layer on every lap-axis chart for race sessions by default (recommended: yes).
3. Figure footer attribution ("Data: OpenF1") and whether OpenF1 terms need a commercial re-review before the funnel, same class as the YouTube re-review.
4. Vercel Blob for exports (recommended) vs committing PNGs before deploy.

## 5. Effort
S1 ≈ 5 d, S2 ≈ 1.5 d, S3 ≈ 1.5 d → ≈ 8 d for the slice plus widening, with an explicit re-estimate after S1. Draft 1's eight days for the full scope was optimistic; the slice-first order means the owner sees a public Monza post with the hardest figure before the rest is built.
