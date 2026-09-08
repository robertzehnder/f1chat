# Platform reconciliation — Monza 2026 (analyst design U5)

*Platform-observed packet (probe.json, 14 questions × 2 routes) reconciled
against the canonical packet. Routing fact that reframes everything: **27 of
28 requests went to LLM-SQL** (queryPath `anthropic` / `anthropic_repaired`);
only a4 hit a deterministic template. The "natural vs LLM-only" comparison
therefore mostly sampled the same route twice — and the two samples
contradict each other on the VSC. The deterministic layer has effectively no
coverage of race-narrative questions.*

## Per-question verdicts (vs canonical packet)

| id | tier | question | natural | llm-only | verdict |
|---|---|---|---|---|---|
| d1 | discovery | Why did Antonelli beat Russell? | "two-stop vs one-stop" | same | **WRONG (shallow)** — stop counts, no VSC, no tyre offset, no closing rate |
| d2 | discovery | How did he win from 19th? | narrative with positions; "held the lead for the remainder" | "two-stop strategy" | **WRONG** — he lost the lead L23 and retook it L50 (packet lead_changes); L3 stop "likely red-flag/VSC" is a guess |
| t1 | timeline | Decisive events? | position-change summary, no mechanism | mass stop L4 "likely SC" (it was the red flag); incidents ✓ | **PARTIAL** — LEC/HAM T2 review and PER/COL start notes found; VSC absent |
| t2 | timeline | SC/VSC/red periods | "one SC, one red; **no VSC recorded**" | SC L3, red L3, restart behind SC L4, **VSC L28–29** ✓ | **CONTRADICTORY** — same route, one answer fabricates the absence of the VSC |
| a1 | atomic | VSC cause | zero rows | zero rows | **HONEST** — cause not in race control (packet agrees) |
| a2 | atomic | Who pitted under the VSC, compounds | zero rows | zero rows | **GAP** — computable (pit × stints × racing-state intervals; packet has 7 stops with compounds) |
| a3 | atomic | Gap over last 10 laps | "pulled away … -0.784 → -8.588" | "consistently faster … pulling away"; M vs H ✓ | **WRONG DIRECTION** — answered from lap-time deltas, not gap_to_leader; he was BEHIND until L50; L49 attributed to "blue flag" (invented; packet: track-limits deletion T1) |
| a4 | atomic | Compounds per stint | template `max_leclerc_compounds_used` ✓ | ✓ | **CORRECT** (both) |
| a5 | atomic | Restart position after red | zero rows | zero rows | **GAP** — computable (as-of position snapshot; packet: P12) |
| a6 | atomic | Championship gap | 66 ✓ | 66 ✓ | **CORRECT** (both) |
| x1 | adversarial | Won on pure pace? | "**emphatically** pure pace … **zero disrupted laps (0 SC/VSC/red)** … not a safety-car windfall" | stop counts | **WRONG + FABRICATED ABSENCE** — the exact v1 error, plus a false claim that contradicts race control |
| x2 | adversarial | Did Russell lose it by a mistake? | "finished P2, not last…" | "did not lose…" | **DODGE** — no analysis of the VSC decision (packet: unresolved, so a dodge is defensible) |
| u1 | unsupported | Corner of the pass | "data does not contain explicit position" | same | **HONEST** |
| u2 | unsupported | Gravel while attacking Russell? | "no race control messages … penalty or investigation" | "only two incidents (RUS yellow flag)" | **WRONG** — rc145 "CAR 12 (ANT) TIME 1:28.582 DELETED - TRACK LIMITS AT TURN 1 LAP 49" exists; the incidents view (034) keeps only stewards' messages |

Score: correct 2 (a4, a6), honest refusals 2 (a1, u1), partial 1, dodge 1, gaps 2, wrong 5 (including one fabricated absence).

## Gap list (for the adjudication sheet; category per the 6-way taxonomy)

| id | Gap | Category | Evidence it is computable |
|---|---|---|---|
| G1 | Caution-aware pit classification: who stopped under SC/VSC/red, with compound before/after | calculable-but-missing-metric | packet `stops[*].class`, `caution_windows[*].stops_inside` (overlap of pit interval with racing-state intervals) |
| G2 | Restart-order snapshot after red/SC/VSC | calculable-but-missing-metric | packet `restart_snapshots` (as-of position/gap before the resumption timestamp; labelled approximation when no observation inside the window) |
| G3 | Racing-state intervals as a first-class object (SC/VSC/red with inferred-endpoint flags) so "how many disrupted laps" cannot return zero | calculable-but-missing-metric + **honesty bug** | packet `timeline.intervals`; x1/t2-natural fabricated absence |
| G4 | Track-limits deletions and non-stewards messages invisible to incident queries | **platform bug** (lossy view 034: stewards-only filter) | rc145 in raw.race_control; absent from analytics.race_control_incidents |
| G5 | Gap evolution from `intervals.gap_to_leader` per lap, not lap-time differencing | calculable-but-missing-metric + reasoning bug | packet `position_trace[*].gap` (0.264 → 0.871 → lead); a3 answered "pulled away" while behind |
| G6 | Lead-change sequence from position_history | calculable-but-missing-metric | packet `lead_changes` (6 changes); d2 said "held the lead" |
| G7 | "Why did X beat Y" mechanism synthesis (tyre offset + caution-priced stop + closing rate) | calculable-but-missing-metric (composite of G1/G3/G5) | the ledger's mechanism chain is entirely packet-derived |
| G8 | LLM-SQL nondeterminism on interruption facts (t2: no VSC vs VSC) | platform bug (route stability) | identical question, same route, contradictory answers |

Gaps G1–G3 and G5–G6 are exactly what race_packet.mjs already computes deterministically; the deterministic-card recipe (6 files) is the path to platform features. G3/G4 are honesty bugs and should rank first: a fabricated absence on a public product is the P0 class the golden-set audit identified.

## What the probe proves about the pilot's original question
The pilot asked "does the base platform support the analysis required?" The answer, now measured: the **warehouse** does (every fact in the corrected report came from raw tables), the **product** does not yet — it cannot discover the mechanism, cannot classify stops against cautions, cannot snapshot a restart, mis-reads gap evolution, and in one of two samples denies the VSC existed. Route-level: the deterministic layer is absent from this question class; the LLM-SQL layer is capable (t2-llm, a4-llm, a6) but unstable and prone to fabricated absence under adversarial framing.
