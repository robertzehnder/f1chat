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

A **~28-slice extension** to the perf roadmap that, when complete, lets the chat (and the new product surfaces from Phase 10) answer roughly **70–80% of the analyses in the broadcast taxonomy** using the OpenF1 data already ingested into `raw.*`, with explicit "no data available" responses for the proprietary 20–30% (battery state, brake temps, fuel state, steering angle, slip angles, etc.).

The three deliverables are:
1. **Data layer (minimal)** — the OpenF1 ingest is already in place via `src/ingest.py` and the `raw.*` schema. The only new data work is per-circuit track segmentation (corner zones + mini-sector reference) in a static `f1.track_segments` table. Optional: team-radio transcription (deferred slice).
2. **Computation layer** — `analytics_build.*` → `analytics.*` matviews (parallel to Phase 3's `core_build.*` → `core.*` pattern), reading from `raw.car_data`, `raw.location`, `raw.intervals`, `raw.overtakes`, `raw.laps`, etc.
3. **Surface layer** — chat contracts for each named insight + a dashboard UI that visualizes the most common ones (Track Dominance map, corner-analysis breakdown, stint-degradation chart).

**Critical correction from earlier draft:** the production data source is **OpenF1** (the openf1.org REST API), NOT FastF1. The schema gives it away — `meeting_key`, `session_key`, `driver_number`, plus endpoint-named tables: `meetings`, `sessions`, `drivers`, `laps`, `car_data`, `location`, `intervals`, `pit`, `stints`, `team_radio`, `race_control`, `weather`, `overtakes`, `position_history`, `session_result`, `starting_grid`. The `fastf1_audit/` and `fastf1_openf1_audit_toolkit/` directories are side-by-side comparison toolkits from a prior diligence pass — not the production ingest path. This plan was originally drafted assuming FastF1 ingest; that section has been corrected. **What was 6 ingest slices in §3 is now 1.**

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

## 3. Data layer — what's already in `raw.*`, what's missing

### 3.1 OpenF1 raw tables already populated

The production ingest (`src/ingest.py` → CSV from `data/{year}/{circuit}/`) already populates these:

| Table | Grain | Notable columns | Useful for |
|---|---|---|---|
| `raw.meetings` | one row per race weekend | meeting_key, year, circuit | dimension |
| `raw.sessions` | one row per session (FP1/FP2/FP3/Q/Sprint/R) | session_key, date_start/end, session_type | dimension |
| `raw.drivers` | one row per driver per session | driver_number, broadcast_name, team_name | dimension |
| `raw.laps` | one row per (session, driver, lap) | lap_duration, sector durations, **i1_speed**, **i2_speed**, **st_speed**, **segments_sector_1/2/3** (mini-sector arrays!), is_pit_out_lap | timing, sector dominance, mini-sector dominance |
| `raw.pit` | one row per pit event | pit_duration (stationary time), date, lap_number | pit-stop analysis, undercut/overcut |
| `raw.stints` | one row per (session, driver, stint) | compound, tyre_age_at_start, fresh_tyre, lap_start, lap_end | tyre strategy, deg curves |
| `raw.intervals` | one row per (session, driver, sample) | interval (gap to ahead, text-encoded), gap_to_leader (text-encoded) | battle forecast, catch-rate |
| `raw.position_history` | one row per (session, driver, sample) | position (live order) | running order over time |
| `raw.car_data` | one row per (session, driver, sample) at **~3.7 Hz** | rpm, **speed**, n_gear, **throttle (0-100)**, **brake (0-100)**, **drs** (0/8/10/12/14 flag values) | corner analysis, braking, traction, DRS |
| `raw.location` | one row per (session, driver, sample) at **~4 s** cadence | x, y, z (GPS coords) | track maps, track dominance, corner zones |
| `raw.race_control` | one row per race-control message | category, flag, scope, sector, lap_number, driver_number, message | flags, SC/VSC, penalties, incident timeline |
| `raw.weather` | one row per weather sample | air_temperature, track_temperature, humidity, pressure, **rainfall (BOOL)**, wind_direction, wind_speed | weather impact |
| `raw.session_result` | one row per (session, driver) | position, points, status, classified | classification |
| `raw.starting_grid` | one row per (session, driver) | grid_position | Lap-1 gain/loss |
| `raw.overtakes` | one row per (session, lap, overtaker, overtaken) | **pre-detected by OpenF1** | overtake events, battle-forecast labels |
| `raw.team_radio` | one row per radio event | recording_url (audio, no transcript) | broadcast storytelling (with transcription) |
| `raw.championship_drivers` / `raw.championship_teams` | per-session standings snapshots | position, points, wins | points-as-they-run |

**Key observations from the actual schema:**
- **`raw.laps.segments_sector_*`** already contains OpenF1's text-encoded mini-sector breakdown. Track Dominance can use this directly without GPS reconstruction for a v1.
- **`raw.overtakes` is pre-detected** by OpenF1 — overtaker/overtaken pairs by lap. Free ground-truth labels for any overtake-prediction model.
- **Three free per-lap speeds**: `i1_speed`, `i2_speed` at fixed measuring loops + `st_speed` at the speed trap. Straight-line dominance is one query away.
- **`raw.intervals.interval` and `gap_to_leader` are TEXT** (parsed from `+1.234` / `L+1` notation) — needs a parsing helper but not new ingest.
- **`raw.weather.rainfall` is BOOLEAN** (not mm/hr). Coarse but workable for wet/dry/crossover detection.
- **`raw.car_data.brake` is 0-100 percentage** (not binary as some sources document). Confirmed from schema.

### 3.2 Sample-rate ceiling and what it caps

OpenF1's public sampling rates put a practical ceiling on precision:

- **`car_data` ≈ 3.7 Hz** → ~270ms between samples → braking-zone resolution is ~10-15m at typical 50m/s entry speeds. Adequate for "who brakes later than whom" but not for sub-meter braking-point analysis.
- **`location` ≈ 4 s cadence** → spatial resolution is poor for instantaneous position; OK for "where on the track" but `car_data` distance integration is preferable for fine-grained dominance segmentation.

Mitigation: where the matview needs fine-grained zones (corner-by-corner braking analysis), aggregate over multiple laps per driver to average down sample noise, and report confidence intervals rather than point estimates.

### 3.3 What we still need to add

| New table | Grain | Volume | Source |
|---|---|---|---|
| `f1.track_segments` | static per-circuit, per-segment polygon/range | ~200-400 segments × 25 circuits ≈ 5-10k rows | hybrid: auto-derived mini-sectors from `raw.location` + hand-curated corners (FIA-published) |

**Optional / deferred:**
| Optional | Why deferred |
|---|---|
| Team-radio transcripts | `raw.team_radio.recording_url` exists; transcription via Whisper costs ~$0.006/min. Not blocking; one slice if/when we want radio storyline detection. |

**Dropped from earlier draft:** `f1.telemetry_samples`, `f1.position_samples`, `f1.race_control_messages` — all already exist as `raw.car_data`, `raw.location`, `raw.race_control`. **No FastF1 ingest needed.**

### 3.4 Slice list — Phase 13 (Data layer, collapsed)

| Slice ID | Goal | Deps |
|---|---|---|
| `13-track-segments-auto` | Create `f1.track_segments` schema. Auto-derive 25-50 equal-distance mini-sectors per circuit from `raw.location` reference fastest laps. Insert one row per (circuit, segment_index, segment_kind=minisector). | none |
| `13-track-segments-corners` | Hand-curate FIA-numbered corner definitions for top 10 circuits (Bahrain, Saudi, Australia, Japan, China, Miami, Monaco, Spain, Canada, Austria). Add `segment_kind=corner` rows with brake_zone_start, turn_in, apex, exit boundaries. ~30 min/circuit × 10 = ~5h. | `13-track-segments-auto` |
| `13-intervals-parsing-helper` | Add a SQL/TS helper that parses `raw.intervals.interval` and `gap_to_leader` text fields into seconds (NULL for "L+N" lapped notation). Used by every battle/forecast matview. | none |

That's **3 slices** in Phase 13 (down from 6). The optional team-radio transcription stays deferred.

---

## 4. Computation layer — `analytics_build.*` matviews

### 4.1 Parallel structure to Phase 3

Phase 3 established `core_build.*` (source-definition views) → `core.*` (materialized views). Phase 14 follows the same pattern: `analytics_build.*` → `analytics.*`.

Why a separate schema:
- `core.*` is "answer-shaped data the chat reads." Stable, query-by-name.
- `analytics.*` is "deeper analysis layer." Larger, slower-to-build, may include heavy GPS aggregations.

The chat synthesis path can read from BOTH schemas; the FactContract layer (Phase 8) abstracts the schema.

### 4.2 Slice list — Phase 14 (Compute layer)

Each slice produces one `analytics.*` matview + a parity test + a TS contract type. Same pattern as Phase 3. Inputs reference real `raw.*` tables (corrected from earlier draft).

| Slice ID | Matview | Inputs | Roughly equivalent broadcast graphic |
|---|---|---|---|
| `14-minisector-dominance` | `analytics.minisector_dominance` | `raw.laps.segments_sector_*` (OpenF1 ships these), `f1.track_segments` | Mini-sector dominance map (uses native OpenF1 mini-sectors, no GPS reconstruction) |
| `14-sector-dominance` | `analytics.sector_dominance` | `raw.laps` | Sector dominance |
| `14-track-dominance-gps` | `analytics.track_dominance_gps` | `raw.car_data` + `raw.location` + `f1.track_segments` | Track Dominance (GPS-driven, finer than mini-sector) |
| `14-corner-analysis` | `analytics.corner_analysis` | `raw.car_data` + `raw.location` + `f1.track_segments` (corner zones) | Corner Analysis (entry/turn-in/mid/exit) |
| `14-braking-performance` | `analytics.braking_performance` | `raw.car_data` (brake/speed traces) + `f1.track_segments` (corner brake-zone bounds) | Braking Performance |
| `14-traction-analysis` | `analytics.traction_analysis` | `raw.car_data` (throttle/speed) + `f1.track_segments` | Throttle/exit traction |
| `14-straight-line-dominance` | `analytics.straight_line_dominance` | `raw.laps` (i1/i2/st_speed) + `raw.car_data` + `f1.track_segments` (straight zones) | Straight-line dominance |
| `14-stint-degradation-curve` | `analytics.stint_degradation_curve` | `raw.laps` × `raw.stints` (compound + tyre_age_at_start + lap range) | Stint degradation slope |
| `14-tyre-warmup-curves` | `analytics.tyre_warmup` | `raw.laps.is_pit_out_lap` + `raw.car_data` + `raw.stints` | Out-lap warm-up |
| `14-fuel-corrected-pace` | `analytics.fuel_corrected_pace` | `raw.laps` (lap_duration regression on lap_number) | Fuel-corrected pace (proxy) |
| `14-traffic-adjusted-pace` | `analytics.traffic_adjusted_pace` | `raw.laps` × `raw.intervals` (clean-air defined as gap-to-ahead > 2s) | Pace in clean vs dirty air |
| `14-overtake-events` | `analytics.overtake_events` | `raw.overtakes` (already pre-detected!) + `raw.intervals` for context (pre-pass gap, lap) + `raw.race_control` to filter pit/DNF-driven changes | Overtake detection (mostly free; just needs filtering + context) |
| `14-battle-segments` | `analytics.battle_segments` | `raw.intervals` (parsed gap-to-ahead < 1.5s sustained) + `raw.car_data` (DRS) | Battle map |
| `14-drs-effectiveness` | `analytics.drs_effectiveness` | `raw.car_data` (drs flag + speed) + `f1.track_segments` (DRS zones) | DRS speed gain per zone |
| `14-undercut-overcut-history` | `analytics.undercut_overcut_history` | `raw.pit` + `raw.laps` + `raw.position_history` (pre/post-pit position deltas) | Past UC/OC outcomes per circuit |
| `14-pit-loss-per-circuit` | `analytics.pit_loss_per_circuit` | `raw.pit.pit_duration` + lap-time delta of pitting driver vs non-pitting reference | Pit-lane time cost per circuit |
| `14-driver-performance-7axis` | `analytics.driver_performance_score` | aggregates of above + qualifying lap times from `raw.laps` (Q sessions) | AWS-style 7-axis driver score (our-methodology version) |
| `14-restart-performance` | `analytics.restart_performance` | `raw.race_control` (SC/VSC start/end) + `raw.position_history` + `raw.laps` | Restart launch / Lap 1 |
| `14-weather-impact` | `analytics.weather_impact` | `raw.weather` (rainfall, track_temp) + `raw.laps` + `raw.stints` (compound choices around weather changes) | Weather effect on pace |
| `14-race-control-incident-index` | `analytics.race_control_incidents` | `raw.race_control` (category, flag, scope) | Penalty/incident timeline |

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

Refresh trigger: piggyback on the existing `src/ingest.py` post-run hook — refresh `analytics.*` after each `raw.*` ingest completes. No new ingest infrastructure needed.

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
[Phase 13: Track segments (3 slices)]  ← f1.track_segments + intervals parser
        ↓
[Phase 14: Compute matviews (20 slices)]  ← analytics.* matviews from raw.*
        ↓
[Phase 15: Modeling layer (6 slices)]    ← tyre-deg, battle-forecast, alt-strategy
        ↓
[Phase 16: Product surfaces (6 slices)]  ← dashboard pages
```

Phase 13 is small (3 slices) but blocks Phase 14 — every track-zone-aware matview needs `f1.track_segments`. Phase 14 blocks Phase 15 + Phase 16; the latter two can run in parallel after Phase 14 lands.

### 6.2 Slice budget (revised after data-source correction)

| Phase | Slice count | Approx. duration through autonomous loop (1 slice ≈ 6-12h with audit) |
|---|---|---|
| Phase 13 (Track segments + helpers) | **3** | ~1 day |
| Phase 14 (Compute) | 20 | 5-10 days |
| Phase 15 (Modeling) | 6 | 2-4 days (longer slices) |
| Phase 16 (Surfaces) | 6 | 2-3 days |
| **Total** | **35 slices** | **9-18 days** through the loop |

Compared to the perf roadmap (13 phases, 87 slices), this is ~40% additional work — but with much lower data-layer risk now that we know ingest is a solved problem.

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

1. **OpenF1 sample-rate ceiling.** `car_data` is published at ~3.7 Hz (~270ms between samples) and `location` at ~4-second cadence. This is finer than mini-sector data but coarser than team-grade telemetry (50 Hz internal). **Impact:** Corner-Analysis braking-zone resolution is ~10-15m at typical entry speeds — adequate for "who brakes later than whom" but not sub-meter brake-point analysis. Per-corner traction analysis works but min-speed estimation has ±5km/h noise. **Mitigation:** matviews aggregate over multiple laps per driver to reduce sample noise; surfaces report confidence intervals rather than point values.

2. **Per-circuit corner curation drift.** F1 occasionally renumbers corners (Suzuka turn-count variants exist across sources). **Mitigation:** track curation source-of-truth in the slice's note; allow corrections via a single-row update; pin to FIA-published numbers as canonical.

3. **Track Dominance interpretation pitfalls.** Naïve "fastest in this segment" can be misleading if drivers were on different tyre compounds, fuel loads, or in/out of traffic. **Mitigation:** the matview includes contextual columns (compound, tyre_age, in_traffic_flag); the synthesis prompt MUST attach those when answering. Default v1 metric: "lowest estimated segment time," not "highest average speed" (per ChatGPT's recommendation, agrees with my read).

4. **Modeling slice (Phase 15) may not converge.** Bayesian tyre-deg or Monte Carlo strategy simulation can take several plan-revise rounds. **Mitigation:** the round-12 plan-iter cap is 10 — enough headroom. If a model slice circuit-breaks at iter 10, fall back to a simpler heuristic (linear regression for tyre deg, deterministic "swap-pit-lap" simulation for strategy).

5. **Phase-8 FactContract shape may not fit analytics.** The shape was designed for `core.*` contracts (driver-session-summary, etc.). Analytics contracts may have time-series data (telemetry traces, deg curves) that don't fit a single record. **Mitigation:** Phase-8 plan-audit allows the contract shape to be a `tagged union` of "scalar fact" and "time-series fact"; analytics surfaces that need traces use the latter.

6. **Hallucination risk on analyses we don't have data for.** User asks "what was the brake temperature at Turn 8?" — we have no data. The chat must answer `INSUFFICIENT_DATA`. **Mitigation:** Phase-8 validators are the gate. A validator for each analytics contract asserts "if no contract is attached, the synthesis cannot make claims of this kind."

7. **Modeling slice scope creep.** "Battle Forecast" is one slice but easily expands into 5 sub-models. **Mitigation:** the slice's acceptance criteria pin a v1 success bar (held-out AUC ≥ 0.65 on overtake events from `raw.overtakes`); v2 improvements are separate slices.

8. **Refresh-strategy mismatch.** Phase-3 matviews have no refresh policy yet (D-3 deferred). The analytics layer compounds the issue. **Mitigation:** piggyback on the existing `src/ingest.py` post-run flow — refresh `analytics.*` after each `raw.*` ingest completes. Resolves D-3 as a side effect.

9. **Storage growth.** `raw.car_data` + `raw.location` are the bulk tables. If backfill expands beyond 2024-2025, `raw.car_data` could grow to ~10-20 GB. **Mitigation:** keep ingest scope at 2024+ for now; add S3 archival policy only if growth becomes a Neon-cost issue.

10. **`raw.intervals` text parsing edge cases.** The `interval` field uses `+1.234` for normal gaps but `L+1` (or similar) for lapped cars. Parser must return NULL gracefully for lapped notation, not crash. **Mitigation:** `13-intervals-parsing-helper` slice's acceptance criteria explicitly require lapped-notation handling.

---

## 9. Open questions for Codex

1. **Phase ordering.** I propose running Phase 13 in parallel with Phase 4. Phase 14 starts after Phase 13 + Phase 3 both finish. Phase 15 + Phase 16 in parallel after Phase 14. The loop merges sequentially per `_index.md`, so parallelization here means "queue Phase 13 slices interleaved with Phase 4 slices in the index." Worth it?

2. **Track-segments seeding.** Some open-source projects publish curated F1 corner definitions. Worth pulling theirs as the seed and refining, or hand-curate from scratch? My read: pull from FIA-published track maps as canonical numbering; auto-derive zone boundaries from `raw.location` GPS clustering; hand-tune the top 10 circuits.

3. **Driver Performance 7-axis equivalence.** AWS publishes the 7 axes (qualifying pace, race starts, race lap 1, race pace, tyre management, pit-stop skill, overtaking) but not their exact normalization. Should `14-driver-performance-7axis` reproduce AWS's scoring, or define our own 0-10 scale per axis? My read: our own, with documented methodology, since AWS's exact formula is proprietary.

4. **Battle Forecast ground truth.** `raw.overtakes` is pre-labeled by OpenF1, but it includes pit-driven and DNF-driven position changes alongside true on-track passes. Should the labels filter to pure on-track passes only? My read: yes; filter via `raw.pit` join (exclude any overtake within ±2 laps of a pit event for either driver) and via `raw.race_control` (exclude any during SC/VSC).

5. **Tyre-deg model approach.** Without team telemetry (lat/lon acc + gyro for tyre-energy), we use lap-time decay vs tyre-age + compound + circuit. Should the v1 model add traffic-adjustment (deg-rate inflated when stuck behind another car)? My read: yes — `raw.intervals` makes traffic detection cheap, and ignoring it biases deg estimates upward.

6. **Strategy simulator UX.** The `16-strategy-simulator` slice shows counterfactual outcomes. Do we want a slider for the user to pick the alt-pit-lap, or auto-show the optimal alt-pit-lap? My read: both — auto-show the model's recommendation, slider lets user explore.

7. **Phase 15 modeling validation gate.** Each model slice should have a held-out validation step (e.g. train on 2024 races 1-20, test on 21-24). Is "AUC ≥ 0.65" the right gate for `14-overtake-events` × `15-battle-forecast`? Or some other calibration metric? My read: defer to slice author with a recommendation; plan-audit can push back.

8. **Phase-8 FactContract `time-series fact` shape.** Some analytics need to attach a trace (telemetry-over-distance) to the synthesis prompt. What's the size limit before we should pre-compute summary statistics instead of attaching the raw trace? My read: ≤ 200 sample points per trace; beyond that, summarize.

9. **`raw.intervals.interval` lapped-car parsing.** The "L+N" notation for lapped cars must return NULL gracefully. Should we also expose a separate `laps_down` integer column from the parser, or keep that as a separate matview? My read: parser returns `(seconds_or_null, laps_down_or_null)` tuple; matviews using "gap < 1.5s" for battle detection naturally exclude lapped cars via the NULL.

10. **Team-radio transcription scope.** `raw.team_radio.recording_url` is public audio; transcription via Whisper costs ~$0.006/min. A whole-season transcription is ~$50-100. Worth doing for storyline/incident detection, or defer until Phase 17? My read: defer; not blocking any other slice.

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

This plan is intentionally broad (35 slices, 4 phases, ~9-18 days through the autonomous loop). Codex review please:

- §3 data-layer correctness: I rewrote this section after discovering the production data is **OpenF1**, not FastF1. Schema cross-check against `sql/002_create_tables.sql` confirms every table I reference exists. Anything still mis-mapped?
- §4 matview list: is the 20-matview list right-sized? Are there any obvious candidates missing or duplicates? Specifically — should `14-track-dominance-gps` and `14-minisector-dominance` be one slice or two? My read: two, because the GPS-driven version is meaningfully more precise and worth its own contract.
- §5 surface picks: 6 surfaces is a defensible MVP. Are any mis-prioritized vs. the chat-only path?
- §7 deferred decisions: any worth pre-committing in the plan vs. leaving to slice authors?
- §8 risks: the OpenF1 sample-rate ceiling (#1) is the most consequential — it caps Corner-Analysis precision. Is the matview-aggregation mitigation sufficient, or do we need to bake "minimum-N-laps" thresholds into each contract?
- §9 open questions: triage as `High` / `Medium` / `Low` per the iterative-plan-audit format. Round-1 audit cap is 10 (per round-12 plan-iter raise).

If APPROVED, next step is generating the 35 slice stub files (mechanical, similar to the `stub_slices.py` approach used for the perf roadmap), then queuing them in `diagnostic/slices/_index.md` under new headers `## Phase 13`, `## Phase 14`, `## Phase 15`, `## Phase 16`.

---

End of plan.
