# Claude Design prompts — F1 Insights card redesigns (2026-07-03)

Worst-first. Each prompt is self-contained (paste standalone + attach the named screenshot from `shots/`).

## Shared design-system note (baked into every prompt below)
- Dark theme, official F1 team colors, cards ~760px desktop / ~380px mobile.
- Card anatomy: title → subtitle → collapsible reasoning trace → prose → metric tiles → **the chart** →
  key takeaways → collapsible SQL → result table.
- **Track mini-maps are our signature visual.** The app renders every 2025 circuit's real outline (a
  track-outline service + per-corner/segment geometry). **Wherever a card's data has a spatial /
  track-position / per-venue dimension, use a mini track-map of the real circuit as a first-class
  element** (as in the corner-delta card). If the data is NOT spatial, do not force a map — say so and
  use the best bespoke alternative.

---

## 1 · grouped_bar → corner-delta  (attach `shots/06_grouped_bar.png`, was C) — APPROVED
Replaced the buggy grouped bars with: per-corner tiles + a mini track-map (corner nodes sized by Δ,
colored by faster driver) + a diverging "who's faster where" ladder. Fixes the y-axis bug, uses the
track-map motif, resolves teammate colors. → to be implemented as a deterministic corner-delta card.
**Routing note:** a *generic* "compare avg entry speed per corner" prompt still emits plain grouped-bar
columns and routes to `grouped_bar` today — the corner-delta track map only renders on the dedicated
brake-zone template shape (`corner_label` + `apex_min_speed_kph` + `zone_f0/f1`). So this card lands as a
**new deterministic template + detector**, not just a restyle of the existing grouped-bar output.

---

## 2 · status_grid  (attach `shots/23_status_grid.png`, was C+/B)

You're redesigning a card for **F1 Insights**, a race-analysis chat app. [paste shared design-system
note above.] The attached card audits **data coverage** — which 2025 sessions have telemetry vs matching
weather data. It's our weakest working visual (C+/B). Problems: it's a spreadsheet-like wall of
"full/full" cells; its all-good/empty state is undesigned; the *answer* ("where is coverage missing?")
doesn't pop.

**Track-map angle (please use it):** this data IS spatial by venue. Render a **grid of mini circuit
outlines — one per 2025 venue** — each colored/annotated by its coverage status (e.g. green = telemetry
+ weather complete, amber = partial, red = gap), so the whole season reads as a wall of recognizable
circuit shapes. A missing-coverage circuit should jump out instantly.

**Please:** critique the current design, then propose a redesigned mockup built around the per-venue
circuit-outline grid, with a proper "all clear" empty state, consistent with the card system. Show the
mockup, explain the encoding, and show the mobile reflow.

---

## 3 · stacked_horizontal_bar  (attach `shots/07_stacked_horizontal_bar.png`, was B)

You're redesigning a card for **F1 Insights**. [paste shared design-system note above.] The attached card
splits each driver's race laps into **clean air (green) vs in traffic (red)** as a proportion. It's a B —
functional but a generic stacked bar; the proportions aren't labeled in-place; with two drivers it looks
sparse.

**Track-map angle (use it IF the data supports it):** traffic happens *somewhere* on the lap. IF a
driver's in-traffic laps can be located on track (we have per-sample lap-position data), make the hero a
**mini track-map with the in-traffic portions of the circuit highlighted per driver** — showing not just
*how much* traffic but *where*. IF that spatial data isn't reliably available, DON'T fake it: fall back
to a compact **per-lap clean/traffic timeline strip** and say why. Design both and recommend one.

**Please:** critique it, then propose the redesigned mockup (track-map hero if spatially supported, else
the timeline), label the proportions in-place, make it feel purpose-built, and scale from a 2-driver
compare to a fuller field. Show the mockup + rationale + mobile reflow.

---

## 4 · degradation_curve  (attach `shots/11_degradation_curve.png`, was B)

You're redesigning a card for **F1 Insights**. [paste shared design-system note above.]

**Note on track maps:** this card plots **pace delta vs tyre age** — it is purely temporal (how a tyre
falls off over a stint), with **no track-position dimension**. Do NOT add a track mini-map here; it would
be meaningless. Focus the craft on the curve itself.

The attached card is our tyre-degradation curve (per compound, pace delta in s/lap vs tyre age); slope =
fall-off rate. It's a B. Problems: (1) **outlier compression** — one Safety-Car-contaminated lap can
spike the y-axis and flatten every real curve into a bottom-of-chart line, making the actual degradation
unreadable; (2) **weak compound identity** — it should read instantly as Soft/Medium/Hard using the
sport's own tyre colors (red/yellow/white), and the "cliff" (where a tyre falls off) isn't called out;
(3) the chart sits below a tall reasoning trace + prose.

**Please:** critique it, then propose a redesigned mockup that is robust to outliers (clamp/annotate
anomalies or zoom the meaningful range), uses **official compound colors**, visually marks each
compound's degradation cliff, and leads with the chart. Show the mockup + rationale + mobile reflow.

---

## Donut (F, no chart today) — design-from-scratch
In F1 Insights (same card system + track-map note), a "categorical share" question (e.g. share of 2025
sessions by type) currently returns **prose only, no chart**. Design a share/proportion viz (donut,
treemap, or better) that fits the dark F1 aesthetic at 760px and 380px. (Track maps don't apply — this is
categorical, not spatial.) Show the mockup + rationale.

---
---

# PART 2 — the remaining 16 surfaces (individual redesigns, run after the vNext Restyle Spec)

These are the **16 remaining surfaces** (most scored A/A−; four were never captured; scatter is B−,
composite B). The "vNext Restyle Spec" card only *listed* them as chips. Per "do it for all visuals,"
each gets its own paste-ready prompt below, worst-remaining first. All build on the vNext system you
established (collapsed reasoning trace, answer-at-a-glance header, mono eyebrows + grotesk numbers,
raw-hex team/compound colors, real circuit outlines for spatial data). Keep each short — the chat already
holds the system. Attach the named `shots/` image (and any `track-maps/` circuit called out) as visual
reference.

> **Two guards for this whole batch (from the repo-grounded 2ndopinion, apply to every prompt):**
> 1. **Routing realism.** Chart type is chosen by a detector `matches()` on the SQL *column shape*, never
>    by the LLM. A mockup that invents a NEW shape (new columns / new encoding) is **un-routable** until a
>    detector + template + spec change ships. Where a prompt below is "restyle-only" it routes today; where
>    it's flagged "needs detector/template work" the mockup is a target, not something the live pipeline
>    can reach yet — design it, but tag it as new work.
> 2. **Track-map source.** For *design reference* attach the `track-maps/` PNG/SVG so Claude Design traces
>    the true shape. But in *implementation* the outline is generated at runtime from
>    `/api/track-outline?circuit=…` (reference-lap `raw.location` geometry) — the prompts should say
>    "runtime track-outline geometry," not "a static asset," so the built card stays data-driven.
>
> Preserve in every implementation: raw domain hex (team/compound) via `ChartSeries.color`, the
> `strokeDasharray`/`strokeWidth`/`opacity`/`emphasis` fields, and the honesty surfaces (collapsed
> reasoning trace, collapsible SQL, result table, no-data + clarification cards).

## 5 · scatter_with_regression  (attach `shots/13` — not captured; regen: "Plot lap time vs lap-in-stint for Verstappen and Norris at Silverstone 2025 and fit the degradation trend", B−)
Next card: **lap-time vs lap-in-stint scatter with a fitted trend line** (tyre-deg per driver). Same
vNext system. **Bug to fix: the card titled itself with the raw prompt** — give it a real deterministic
title. Redesign: clean point cloud, team/secondary colors per driver, label each regression slope as the
**deg rate (s/lap)**, mark the crossover if the trends intersect. Temporal — no track map. Mockup +
rationale + mobile reflow.

## 6 · composite  (attach `shots/27` — not captured; regen: "Break down the wet-to-dry crossover, any spins, and the pit sequence for Hamilton at Silverstone 2025", B)
Next card: a **multi-section composite** answer (e.g. wet→dry crossover × spin events × pit sequence in
one card). Same vNext system. Today it stacks generic sections. Redesign a clear **sectioned layout**
with mono section-labels and a consistent rhythm, each section leading with its answer-at-a-glance.
**Track-map angle:** a spin-location pin requires **actual corner / lap-fraction data** for that incident
— only pin it if that data exists (it often won't); otherwise keep the section temporal and say so.
Mockup + rationale + mobile reflow.

## 7 · no-data / data-absence  (attach `shots/25` — not captured; regen: "How many pit stops did Tsunoda make at the 2025 Saudi Arabian Grand Prix?", B+ — genuine no-data)
Next card: the **honest "no-data / data-absence"** card — the app's integrity surface (it must never
invent a number). Same vNext system. Redesign it as a **first-class answer**, not an error: state plainly
what *is* in the dataset (e.g. "N laps recorded, no pit row" — use only facts the result rows prove;
don't assert a DNF cause unless the data shows it), why the asked metric is absent, and what related
question we *can* answer. A small greyed venue outline for context is optional. This card must feel
designed, not like a 404. **Impl note:** a richer factual card may need structured "what we have" fields
beyond today's `body`/`what_we_have` — flag as light data work if so. Mockup + rationale.

## 8 · clarification  (attach `shots/26` — not captured; regen: "Show me the qualifying results for the 2025 Miami Grand Prix" [sprint weekend → ambiguous], B+)
Next card: the **clarification / disambiguation** card (e.g. sprint weekend → "Sprint Qualifying or Grand
Prix Qualifying?"). Same vNext system. Redesign the choice UI: human-readable options (session type +
readable label, never raw `session_key`), a clear primary vs secondary, one-tap to resolve. **Impl note:**
this is **structured UI/API work (choice actions + resolution), not a chart restyle** — the mockup drives
a small interaction change, not a detector. Mockup + rationale.

## 9 · hero (scalar)  (attach `shots/01_hero.png`, A−)
Next card: the **hero scalar answer** (single big number — e.g. "Norris made 2 pit stops"). Same vNext
system. This is the purest answer-at-a-glance — make the number monumental (grotesk), one supporting
sub-stat, mono eyebrow context (venue · session). Optional: a small venue outline as a contextual motif,
not a chart. Don't over-build — the number is the design. Mockup + rationale.

## 10 · horizontal_bar (ranked)  (attach `shots/04_horizontal_bar.png`, A−)
Next card: the **ranked horizontal bar** (e.g. on-track overtakes by driver). Same vNext system. Lead
with the leader + total; bars in team colors, value labels in-bar, the top bar emphasized. Clean the
axis. No track map (per-driver counts). Mockup + rationale.

## 11 · horizontal_bar_diverging  (attach `shots/05_horizontal_bar_diverging.png`, A−)
Next card: the **diverging bar** (positions gained vs lost — e.g. lap-1 launch). Same vNext system. Make
the zero-line the anchor, gained = green right / lost = red left, name + Δ per bar, the winner
emphasized. Mockup + rationale.

## 12 · verdict + stint_gantt  (attach `shots/02_verdict_stint_gantt.png`, A)
Next card: the **verdict + stint-gantt** (strategy-split yes/no + each driver's stint bars in compound
colors). Same vNext system. Lead with the **verdict pill** (YES/NO + one-line why), then the gantt with
raw-hex compound colors and lap-range labels in-bar. Restyle to vNext; keep the honest verdict. No track
map (temporal). Mockup + rationale.

## 13 · pace_cliff  (attach `shots/10_pace_cliff.png`, A−)
Next card: the **pace-cliff** line (one driver's stint lap-times, cliff = where pace falls off). Same
vNext system. Mark the cliff lap explicitly, compound context in the subtitle, lead with the cliff lap +
delta as tiles. Temporal — no track map. Mockup + rationale.

## 14 · wet_crossover_dual_axis  (attach `shots/12_wet_crossover_dual_axis.png`, A−)
Next card: the **wet→dry crossover** dual-axis (lap time vs track-status/grip over laps; crossover =
inter→slick switch lap). Same vNext system. Make the **crossover lap** the hero marker, dual axes clearly
labeled, teammate primary/secondary colors. Temporal — no track map. Mockup + rationale.

## 15 · race_trace  (attach `shots/14_race_trace.png`, A)
Next card: the **race trace** (gap-to-leader evolution, full field, over/under-cut verdict). Same vNext
system. Keep the multi-line trace but emphasize the story lines (winner + biggest mover), dim the pack,
lead with the over/undercut verdict. Temporal — no track map. Mockup + rationale.

## 16 · position_changes  (attach `shots/15_position_changes.png`, A− — but reads busy at full field)
Next card: the **position-changes bump chart** (grid → finish, full field). Same vNext system. The known
weakness: full-field spaghetti reads chaotic. Redesign: **emphasize the winner + biggest climber/faller**
(bold, team color), dim everyone else, annotate the start/end positions of the emphasized lines. Temporal
— no track map. Mockup + rationale + mobile reflow.

## 17 · track_corner_delta  (attach `shots/20` — not captured; regen: "Compare Verstappen and Norris's apex speed and pace delta through each corner on their Silverstone 2025 fastest laps.", A) — SPATIAL
Next card: the **two-driver brake-zone / corner-delta track map** (corners highlighted on the real circuit
outline). Same vNext system — make it **consistent with corner-delta card #1** (same node/ladder motif).
Corner nodes sized/colored by the metric on the runtime track-outline geometry; a who's-faster-where
ladder beside it. **Routing note (important):** this only routes today for the **existing two-driver
brake-zone shape** (`corner_label` + `apex_min_speed_kph` + `shared_pace_delta_s` + `zone_f0/zone_f1`).
Keep the prompt a **two-driver corner comparison** — a single-driver "which corners did X brake latest"
is a *different shape* that would need a new template + detector, so tag that variant as new work rather
than assuming it renders. Mockup + rationale.

## 18 · track_heatmap  (attach `shots/19` — not captured; regen: "Show the mini-sector dominance between Verstappen and Norris on their fastest laps at Silverstone 2025.", A) — SPATIAL
Next card: the **mini-sector dominance ribbon** (who's faster in each mini-sector). Same vNext system.
Render the full circuit outline colored by per-mini-sector dominance (both drivers in raw-hex team
colors), plus the `dominance_legend` (both drivers + sector counts). Use the real
`track-maps/12_silverstone` outline. Mockup + rationale.

## 19 · track_speed_map  (attach `shots/21_track_speed_map.png`, A — standout) — SPATIAL
Next card: the **single-lap speed map** (fastest/slowest sections of one driver's lap, our standout
visual). Same vNext system — this one mostly needs a **vNext restyle**, not a redraw: keep the
speed-gradient-along-the-real-outline, add mono eyebrows + answer-at-a-glance (top speed + slowest
corner as tiles), tidy the legend. Real outline already used. Mockup + rationale.

## 20 · telemetry_overlay  (attach `shots/22_telemetry_overlay.png`, A−) — add mini-map
Next card: the **fastest-lap telemetry overlay** (two drivers' speed/throttle/brake traces vs distance).
Same vNext system, teammate primary/secondary colors. **Track-map angle (add it, and it's low-risk):**
the x-axis is distance-along-lap, so **add a mini track-map that highlights where the biggest speed delta
occurs** — "how much faster" → "where faster." This is **restyle-only for routing** (`telemetry_overlay`
already routes from `overlay_session_key` + `fastest_lap_number`); the map can reuse the **existing
`/api/lap-telemetry` normalized lap-fraction + corner data mapped onto the runtime track-outline
geometry** — no new detector. Mockup + rationale + mobile reflow.

---

That's all 27 visuals covered (11 in Part 1 + this batch of 16). After these, the deck is complete and
ready for the `</>` handoff back to the repo.

## Implementation-risk split (repo-grounded, for the handoff — not for Claude Design)
Which redesigns route on the **existing** pipeline (restyle-only) vs need **new detector/template/data**:
- **Restyle-only (routes today):** scatter, hero, horizontal_bar, horizontal_bar_diverging,
  verdict+stint_gantt, pace_cliff, wet_crossover, race_trace, position_changes, track_heatmap,
  track_speed_map, telemetry_overlay (incl. its added mini-map — reuses `/api/lap-telemetry`).
- **Needs new detector/template/data (mockup is a target, not yet routable):**
  - **corner-delta #1 / #17** — only the two-driver brake-zone shape routes; a generic corner-speed
    comparison hits `grouped_bar`. New deterministic template + detector to land the track-map version.
  - **composite #6** — a spin-location pin needs real corner/lap-fraction data for the incident.
  - **no-data #7** — a richer factual card may need structured "what we have" fields beyond `body`.
  - **clarification #8** — structured choice/resolution UI+API work, not a detector.
- **Also carry into implementation:** deterministic title fallback (fixes the scatter raw-prompt bug),
  and decide the 3 dead renderers (`delta_comparison`, bare `timeline`, `donut`) — wire or delete.

_2ndopinion (GPT-5.5, xhigh) verdict on this set: REVISE → applied. Track-map discipline confirmed
correct; edits above address routing realism + the runtime track-outline source._
