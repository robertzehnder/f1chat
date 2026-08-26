# F1 Fantasy Prediction — Plan (2026-08-26)

**End goal (friend's):** predict outcomes for the official F1 Fantasy game
(fantasy.formula1.com) well enough to pick winning teams. The friend's proposed
method — regression that "predicts where cars are on track" — is evaluated
below against alternatives. TL;DR: predict **finishing-order distributions**,
convert to **expected fantasy points**, then run a **team optimizer**; the
on-track-position regression is only needed for live in-race prediction, which
the fantasy game doesn't reward.

---

## 1. The game, and what actually needs predicting

Roster: **$100M budget, 5 drivers + 2 constructors**, 2 free transfers/round
(−10 pts per extra; 2026 nets transfers per round), $3M price floor, one DRS
Boost (2× one driver) every round + six once-per-season chips (Extra DRS 3×,
Wildcard, Limitless, No Negative, Final Fix, Autopilot).

### Driver scoring (per round)
| Component | Points |
|---|---|
| Qualifying P1..P10 | 10, 9, 8 … 1 |
| No quali time / quali DSQ | −5 / −15 |
| Race finish P1..P10 | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 |
| Position gained / lost (grid→flag) | +1 / −1 each |
| Each legal on-track overtake | +1 |
| Fastest lap | +10 |
| Driver of the Day (fan vote) | +10 |
| Race DNF / DSQ | −20 / −25 (DSQ now charged to constructor) |
| Sprint | same shape; sprint DNF −10 (2026 change) |

### Constructor scoring (per round)
Sum of both drivers, plus:
| Component | Points |
|---|---|
| Q2 progression (0/1/2 drivers) | −1 / +1 / +3 |
| Q3 progression (1/2 drivers) | +5 / +10 |
| Pit stop tiers (GP only) | <2.00s +20 · 2.00–2.19 +10 · 2.20–2.49 +5 · 2.50–2.99 +2 |
| Fastest stop of race / world record | +5 / +15 |

### Decomposition → prediction targets
Expected points are dominated, in order, by:
1. **Race finishing order** (position points + positions-gained coupling)
2. **Qualifying order** (its own points AND it sets the gained/lost baseline)
3. **DNF probability** (−20 swings; also kills position points)
4. **Overtake volume** (correlated with grid-vs-pace mismatch)
5. Constructor extras: **Q2/Q3 progression** (order model gives this free) and
   **pit-stop time tiers** (team-level stationary-time distribution)
6. Noise terms: fastest lap (pace + late-race free-stop dynamics), Driver of
   the Day (fan vote — model as popularity/underdog heuristic, low weight)

So the core problem is: **joint distribution over (quali order, finish order,
DNF) per race**, plus a small pit-stop-time model. Everything else is
bookkeeping over the scoring table.

---

## 2. Modeling options considered

### A. Friend's proposal: regression predicting car positions on track
Lap-by-lap car-position prediction is the *hardest* formulation (full field
interaction, strategy, SC timing) and its output still has to be collapsed to
finish order to score fantasy points. It's the right shape only for **live
in-race** prediction — which fantasy doesn't score (teams lock pre-quali).
**Verdict: not best practice for this goal; park it for a possible live mode.**

### B. Full race simulation (the existing race-simulation proposal)
Great for strategy counterfactuals in chat, and its Monte Carlo machinery
overlaps with what we need — but as a *fantasy* engine it models strategy
detail that mostly cancels out at the finishing-order level, and it needs the
hard multi-driver interaction work to be trustworthy for order prediction.
**Verdict: complementary, not the core. Build the sim for chat value; feed its
SC/variance pieces into the fantasy MC later.**

### C. RECOMMENDED: rating → order distributions → Monte Carlo → optimizer
Standard practice for this class of problem (and what the serious community
tools converge on):

1. **Pace ratings** per driver/team, updated race-to-race (exponentially
   weighted or Elo-style), from warehouse features: fuel-corrected clean-air
   pace, quali gap to teammate/field, recent form, circuit-archetype fit
   (straight-line vs high-downforce — we have straight_line_dominance,
   corner_analysis, drs_effectiveness per circuit).
2. **Quali order model:** rating + circuit adjustment + noise → sample orders
   (Plackett–Luce or rank-from-noisy-scores; both trivial to sample).
3. **Race finish model:** start from sampled grid; apply a grid→finish
   transition model calibrated on our own `core.grid_vs_finish` history
   (per-circuit overtaking difficulty from overtake_events), plus **DNF
   hazard** per driver/team from `raw.session_result` status history.
4. **Monte Carlo (10k):** produces every scoring input jointly — finish
   distributions, positions gained, Q2/Q3 progression, DNF — score each sample
   with the exact fantasy tables → **expected points ± variance per driver and
   constructor**.
5. **Team optimizer:** maximize expected points subject to $100M, 5+2 roster,
   transfer costs from the current team, DRS-boost choice (pick max-EV
   driver), chip timing. This is a small integer program (fields of 22 drivers
   / 11 teams — brute-forceable). *This step is where fantasy is actually won
   and is pure engineering, no ML.*

### D. Baseline: direct per-driver points regression
Features → predicted fantasy points, no order consistency. One afternoon of
work against our backtest harness; keep it as the benchmark option C must beat.

---

## 3. What the warehouse gives us vs. what's missing

**Already have (through Zandvoort 2026):** official results + grids (positions
gained), lap-level pace, fuel-corrected pace, deg, pit stop durations
(`raw.pit` — the constructor tier model), overtake events, DNF/DSQ statuses,
per-circuit overtaking/DRS effectiveness, weather. 2023 + 2025 + 2026 seasons.

**Killer validation asset we can build immediately:** we can *retroactively
compute actual fantasy points* for every driver/constructor for every 2025 and
2026 round from our own data (all scoring inputs except Driver of the Day are
in the warehouse). That gives ~35+ scored rounds of ground truth for
backtesting any model.

**Missing / external:**
- **Prices + price changes + ownership** — from the fantasy game itself
  (unofficial API endpoints exist; community mirrors like f1fantasytools
  publish price history). Needed for the optimizer, not the predictor.
- **Driver of the Day** history (formula1.com awards page) — small heuristic.
- Sprint points table fine print; confirm vs official rules at build time.

---

## 4. Phased plan

**Phase F1 — Ground truth + baseline (small)**
- Matview `analytics.fantasy_points_scored`: actual fantasy points per
  driver/constructor/round computed from warehouse data (exact tables above).
- Backtest harness: walk-forward by round; metric = MAE on points + rank
  correlation on finish order.
- Baseline model D. *Deliverable: "how many fantasy points did X score at
  Zandvoort?" answerable in chat, and a measured baseline.*

**Phase F2 — Order models + Monte Carlo (the core)**
- Rating updater + quali/race order samplers + DNF hazard; calibrate on
  2025, validate walk-forward on 2026 (12 rounds so far, Monza next).
- `analytics.fantasy_projection` per upcoming round: expected points ±
  spread per driver/constructor. *Deliverable: pre-Monza projections with
  backtested accuracy numbers.*

**Phase F3 — Optimizer + chat**
- Budget/roster/transfer/chip optimizer over the projections.
- Chat family: "who should I pick this week?", "best DRS boost?", "is Norris
  worth $29M?" — deterministic templates over the projection matview,
  provenance-cited like everything else. Prices ingested from the game API.

**Phase F4 — Optional depth**
- Race-sim proposal's MC (SC timing, strategy variance) feeding the finish
  model's tails; live in-race mode — the ONE place the friend's
  car-position regression belongs.

## 5. Risks
- 2026 regs shuffle (new cars) make 2023/2025 priors weaker → weight recent
  form heavily; the 12 completed 2026 rounds are the calibration gold.
- DotD and fastest lap are high-variance small terms — model coarsely, flag
  as noise in answers.
- Price data is unofficial-API-dependent; isolate behind one ingest module.

---

# CONVERGED ROADMAP (v3) — supersedes §4
*Converged 2026-08-26 via three GPT-5.6 Sol review passes (REVISE → REVISE → SHIP).*

**Principles:** decision metric over model metric (season points from executable
decisions + regret vs a time-respecting oracle, not MAE); ground truth and
baselines before models; calibrated distributions, not point estimates; degrade
visibly, never guess.

**R0 — Scoring truth & decomposition.** Versioned scoring-rules table per
season (rules are DATA with tests, never constants — verify every number
against the official rules page; quali/race/sprint penalty and positions-lost
details differ from third-party summaries). Fantasy component ledger per
driver/constructor/round with per-component `source`/`confidence`/`is_exact`
(overtakes are a PROXY — raw.overtakes includes pit-cycle passes, fantasy
scores legal on-track only; DotD is external). Reconciliation harness vs
official published round totals. Empirical variance decomposition to rank which
components actually drive points. Widget: post-race recap card (QA tier).

**R1 — Temporal foundation.** Price/roster/transfer/chip-state ingest with
as-of deadline snapshots (pre-weekend · pre-quali main deadline · post-quali
for Final Fix only); price-move events as their own table, partial history
flagged. External timestamped inputs: weather FORECASTS (observed warehouse
weather is not a legal feature), penalties/upgrades/driver-news. 2026 coverage
audit of every warehouse feature used.

**R2 — Mechanics engine + harness + baselines.** `web/src/lib/fantasyEngine/`:
pure, season-pinned rules engine (5+2 roster, budget, $3M floor, 2026
net-transfer accounting, penalties, chip inventory/effects/state transitions
incl. Final Fix and No Negative, deadline calendar, 3-team portfolio) with
legality property tests + replay tests reproducing official totals within
ledger bounds. Walk-forward harness with strict as-of; every state transition
goes through the engine (executable-by-construction). Baselines: hold-team,
persistence, direct-points regression, price-implied (betting odds stretch).
Metrics: executable-decision season points, oracle regret under real
constraints, proper scores + calibration, race-level bootstrap, splits by
sprint/wet/era.

**R3 — Projection model v1.** Recency-weighted hierarchical ratings (driver
within team) → quali/race order samplers → DNF hazard → explicit submodels:
proxy-calibrated overtakes, fastest lap, pit-stop count+tier, sprint-specific
tables, and the PRICE-EVOLUTION model (per-asset price-change distributions,
backtested + calibrated on R1 history; thin history ⇒ no-move prior with
widened uncertainty). Monte Carlo scored through R0 rules. Calibration report
ships inside every release.

**R4 — Rolling-horizon optimizer (2–4 rounds).** Objective: expected points +
squad-value growth (from the calibrated price model ONLY; drops to pure points
if uncalibratable) + transfer option value − penalties. Chip-calendar planner
(sprint weekends, weather-risk No Negative). 3-team diversified portfolio.
Utility profiles (chaser / leader / new entrant).

**R5 — Decision-first UI.** `fantasy_team` decision card: current vs
recommended roster, exact transfers + penalty, 1-round & horizon gain,
P10/P50/P90 team outcomes, price-change probabilities (hidden when
uncalibrated), top-3 near-optimal alternatives, boost/chip incremental value,
data timestamp. Value view = marginal points over replacement per dollar,
drivers/constructors separate. Honest scoping: new chart detectors + composite
card extension + surface-manifest sync (moderate work, not renderer reuse);
recap + model scorecard are secondary surfaces.

**R6 — Automation & chat.** Projection runs keyed to the official deadline
calendar (main run BEFORE quali; Final-Fix re-run after quali); chat question
family over projection/decision matviews with provenance.

**R7 — Optional depth.** Race-sim variance into finish tails; live in-race
mode (the only home for lap-by-lap car-position regression).

**Stop condition:** if R3 can't sustainably beat the price-implied baseline on
executable-decision season points, ship the optimizer over market forecasts
and say so.

**Review log:** pass 1 (REVISE): scoring-table errors + overtakes-proxy catch,
price-baseline dependency error, myopic optimizer → rolling horizon + chips +
portfolio, missing MC submodels, as-of deadline leakage contract, renderer
overstatement, decision-first UI, executable-decision metrics. One finding
rejected: "driver_performance_score hard-coded to 2025" cited the 045 file,
superseded by migration 052 in the live DB. Pass 2 (REVISE): missing
price-evolution model; mechanics engine required for legal regret. Pass 3:
both resolved, SHIP.
