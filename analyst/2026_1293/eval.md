# Two-level evaluation — Monza 2026, pilot v1 vs corrected v2

*Analyst design U6/U7. Label: **ASSISTED** for v2 (see freeze.json) — the
author had read the reference pieces before writing. Scores are structured
self-review labels, not independent adjudication. Reference moment inventory
hand-built from the seven pro pieces (The Race ×3, Straw, F1.com, Sky, FIA);
the claim extractor is not yet the oracle.*

## Reference moment inventory (weights: decisive mechanism 3, near-miss 2, others 1)

| id | Moment | w | v1 (pilot) | v2 (corrected) |
|---|---|---|---|---|
| M1 | Leclerc crash → red flag | 1 | 1 | 1 |
| M2 | Hamilton–Leclerc first-chicane contact | 1 | 0.5 (hedged, cause implied) | 1 (stewards' note quoted; causation withheld) |
| M3 | Restart from 12th; 7 places in 2 laps | 1 | 0 | 1 |
| M4 | Antonelli to the lead by L18 | 1 | 1 | 1 |
| **M5** | **VSC free stop; medium vs ageing hards — the mechanism** | **3** | **0** | **3** |
| M6 | L49 excursion at the first chicane | 2 | 0 (misread as Russell's resistance) | 2 (cause shown in the anomaly window) |
| M7 | Winning pass L50 (corner: Lesmo 2/Ascari) | 1 | 0.5 (lap only) | 0.5 (lap only; corner `not available`) |
| M8 | Gasly pole → 7th | 1 | 0 | 1 |
| M9 | 66-point championship lead | 1 | 0 | 1 |
| M10 | Verstappen's parallel VSC stop, P7→P3 | 1 | 0 | 1 |
| M11 | Driver/team quotation | 1 | 0 | 0 (`not available`, labelled) |
| M12 | Tsunoda start-procedure referral / appeal | 1 | 0 (attributed to Pérez) | 0.5 (referral in data; appeal not) |
| | **Weighted mechanism recall** | 15 | **3.0 / 15 = 0.20** | **13.0 / 15 = 0.87** |

## Claim-level metrics

| Metric | v1 | v2 |
|---|---|---|
| Unsupported-causal-claim rate (causal claims without evidence or attribution) | 2 / 4 = **50%** ("pure pace"; "Russell's resistance") | 0 / 5 = **0%** (all reviewed: 2 accepted, 3 qualified with the qualification in the text) |
| Contradiction rate vs canonical packet | **3** (win mechanism; L49 cause; Pérez penalty timing) | **0** |
| Precision (supported claims / total claims) | numbers 12/12; causal 2/4 → **0.88** | 14/14 → **1.00** |
| Extra supported findings not in the reference inventory | gap trace, fastest lap, Pérez penalty (mis-timed) | gap trace, fastest lap, Pérez penalty (correctly linked), lap-number adjudication, red-flag tyre split as the origin of the offset |

## Thesis-level (human-labelled, structured self-review)

| Measure | v1 | v2 |
|---|---|---|
| Primary-thesis correctness | **WRONG** — "earned on pace, unlocked by circumstance" with the circumstance being the red flag; the VSC is absent | **CORRECT** — tyre split at the red flag + VSC-priced stop + closing rate on old hards |
| Mechanism-chain correctness (link by link) | 1 / 4 links supported (lead by L18) | 5 / 5 links accepted or qualified (CL1, CL4, D1–D3, CL2) |
| Causal salience / ranking | decisive mechanism not present, so cannot be ranked | decisive mechanism is the headline and the second section; counter-thesis explicitly demoted |
| False-mechanism severity | **HIGH** — the headline mechanism is false | none |
| Two-level result | **FAIL** (thesis level) | **PASS** (both levels) |

## What each update caught (traceability of the fix)

| v1 defect | Caught by |
|---|---|
| VSC mechanism missed | U1 full race-control typing + racing-state intervals + caution event-window (stops inside, observed change vs estimate) + pit-cluster candidate `m_vsc_28` at salience 1.0 |
| L49 cause invented | U1 lap-time-spike candidate `m_lapspike_ANT_49` → anomaly window containing rc145 (track-limits deletion, Turn 1) and the +4.3 s sector-1 |
| Pérez penalty mis-timed | U1 typed links (car + infringement subtype) → rc114 ↔ rc95/rc100; the lap-1 start note left unlinked |
| Restart-grid caveat omitted | U1 restart snapshot (labelled approximation) + content contract C6 |
| Standings / pole-sitter omitted | U1 standings block + contract C5/C7 |
| No quotation | Contract C9: race-control messages verbatim; driver quotes marked `not available` |
| "Pure pace" thesis | U4 mandatory counter-thesis, decided by D3 arithmetic |
| Machine tells / table / wrap-up | style_lint (8 tells → 0) |

## Caveats on this evaluation
- Assisted, not blind: the inventory and the author's exposure come from the same references. A blind run on an unseen race is the first real test of discovery.
- The green-flag pit cost is an ESTIMATE (median lane time); D2/D3 inherit that.
- SC-period end after the red flag is inferred at lap-4 end; laps 5–6 were slow field-wide, so the restart procedure ran longer than the packet's interval — the report does not depend on it.
