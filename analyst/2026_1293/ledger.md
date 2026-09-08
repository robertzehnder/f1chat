# Evidence ledger — 2026 Italian Grand Prix (session 11361)

*Analyst design U4: packet → candidates → thesis → counter-thesis → causal
review gate → THEN prose. Every entry cites the canonical packet
(analyst/2026_1293/packet.json, race_packet@1). Review mode: **structured
self-review** (one developer; no independent reviewer) — outcomes recorded
per claim; the frozen blind evaluation is the external check.*

## 1. Evidence ledger (observations; packet paths)

| # | Observation | Packet reference |
|---|---|---|
| E1 | Result: ANT P1 (grid 19), RUS P2 (grid 2), VER P3 (grid 5), NOR P4, PIA P5, HAM P6, GAS P7 (grid 1 = pole). Margin 3.857 s (RUS gap L53). | `results`, `position_trace.RUS[52].gap` |
| E2 | DNFs: LEC last completed lap 2; ALO lap 24; STR lap 27. | `results[*].last_completed_lap` |
| E3 | Lap 3: "SAFETY CAR DEPLOYED" 13:06:49Z then "RED FLAG - RACE SUSPENDED" 13:07:43Z. Announcement "RACE WILL RESUME AT 15:39". Resumption via "SAFETY CAR LIGHTS ON" 13:34:00Z (red endpoint inferred: resumption_state_msg; SC period to lap-4 end inferred: lights_on_lap_end). | `timeline.intervals[0..2]`, `timeline.announcements` |
| E4 | Under the suspension 21 cars changed tyres (stops classified boundary_spanning against the red interval; pit.date = exit semantics). ANT HARD→MEDIUM; RUS MEDIUM→HARD; VER SOFT→MEDIUM; GAS MEDIUM→HARD. | `caution_windows[1].stops_inside`, `stints` |
| E5 | Restart order after the red (approximation:lap_end): RUS P1, GAS P2, VER P3, COL P4, PIA P5, NOR P6, LIN P7, HAM P8, BEA P9, OCO P10, BOR P11, **ANT P12**. ANT was P14 at lap 1, P12 at lap 2. | `restart_snapshots[1]`, `position_trace.ANT[0..1]` |
| E6 | Lead sequence: RUS L2 → VER L12 → RUS L15 → **ANT L18** → RUS L23 → **ANT L50**. | `lead_changes` |
| E7 | Before the VSC (lap 28) ANT was P2, 0.52 s behind RUS, both on 24-lap-old tyres: ANT MEDIUM, RUS HARD. ANT had closed from 0.55 s (L26) / 0.58 (L27) / 0.28 (L28). | `caution_windows[3].before_top10`, `position_trace.ANT[25..27]` |
| E8 | "VSC DEPLOYED" lap 28 14:17:45Z; "VSC ENDING" lap 29; interval closed 14:19:42Z by "TRACK CLEAR" (no inference flag). STR's last completed lap is 27 (E2) — coincident with the VSC; the feed does not state the cause. | `timeline.intervals[3]`, `results` (STR) |
| E9 | Stops inside the VSC interval: HUL, SAI, OCO, PER, BOT (lap 27), **ANT (lap 28, 24.9 s lane, MEDIUM→MEDIUM)**, **VER (lap 28, 24.9 s, MEDIUM→HARD)**. RUS did not stop (HARD, lap 4 → lap 53, tyre age 49 at the flag). | `caution_windows[3].stops_inside`, `stints` (RUS) |
| E10 | Observed change across ANT's VSC stop: P2 → P5, gap to leader 0.52 s → 13.68 s. VER: P3 → P7, 1.86 → 15.48 s. Median green-flag pit-lane time this race: 31.1 s (labelled ESTIMATE of a green stop's cost, assumption recorded in the packet). | `caution_windows[3].observed_change`, `caution_windows[3].estimate_green_flag_loss_s` |
| E11 | ANT gap to leader after the restart: L29 14.30 → L34 10.65 → L40 7.06 → L44 3.95 → L45 2.80 → L46 1.70 → L47 0.97 → L48 0.26 → L49 0.87 → L50 lead. | `position_trace.ANT[28..49].gap` |
| E12 | Lap times L47–L51 — ANT: 84.13, 84.57, **88.58 (S1 32.03 vs ~27.7)**, 84.12, 84.40. RUS: 84.86, 85.28, 87.98, 86.21, 84.39. | `anomaly_windows[m_lapspike_ANT_49].laps` |
| E13 | Race control, lap 50: "CAR 12 (ANT) TIME 1:28.582 DELETED - TRACK LIMITS AT TURN 1 LAP 49". | `timeline.events` rc145 (occurred_lap 49, corner 1) |
| E14 | Fastest lap: ANT 83.504 (lap 53); next-best non-ANT: VER 84.242. ANT also 83.861 (L46), 84.037 (L45). | `fastest_laps` |
| E15 | Standings: ANT 242 → 267, RUS 183 → 201 (gap 66), HAM 191, NOR 171. | `standings_after` |
| E16 | GAS from pole: P2 by lap 2, P3 lap 7, P6 lap 10, finished P7; one stop (red flag) MEDIUM→HARD; no incident rows in his windows. | `position_trace.GAS`, `stints` (GAS) |
| E17 | PER: lap-1 note "PRACTICE START INFRINGEMENT" (rc2/rc3, investigated after the race); lap-25 "TURN 1 INCIDENT … ESCAPE ROAD INSTRUCTIONS" (rc95, rc100); lap-30 "5 SECOND TIME PENALTY … ESCAPE ROAD INSTRUCTIONS" (rc114) — linked to rc95/rc100 on car+subtype, NOT to the start note. | `timeline.links`, `timeline.events` |
| E18 | TSU: "STARTING PROCEDURE INFRINGEMENT" noted lap 7 (rc78), "WILL BE INVESTIGATED AFTER THE RACE" lap 11 (rc82); no decision row in the feed. | `timeline.events` rc78, rc82 |
| E19 | LEC/HAM: "TURN 2 INCIDENT INVOLVING CARS 16 (LEC) AND 44 (HAM) NOTED" lap 2 (rc28); "REVIEWED NO FURTHER INVESTIGATION" (rc64). LEC's retirement (E2) is the same lap; the feed does not describe the crash. | `timeline.events` rc28, rc64 |
| E20 | Manifest flags: red/SC endpoints inferred (E3); pit.date treated as exit; NOT AVAILABLE: radio, stewards' reasoning, overtake corners, controlled pit-loss. Laps 5–6 are slow field-wide (restart procedure) — the SC-period end is an under-estimate. | `manifest` |

## 2. Derived metrics (arithmetic on packet fields; each is a sidecar `derived_metric`)

- **D1 Closing rate L40→L48:** (7.06 − 0.26) / 8 laps = **0.85 s/lap** (E11).
- **D2 Gap-cost of ANT's VSC stop:** 13.68 − 0.52 = **13.2 s** observed (E10) vs **31.1 s** estimated green cost → **≈ 18 s cheaper** (ESTIMATE-based; labelled).
- **D3 Laps needed to erase a green-stop deficit at D1:** 31.1 / 0.85 ≈ **37 laps**; laps available after L28: **25**. (Counterfactual arithmetic — see CT1.)
- **D4 Tyre-age asymmetry at the pass (L50):** RUS HARD age 46; ANT MEDIUM age 21 (packet stint/age).
- **D5 Lap-49 excursion cost:** ANT L49 88.58 vs L48 84.57 = **+4.0 s**, of which S1 = +4.3 s over the L48 S1 (E12) — gap re-opened 0.26 → 0.87 (E11).
- **D6 Standings gap:** 267 − 201 = **66** (E15).

## 3. Thesis, counter-thesis, mechanism chain

**Thesis.** Antonelli won because the red flag set a tyre split (ANT medium vs RUS hard, E4), the medium was quicker but track position held him at 0.3–0.6 s behind Russell for laps 26–28 (E7), and the lap-28 VSC let him convert that pace: a stop that cost ~13 s instead of ~31 s (D2) put him fifth on fresh mediums with 25 laps to close 13.7 s against a hard tyre that would be 46 laps old at the pass (E9–E11, D4). At ~0.85 s/lap (D1) that was enough with three laps to spare; a lap-49 excursion at the first chicane (E12–E13, D5) cost one lap, and the pass came on lap 50 (E6).

**Counter-thesis (mandatory): "won on pure pace."** Supporting rows: fastest lap and the three quickest laps of the race are ANT's (E14); the L40–48 closing rate (D1). Rejecting rows: before the VSC, on EQUAL-age tyres, the faster car was stuck 0.3–0.6 s behind (E7) — pace alone was not converting; and without the VSC a green stop would have cost ~31 s (E10) needing ~37 laps to recover at D1 with only 25 available (D3). Verdict: pace was necessary, the VSC-priced stop was what made it sufficient. The counter-thesis is REJECTED as a sole cause, RETAINED as a component.

**Mechanism chain (each link reviewed below):**
`red-flag tyre split (E4)` → `medium faster but blocked (E7)` → `VSC-priced stop preserves offset with fresh rubber (E8–E10, D2)` → `0.85 s/lap on 40+-lap hards (D1, D4)` → `pass L50 despite L49 excursion (E6, D5)`.

## 4. Causal review gate (structured self-review; outcomes bind the draft)

| id | Claim (type) | Relation asserted | Outcome | Basis / qualification |
|---|---|---|---|---|
| CL1 | The VSC stop is what made the win possible (causal) | VSC → cheap stop → fresh-tyre offset → win | **qualified** | Accepted on observed gap change vs an ESTIMATED green cost; the draft must say the green-flag cost is an estimate. |
| CL2 | The lap-49 gap re-opening was Antonelli's own excursion at Turn 1 (causal) | track-limits excursion → +4 s → gap 0.26→0.87 | **accepted** | rc145 + S1 +4.3 s in the anomaly window; "gravel" itself is not in the data — the draft says "ran wide at the first chicane / lap deleted", not "gravel". |
| CL3 | The VSC was triggered by Stroll's stoppage (causal) | STR stop L27 → VSC L28 | **qualified** | Coincident in the data (E2, E8); cause not stated by race control → attributed to reporting in the draft. |
| CL4 | "Pure pace" was not sufficient on its own (causal, counter-thesis) | equal-age blockage + green-cost arithmetic | **accepted** | E7, D3. |
| CL5 | Pérez's 5 s penalty was for the lap-25 escape-road incident, not the start (observation-link) | rc114 ↔ rc95/rc100 | **accepted** | car+subtype link; the lap-1 start note was investigated post-race, no penalty row. |
| CL6 | The Hamilton contact caused Leclerc's crash (causal) | T2 incident → crash | **rejected as a claim** | Data has a noted T2 incident and a same-lap retirement; no causal evidence. Draft: report the stewards' note and the retirement, no causation. |
| CL7 | Gasly lacked race pace from pole (causal) | car pace → regression P1→P7 | **qualified** | Position trace shows steady regression with no incident rows (E16); car-vs-tyre cause not separable → "the Alpine could not hold the leaders" only. |
| CL8 | Russell should have pitted under the VSC (causal/opinion) | — | **unresolved, not material** | Requires an out-position estimate the packet does not carry; the draft does not make the claim; Russell's own view is `not available` (radio). |
| CL9 | Antonelli's restart from 12th, not 19th, qualifies the headline (observation) | — | **accepted** | E5 (labelled approximation). |

**Gate result:** no material claim rejected or unresolved → prose may proceed. CL6 is excluded from the draft by outcome; CL8 is not made.

## 5. Platform reconciliation (U5)
See analyst/2026_1293/platform_gaps.md. Summary: 27/28 requests routed to LLM-SQL (the deterministic layer covers only the compounds question); correct 2, honest refusals 2, partial 1, dodge 1, computable-but-zero-rows 2, wrong 5 — including a fabricated absence ("zero disrupted laps", "no VSC recorded") that contradicts race control, and the pilot's exact "pure pace" error reproduced by the product. Eight gaps listed (G1–G8); G3/G4 are honesty bugs and rank first.
