# Chart-card response rubric

Grading contract for `randomized_sweep.mjs` (and adoptable by
`baseline_sweep.mjs`). Every sweep item is scored on seven dimensions.
Five are checked mechanically by the script; two need judgment and are
scored by an LLM judge (`--judge`, uses `ANTHROPIC_API_KEY` from
`web/.env.local`). The final letter is the **worse** of the mechanical
grade and the judge grade.

## Dimensions

| # | Dimension | Question it answers | Graded by |
|---|-----------|--------------------|-----------|
| D1 | Resolution | Did the pipeline resolve the right session? Rows must carry `year = 2025` and a location/country matching the venue in the prompt; every driver named in the prompt must appear in the rows. | mechanical |
| D2 | Data sufficiency | Did the query return enough rows to draw the intended chart (per-family minimum below)? Not refused, not empty, not silently truncated. | mechanical |
| D3 | Chart shape | Did the detector registry pick the expected chart type, and does the emitted spec have non-empty series/segments? | mechanical |
| D4 | Insight completeness | Yes/no prompts carry a verdict; the card has a title plus at least one metric or takeaway. | mechanical |
| D5 | Honesty | No verdict over a hedged answer; refusals only when data is genuinely absent; caveats present where the data demands them (change-feed semantics, best-lap-not-same-moment, etc. — caveat *presence* is judged, contradiction is mechanical). | mechanical + judge |
| D6 | Factual consistency | Do the numbers and claims in the answer text and verdict actually follow from the returned rows? Is the verdict the sound reading of the data? | judge |
| D7 | Communication | Is the answer clear, complete for the question asked, and does the chosen chart fit the question even beyond type-matching (right drivers focused, right axis framing)? | judge |

Latency is recorded and warned on (deterministic > 20 s, LLM path > 90 s)
but never changes the letter on its own.

## Letter grades

Mechanical problems carry a severity: **fail** (wrong chart, wrong
session, missing driver, 0 rows, refused, verdict missing/contradicted)
or **warn** (below row minimum but drawable, no metrics/takeaways,
slow, venue unverifiable from rows).

- **A** — no fails, no warns.
- **B** — warns only.
- **C** — exactly one fail.
- **F** — two or more fails, or the request itself errored.

The judge scores D5–D7 each 0–2 (2 = fully sound, 1 = minor issue,
0 = wrong/misleading) and maps to a letter: A = 6 with no zero,
B = 4–5 with no zero, C = 2–3 or any single zero, F = otherwise.
**Final grade = max(severity) of the two letters.**

## Per-family row minimums (D2)

| family | min rows | rationale |
|--------|---------:|-----------|
| race_trace / over_cut | 100 | full-field gap trace needs many laps × drivers |
| deg_curve | 6 | ≥2 compounds × ≥3 age points |
| position_changes | 15 | full field incl. synthetic lap-0 grid rows |
| telemetry_overlay | 2 | one row per driver (fastest lap each) |
| strategy_split | 3 | ≥2 stints + both drivers |
| stint_delta | 2 | ≥2 stints to show a delta evolving |
| brake_zones | 3 | three heaviest zones |
| sector_dominance | 3 | three official sectors |
| speed_map | 50 | dense outline samples for the gradient |
| lap1_launch | 2 | both drivers |
| wet_crossover | 10 | enough laps to show the crossover window |
| radar | 7 | seven axes |
| pit_stop | 1 | single event |

## A-gate per-dimension pass criteria (roadmap_to_A_grade_2026-07-02.md)

An "A" is **measured** by `scripts/health/a_gate.mjs`, not asserted. Each graded
dimension has a pass criterion and the concrete gate step that enforces it. The
gate exits non-zero if ANY step fails or is not yet wired (no silent gaps), and
records the **worst** of N runs (no best-of retries).

| Dimension | A means | Gate step (a_gate.mjs) | Phase |
|-----------|---------|------------------------|-------|
| **Surface completeness** | every derived templateKey / detector / generationSource / failure sub-state / materialized layer / client-fetch edge / renderer slot is classified in `a_surface_manifest.json` (fail on any unclassified) | `surface-coverage` | 0 |
| **Migration integrity** | full chain deploys to a clean DB, verifies, and the 028→051 segment reverts + re-applies + verifies (file parity 51/51/51) | `migration` | 1 |
| **Data correctness** | source grains correct (unique lap grain, COUNT(DISTINCT) traffic, deduped weather, official grid/finish); every hard-truth templateKey validated vs FastF1/official on ~8 sampled 2025 races within tolerance | `external-truth` | 3 + 3.5 |
| **Honesty + grade-gate** | judged sweep over the full gated surface + expanded families (DNF/SC/team-vs-team/refusal/ambiguous-venue/wrong-session), ≥3 seeds, cold/warm/concurrent: zero fabricated absence, zero verdict-over-hedge, validators GATE (not just trace), judge factual/honesty/comms A-band; `rows>0` earns at most C | `judged-sweep` + base `verify` | 4 |
| **Reliability / perf** | deterministic-template p95 < 8 s cold / < 4 s warm, zero statement timeouts, cold+warm+concurrent; client-fetch APIs (`/api/track-outline`, `/api/lap-telemetry`) in the SLO and data-versioned | `perf-slo` | 2 |
| **Visual** | Playwright over every `pixel-gated` renderer branch + card slot on `/mock` + live fixtures (mobile+desktop): non-blank, no overflow/clipping, axis labels visible, no off-scale; client-fetch charts populate after their real API fetch | `pixels` | 5 |

Methodology-scoped templates (see `a_surface_manifest.json` truthTier) are NOT
claimed as external truth: "A" for them = internally consistent + inference
method disclosed in an in-card caveat + per-family plausibility fixture passes.
Their latency floor on the LLM path is out of the perf-A surface (declared here),
in the honesty-A surface (must stream honestly within the 90 s request budget).

## Formerly-"known gaps" — now gated, not acknowledged-and-ignored

These were listed as ungraded gaps before the roadmap. They are now first-class
gate steps (PENDING until their phase lands; the gate reports INCOMPLETE, not a
false PASS, until then):

- **Rendered visual quality** → `pixels` step (Phase 5), Playwright over `/mock`
  + live fixtures. No longer "manual/preview only."
- **External ground truth (rows-vs-reality)** → `external-truth` step
  (Phase 3.5), FastF1/official for the hard-truth tier. D6 (answer-vs-rows) is
  the sweep's job; rows-vs-reality is now separately measured.
- **Wrong-but-plausible session resolution with no venue columns** — the honesty
  sweep now includes wrong-session / ambiguous-venue trap fixtures (Phase 4).
