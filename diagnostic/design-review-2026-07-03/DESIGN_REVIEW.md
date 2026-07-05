# F1 Insights — visual design review (live pipeline, 2026-07-03)

Every visual the app generates through the **real** pipeline (prompt → `/api/chat` → deterministic
SQL template or LLM fallback → client chart-detector → renderer). **Not** the `/mock` page. Each was
produced by a live 2025 prompt and rendered into ONE scrollable thread in the preview panel (scroll it
to copy cards into Claude Design). Grades use [RUBRIC.md](RUBRIC.md).

**How chart type is chosen (important for redesign):** the chart type is ALWAYS derived from the SQL
result-row column shape (`detectChart → runDetectorRegistry`), never emitted by the LLM. So the "type"
is a function of data shape, not of the model's intent — a redesign that adds a new chart must also
add/adjust a detector `matches()` rule.

---

## Cross-cutting findings (apply to ALL cards — highest design leverage)

1. **The chart is buried below the fold.** Every card is a fixed shell: title → subtitle → a tall
   *reasoning trace* block (Reading question / Resolving references / Planning query / Running query /
   Drafted answer) → prose paragraph → metric tiles → **chart** → key takeaways → collapsible SQL →
   raw result table. On a desktop card the reasoning trace + prose fill a whole viewport before the
   chart appears. For a data-viz product this inverts the hierarchy. **Redesign:** collapse the
   reasoning trace by default (it already collapses in some cards via "▸ REASONING"), and/or move the
   chart above the prose so the visual leads.
2. **Consistency is a real strength.** The shared shell (tiles + chart + takeaways + provenance/SQL +
   result table) gives strong brand cohesion and honesty (every answer shows its SQL + rows). Keep it.
3. **The metric tiles are the best-designed element** — big number, unit, sub-label, one highlighted
   (red) tile. They carry the "answer at a glance." Lean into them.
4. **Dark theme + team colors** read well; the recent teammate-color fix (primary vs secondary hue)
   means same-team comparisons are now distinguishable (verified on Ferrari telemetry, Sauber wet).
5. **Titles are LLM-generated and occasionally fail** — the scatter card titled itself with the raw
   prompt ("Plot lap time versus lap-in-stint…"). Add a deterministic title fallback.
6. **Three renderer branches never produce output live** (see "Dead renderers" at the end): they are
   design surface that ships but can't be reached — either delete or wire them.

---

## Grades at a glance

| # | Visual | Type | Grade | One-line |
|---|---|---|---|---|
| 1 | Pit-stop count | hero (scalar) | A− | Clean big-number + context tiles |
| 2 | Strategy split | verdict + stint_gantt | A | Bold YES/NO + compound-banded gantt |
| 3 | Corner speeds | metric_grid (tiles) | B+ | Entry/apex/exit tiles, no chart needed |
| 4 | Overtakes ranking | horizontal_bar | A− | Team-colored ranking + value labels |
| 5 | Lap-1 launch | horizontal_bar_diverging | A− | Green/red diverging around zero |
| 6 | Corner entry speeds | grouped_bar | B | Side-by-side bars; generic vs bespoke cards |
| 7 | Clean-air vs traffic | stacked_horizontal_bar | B | Two-segment bars; fine, unremarkable |
| 8 | Opening-stint pace | line | B+ | Multi-line lap times, smooth |
| 9 | Stint delta | line_with_stint_markers | A− | Delta line crossing zero + stint markers |
| 10 | Degradation curve | degradation_curve | B | Per-compound lines; y-axis compresses on an outlier |
| 11 | Wet crossover | line_dual_axis | A− | Lap-time + wet band; teammate-distinct now |
| 12 | Deg scatter | scatter_with_regression | B− | Points + trend; **title = raw prompt (bug)** |
| 13 | Race trace | race_trace | A | F1-TV-style gap trace + SC bands; bespoke |
| 14 | Position changes | position_changes | A− | Full field, movers emphasised / pack dimmed |
| 15 | First-stop cycle | pit_event_strip | B+ | 3-phase in/box/out strip |
| 16 | Steward events | event_timeline | B | Lap-keyed incident timeline |
| 17 | Performance radar | radar | B+ | Now bar-fallback when <3 axes populated |
| 18 | Pace cliff | line_with_stint_markers | A− | Single-driver cliff-onset + pit markers |
| 19 | Mini-sector dominance | track_heatmap | A | Track dominance ribbon on real circuit |
| 20 | Brake zones | track_corner_delta | A | Circuit outline + corner highlights |
| 21 | Speed map | track_speed_map | A | Blue→red speed-gradient ribbon + DRS bands (standout) |
| 22 | Telemetry overlay | telemetry_overlay | A− | Stacked speed/gear/pedal traces, teammate-distinct |
| 23 | Data coverage | status_grid | C+ | Data-health grid; resolved oddly, "no gaps" empty-ish |
| 24 | Session-type share | donut | **F** | **No donut renders** — dead path (prose only) |
| 25 | Front-wing damage | no_data / refusal | B+ | Honest "Not in dataset"; add "what we have" |
| 26 | Ambiguous quali | clarification | B+ | Disambiguation w/ human session labels (post-fix) |
| 27 | Crossover × spin × pit | composite | B | Multi-section stitched answer; dense |

---

## Per-visual detail (grade · what it shows · prompt · strengths · redesign)

### Big-number / verdict / tiles
- **1 · hero (A−)** — "Norris made 1 pit stop (one-stop)". Prompt: *How many pit stops did Norris make
  at the Hungary 2025 race?* Strengths: the scalar is unmistakable; context tiles good. Redesign: the
  hero number could be even larger / more dominant vs the trace above it.
- **2 · verdict + stint_gantt (A)** — bold **YES**, then a compound-banded gantt (M/H color bands per
  driver). Prompt: *Did Mercedes split strategies between Russell and Hamilton at Spa 2025?* Strengths:
  verdict + evidence in one; compound legend clear. Redesign: gantt bar labels could show stop laps.
- **3 · metric_grid (B+)** — Leclerc Turn 1 entry/apex/exit tiles (no chart). Prompt: *What were the
  entry, apex and exit speeds for Leclerc through Turn 1 at Monaco 2025?* Strengths: tiles are the
  strongest element. Redesign: a tiny corner sparkline or the corner on a mini track-map would elevate it.

### Bars
- **4 · horizontal_bar (A−)** — inferred overtakes ranking, team-colored, value labels, "⚠ estimated"
  honesty. Redesign: fine as is; could sort toggle.
- **5 · horizontal_bar_diverging (A−)** — lap-1 launch, green(gained)/red(lost) around zero. Clean.
- **6 · grouped_bar (B)** — Hamilton vs Leclerc corner entry speeds, side-by-side bars per corner.
  Strengths: legible. Weakness: this is the most "default Recharts" of the set — generic vs the
  bespoke track cards. Redesign: consider plotting corner deltas on the track map instead of bars.
- **7 · stacked_horizontal_bar (B)** — clean-air vs traffic laps per driver, two-segment bars.
  Functional, unremarkable. Redesign: annotate the % in traffic on the bar.

### Lines
- **8 · line (B+)** — opening-stint lap-time compare, two smooth lines. Redesign: mark the fastest lap.
- **9 · line_with_stint_markers / stint delta (A−)** — per-lap delta crossing a zero line with dashed
  stint-boundary markers (S1 Medium / S2 Soft). Bespoke touch. Redesign: shade above/below zero by driver.
- **10 · degradation_curve (B)** — per-compound median-delta-vs-tyre-age lines. Weakness: a single
  Safety-Car-contaminated outlier compresses the whole y-axis (seen at Austin); also a boilerplate
  "±5s" over-claim in prose (content bug). Redesign: clamp/annotate outliers; secondary y-zoom.
- **11 · line_dual_axis / wet crossover (A−)** — lap-time trace + wet-track band + tyre-change markers;
  now teammate-distinct (green vs silver for Sauber). Redesign: the huge SC-lap spike compresses the
  useful range — same y-axis issue as #10.
- **12 · scatter_with_regression (B−)** — lap-time vs lap-in-stint with a fitted trend. **Bug: the card
  titled itself with the raw prompt.** Redesign: deterministic title; label the regression slope.

### Rich race cards (the bespoke, best-craft tier)
- **13 · race_trace (A)** — F1-TV gap-to-leader trace, inverted y (leader on top), SC/VSC shaded bands,
  team-colored legend. One of the strongest. Redesign: hover-to-isolate a driver.
- **14 · position_changes (A−)** — full 20-driver grid→flag step chart; the winner + biggest mover +
  biggest faller are emphasised (bold, full opacity) and the pack dimmed. Redesign: hover-to-isolate.
- **15 · pit_event_strip (B+)** — in-lap / pit-lane / out-lap 3-phase strip, red = time-loss segment.
  Redesign: show gained/lost track position around the stop.
- **16 · event_timeline (B)** — lap-keyed steward/SC incidents. Redesign: give it a clearer visual lane
  per driver / incident-type iconography.
- **17 · radar (B+)** — season 7-axis performance; when <3 axes are populated it now falls back to a
  bar (was a degenerate spike). Redesign: grey the unpopulated spokes even in the full radar.
- **18 · line_with_stint_markers / pace cliff (A−)** — single-driver stint pace with cliff-onset + pit
  markers. Redesign: shade the post-cliff region.

### Track maps (bespoke, standout tier)
- **19 · track_heatmap (A)** — mini-sector/sector dominance ribbon on the real circuit; both drivers now
  in the legend with sector counts. Redesign: stronger sector-boundary strokes when one driver sweeps.
- **20 · track_corner_delta (A)** — real circuit outline with the heaviest corners highlighted, colored
  by who's faster. Bespoke, on-brand.
- **21 · track_speed_map (A, standout)** — the driver's fastest lap drawn as a blue→red speed-gradient
  ribbon on the circuit, with green DRS bands. The single most distinctive visual in the app.
- **22 · telemetry_overlay (A−)** — stacked speed / gear / throttle-brake traces aligned by lap distance;
  now teammate-distinct (Leclerc red vs Hamilton yellow). Redesign: corner ticks are subtle; label them.

### Data / honesty / states
- **23 · status_grid (C+)** — telemetry-vs-weather coverage. Weakness: the season query resolved to a
  single session and reported "no gaps" (near-empty state); the grid reads thin. Redesign: a real
  season matrix (session × venue heat grid) would make this shine; design an explicit empty state.
- **24 · donut (F)** — **no donut renders.** Even with perfect share data (Practice 50 / Quali 25 /
  Race 25), the pipeline produces prose only — no `donut` detector fires on this shape. Either wire a
  categorical-share detector or drop the renderer. (See Dead renderers.)
- **25 · no_data / refusal (B+)** — "Not in dataset" for proprietary front-wing data; honest and
  on-brand. Redesign: pair the refusal with a "what we DO have for this session" suggestion (the
  what_we_have slot exists — use it).
- **26 · clarification (B+)** — ambiguous sprint-weekend "qualifying" → asks which session, now with
  human labels ("Qualifying, session_key …") after this session's fix. Redesign: render the options as
  clickable chips, not text.
- **27 · composite (B)** — stitches crossover + spin + pit-timing into one multi-section card. Dense but
  coherent. Redesign: clearer section dividers / sub-headers between the stitched phenomena.

---

## Dead renderers (ship but never reachable live — decide: wire or delete)
- **delta_comparison** — `charts/index.tsx` comment: "nothing in the live pipeline emits
  delta_comparison." Renderer + component exist; no detector/template produces the type.
- **timeline (bare)** — only `event_timeline` reaches `TimelineChart`; bare `timeline` has no emitter.
- **donut** — has a detector but no deterministic path and no analytics table produces the
  `label + share (no driver)` shape; confirmed live to render prose only (#24).
- (`metric_grid` is in the `ChartType` union but has **no `ChartRenderer` case** — it renders via the
  `metrics` tiles path, not the chart path. Not "dead," just mis-catalogued; worth cleaning up.)

## Suggested priorities for Claude Design
1. **Re-order the card shell** so the chart leads (collapse the reasoning trace by default). Biggest
   at-a-glance win, affects all 27.
2. **Level up the generic bar/line/scatter cards** (#6, #7, #10, #12) toward the bespoke track-card
   craft — or route more of them onto the track/graph treatments.
3. **Fix the scatter title bug** and add deterministic title fallbacks.
4. **Design the data/empty states** (#23 status_grid, #24 donut, #25 refusal) — these are the weakest
   and most generic today.
5. **Decide on the dead renderers** (delta_comparison, bare timeline, donut) — wire or delete.
