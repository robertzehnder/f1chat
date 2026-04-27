# F1 Race-Analysis Capability Plan — Broadcast-Style Insights

**Date:** 2026-04-27
**Author:** Claude (Opus 4.7, 1M context), drafted for Codex audit
**Target deliverable file:** this file (`diagnostic/analysis_taxonomy_plan_2026-04-27.md`)
**Scope relationship:** this plan extends the in-flight `roadmap_2026-04_performance_and_upgrade.md` and `loop_hardening_plan_2026-04-26.md`. It does NOT replace them. The performance roadmap (Phases 0–12) makes the chat surface fast and trustworthy; this plan adds the breadth of analyses the chat is *capable of answering*.

---

## 1. Context — what we're trying to achieve

### 1.1 The current state of the system (post Phase-3 partial)

OpenF1 today serves chat-based race analysis backed by:
- Postgres (`f1.*` raw tables: laps, sessions, drivers, etc., from FastF1 + scraping).
- A growing set of `core_build.*` and `core.*` materialized views (Phase 3 in progress: 8/13 done).
- A synthesis pipeline that converts the user question → semantic contract selection → matview read → LLM answer synthesis.
- Phase-8 validators (planned, not yet built) that cross-check synthesis claims against the contracts.

The system answers questions about race results, lap pace, stint pace, strategy summaries, and a handful of derived analyses (grid-vs-finish, pit-cycle, lap-context, etc.). The matview list it materializes today is **a subset** of the analyses an experienced F1 viewer expects from a "race-analysis assistant."

### 1.2 What's missing

Comparing the current contract list against the universe of broadcast-style analyses (Track Dominance, Corner Analysis, Braking Performance, Battle Forecast, Energy Usage, Track Pulse-style storyline detection, etc.), the gap falls into three buckets:

1. **Analyses we have data for but no contract.** GPS / mini-sector / telemetry data is in `f1.*` tables (FastF1 ingests it) but no semantic contract exposes it for chat synthesis. Examples: Track Dominance, corner-by-corner analysis, braking-zone analysis, throttle traces.
2. **Analyses we don't have data for.** Battery state, ERS deployment, brake temperature, fuel state, damage state — these are not in F1's public timing feed. AWS produces them via team-fed proprietary models we cannot replicate.
3. **Analyses that require modeling, not just data.** Battle Forecast, Alternative Strategy simulation, Safety Car probability, Tyre Degradation Bayesian model — these need a forecast/simulation layer that doesn't exist in the codebase today.

### 1.3 What this plan delivers

A **20–30 slice extension** to the perf roadmap that, when complete, lets the chat (and the new product surfaces from Phase 10) answer roughly **80% of the analyses in the broadcast taxonomy** using public FastF1 data, with explicit "no data available" responses for the proprietary 20% (battery state, internal telemetry, etc.).

The three deliverables are:
1. **Data layer** — FastF1 ingest extension to capture the telemetry channels we don't store today (throttle, brake, GPS coords, gear, RPM, DRS), plus a `track_segments` static table per-circuit.
2. **Computation layer** — `analytics_build.*` schema (parallel to `core_build.*`) with matviews for the named insights.
3. **Surface layer** — chat contracts for each named insight + a dashboard UI that visualizes the most common ones (Track Dominance map, corner-analysis breakdown, stint-degradation chart).

### 1.4 Why this works as an extension, not a rewrite

Phase 3 (in flight) establishes the matview pattern. Phase 8 (planned) establishes the FactContract validator pattern. Phase 10 (planned) establishes the product-surface pattern. **This plan reuses all three** and only adds:
- New telemetry-grade matviews (`analytics_build.*`).
- New FactContract types for the named insights.
- New dashboard pages (extension of the Phase-10 session-detail page concept).

There is no architectural cliff to climb; this is "more matviews + more contracts + more surfaces" within the existing pattern.

---

## 2. Source taxonomy — what we're trying to cover

The full taxonomy is captured in the user's reference document (22 categories, ~400 distinct analyses). For implementation purposes we collapse it into **14 condensed master categories**, mapping each to a known F1/AWS-named insight where possible:

| # | Master category | Named broadcast graphic equivalent | Public-data feasibility |
|---|---|---|---|
| 1 | Race state | Running order / classification / penalties | Full |
| 2 | Timing & pace | Lap / sector / mini-sector / trends | Full |
| 3 | Track dominance | Track Dominance | Full (approximated from GPS) |
| 4 | Corner analysis | Corner Analysis (braking/turn-in/mid-corner/exit) | Full (requires per-circuit segment definitions) |
| 5 | Braking | Braking Performance | Full (brake trace, speed delta) |
| 6 | Acceleration / throttle / traction | (ad-hoc) | Full (throttle trace) |
| 7 | Steering / balance / handling | (ad-hoc, mostly inferential) | Partial (no steering-angle channel publicly) |
| 8 | Tyres | Tyre Performance | Partial (tyre energy proprietary; deg modelable) |
| 9 | Pit & pit-lane | Pit Lane Performance | Full (pit timing in `f1.pit_stops`) |
| 10 | Strategy & simulation | Alternative Strategy | Partial (requires Monte Carlo + tyre model) |
| 11 | Overtaking & battles | Battle Forecast | Full (gap, pace delta, DRS) |
| 12 | Starts & restarts | Race Lap 1 metric | Full (lap-1 position deltas) |
| 13 | Energy & power unit | Energy Usage | **None** — proprietary team data |
| 14 | Car performance & setup | Car Performance score | Partial (inferable from pace residuals) |
| 15 | Driver performance | Driver Performance score (7-axis) | Full (combines existing analyses) |
| 16 | Weather & surface | Weather impact | Full (FastF1 weather channel) |
| 17 | Race control / stewarding | Penalty / track-limits | Full (race-control messages) |
| 18 | Broadcast storytelling | Track Pulse | Partial (alert/event detection) |

**Categories we will NOT attempt** (proprietary data, no realistic public proxy):
- Battery state-of-charge inference, brake temperature, fuel level, ERS modes, active-aero state.
- Damage estimation beyond crude pace-residual heuristics.
- Driver fatigue / heat stress (radio + onboard inference only).

For these, the chat must respond with `INSUFFICIENT_DATA` rather than hallucinating numbers (Phase-8 validators handle this).

---

## 3. Data layer — extending FastF1 ingest

### 3.1 What we have today

The existing OpenF1 Postgres schema (`f1.*`) holds:
- `f1.sessions` — schedule, weekend identifiers
- `f1.laps` — per-driver per-lap timing (lap time, sector times, compound, tyre life)
- `f1.pit_stops` — pit timing
- `f1.results` — final classification
- `f1.weather` — track/air temp, wind, rainfall flags

It does NOT hold per-sample telemetry (throttle, brake, GPS, gear, RPM, DRS) at scale — only what FastF1 ingestion captures during contract builds. The matviews don't depend on telemetry today.

### 3.2 What we need to add

| New table | Grain | Volume estimate | Source |
|---|---|---|---|
| `f1.telemetry_samples` | one row per (session, driver, sample_ts), 5-50 Hz | ~100k samples/driver/race × 20 drivers × 24 races/yr ≈ 50M rows/yr | FastF1 `lap.get_car_data()` |
| `f1.position_samples` | one row per (session, driver, sample_ts) with X,Y,Z coords | similar volume to telemetry | FastF1 `lap.get_pos_data()` |
| `f1.race_control_messages` | one row per (session, message_ts, message) | ~50-200 rows/race | FastF1 `session.race_control_messages` |
| `f1.track_segments` | static lookup: per-circuit, per-segment polygon/range | ~200-400 segments/circuit × 25 circuits | hand-curated + auto-derived from GPS |
| `f1.driver_radio` *(deferred)* | radio transcripts | only if we add transcription | external |

**Data volume sanity check:** ~50M telemetry rows/year × ~80 bytes/row ≈ 4 GB/year. Fits Neon free tier with room to spare.

**Ingest cadence:** post-session, batch. Live ingest is not in scope (broadcast-time real-time is a separate problem; this plan targets post-session analysis).

### 3.3 Per-circuit track segmentation

Track Dominance, Corner Analysis, and braking-zone analysis all require partitioning the lap into named segments:
- **Mini-sectors** — 25-50 equal-distance bins (auto-derived from a reference fastest lap).
- **Corners** — manually defined: corner number, brake_zone_start, turn_in_point, apex, exit_point.
- **Straights** — derived: regions between consecutive corner exits and corner brake-zones.

Recommended approach: **hybrid**. Auto-derive 25-50 mini-sectors per circuit from a reference fastest lap's GPS distance markers. For corners, hand-curate the 5-30 named corners per circuit (FIA publishes these). Store both in `f1.track_segments` with a `segment_kind` column (`minisector` | `corner` | `straight`).

Curation cost: ~30 min per circuit × 25 circuits = ~12 hours one-time. Slice for this is below.

### 3.4 Slice list — Phase 13 (Data layer)

| Slice ID | Goal | Deps |
|---|---|---|
| `13-fastf1-telemetry-ingest` | Add ingest job that pulls telemetry + position samples from FastF1 for any session in `f1.sessions`. Idempotent; partitioned by session_id. | none |
| `13-telemetry-storage-schema` | Create `f1.telemetry_samples` and `f1.position_samples` with appropriate indexes (session_id + driver + ts). | `13-fastf1-telemetry-ingest` |
| `13-race-control-ingest` | Pull race_control_messages into `f1.race_control_messages`. | none |
| `13-track-segments-static` | Create `f1.track_segments` table; ingest auto-derived mini-sectors for all circuits in current dataset. | `13-telemetry-storage-schema` |
| `13-track-segments-corners` | Hand-curate corner definitions for top 10 circuits (Bahrain, Saudi, Australia, Japan, China, Miami, Monaco, Spain, Canada, Austria). Document the curation procedure. | `13-track-segments-static` |
| `13-backfill-historical` | Backfill telemetry + race-control for the 2024 season (24 races) so we have data to build matviews against. | all above |

---

## 4. Computation layer — `analytics_build.*` matviews

### 4.1 Parallel structure to Phase 3

Phase 3 established `core_build.*` (source-definition views) → `core.*` (materialized views). Phase 14 follows the same pattern: `analytics_build.*` → `analytics.*`.

Why a separate schema:
- `core.*` is "answer-shaped data the chat reads." Stable, query-by-name.
- `analytics.*` is "deeper analysis layer." Larger, slower-to-build, may include heavy GPS aggregations.

The chat synthesis path can read from BOTH schemas; the FactContract layer (Phase 8) abstracts the schema.

### 4.2 Slice list — Phase 14 (Compute layer)

Each slice produces one `analytics.*` matview + a parity test + a TS contract type. Same pattern as Phase 3.

| Slice ID | Matview | Inputs | Roughly equivalent broadcast graphic |
|---|---|---|---|
| `14-track-dominance` | `analytics.track_dominance` | telemetry_samples, position_samples, track_segments | Track Dominance |
| `14-mini-sector-dominance` | `analytics.minisector_dominance` | telemetry_samples, track_segments | Mini-sector dominance map |
| `14-sector-dominance` | `analytics.sector_dominance` | laps | Sector dominance |
| `14-corner-analysis` | `analytics.corner_analysis` | telemetry_samples, position_samples, track_segments | Corner Analysis (entry/turn-in/mid/exit) |
| `14-braking-performance` | `analytics.braking_performance` | telemetry_samples, track_segments | Braking Performance |
| `14-traction-analysis` | `analytics.traction_analysis` | telemetry_samples, track_segments | Throttle/exit traction |
| `14-straight-line-dominance` | `analytics.straight_line_dominance` | telemetry_samples, track_segments | Straight-line dominance |
| `14-stint-degradation-curve` | `analytics.stint_degradation_curve` | laps, stint_summary | Stint degradation slope |
| `14-tyre-warmup-curves` | `analytics.tyre_warmup` | laps, telemetry_samples | Out-lap warm-up |
| `14-fuel-corrected-pace` | `analytics.fuel_corrected_pace` | laps | Fuel-corrected pace |
| `14-traffic-adjusted-pace` | `analytics.traffic_adjusted_pace` | laps, gap analysis | Pace in clean vs dirty air |
| `14-overtake-events` | `analytics.overtake_events` | laps (position changes), race_control_messages | Overtake detection |
| `14-battle-segments` | `analytics.battle_segments` | laps, gap analysis | Battle map (stretches of race where two cars are within ~1.5s) |
| `14-drs-effectiveness` | `analytics.drs_effectiveness` | telemetry_samples, track_segments | DRS speed gain per zone |
| `14-undercut-overcut-history` | `analytics.undercut_overcut_history` | pit_stops, laps | Past UC/OC outcomes per circuit |
| `14-pit-loss-per-circuit` | `analytics.pit_loss` | pit_stops | Pit-lane time cost per circuit |
| `14-driver-performance-7axis` | `analytics.driver_performance_score` | aggregates of above | AWS-style 7-axis driver score |
| `14-restart-performance` | `analytics.restart_performance` | laps after SC/VSC | Restart launch / Lap 1 |
| `14-weather-impact` | `analytics.weather_impact` | laps, weather | Weather effect on pace |
| `14-race-control-incident-index` | `analytics.race_control_incidents` | race_control_messages | Penalty/incident timeline |

Twenty matviews. Each ~½ day of work given the established Phase 3 pattern (one full slice per matview through the autonomous loop).

### 4.3 What we explicitly skip

- **Energy Usage / ERS deployment** — no public data.
- **Battery state inference / clipping detection** — would need a model with very low confidence; flag as out-of-scope.
- **Damage estimation** — too speculative; if user asks, return `INSUFFICIENT_DATA`.
- **Active-aero state (2026 regs)** — not yet in current season's data.
- **Live broadcast graphics** — out of scope (post-session only).

### 4.4 Modeling layer — Phase 15

Some analyses need probabilistic modeling, not just aggregations:

| Slice ID | What it computes |
|---|---|
| `15-tyre-deg-bayesian` | Per-compound, per-circuit tyre-life model with uncertainty. Updates after each race. |
| `15-battle-forecast` | Predicts catch / pass probability given current gap, pace delta, DRS, tyre offset, circuit. |
| `15-overtake-difficulty-index` | Per-circuit, per-corner overtaking probability score. |
| `15-safety-car-probability` | Logistic regression on (circuit, weather, lap range) → SC probability per lap. |
| `15-alternative-strategy-sim` | Monte Carlo race simulation: "if driver X had pitted on lap N instead, expected finish position is …". |
| `15-points-as-they-run` | Live recomputation of championship implications. |

These are research-grade slices and may take longer (≥1 day each through the loop) because the auditor will rightly demand: held-out validation, calibration plot, fallback when model confidence is low.

### 4.5 Refresh strategy

Phase-3 matviews are materialized once per session ingest. The analytics layer follows the same model — the data is post-session, so a one-time refresh per new race is correct. No streaming, no incremental refresh complexity.

Refresh trigger: a new slice `13-post-ingest-refresh-hook` runs `REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.*` after `13-fastf1-telemetry-ingest` completes for a session.

---

## 5. Surface layer — chat contracts + UI

### 5.1 FactContract integration (Phase 8 reuse)

Each `analytics.*` matview gets a corresponding `FactContract` shape (Phase-8 pattern). The synthesis prompt receives the contract; the synthesis answer is validated by Phase-8 validators against the same contract. Reusing this pattern means:
- Each analytics slice adds one new FactContract type.
- Each analytics slice adds one new validator (asserting "every claim about <X> is consistent with the matview output").
- The chat path automatically gains the analysis once the contract is registered.

### 5.2 New product surfaces — Phase 16

Beyond chat, the dashboard (Phase 10) gains analysis-specific pages:

| Slice ID | Surface |
|---|---|
| `16-track-dominance-map` | Per-session, per-pair-of-drivers track map colored by dominance. |
| `16-corner-analysis-page` | Picker: session + corner + drivers → full braking/turn-in/mid/exit comparison. |
| `16-stint-degradation-chart` | Per-session, per-driver, lap-by-lap degradation curve overlay. |
| `16-driver-performance-card` | 7-axis radar chart per driver per season. |
| `16-battle-replay` | Time-series scrubber over a battle stretch with both drivers' telemetry. |
| `16-strategy-simulator` | Interactive: "what if driver X had pitted on lap N?" — hits the `15-alternative-strategy-sim` model. |

Six surfaces. Each is roughly the complexity of a Phase-10 slice (~½ day through the loop).

### 5.3 Chat-only surfaces

Chat questions like "Who was strongest in sector 2 of Monaco?" or "How aggressive was Hamilton on his out-lap after the Lap 23 stop?" don't need a UI surface. They just need a contract + matview, both of which the analytics layer provides.

---

## 6. Sequencing and dependencies

### 6.1 Phase-level dependencies

```
[existing Phases 0-12 — perf roadmap]
        ↓
[Phase 13: Data layer extension]      ← FastF1 telemetry + position + race_control + track_segments
        ↓
[Phase 14: Compute matviews]          ← analytics.* matviews
        ↓
[Phase 15: Modeling layer]            ← tyre-deg, battle-forecast, alt-strategy
        ↓
[Phase 16: Product surfaces]          ← dashboard pages
```

The data layer (Phase 13) blocks everything. The compute layer (Phase 14) blocks the modeling layer (Phase 15) and the surfaces (Phase 16). Modeling and surfaces can run in parallel after Phase 14 lands.

### 6.2 Slice budget

| Phase | Slice count | Approx. duration through autonomous loop (1 slice ≈ 6-12h with audit) |
|---|---|---|
| Phase 13 (Data) | 6 | 2-4 days |
| Phase 14 (Compute) | 20 | 5-10 days |
| Phase 15 (Modeling) | 6 | 2-4 days (longer slices) |
| Phase 16 (Surfaces) | 6 | 2-3 days |
| **Total** | **38 slices** | **11-21 days** through the loop |

Compared to the perf roadmap (13 phases, 87 slices), this is ~40% additional work.

### 6.3 Approval-required flagging

| Slice category | `user_approval_required` |
|---|---|
| Data ingest (Phase 13) | `no` (read-only ingest from public source) |
| Compute matviews (Phase 14) | `no` (additive matviews, parity-tested) |
| Modeling (Phase 15) | `no` per-slice, but **model-validation-baseline** sub-step gates merge |
| Surfaces (Phase 16) | `no` (UI-only, behind feature flag until QA) |

No production-touching slices. Phase 15 has its own validation gate but doesn't need a sentinel.

### 6.4 Dependencies on the existing perf roadmap

This plan **does not** require all 87 perf-roadmap slices to land first. Minimum prerequisites:
- Phase 0–1 (done): instrumentation + baselines.
- Phase 3 partial (in flight): the matview pattern proven via at least 3 successful slices.
- Phase 8 plan-aware (planned): FactContract shape defined. **This plan can begin before Phase 8 lands** — the early slices use ad-hoc contracts; we re-shape after Phase 8 lands. Mitigation cost is low (~1 day re-shape work).

The pragmatic recommendation: **start Phase 13 in parallel with Phase 4** (perf indexes). Phase 13 has no DB-perf dependency on Phase 3 matview completion; it just needs the underlying `f1.*` tables.

---

## 7. Critical decisions deferred to slice authors

These are decisions worth flagging but not pre-committing in this plan:

| Decision | Where it gets made | Recommended default |
|---|---|---|
| Per-circuit corner curation source | `13-track-segments-corners` | FIA published corner numbers + GPS centroids |
| Mini-sector count per circuit | `13-track-segments-static` | 30 (uniform), bias to lower for short tracks |
| Tyre-deg model family | `15-tyre-deg-bayesian` | Linear-in-tyre-age with random-effects per (driver, compound, circuit) |
| Track Dominance metric | `14-track-dominance` | Normalized speed delta per mini-sector, with statistical significance test (z-score on speed difference distribution) |
| Battle Forecast feature set | `15-battle-forecast` | gap, pace delta over last 3 laps, DRS available, tyre offset, circuit overtake-difficulty |
| Telemetry sample rate to store | `13-fastf1-telemetry-ingest` | Whatever FastF1 returns natively (10-50Hz; downsampling is lossy) |
| Race control message parsing | `13-race-control-ingest` | Store raw + a regex-extracted `event_kind` enum |
| `analytics.*` schema permissions | `14-track-dominance` (first slice) | Same role as `core.*`; new role only if a security boundary emerges |
| Dashboard UI framework | Phase 16 first slice | Reuse existing Phase-10 patterns (Next.js + Recharts + shadcn) |
| Strategy simulator UX | `16-strategy-simulator` | Side-by-side "actual vs counterfactual" lap chart with confidence bands |

---

## 8. Risks

1. **FastF1 data freshness.** FastF1 caches and ingests from F1's live timing service post-session. There can be a 24-72h lag for full data on a fresh race weekend. **Mitigation:** the analytics layer is post-session, so this lag is acceptable.

2. **Telemetry data volume.** ~4GB/year is fine for Neon, but if we ingest historical seasons (2018-2025) the volume balloons to ~30GB. **Mitigation:** start with 2024+ only; archive older seasons to S3 if needed later.

3. **Per-circuit corner curation drift.** F1 occasionally renumbers corners (Suzuka turn count differences in older sources). **Mitigation:** track curation source-of-truth in the slice's note; allow corrections via a single-row update.

4. **Track Dominance interpretation pitfalls.** Naïve "fastest in this segment" can be misleading if drivers were on different tyre compounds, fuel loads, or traffic. **Mitigation:** the matview includes contextual columns (compound, tyre_age, traffic_flag); the synthesis prompt MUST attach those when answering.

5. **Modeling slice (Phase 15) may not converge.** Bayesian tyre-deg or Monte Carlo strategy simulation can take several plan-revise rounds. **Mitigation:** the round-12 plan-iter cap is 10 — enough headroom. If a model slice circuit-breaks at iter 10, fall back to a simpler heuristic (linear regression for tyre deg, deterministic "swap-pit-lap" simulation for strategy).

6. **Phase-8 FactContract shape may not fit analytics.** The shape was designed for `core.*` contracts (driver-session-summary, etc.). Analytics contracts may have time-series data (telemetry traces, deg curves) that don't fit a single record. **Mitigation:** Phase-8 plan-audit allows the contract shape to be a `tagged union` of "scalar fact" and "time-series fact"; analytics surfaces that need traces use the latter.

7. **Hallucination risk on analyses we didn't model.** User asks "what was the brake temperature at Turn 8?" — we have no data. The chat must answer `INSUFFICIENT_DATA`. **Mitigation:** Phase-8 validators are the gate. A validator for each analytics contract asserts "if no contract is attached, the synthesis cannot make claims of this kind."

8. **Modeling slice scope creep.** "Battle Forecast" is one slice but easily expands into 5 sub-models. **Mitigation:** the slice's acceptance criteria pin a v1 success bar (held-out AUC ≥ 0.65 on overtake events); v2 improvements are separate slices.

9. **Refresh-strategy mismatch.** Phase-3 matviews have no refresh policy yet (D-3 deferred). The analytics layer compounds the issue. **Mitigation:** this plan adds `13-post-ingest-refresh-hook` which establishes a single refresh policy (post-session, full refresh) for both `core.*` and `analytics.*`. D-3 gets resolved as a side effect.

10. **Live-broadcast scope drift.** Users may eventually ask for live (in-session) analyses. **Mitigation:** explicitly out of scope for this plan; if requested, a Phase-17 plan would add streaming ingest. Don't preemptively design for it.

---

## 9. Open questions for Codex

1. **Phase ordering.** I propose running Phase 13 in parallel with Phase 4. Phase 14 starts after Phase 13 + Phase 3 both finish. Phase 15 + Phase 16 in parallel after Phase 14. Is the parallelization safe (no shared file conflicts in the loop's auto-merger)? The loop merges sequentially per `_index.md`, so parallelization here means "queue Phase 13 slices interleaved with Phase 4 slices in the index." Worth it?

2. **Data-volume cliff.** If we backfill seasons 2018-2025 instead of 2024-only, telemetry storage grows to ~30GB. Does that change the deferred D-2 (storage tier) decision in the perf roadmap? My read: 2024-only for now; expand later only if user demand justifies.

3. **Track-segments static-table duplication.** Some open-source projects publish curated F1 corner definitions (e.g. `f1-2024-corners` repos). Worth pulling theirs as the seed and refining, or hand-curate from scratch? My read: pull, refine, attribute.

4. **Driver Performance 7-axis equivalence.** AWS publishes the 7 axes (qualifying pace, race starts, race lap 1, race pace, tyre management, pit-stop skill, overtaking) but not their exact normalization. Should `14-driver-performance-7axis` reproduce AWS's scoring, or define our own 0-10 scale per axis? My read: our own, with documented methodology, since AWS's exact formula is proprietary.

5. **Battle Forecast ground truth.** To validate the model, we need labeled overtake events. `14-overtake-events` produces these, but they include unforced changes (rival pit, DNF). Should the labels be pure on-track passes only? My read: yes; filter out pit-related and DNF-related position changes from the training set.

6. **Tyre-deg model — "tyre energy" without telemetry.** AWS's tyre-energy metric uses lateral/longitudinal acceleration + gyro. We have GPS speed and can derive lateral acc from cornering radius. Is that close enough, or fundamentally different? My read: documented approximation with a "this is a derived estimate, not AWS's tyre energy" disclaimer in the contract.

7. **Strategy simulator UX.** The `16-strategy-simulator` slice shows counterfactual outcomes. Do we want a slider for the user to pick the alt-pit-lap, or auto-show the optimal alt-pit-lap? My read: both — auto-show the model's recommendation, slider lets user explore.

8. **Phase 15 modeling validation gate.** Each model slice should have a held-out validation step (e.g. train on 2024 races 1-20, test on 21-24). Is "AUC ≥ 0.65" the right gate for `15-battle-forecast`? Or some other calibration metric? My read: defer to slice author with a recommendation; cap audit can push back.

9. **Permissions model.** All `analytics.*` matviews are read-public from the chat path. No user-segregated data. Is there any reason to gate (cost-sensitivity, data licensing)? My read: no; F1 timing data is publicly licensed via FastF1.

10. **Phase-8 FactContract `time-series fact` shape.** Some analytics need to attach a trace (telemetry over distance) to the synthesis prompt. What's the size limit before we should pre-compute summary statistics instead of attaching the raw trace? My read: ≤ 200 sample points per trace; beyond that, summarize.

---

## 10. What "ready to ship" means

Once Phases 13–16 complete:

- **Data**: `f1.telemetry_samples`, `f1.position_samples`, `f1.race_control_messages`, `f1.track_segments` populated for 2024 + 2025 seasons.
- **Compute**: 20 `analytics.*` matviews populated, parity-tested, refreshed post-ingest.
- **Modeling**: 6 modeling slices with held-out validation passing their gate metrics.
- **Surfaces**: 6 dashboard pages live behind a `analyticsv2` feature flag.
- **Chat**: every named insight in §2 (~80% of the broadcast taxonomy) answerable, with `INSUFFICIENT_DATA` clean-fail for the proprietary 20%.
- **Healthcheck**: a new benchmark question set (`healthcheck_analyses`) with ~30 broadcast-style questions; ≥80% A-grade target after Phase 16.

---

## 11. Codex audit ask

This plan is intentionally broad (38 slices, 4 phases, ~21 days through the autonomous loop). Codex review please:

- §3 data-layer feasibility: are the volume estimates realistic? Is FastF1 the right ingest path or is there a better source I'm missing?
- §4 matview list: is the 20-matview list right-sized? Are there any obvious candidates missing or duplicates?
- §5 surface picks: 6 surfaces is a defensible MVP. Are any of them mis-prioritized vs. the chat-only path?
- §7 deferred decisions: any of these worth pre-committing in the plan vs. leaving to slice authors?
- §8 risks: anything mis-classified or missing? Particularly interested in the modeling-slice convergence risk.
- §9 open questions: triage as `High` / `Medium` / `Low` per the existing iterative-plan-audit format. I'll resolve and re-submit until APPROVED before adding any of these slices to `diagnostic/slices/_index.md`.

If APPROVED, the next step is generating the 38 slice stub files (mechanical, similar to the `stub_slices.py` approach used for the perf roadmap), then queuing them in `_index.md` under new headers `## Phase 13`, `## Phase 14`, etc.

---

End of plan.
