# ✅✅ COMPLETE (2026-07-04) — all 5 final items applied + LIVE-verified

**The migration is done.** The final 5 items (A4, A3, A5, B19, B17) were applied per
`FINAL_EXECUTION_PLAN.md`, typecheck/router/mapInsight gates all green, and every card was
verified through the REAL chat UI (port 3000):
- **A4** — per-driver lanes + kind glyphs over the L{min}..L{max} ruler (São Paulo); corner pin honestly
  declines when the outline has no `corners[]` (Interlagos).
- **A3** — 24-circuit venue coverage grid (R1..R24) + "All clear" banner + Complete/Partial/Gap legend.
- **A5** — `corner_delta_grid` track-map nodes + entry/apex/exit tiles + diverging apex-delta ladder;
  `at_a_glance` (NO YES/NO badge — the P0 fix). Abu Dhabi, drivers 1 & 16.
- **B19** — session-type donut ("120 total", 3-slice); dead `timeline`/`delta_comparison` removed; M15→event_timeline.
- **B17** — ClarificationCard renders on `sessionCandidates>=2`; clicking an option re-sends `(session <key>)`
  and returns a real answer. Live trigger: *"What was the fastest lap in practice at Imola?"*

**One live bug found + fixed:** A3 `telemetryWeatherGap` SQL had a `;` inside a `--` comment →
`querySafety` "single SQL statement" rejection. Removed the semicolon; re-verified live. (tsc/router tests
don't catch this — only a live query does.)

**Known pre-existing (NOT this work):** `answer-cache.test.mjs` 6/9 red — its transpile harness never
stubs `orchestration.ts` (route.ts now re-exports from it). Spawned a fix task.

**Still nothing committed** — commit only when the user asks. Branch `ui/v0-frontend-replacement`.

---

# ▶▶ (historical) RESUME HERE (post-compaction handoff, 2026-07-04)

**Goal:** finish migrating the Claude Design deck into code, using the app's REAL runtime geometry, wave
by wave, `/2ndopinion`-gated. All changes are in the working tree on branch `ui/v0-frontend-replacement`
— **nothing committed** (commit only when the user asks).

### DONE + verified (do NOT redo)
- **Foundation** (`globals.css` near-black tokens + dual red, shell mono eyebrows / glow dot /
  `at_a_glance` slot, mono metric tiles, color sweep) — SHIP.
- **Wave 1** (glance-everywhere derive in `toCardProps.ts`, verdict pill, reasoning `— N rows · Xms`,
  ranked-bar leader emphasis, diverging winner emphasis, donut readout, no-data restyle) — SHIP.
- **Wave 2** (grouped-bar tick rounding, degradation cliff markers, race-trace dimming, radar caption,
  composite sections) — SHIP.
- **Wave 3 foundation:** `<TrackMap>` extended with `markers` (node pin) + `variant="mini"` +
  `showCornerLabels/showStartFinish/className`. Backward-compatible (3 existing callers use defaults).
- **A2 telemetry biggest-Δ minimap** — client-only, LIVE-verified (smoothing fixed a +89→+32 kph artifact).
- **A1 corner-on-map DISPLAY** — `charts/corner-mini-map.tsx` (resolves corner from `outline.corners` by
  number; NO SQL needed), threaded `corner_map` through 6 layers, /mock-verified (Jeddah + Turn 22).

### ⚡ ULTRACODE WORKFLOW — 9 remaining items specced (exact edits) + adversarially verified
Full ready-to-apply specs (exact old→new strings / new-file contents) + verifier verdicts saved to
`diagnostic/design-review-2026-07-03/WORKFLOW_SPECS.json` (18-agent run). Apply queue + fixes to make:

| Item | Verdict | Apply notes / fixes before applying |
|---|---|---|
| **A1-derive** | ✅ APPLIED | `applyCornerMap` in mapInsight.ts + wired in page.tsx. Typecheck ✓. **Gap found live:** fires only when rows carry `circuit_short_name` (Verstappen corner query has it; Hamilton variant does NOT) — needs the circuit resolved from the venue REFERENCE (not just rows) to be universal. /mock display proven. |
| **B1-fastest-lap** | ✅ APPLIED | line-chart.tsx diamond markers, gated on `y_value_format==='lap_time_s'`. Typecheck ✓. Not yet live-screenshotted. |
| **B17-clarification** | ✅ sound | ~7 files (new clarification-card.tsx + chatTypes/chart-types/mapInsight/insight-card/toCardProps/page.tsx). Apply as-is. |
| **A4-event-pin** | ✅ sound | SQL+detector: raceControlIncidents template + registry + new timeline-chart.tsx (lanes+icons+pin). Live-verify needed. |
| **A3-status-grid** | ✅ sound | SQL+detector: telemetryWeatherGap circuit roll-up + registry + new status-grid.tsx (24 mini maps). Live-verify. |
| **A5-corner-delta** | ⚠️ revise | **P0: cornerDeltaInsight sets verdict.label to "EVEN"/"…EDGE" — InsightFields.verdict.label is "YES"|"NO" → typecheck break.** Also DivergingBar reads `chart.legend` not `diverging_colors`; grouped-bar baseline-0 edit is global. Fix these then apply (~11 files). |
| **B14-title** | ✅ APPLIED+converged | `isSelfTitle` guard + `titleFromRows` deriver in mapInsight.ts (re-derived; agent omitted strings). 2ndopinion REVISE→fixed: tightened self-echo (70% overlap so a good short title survives), numeric-corner-aware, reject mixed rows. Typecheck ✓. |
| **B19-dead-renderers** | ⚠️ revise | **Missed blocking update to scripts/tests/template-router-topic-guards.test.mjs**; donut→wire via new sessionTypeShare template; delta_comparison+timeline→delete. Incomplete delta_comparison ref sweep. |
| **B3-radar-spokes** | ✅ APPLIED | radar detector RETAINS all-zero axes + `empty_axes` field; radar-chart.tsx greys/dashes those spokes + n/a readout; chart-types.ts field added (anchor fixed); textAnchor type fixed. Typecheck ✓. Not yet live-screenshotted (m17). |

### NEXT STEPS (in order)
1. **A1 live gap — deterministic `corner_map` derive.** The LLM won't reliably emit `corner_map`.
   Instead derive it where the corner-metrics insight is assembled (the resolved reference already has
   circuit + corner — see `chatRuntime/resolution.ts` + `orchestration.ts`; the query returns
   `circuit_short_name` + `corner_number`). Set `insight.corner_map = {circuit, corner_number}` when the
   result rows carry a single `corner_number` + `circuit_short_name`. Mirror the `at_a_glance` derive
   pattern. Live-verify with "entry/apex/exit speeds for Hamilton through Turn 1 at Monaco 2025".
2. **A4 event-timeline corner-pin** — event detector (`registry.ts` ~600) emits only `lap/driver/kind/
   message`; add `corner_label`/`corner_f` to the row contract when race-control text yields a corner
   (data-gated, never invent), rebuild the timeline renderer as per-driver lanes + kind icons, pin via
   `<TrackMap markers>`.
3. **Wave 4 — A3 status-grid 24-circuit coverage grid** (`telemetryWeatherGap.ts` + `statusGrid` detector
   need `circuit_short_name`+round+rolled-up status; render grid of `<TrackMap variant=mini>`; memoize 24
   fetches) and **A5 corner-delta card** (new all-corner entry/apex/exit delta template + detector,
   building on the existing brake-zone corner path in `brakeZones.ts`/`registry.ts:1333`).
4. **Deferred Wave-2:** B1 fastest-lap markers, B7 event lanes (folds into A4), **B14 scatter/corner
   deterministic title fallback (CONFIRMED live bug)**, B17 clarification card, B19 dead-renderer
   decision (`delta_comparison`, bare `timeline`, weak-routing `donut`), B3 radar grey-empty-spokes
   (detector must retain empty axes).
5. **Final gate:** full live-prompt screenshot sweep (prompts in the design-review kit / `shots/INDEX.md`).

### Operational notes for the fresh context
- **`<TrackMap>` markers/mini already exist** — reuse for all maps; `pointAt(points,f)` resolves any
  fraction to (x,y); corner windows come from `analytics.corner_analysis` (`start/end_normalized`) NOT the
  outline API (which only has `corners:[{label,f}]`).
- **`/2ndopinion` = codex**: `CODEX_HOME=/tmp/cxhome codex exec --model gpt-5.5 -c
  model_reasoning_effort=high --sandbox read-only --skip-git-repo-check "<prompt>"`. Run FOREGROUND with a
  bounded Bash timeout — background runs get reaped (0-byte output). If auth expires, user runs
  `CODEX_HOME=/tmp/cxhome codex login`.
- **Preview**: `preview_start` name `web` (port 3000). `/mock` renders all 21 fixtures; live chat at `/`.
  The dev server stops between turns often — just `preview_start` again. Screenshots capture page-top, so
  isolate a card via `display:none` on other `section[data-testid^="fixture-"]` + `scrollTo(0,0)`.
- **Verify pattern per item:** typecheck (`cd web && npx tsc --noEmit`) → /mock or live screenshot →
  foreground `/2ndopinion` → update this log.

---

# vNext migration backlog — deck → code (track maps + all remaining visual migrations)
_2026-07-03 · plan to migrate every Claude Design deck feature not yet in code, using the app's REAL
runtime geometry (`/api/track-outline`, `/api/lap-telemetry`) styled to the deck._
**/2ndopinion status: CONVERGED — SHIP** (GPT-5.5, 3 passes, 10→2→0 findings). Safe to implement
wave-by-wave.

### ⏱ IMPLEMENTATION LOG
- **✅ Part C — `at_a_glance` everywhere.** Shared `deriveGlance()` in `toCardProps.ts`: when no explicit
  glance (deterministic cards / cached), promote the first sentence of the body and trim it from the prose
  (no dup). Suppressed when a hero/verdict already leads. Live-verified: glance now on 15/21 `/mock` cards.
- **✅ B4 — verdict PILL.** `verdict-card.tsx` rebuilt: compact tinted pill (✓/✕ icon + mono label + why)
  replacing the 6xl word (now 14px). Verified.
- **✅ B0 — reasoning metadata line.** `— N rows · Xms` appended to the reasoning toggle. Verified.
- **✅ B9 — ranked-bar leader emphasis** (non-leaders `fillOpacity 0.45`). Verified (Singapore overtakes).
- **✅ B10 — diverging winner emphasis + value labels** (`winnerIdx` full-strength + `LabelList` signed Δ).
- **✅ B15 — donut in-place readout** (legend → sorted rows with value + %). Verified (DRS-zone share).
- **✅ B18 — no-data polish** (mono eyebrow + `→` arrows + surface-raised panel, first-class not a 404).
- Typecheck green, no console errors, verified across verdict/stint-gantt/ranking/donut on `/mock`.
- **Wave-1 tail (deferred, small):** B6 numeric start/end labels on position lines (emphasis/dimming
  already ships the story), B11 optional hero venue-motif, B12/B13 (cliff + crossover markers ALREADY
  exist per audit — effectively done).
- **✅ /2ndopinion checkpoint — SHIP** (after codex re-login; 3 findings → 1 → 0):
  - `deriveGlance` rewritten as a boundary scanner (skips decimals + genuine continuation abbreviations
    `no|vs|dr|…|avg` + single-letter initials + multi-line leads; excludes F1 sentence-enders Q3/P2/GP so
    it never merges two sentences).
  - donut readout moved OUTSIDE the fixed `h-64` chart box (was overflowing/overlapping) — verified
    `readoutBelowChart: true`.
  - diverging mispositioned value labels REMOVED (redundant with the +4/−3 tiles; winner-emphasis via
    `fillOpacity` retained).
  Typecheck green, no console errors, live-verified (donut readout, diverging tiles, verdict pill).
- **Wave-1 tail (deferred, small):** B6 numeric start/end labels on position lines; B11 optional hero
  venue-motif; B12/B13 markers already exist; per-bar Δ labels on the diverging chart (needs the correct
  Recharts custom-label pattern).
### ⏱ WAVE 2 (markers/outliers) — /2ndopinion SHIP (no findings)
- **✅ B19 grouped-bar tick fix** — round large-range ticks to integers (was 267.7 → **268**, verified).
- **✅ B2 degradation cliff markers** — `cliffAge()` computes each compound's fall-off (steepest slope vs
  median, thresholded) from the series itself + `ReferenceDot`; no data/detector change. Guarded (all-null
  → null, never age 0, finite-only).
- **✅ B5 race-trace dimming** — honor `series.emphasis`; else derive winner + biggest-climber and dim the
  pack (`strokeOpacity 0.28`) when field > 3. Component-derived, crash-safe.
- **✅ B3 radar caption** — hardcoded `amber-500` → `--semantic-warning` token + mono "insufficient to
  rank". (Full grey-empty-spokes deferred — needs the detector to RETAIN empty axes instead of dropping.)
- **✅ B16 composite** — mono section-labels + `border-t` section rhythm.
- Typecheck green; codex: "No findings. SHIP."
- **Wave-2 deferred (need detector/template/title-layer, not component-only):** B1 fastest-lap markers
  (spec+detector flag), B7 event-timeline lanes+icons (renderer rebuild), B14 scatter deterministic title
  (title-resolution layer), B17 clarification choice card (new card+API), B19 dead-renderer wire/delete
  decision, B3 grey-empty-spokes (detector retains empty axes).

### ⏱ WAVE 3 (track maps) — in progress
- **✅ `<TrackMap>` extension** (prerequisite) — `markers` node-pin prop (faded outer + solid inner at any
  `pointAt(f)`), `variant="mini"` (strips chrome for dense grids), `showCornerLabels`/`showStartFinish`
  overrides, `className`, stray hex → tokens. Typecheck green; 3 existing callers use defaults →
  behavior-identical. **Proven live by A2's minimap render.**
- **✅ A2 telemetry biggest-Δ minimap** — client-only (no SQL/detector). `useTrackOutline(payload.circuit)`
  (hook before early returns) + argmax of **smoothed** (±3 window) |Δspeed| over 200 steps → `<TrackMap
  variant=mini markers=[node]>` + "Biggest Δ · where" panel. **Live-verified** (VER/NOR Silverstone: real
  outline + node at Turn 1; smoothing fixed a +89→+32 kph single-sample artifact). Self-reviewed
  (hook-order safe, all-null/single-driver guarded); codex checkpoint flaky (kept getting reaped).
- **◑ A1 metric-corner-map — display DONE + /mock-verified; live emission flaky.**
  - New `CornerMiniMap` component: fetches runtime outline, resolves the corner by number from
    `outline.corners` (NO SQL change needed — corner position comes from track-outline), renders
    `<TrackMap variant=mini>` with a highlight window + node. Threaded `corner_map` through
    `InsightMock`/`InsightFields`/`toCardProps`/`applyInsightFields`/validator/synthesis-prompt + shell.
  - **✅ /mock-verified** (m03 brake-zone card: real **Jeddah outline + Turn 22 pinned**, screenshot).
  - **⚠️ Live gap:** the LLM synthesis produces tiles+title but does NOT reliably emit `corner_map` (live
    Hamilton/Turn-1/Monaco: 78 rows, correct tiles 131/104/183, good title "Sainte Dévote", but no map).
    The optional-field directive in `chartWithMetricsTemplate` isn't being honored. **Robust fix (next):**
    derive `corner_map` DETERMINISTICALLY from the resolved corner reference (like the `at_a_glance`
    derive) rather than trusting the LLM — the card already resolves circuit + corner cleanly.
  - Also surfaced live: **B14 self-title bug is real** (a 0-row Silverstone/T3 query titled itself with the
    raw prompt) — confirms B14 needs the deterministic-title fallback.
- **NEXT (reassess):** deterministic `corner_map` derive → A4 event-pin → Wave 4 A3/A5 → deferred Wave-2.

**Ground rule (track maps):** the deck baked static SVG geometry (`tracks-data.js`). We do NOT use that.
Every map is drawn from the app's **runtime** geometry via the existing `<TrackMap>` component (used today
by `track-corner-delta`, `track-speed-map`, `minisector-strip`). Domain colors stay raw hex; theme tokens.
- `/api/track-outline?circuit=X` returns `points[{x,y,f}]`, `corners:[{label, f}]` (corner **start** only —
  `f1.track_segments.start_normalized`), `sectors`, `drsZones`. **It does NOT return corner f0/f1 windows.**
  Corner **windows** (`start_normalized`/`end_normalized`) live in `analytics.corner_analysis` and are
  already queried by `web/src/lib/deterministicSql/brakeZones.ts` — SQL-backed corner cards get f0/f1 from
  there and pass them in the spec. So **no DB migration** is needed; A1/A5 plumb windows from the query.

**`<TrackMap>` extensions required first (shared prerequisite for A1/A2/A4/A5):** it exposes
`segments` / `highlights{f0,f1}` / `gradient` + `pointAt(points,f)`, but has **no node/pin prop, no
mini/outline-only mode**, and always draws shadow + center-stripe + start/finish + corner labels at
`max-w-md`. Add: `markers?:[{f,color,label?,r?}]` (the deck's faded-outer + solid-inner pin), `variant?:
"full"|"mini"` (strip chrome for the 24-grid), `showCornerLabels?`, `showStartFinish?`, `className`.
[track-map.tsx:99/187]

Foundation already shipped (token layer, shell, mono tiles, `at_a_glance` LLM path, color sweep) — see
INTEGRATION_PLAN.md execution log. This backlog is the REMAINDER.

---

## PART A — Track-map migrations (new map placements the deck adds)

Deck styling reference for all: full outline in muted `#33333a`/`--chart-grid` stroke, corner/point nodes
as a faded outer circle + solid inner (team/accent color), mono corner label. Reuse `<TrackMap>`.

### A1 · metric_grid → corner-on-map  (deck card #7 "Verstappen through Copse")
- **Deck:** the single corner highlighted on the real outline (highlighted window + pulsing node w/ corner
  number + label) beside the ENTRY/APEX/EXIT tiles (left-border accent per phase).
- **Runtime source:** `<TrackMap>` `highlights` renders an f0/f1 window; the corner **window** comes from
  `analytics.corner_analysis` (`start_normalized`/`end_normalized`) — NOT the outline API. metric_grid is a
  **slot** (not detector-routed), so no detector change.
- **Migration:** the corner-metrics query/spec must carry `{ circuit, corner_zone:{label,f0,f1} }` (add
  `end_normalized` to that query); render `<TrackMap variant="mini" highlights=[zone] markers=[node]>`
  beside the tiles. **Size: M** (query adds the window + spec plumb + TrackMap markers prop).

### A2 · telemetry_overlay → biggest-delta minimap  (deck card #27)
- **Deck:** minimap panel = outline + a single node at the lap location where |ΔspeedA−B| is largest,
  labelled ("Maggotts exit · VER +11 kph"); the trace also gets a dashed marker at that distance.
- **Runtime source:** `/api/lap-telemetry` gives per-trace `f[]` + speed for both drivers; `/api/track-
  outline` gives `points{x,y,f}`. Client computes `argmax|Δ|` fraction → `pointAt(points, f)` → node.
- **Migration:** telemetry-overlay today has **no minimap** and fetches only `/api/lap-telemetry`
  ([telemetry-overlay-chart.tsx:121]) — add a `useTrackOutline(circuit)` fetch, compute the argmax-delta
  fraction client-side, render a mini `<TrackMap markers=[node]>` + a Recharts `ReferenceLine` on the
  speed trace at that x. **Client-only, telemetry_overlay already routes — no detector change. Size: M.**

### A3 · status_grid → 24-circuit coverage grid  (deck card #2)
- **Deck:** `repeat(auto-fill,minmax(98px,1fr))` grid of 24 mini circuit outlines, each tinted by coverage
  status (green complete / amber partial / red gap), round number per cell; an all-clear verdict panel +
  gaps/venues/sessions tiles above.
- **Runtime source:** 24 outlines via `/api/track-outline` per circuit (already used to export the PNGs) —
  so **24 fetches**; memoize/cache and lazy-render. Current `status-grid` is a **table**, not circuit cards.
- **Migration:** (a) the coverage query/detector currently emits **session** rows and drops circuit
  metadata ([telemetryWeatherGap.ts:50], [registry.ts:813]) — add `circuit_short_name` + round + roll-up
  status per venue to the row contract first; (b) replace the table render with a grid of `<TrackMap
  variant="mini">` (stripped mode — full TrackMap's shadow/labels/`max-w-md` are too heavy ×24) keyed by
  venue, tint per status. **Size: L** (query+detector circuit roll-up + new grid renderer + mini mode +
  24-fetch memoization). Bucket: query/detector + renderer change, no DB migration.

### A4 · event_timeline → corner-pinned incidents  (deck card #8 "Race Control — Baku")
- **Deck:** per-driver lanes + incident icons; the ONE corner-tagged incident (Stroll T15) pinned on the
  outline; lap-only incidents stay on the timeline (honest — no fabricated location).
- **Reality (under-scoped before):** the event detector emits only `lap/driver/kind/message`
  ([registry.ts:600]) — **there is no corner/turn field preserved**, and the renderer is card rows, not
  lanes/pins.
- **Migration:** (a) add `corner_label`/`corner_f` to the event row contract + detector mapping (only when
  race-control text yields a corner — data-gated, never invented); (b) rebuild the renderer as per-driver
  lanes + kind icons; (c) when a corner is present, render a mini `<TrackMap markers=[node]>`. **Size: M**,
  data-gated. Overlaps B7 (lanes/icons) — do together.

### A5 · corner-delta card #1 (grouped_bar → corner card)  (deck card #1)
- **Deck:** replaces the buggy grouped bars (real y-axis tick bug: `454545` labels) with per-corner tiles +
  mini track-map (corner nodes sized by Δ, colored by faster driver) + a diverging "who's faster where"
  ladder.
- **Reality (partly built, not wholly new):** a `track_corner_delta` renderer already routes when rows
  carry `zone_f0/zone_f1`, and `brakeZones.ts` already selects `start_normalized/end_normalized` from
  `analytics.corner_analysis` ([brakeZones.ts:43], [registry.ts:1333]). So the corner-window + map pipeline
  EXISTS for the brake-zone shape.
- **Migration:** the NEW work is a **broader all-corner entry/apex/exit delta template + spec + card**
  (2-driver × N-corner, reusing the existing corner-window plumbing) with `<TrackMap>` nodes sized by Δ +
  the diverging ladder — plus a detector for that broader shape. **Size: L** (template + detector + card,
  but building on the existing brake-zone corner-map path, not from zero). Also **fix the generic
  grouped_bar y-axis tick bug** regardless.

---

## PART B — Non-map visual migrations (per-card, only genuine gaps vs current code)

Verified against a full code audit. **Already shipped, NOT gaps:** compound colors (stint-gantt,
degradation), teammate secondary colors, `position_changes` emphasis/dimming, reasoning-collapse-by-
default, `at_a_glance` slot, mono tiles, scatter IQR-trim + regression, the 3 existing track maps.

### Shell
- **B0 · reasoning metadata line** — deck's reasoning toggle shows `— N rows · Xms · deterministic
  template` inline on the toggle itself; the activity log already surfaces rows/ms elsewhere, but the
  **reasoning `<summary>` text is static** ("Reasoning & query"). Append the source/rows/ms summary to
  that summary line. **S.**

### Coverage note (auditable 27-card map)
Already shipped / **no action**: `track_heatmap` (#19 minisector ribbon), `track_speed_map` (#26),
`track_corner_delta` (#24 brake-zone), stint_gantt compound colors, teammate colors, position-changes
emphasis, reasoning-collapse, scatter IQR. Every other deck card maps to an A/B/C item below.

### Cross-cutting
- **B1 · fastest-lap markers** — deck marks each driver's fastest lap (diamond) on `line`; audit confirms
  **not implemented** anywhere. Add a `fastest_lap` marker to `line-chart` (and where relevant
  `line-with-stint-markers`). **S–M.** (Needs the spec/detector to flag the fastest lap index.)

### Per-card gaps
| # | Card | Deck feature missing in code | Current state | Size |
|---|---|---|---|---|
| B2 | degradation_curve | **Visual cliff markers + explicit SC/anomaly annotation only** | compound colors ✓; SQL ALREADY drops SC/outlier laps (`degradationCurve.ts:54` field-median×1.4) + synthesis ALREADY reports cliff ages (`degradationCurveInsight.ts:81`) — the gap is drawing the cliff marker + annotating the excluded anomaly | S |
| B3 | radar | **Grey + dash unpopulated axes** with "low sample · insufficient to rank" + a readout table; keep the heptagon | today DROPS all-zero axes / switches to bars (`partial_data_axes`) | M |
| B4 | verdict | **Compact verdict PILL** (icon + YES/NO + one-line why) | renders a huge 5xl–6xl "YES"/"NO" | S |
| B5 | race_trace | **Emphasize story lines (winner + biggest mover), dim the pack** | team colors + SC bands + pit dots, but NO emphasis/dimming | M |
| B6 | position_changes | **Annotate start/end positions** of the emphasized lines | emphasis/dimming ✓, annotation missing | S |
| B7 | event_timeline | **Per-driver lanes + incident-type icons** (▲ crash / ⚑ penalty / ◎ investigation) | vertical card list w/ lap markers + kind badges | M |
| B8 | pit_event_strip | **Lead with the numbers** (stop time, lap, net s) as tiles; ensure the P→P position flow | phase strip + position flow "when available" | S–M |
| B9 | horizontal_bar | **Leader-emphasis only** (in-bar value labels ALREADY exist) | per-bar team colors, zero-baseline, value labels ✓ | XS |
| B10 | diverging_bar | **Winner emphasis** on the biggest mover | zero line + gained/lost colors ✓ | S |
| B11 | hero | **Optional venue-outline motif only** (number is ALREADY large mono) | large mono value ✓ | XS/optional |
| B12 | pace_cliff | Lead with **cliff-lap + delta tiles** (marker already exists) | cliff-onset marker ✓ | S |
| B13 | wet_crossover | Make the **crossover lap the hero marker** (transition marker exists) | tyre-transition markers ✓ | S |
| B14 | scatter | **Deterministic title fallback only** (slope ALREADY labelled `s/lap`) | regression + IQR + slope label ✓; title from LLM (self-title bug) | S |
| B15 | donut | **In-place share labels** + confirm the categorical-share query routes | pie + center total; routes on label+value | S |
| B16 | composite | vNext **sectioned layout** (mono section-labels, per-section glance) | embeds line + metric_grid per section | M |
| B17 | clarification | Deck's **choice card** (session-type options, primary/secondary, one-tap) | handled ad-hoc; no dedicated choice card | M |
| B18 | no_data | Polish the **"what the dataset holds"** panel (facts only) | "What we can show instead" + bullets; DNF-aware enrich exists | S |

### Dead renderers (decide)
- **B19** — `delta_comparison` (never emitted), bare `timeline` (mock-only), and **`donut`** (detector
  exists but live routing is weak/prose-only per the design review — B15 must make the categorical-share
  query actually route, else donut stays dead): wire or delete each. **S.**
- Also fix the **grouped_bar y-axis tick bug** (`454545`-style labels) noted in the design review — until
  corner-delta card A5 replaces it for the 2-driver corner case. **S.**

## PART C — Deterministic `at_a_glance`
- Emit `at_a_glance` from the `synthesis/*Insight.ts` builders (race-trace, speed-map, pace-cliff,
  stint-delta, telemetry, position-changes, …) so deterministic cards get the promoted line the LLM path
  already produces. **Size: S each**, ~12 builders, or a shared helper.

---

## SEQUENCING (by value × dependency; verify each on /mock + a live prompt, /2ndopinion per wave)

**Wave 1 — cheap wins, no new data contract (mostly restyle/marker):**
B0 reasoning-line, B4 verdict pill, B6 position annotate, B9/B10 bar emphasis+labels, B11 hero mono,
B12 pace-cliff tiles, B13 wet-crossover marker, B18 no-data polish, B15 donut labels, C at_a_glance
(shared helper). → knocks out the long tail fast.

**Wave 2 — markers + outliers (small data/spec flags):**
B1 fastest-lap markers, B2 degradation SC-exclusion+cliff, B14 scatter slope+title, B3 radar grey-axes,
B5 race-trace dimming, B8 pit-strip numbers, B16 composite sections, B7/B17 event-timeline lanes +
clarification card, B19 dead-renderer decision + grouped-bar tick fix.

**Wave 3 — track maps reusing runtime geometry + existing `<TrackMap>`:**
A1 metric_grid corner-on-map → A2 telemetry minimap → A4 event-timeline pin (data-gated).

**Wave 4 — the heavy new surfaces (new renderer / template + detector):**
A3 status_grid 24-circuit coverage grid → A5 corner-delta card #1 (new template + detector).

## Effort roll-up
- Part A (5 maps): 2×M (A1,A2) + 1×M-gated (A4) + 2×L (A3,A5).
- Part B (20 items): ~12×S + ~6×M + dead-renderer decision.
- Part C: 1 shared helper + ~12 one-line emits.
- **No warehouse/migration changes** — every map uses existing `/api/track-outline` + `/api/lap-telemetry`;
  A5 is the only one needing a new deterministic SQL template + detector rule. Everything else is
  client/spec/synthesis-layer.

## Gates (per wave)
Visual diff vs deck screenshot · axe/contrast on near-black · mobile reflow · `prefers-reduced-motion` ·
detector contract test (shape→renderer) · `ChartSeries` optional fields preserved · randomized live sweep
holds A-grade.
