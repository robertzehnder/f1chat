# Visuals in chat + a permanent blog home — plan (revision 5, 2026-09-09)

Owner ask: (A) every visual the analyst article needs is available in chat or otherwise; (B) a blog
section on F1 Chat where a post and its visuals live permanently; (C) yellow and red flag conditions
(and SC/VSC) are represented well.

Revision 2 integrated GPT-5.6 Sol pass 1 (REVISE): sequencing, race-state semantics, renderer assumptions
and publication gates changed. Revision 3 integrates pass 2 (REVISE, five targeted items): the pair-gap
metric, revision-owned publication state, export access and gate order, claim-to-spec binding with
coverage, and a full-race acceptance fixture. Revision 4 integrates pass 3 (REVISE, three contracts): the
pair-gap terminal point and lapping test, one shared revision resolver, and claim binding over the whole
figure envelope including captions. Revision 5 integrates pass 4 (REVISE, one item): figure text is
rendered from typed slot bindings so caption numbers are addressable without a language parser.
Pass 5 verdict: **SHIP** (one wording correction to a negative fixture applied). Converged 2026-09-09.

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
- **Sector yellows**: a single **flag strip** under the x-axis, one tick per (lap, sector), single yellow light / double dark. Ticks mean "a yellow was issued in sector N during lap L", nothing about duration. **Collision rule**: ticks for the same lap stack vertically in sector order, up to three rows; a lap with more than three flagged sectors draws one tall tick with a count label ("×5"). Hover shows lap, sector, level and issue time. **Static export**: the legend lists sector numbers when the figure has ≤ 3 distinct sectors; otherwise it reads "sector yellows (n distinct sectors)" and the strip keeps the count labels. Per-sector lanes are an expanded mode, not the default (an article figure cannot afford 8+ lanes).
- **Source contract**: `loadRacingState(sessionKey)` reads `analytics.racing_state_intervals` + `raw.race_control` sector flags. Attachment requires a **trusted session key** (deterministic template context or a single distinct `session_key` in the rows); ambiguous or multi-session results get no layer and `source = absent`. `failed` (query error) sets `chart_note` "race-control state unavailable; cautions not shown". `available` with zero periods draws nothing and says nothing. **`incomplete` trigger**: the view returned rows AND (any period has `endpoint_inferred` not null, OR the session's race-control feed has no CHEQUERED message). Behaviour: every inferred period gets the glyph and its own `chart_note` line; a missing chequered adds "race-control feed ends before the chequered flag; later cautions may be missing". `incomplete` is still drawn; only `failed` and `absent` suppress the layer.
- **Packet parity**: `race_packet.mjs` reads periods from the 062 view instead of its own builder, with a parity test that the JS builder and the view agree on Monza; the JS builder is kept only for the test until the view has been exercised on three races, then deleted.

**S1.2 Renderer work the hero figure needs (1 d)**
- `race_trace` (and `line`): explicit `x` per point (`lap`), an x-domain, and `point_quality` per value (`observed | carried | missing`) — observed solid, carried dotted, missing gaps not bridged. Pit markers accept a label (`"stop · VSC"`).
- Typed `annotations[]` on lap-axis charts: `{lap, text, kind: deletion|note}` for "L49 track limits, T1".
- **Pair-gap definition** (replaces the sampled-interval idea, which measures the gap to whichever car is ahead, not to a named driver): `pair_gap(A, B, L) = date_start(B, L+1) − date_start(A, L+1)` from `raw.laps` — the difference of the two drivers' line-crossing timestamps that end lap L. Sign: positive = B behind A. Missing when either lap row lacks `date_start`. **Terminal point**: lap N (the last lap) has no lap N+1 record, so its crossing time is `date_start(N) + lap_duration(N)` for each driver; if either driver lacks `lap_duration` on lap N the terminal point is missing and the caption says the trace ends at lap N−1 (the packet manifest already flags "final lap end unknown"). **Lapping test** (drivers normally cross at different times, so differing completed-lap counts are not the test): B is a lap down at lap L when `date_start(B, L+1) ≥ date_start(A, L+2)`, i.e. A has started lap L+2 before B finishes lap L; the series stops at the first such L with the point labelled `lapped`. Across a red flag the quantity is discontinuous (the restart resets it), so the discontinuity annotation fires there by rule. Timestamps come from one clock, so no common-sample or freshness rule is needed. One line (Antonelli behind Russell), not two gaps-to-leader.
- The same definition is adopted for chat's `race_trace` in S3 (it currently sums `lap_duration`, which drifts on missing laps and is undefined across the red); until then the two keep separate names and are never mixed on one axis.

**S1.3 Packet → figure compiler, one recipe (0.5 d)**
`scripts/analyst/figures.mjs --session 11361 --figure gap_trace --drivers RUS,ANT --laps 20-53` writes
`analyst/<meeting>/figures/gap_trace.json` = `{chart, caption, alt, claims[], provenance}`.
`lib/packet.mjs` gains a first-class `pair_gaps` series (the definition above, computed for the top-10 pairs the ledger names) so the figure reads a packet path, not a compiler-side calculation. The prose in v8 cites gaps from the sampled `position_trace.gap`; `verify_draft.mjs` reports every cited lap where `pair_gap` and the sampled gap differ by more than 0.1 s, and the owner decides between an erratum and a rewording before the post publishes.
Every number on the figure is a `claim` with `{value, spec_path, packet_path, driver, lap, unit}`. For values inside `chart` (series, bands, markers, domain) `spec_path` is a JSON pointer to the numeric leaf. **Text is not parsed; it is rendered from bindings.** Caption, alt, `chart_note` and annotation text are stored as a template plus typed slots, e.g. `template: "{b} was {gap} behind {a} at lap {lap}"`, `slots: { gap: {packet_path, driver, lap, unit: "s", format: "0.0"}, lap: {...}, a: {driver_ref}, b: {driver_ref} }`. The compiler renders the text from the slots and stores both the template+slots and the rendered string; a slot is the claim, and its `spec_path` is the slot (`/caption/slots/gap`). The same structure applies to alt text, notes and annotations. Estimates are drawn as labelled estimates, never as data points.

**S1.4 Figure verifier (0.5 d)**
`verify_draft.mjs --figures`, two checks per figure:
- **Equality**: for each claim, the value at `spec_path` equals the value at `packet_path` (unit-aware, rounding tolerance); driver/lap identity matches; derived values recompute from named inputs.
- **Text binding**: the verifier re-renders every template from its slots and requires byte equality with the stored rendered text; any digit sequence in the rendered text that did not come from a slot fails as an unbound number (so a hand-typed "2.4 s" cannot slip in). No sentence parsing anywhere.
- **Coverage**: every source-derived numeric leaf in `chart` (series values, band boundaries, marker positions, annotation laps, axis domain) and every slot in caption, alt, `chart_note` and annotation templates is covered by a claim or by a declared derivation rule (e.g. "series `pair_gap` = packet `pair_gaps[RUS,ANT][*].gap`"). An uncovered leaf fails.
- **Negative fixtures** in `scripts/tests/analyst-figures.test.mjs`: change a plotted value with its claim intact → fail; swap drivers → fail; delete a claim → fail; shift a band boundary → fail; change only a caption slot's `packet_path` to another valid path with a different value while leaving the rendered text → fail (byte equality breaks); edit the rendered caption by hand to a number that exists elsewhere in the packet → fail (re-render equality breaks first; the unbound-number rule is a second line, and the fixture asserts rejection, not which diagnostic fired). All six must fail before the verifier is trusted (the last two are the cases the prose verifier cannot catch).
This is stricter than the prose pass and is documented as such. The sidecar gets a `figures` block; the prose pass is unchanged.

**S1.5 Blog data model and guarded publish (1 d)**
- Migration 063: `core.blog_post (id, slug unique, published_revision_id|null, author_user_id, meeting_key, session_key, created_at)`; `core.blog_post_revision (id, post_id, title, dek, body_md, hero_figure_name, content_sha256, verified_sha256|null, verified_at, published_at|null, created_at)`; `core.blog_figure (id, revision_id, name, chart jsonb, caption, alt, chart_type, spec_version, compiler_version, renderer_version, provenance jsonb, content_sha256, png_light_url, png_dark_url, png_light_sha256, png_dark_sha256, created_at)`. **Publication state belongs to revisions**: a post is public iff `published_revision_id` is set; a revision is public iff its `published_at` is set. Editing creates a new candidate revision and never touches the pointer. Promotion is one statement: set `published_at` on the candidate and move `published_revision_id`, guarded by `verified_sha256 = content_sha256` and by the export check below. `{{fig:name}}` resolves against the revision being rendered; `?rev=` resolves only revisions with `published_at` set, and figures/JSON/metadata for a candidate revision of a public post are unreachable without author preview. A test covers exactly that case. Errata = a new candidate promoted the same way; the permanent URL shows `published_revision_id`.
- **Verification is bound to content**: `publish_post.mjs` computes `content_sha256` over body + figures + captions + alt + provenance, runs verify_draft (prose + figures), style_lint and similarity guard, and records `verified_sha256`. The publish transition (draft → published) is a single SQL statement that requires `verified_sha256 = content_sha256`. Any edit produces a new revision with `verified_sha256 = null`.
- **Auth**: writes require a Neon Auth session whose user id is in `BLOG_AUTHOR_IDS` (env, fail closed; `"guest"` never passes). The CLI authenticates with a scoped bearer token (`BLOG_PUBLISH_TOKEN`, env) checked server-side; no token → 401.
- **One shared revision resolver** used by every surface (post page, figure page, JSON, export rendering, metadata): `resolveRevision(slug, rev?, credentials)` returns (a) `published_revision_id` when `rev` is absent; (b) the requested revision when it belongs to the post and has `published_at` set; (c) a candidate revision of the post only when the credentials are an allowlisted author session or the publish bearer token; otherwise 404. Figures are always resolved against the revision the resolver selected, never against "current". The acceptance tests exercise all three paths plus the failure case (candidate without credentials).
- **Markdown**: rendered with a sanitising renderer (no raw HTML); an unresolved `{{fig:…}}` fails the publish gate.

**S1.6 Export and deployment (0.5 d)**
`export_figures.mjs --slug --rev` renders the **candidate** revision: it sends the `BLOG_PUBLISH_TOKEN` bearer as a request header and the figure route accepts it as author preview (same check as `?preview=1`), so no unauthenticated draft route exists. Playwright renders `/blog/[slug]/figure/[name]?rev=<candidate>&theme=light|dark` (fixed 1200×675, animations disabled, waits for fonts and hydration, caption included), uploads to **Vercel Blob** under unguessable content-addressed paths, and writes URL + sha256 to the figure row. **Order**: export runs after the gates and before promotion; promotion additionally requires both PNGs present with recorded hashes matching the uploaded bytes, so a published revision is bound to its exact artifacts. No unauthenticated surface ever emits a candidate revision's PNG URL; if the Vercel plan offers private Blob access, draft uploads use it (decision 5). `og:image` = hero light PNG of the published revision. The bare figure page includes `<img>` fallback to the PNG when JS is off.

**S1.7 Public page (0.5 d, inside the slice)**
`/blog/[slug]`: server component, ISR with `revalidateTag('blog:'+slug)` called on publish/revision; previews uncached and `noindex`; canonical URL, OpenGraph/Twitter tags, `/sitemap.xml` includes published posts; theme tokens shared with chat; figures at article width, captions and `chart_note` always visible; alt text is a required field authored in the figure JSON, not copied from the caption.

**Slice acceptance** (two figures, because the hero's lap-20–53 domain cannot show laps 1–4):
- Hero `gap_trace` (laps 20–53): VSC L28–29 with the inferred-end glyph and note; stop markers labelled by class; L49 deletion annotation; verifier passes equality and coverage.
- Full-race fixture `charge` (position trace, laps 1–53, Antonelli ± Russell): red L3–4 hatched with restart rule, SC L3 and L4 stacked in time order, lap-1 sector yellows on the strip with the collision rule exercised (Monza lap 1 has four flagged sectors → count label). This figure is built in S1, not S2, because it is the racing-state layer's acceptance test.
- `/blog/monza-2026` shows v8 with both figures; PNGs on Blob with matching hashes; the page is public; the resolver's three paths and the unauthenticated-candidate 404 are tested; the hero's lap-53 point is present only if both drivers' lap-53 durations exist, and the caption states where the trace ends; light and dark correct.

### S2 — Widen to the remaining article figures (est. 1 d, re-estimate after S1)
- `closing_rate`: per-lap **pace** delta (lap time Antonelli − Russell), laps 40–48, pit/interrupted laps excluded and said so; needs `lap_s` added to `position_trace` in `lib/packet.mjs`. Named "pace delta", not "gap change".
- `strategy_split`: `stint_gantt` + stop markers with caution class, top 8. Needs the gantt to accept `racing_state`.

### S3 — Chat availability (est. 1.5 d)
- New template `driver_pair_gap_trace` (closes probe gap G5), using the packet's metric definition and the racing-state layer.
- `session_race_trace`, `race_position_changes`, `driver_pair_strategy_split`, `driver_pair_stint_delta` gain the racing-state layer through S1.1 with no other change; `buildCautionBands`/`track_flag` path deleted; `neutralized_laps` heuristic demoted to a `slow_laps` overlay used only when `source = absent`.
- One suggestion chip for interruptions. `a_surface_manifest.json` updated. W0 baseline check (confirm the VSC does not shade today) becomes the first test in this stream.

### S4 — Deferred
- "Add to post" from an insight card: deferred until S1 has exposed the renderer and publication work; when built it must go through the same publishable-type filter, a new revision, and re-verification.
- Track-outline mini-map for sector yellows: only if an article needs "where the yellow was".

## 3. Not proposed
Request-time PNG rendering; LLM-chosen chart types or LLM-authored captions; in-browser figure editing; public authoring.

## 4. Owner decisions (taken 2026-09-09)
1. URL path: **`/blog`**.
2. Racing-state layer on every lap-axis chart for race sessions by default: **yes**.
3. Figure footer attribution "Data: OpenF1": **add it**; no licensing check requested.
4. Exports to **Vercel Blob** (owner must create the store and add `BLOB_READ_WRITE_TOKEN` to `web/.env.local` before S1.6).
5. Candidate-revision exports: **private Blob access if the installed `@vercel/blob` supports it, else unguessable content-addressed paths + the no-emission rule** (my call, delegated).

## 5. Effort
S1 ≈ 5.5 d (the full-race fixture and the packet `pair_gaps` series moved in), S2 ≈ 1 d, S3 ≈ 1.5 d → ≈ 8 d for the slice plus widening, with an explicit re-estimate after S1. Draft 1's eight days for the full scope was optimistic; the slice-first order means the owner sees a public Monza post with the hardest figure before the rest is built.
