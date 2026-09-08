# Analyst pipeline — design assessment & correction plan (2026-09-07)

**Status: CONVERGED (SHIP) — 4-pass GPT-5.6 Sol review, findings 10 → 4 → 2 → 0.**
Trigger: the Monza 2026 pilot recap got every number right and the story wrong
(diagnostic/monza_2026_recap_comparison.md). This document says WHY the
workflow missed it and WHAT to build before the corrected report is written.
Implementation has NOT started.

Reviewer's standing framing, adopted as Finding 0: **the improvised pilot
workflow failed; the platform itself remains unevaluated** — the pilot bypassed
both the deterministic-template and LLM-SQL routes, so no conclusion about the
product's ability to surface the VSC story can be drawn until U5 runs.

### A. Assessment — what actually failed (unchanged from v2)
Finding 0: the improvised workflow failed; the platform remains unevaluated. Faults: (1) early stopping without coverage/contradiction checks → VSC miss; (2) no separation of observed features from causal claims → invented L49 cause; (3) no event model (occurred vs issued time, typed links) → Pérez conflation; (4) voice template without a content contract → omissions; (5) evaluation measured style only; (6) the analytics layer's known lossy views cannot serve as the editorial oracle.

### B. Design updates — vertical slice

**U1 — Canonical evidence packet from raw/core via versioned, fixture-tested transforms.** Monza-required scope only:
- *Event timeline*: every race-control row typed; `issued_at`/`issued_lap`; `occurred_lap`+corner+cars parsed from message text when present; typed links (`investigates` / `decides` / `penalizes`) ONLY on car + occurred-lap match, else `unresolved`.
- *Racing-state intervals* — exact contract: SC interval opens at the first "SAFETY CAR DEPLOYED" and closes at "SAFETY CAR IN THIS LAP"'s lap end or the next green/"TRACK CLEAR" message, whichever is first; VSC opens at "VSC DEPLOYED", **"VSC ENDING" is a warning and does NOT close it — "VSC ENDED"/green closes it**; red opens at "RED FLAG" and closes ONLY at the actual resumption green timestamp ("GREEN LIGHT" / first green state message after the suspension); "RACE WILL RESUME AT hh:mm" is an announcement recorded in `announcements[]` and never closes an interval. Duplicate state messages are idempotent; a missing endpoint closes the interval at the next contradictory state message and is flagged `endpoint_inferred`. Every interval carries both timestamps and lap bounds.
- *Stint/pit overlay*: compounds + tyre age per driver per lap; a stop's caution class is decided by **interval overlap of [pit_entry_ts, pit_exit_ts]** with the racing-state intervals: fully inside → that class; spanning a boundary → `boundary_spanning` with both classes and the fraction inside each; no overlap → green.
- *Position & gap trace* — exact mapping: an observation at time t belongs to the lap whose [date_start, next date_start) contains t for that driver; when several observations fall in one lap, the packet keeps the LAST (lap-end state) and stores all in an `observations[]` array. "Before X" = the last observation strictly before X's timestamp; "after X" = the first observation after X's end timestamp; both stored as as-of timestamps.
- *Restart snapshots*: the as-of order/gaps/compound/age immediately before the restart's green timestamp. Where only lap-mapped positions exist (no timestamp inside the window), the snapshot is labelled `approximation:lap_end` — never called a "restart grid" without that label.
- *Results/standings*: official result with status + last completed lap; grid; championship points before/after; pole-sitter fate; movers.
- *Caution event-window record* (per SC/VSC/red): before/after as defined above; stops inside the interval with their overlap class; **observed gap/position change across the stop** (explicitly NOT a controlled pit-loss figure — field compression and simultaneous moves are not netted out); a LABELLED ESTIMATE of expected green-flag loss (circuit median lane time + stated assumption); pace delta the beneficiary then needed.
- **Generic anomaly window** (new): for EVERY material discontinuity the story uses — gap jumps, position swings, lead changes, lap-time spikes, DNFs — the packet materialises a local window: nearby race-control rows (±2 laps), the timestamped position/gap observations, lap and sector times, pit activity, and any unresolved links. Any explanation of a discontinuity must cite its window or be marked `cause:unknown`. (For Monza L49: the window holds the gap bounce, the lap-time spike, and — if present — the off-track/deleted-lap message; absent a message, the cause stays unknown rather than "resistance".)
- *Candidate moments*: salience-scored (caution × pit cluster, order change, gap discontinuity, sustained <1s then swap, penalties). **Human-added candidates permitted with a recorded reason** — the heuristic list is not a closed universe.
- *Data-quality manifest*: sources, row counts, known-limit notes, `endpoint_inferred`/`approximation` flags, NOT AVAILABLE list.
- *Fixtures* (transform tests): delayed messages, missing interval endpoints, duplicate state messages, boundary-spanning stops, multiple observations per lap, VSC ENDING-vs-ENDED, a penalty citing an earlier lap, **announcement-before-restart (RACE WILL RESUME issued, delay, then GREEN LIGHT — interval must close at the green)**.

**U2 — Content contract**: beats resolved `covered` / `not material` / `not available` with a reason; race-control record ≠ quotation; secondary stories by salience OR strategic significance. (Unchanged.)

**U3 — Typed sidecar (scoped) + narrow verifier.** Sidecar entries ONLY for causal_interpretation, derived_metric, and disputed-chronology claims (trivial observations are traceable through the packet without entries). Verifier checks schema, arithmetic, references, chronology consistency, and contract-beat resolution — nothing else. Broad causal-language detection only flags sentences that lack a sidecar entry.

**U3b — Causal review gate (new, replaces "human-reviewed").** Every causal_interpretation claim gets a recorded outcome: `accepted` / `qualified` (with the qualification text that must appear in the draft) / `rejected` / `unresolved`, plus an explicit decision on the asserted relation and on the strongest alternative. **Publication fails on any rejected or unresolved claim marked material.** For this pilot there is one developer, so this is honestly labelled **structured self-review** — the reviewer works from the packet windows, not the draft — and the frozen blind evaluation is the external check.

**U4 — Editorial sequence**: packet → candidates (+ human additions) → thesis → mandatory counter-thesis with supporting and rejecting rows → contract resolution → draft + scoped sidecar → verifier → linter → judge → causal review gate. (Unchanged except the gate.)

**U5 — Platform probe** on both runtime paths, five question tiers, full routing record, reconciliation → gap list. (Unchanged.)

**U6/U7 — Evaluations.** Blind (frozen by hash before reference exposure) and assisted (labelled) remain separate. Metrics now at TWO levels:
- claim level: weighted mechanism recall, unsupported-causal-claim rate, contradiction rate vs packet, precision;
- **thesis level (new, human-labelled)**: primary-thesis correctness (does the headline explanation match the reviewed mechanism?), mechanism-chain correctness link by link (each asserted `A → B` accepted/rejected), causal salience/ranking (is the decisive mechanism treated as decisive, or demoted to a secondary event?), and false-mechanism severity (a wrong headline mechanism is a fail regardless of per-claim rates). A report scores PASS only at both levels, **and publication requires that two-level PASS — completing the frozen evaluation is not sufficient for release.**
The Monza moment inventory for scoring is hand-built from the seven reference pieces; the claim extractor graduates to oracle only after G5 adjudication.

### C. Corrected-report order (unchanged): evidence contract + fixtures → minimal Monza packet (independent of chat) → evidence ledger + mechanism via event-window + counter-thesis → causal review gate → U5 probes both paths → reconciliation → write + sidecar → verifier → linter → judge → freeze by hash → blind eval (both metric levels) → labelled assisted pass → blind pair v2 → generalize only after Monza + two structurally different races.

### D. Non-goals (unchanged): no new matviews/templates; no location-based corner detection; no posting automation; no rights-model changes.

---

## Review log (GPT-5.6 Sol, 4 passes, 2026-09-07)

- **Pass 1 (REVISE, 10):** reframe workflow-vs-platform; don't make the lossy
  analytics views (034 stewards-only, 037 not caution-adjusted, 040 no red-flag
  restart grids, 042 NULL corners, 043 mislabelled overcut) the editorial oracle
  — canonical raw/core packet + separate platform-observed packet, reconcile, no
  silent fallback; U1 too broad, add the caution event-window record; verifier
  checks provenance not entailment, typed sidecar, human causal review; event
  identity with occurred vs issued time and typed links; detector emits
  candidates never "decisive"; probes split by tier and by runtime path; blind
  vs assisted evaluations kept separate; content contract conditional not
  mandatory prose; sequence reordered.
- **Pass 2 (REVISE, 4 + proportionality):** generic anomaly window for every
  material discontinuity (the L49 case), human-added candidates; thesis-level
  human-labelled evaluation (primary-thesis correctness, mechanism-chain
  link-by-link, causal salience, false-mechanism severity); human review as a
  defined gate with per-claim outcomes, honestly labelled structured
  self-review; exact temporal semantics (lap mapping, before/after, interval
  endpoints, VSC ENDING vs ENDED, overlap-classified stops, boundary-spanning
  stops, as-of restart snapshots); trims (scoped sidecars, narrow verifier,
  Monza-only transforms).
- **Pass 3 (REVISE, 2):** red-flag interval must close on the actual green, not
  the "RACE WILL RESUME" announcement (+ fixture); publication gated on the
  two-level evaluation PASS.
- **Pass 4 (SHIP):** "The design is ready to implement."
