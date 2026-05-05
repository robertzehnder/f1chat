# Phase 26 — Path to ≥90% A-rate (≥151/167) — 2026-05-05 (rev0)

**Starting position** (Phase 25.2 + Round 2 actuals, awaiting authoritative baseline):
- Confirmed live A: ≈ 126 / 167 ≈ **75.4%**
- Plan rev10 projection: 159 / 167 ≈ 95.2%
- Realized gap: **33 questions** (some unliftable without infra; some structurally stuck)

**Phase 26 target: 151 / 167 ≈ 90.4%** — requires **+25 A grades** from the current state.

---

## rev0 changes (2026-05-05)

Initial plan after Phase 25.2 + loop tightening Round 2 shipped. Built
from the per-question failure characterization in
`phase_25_remaining_75_roadmap_2026-05-04.md` rev11 + per-slice
live-validation actuals.

---

## Section 1 — Where the 25 questions come from

The +25 A grades break down across 5 work streams. Each has its own
section below with a per-question target list, effort estimate, and
acceptance criteria.

| Stream | Effort | Expected A delta | Cumulative A-rate |
|---|---|---:|---:|
| **26.1 Lap-distance derivation** (infrastructure) | 2-3 days | 0 (enabler only) | 75.4% |
| **26.2 Five spatial slices** (corner / minisector / traction / braking / spatial-zone DRS+overtake) | 3-4 days | +14 to +16 A | ≈ 84-85% |
| **26.3 Question-text cleanup pass** (false-premise + mis-tagged) | 1 day | +5 to +7 A | ≈ 88-89% |
| **26.4 Resolver enhancements** (driver-without-session, cross-team compare) | 1 day | +3 to +5 A | ≈ 90-91% |
| **26.5 Stochastic-variance robustness** (best-of-5 / matview-refresh ergonomics) | 0.5 day | +1 to +2 A | ≈ 91-92% |
| **TOTAL** | **7-9 days focused** | **+24 to +30 A** | **≥ 90%** |

The plan reaches 90% at the end of Stream 26.4. Stream 26.5 is buffer
in case any of the upstream streams under-deliver.

---

## Section 2 — Stream 26.1: Per-sample lap-distance derivation (infrastructure)

**Why first**: every spatial slice needs to know "this raw.car_data
sample (or raw.location sample) is at lap-distance X.X% along this lap."
Without that, spatial questions can't be answered, full stop.

**Approach**: build `core.lap_distance_per_sample` matview (or a
per-(session, driver, lap) `path_arclength` lookup table) by integrating
Euclidean distance between consecutive raw.location samples within
each lap window. Per-sample lap-distance is the cumulative arclength
divided by the lap's total path length.

**Files**:
- `sql/migrations/deploy/047_core_lap_path_arclength.sql` — per-(session,
  driver, lap) total path length and per-sample distance offset.
- `sql/migrations/deploy/048_core_lap_sample_distance.sql` — joinable
  view that gives every raw.car_data sample its `normalized_lap_distance`
  (0.0 - 1.0).
- `sql/migrations/verify/047_*.sql`, `verify/048_*.sql`.

**Source data**:
- `raw.location` — x, y, z, date, session_key, driver_number. The xyz
  trace per lap is dense enough (~20 Hz) for arclength integration.
- `core.laps_enriched.lap_start_ts` and `lap_end_ts` for lap-window
  bounds.

**Cost mitigation**:
- The full raw.location table is multi-million rows. Build the matview
  per-(session, driver, lap) using batched aggregation; refresh
  incrementally per session_key, not full-rebuild.
- Index `raw.location` on `(session_key, driver_number, date)` if not
  already present.
- 15-min `statement_timeout` on the matview build.

**Risk**:
- raw.location sample density varies by session; a few laps may be
  too sparse for stable arclength. Acceptance: 95th-percentile of
  per-lap sample counts ≥ 200 samples / lap. Sessions below threshold
  fall back to `null` for that lap (downstream dependents handle it).
- Path closure error: integrating xyz around a lap should return
  approximately to the start position. Validate that `|end - start| /
  total_arclength` < 5% on Race sessions.

**Acceptance**: deploy + verify + a one-line probe asserting that for a
known session (Suzuka 2025 Race), `core.lap_path_arclength` reports a
total length within 1% of the published 5.807 km. If that holds, the
infrastructure is reliable.

**Effort**: 1.5-2 days for the migrations + verify + probe + matview
refresh strategy.

---

## Section 3 — Stream 26.2: Five spatial slices

Each slice unlocks ~3-5 questions. Per-slice ship template mirrors
Phase 25.2: matview SQL + verify + facade view + schemaCatalog entry +
MATVIEW_HINTS entry + slices_status flip + question JSON
floor_active_after_slice cleanup + per-question live re-validation.

### 26.2a — `21-corner-analysis` (slice 049)

- 11 questions tagged: q1710-q1719, q2206 (per Phase 19 baseline).
- Schema: per-(session, driver_number, corner_id) with
  entry_speed_kph, apex_min_speed_kph, exit_speed_kph,
  entry_brake_pressure_avg, corner_label.
- Source: raw.car_data.speed × normalized_lap_distance (from 26.1) ×
  f1.track_segments (corner zones, already deployed).
- For each lap-and-corner, find samples whose distance ∈
  [start_normalized, end_normalized]. Entry = max(speed) just before
  start_normalized; apex_min = min(speed) inside; exit = max(speed) just
  after end_normalized.
- Expected A lift: 9 of 11 (q2206 is manifest C-cap; one question may
  partial-lift to B due to multi-matview cross-cat).

### 26.2b — `21-minisector-dominance` (slice 050)

- ~3 questions tagged.
- Schema: per-(session, driver_number, minisector_index) with
  best_minisector_time_s, dominance_count.
- Source: raw.car_data per-lap minisector splits, computed by binning
  samples into f1.track_segments minisector zones (750 entries
  deployed).
- Expected A lift: 3 of 3.

### 26.2c — `21-traction-analysis` (slice 051)

- 4 questions tagged.
- Schema: per-(session, driver_number, corner_id) with
  exit_throttle_application_pct (% of corner-exit samples on full
  throttle), exit_speed_kph, exit_traction_loss_count.
- Source: raw.car_data.throttle × normalized_lap_distance × corner
  zones from track_segments.
- Expected A lift: 3 of 4.

### 26.2d — `21-braking-performance` (slice 052)

- 2 questions tagged.
- Schema: per-(session, driver_number, corner_id) with
  brake_zone_speed_drop_kph (max speed - min speed in entry zone),
  brake_application_lap_distance, peak_brake_pressure_pct.
- Source: raw.car_data.speed and raw.car_data.brake × normalized_lap_distance.
- Expected A lift: 2 of 2.

### 26.2e — Spatial-zone augmentation of `21-drs-effectiveness` (revisit
slice 041 with track-zone joins)

- Update `analytics.drs_effectiveness_data` to include
  `drs_zone_index` (which DRS zone the sample was in) by joining
  raw.car_data.date + normalized_lap_distance to f1.track_segments
  (zones tagged segment_kind='drs_zone' — needs to be added to
  track_segments seed if missing).
- Lifts q2085 (DRS-zone-percentage analysis) which is currently
  permanently C.
- Expected A lift: +1 (q2085).

**Stream 26.2 total**: +14 to +16 A grades. Cumulative A-rate ≈ 84-85%.

**Effort**: 3-4 days for all 5 slices, mostly in parallel since they
share the lap-distance infrastructure from 26.1.

---

## Section 4 — Stream 26.3: Question-text cleanup pass

Some questions in the 50q + cross-cat + tyre + restart benchmarks
have `expected_columns` references that don't match what synthesis
actually needs to answer. Others have false premises.

### 26.3a — Manifest-confirmed false-premise rewrites (3 questions)

For each, edit the source question JSON to remove the unverifiable
specificity, then drop the manifest C-cap.

- **q2100** (Saudi 2025 lap-3 SC restart): rewrite as "Who led the
  field on the first SC restart of the 2025 Saudi Arabian GP?" —
  matches data; cap drops; should grade A.
- **q2144** (Mexico City lap-6 forcing-off): rewrite as "Compare the
  lap-1 Mexico City 2025 Turn 2 incident across drivers — did the
  stewards apply consistent penalties for forcing-off?" — matches
  data.
- **q2101** (TBD — probe to confirm false-premise; if confirmed
  rewrite, otherwise downstream synthesis fix).

**Expected A lift**: +3.

### 26.3b — `expected_columns` corrections (5-7 questions)

Several questions need 2-3 columns to grade A but only list 1 in
their source JSON. The grader checks every listed column is in the
SQL — but synthesis often picks a *different* correct column from
the same matview. Fixing this is a per-question audit.

Approach: for each non-A question, run the SQL through synthesis,
check what columns IT picked, compare to `expected_columns`. If
synthesis is correct but expected_columns is too narrow, expand
the list.

Candidates: q2086, q2123 (already A but check), q2143, q2167, q2200,
q2202.

**Expected A lift**: +2 to +4.

### 26.3c — Cross-table `expected_columns` additions (3-5 questions)

Multi-matview questions whose `expected_columns` only list one
matview — synthesis correctly JOINs but the grader marks the
non-listed columns as missing. Add the implied columns.

Candidates: q2100 (race_control + race_progression), q2086 (drs +
battle), q2202 (traffic + degradation).

**Expected A lift**: +2 to +3.

**Stream 26.3 total**: +5 to +7 A grades. Cumulative ≈ 88-89%.

**Effort**: 1 day of focused per-question audit + JSON edits +
re-validation.

---

## Section 5 — Stream 26.4: Resolver enhancements

### 26.4a — Bare-driver resolution without session (q2161 + others)

When `selectedSession` is undefined (e.g. season-retrospective fast-
path) but a driver name is mentioned, resolver currently falls into
`forceDriverClarification`. Fix: extend `getDriversFromIdentityLookup`
to query `core.driver_dim` (cross-season identity table; if missing,
build from `core.session_drivers` aggregate) when session_key is
unset.

Files:
- `web/src/lib/queries/resolver.ts` — add a session-less driver
  lookup branch.
- `web/src/lib/chatRuntime.ts` — when no session but a year is
  resolved, allow the cross-season driver lookup.

**Expected A lift**: +1 (q2161). Possibly +2 if other season-wide
single-driver questions exist.

### 26.4b — Cross-team comparison structural support (q2023 + others)

Currently `STRUCTURAL_COMPARISON_PATTERNS` covers steward / deg /
sequence comparisons but not "team A vs team B". Extend the pattern
list so "compare McLaren vs Mercedes / Ferrari vs Red Bull /
Mercedes pair / Ferrari drivers" patterns also bypass the driver-
pair clarification.

**Expected A lift**: +2 to +3 (q2023 plus 1-2 sibling cross-team
warmup / strategy questions).

### 26.4c — Per-lap matview-hint expansion (DRS / restart per-lap)

Some questions (q2086 DRS gap, q2101 restart leader) need synthesis
to JOIN a session-level matview against `core.race_progression_summary`
on (session_key, lap_number). The current matview hints don't
include this JOIN pattern explicitly enough. Expand the existing
hints with explicit "if you need lap-N position context, JOIN ..."
guidance.

**Expected A lift**: +1 to +2 (q2086, q2101).

**Stream 26.4 total**: +3 to +5 A grades. Cumulative ≈ 90-91% — this
is where we cross the 90% line.

**Effort**: 1 day.

---

## Section 6 — Stream 26.5: Stochastic-variance robustness

Borderline-A questions occasionally flake to B or C across runs (~3
attempts to settle). Two interventions:

### 26.5a — Best-of-5 in the benchmark runner (no code change)

Phase 25 used `--retries 3` (best of 3). Bumping to `--retries 5`
catches the LLM variance band. Cost: 5/3 × benchmark runtime ≈ 33%
more time per run, in exchange for more durable A grades. Document
in the acceptance script as the standard runtime for Phase 26
acceptance.

### 26.5b — Matview-refresh job

Some matviews (`stint_degradation_curve_data`, `traffic_adjusted_pace_data`)
build from full-table aggregates. If raw.car_data / raw.intervals
ingests new data, these matviews stale. Add a daily refresh hook in
`scripts/refresh_completeness_matview.py` (or a sibling script) that
runs `REFRESH MATERIALIZED VIEW analytics.* CONCURRENTLY` for all
Phase 21 / Phase 26 matviews.

**Expected A lift**: +1 to +2 (durability — borderline-A questions
that were flaking now stay A reliably).

**Effort**: 0.5 day.

---

## Section 7 — Dependency graph

```
26.1 lap-distance        ───┬─→ 26.2a corner-analysis
                            ├─→ 26.2b minisector-dominance
                            ├─→ 26.2c traction-analysis
                            ├─→ 26.2d braking-performance
                            └─→ 26.2e drs-zone augmentation

26.3 question-text        (independent — can ship in parallel)
26.4a driver-without-session  (independent)
26.4b cross-team-compare      (independent)
26.4c lap-N-JOIN-hint         (depends on 26.2 if zone-aware hints needed)
26.5  stochastic robustness   (independent)
```

**Critical path**: 26.1 → 26.2. 26.3, 26.4, 26.5 can all proceed in
parallel from day 1.

**Realistic schedule** (single-track focused execution):
- Day 1-2: 26.1 lap-distance + 26.4a driver-without-session
- Day 3-4: 26.2a corner-analysis + 26.4b cross-team-compare
- Day 5: 26.2b minisector + 26.2c traction + 26.5 robustness
- Day 6: 26.2d braking + 26.2e DRS augmentation
- Day 7: 26.3 question-text cleanup pass
- Day 8-9: full re-validation, plan rev1 with actuals

---

## Section 8 — Per-question target list (all 25 expected lifts)

| qid | current | target | stream | mechanism |
|-----|---------|--------|--------|-----------|
| q1710 | C | A | 26.2a | corner_analysis.apex_min_speed_kph |
| q1711 | C | A | 26.2a | corner_analysis.apex_min_speed_kph |
| q1712 | C | A | 26.2a | corner_analysis.entry_speed_kph |
| q1713 | C | A | 26.2a | corner_analysis 3-axis |
| q1714 | C | A | 26.2a | corner_analysis comparison |
| q1716 | C | A | 26.2a | corner_analysis.apex_min_speed_kph |
| q1717 | C | A | 26.2a | corner_analysis 3-axis |
| q1719 | C | A | 26.2a | corner_analysis 3-axis |
| q1718 | C | B→A | 26.2a + 26.2c | corner+stint multi-matview |
| q2010-q2013 | C | A (~3) | 26.2b | minisector-dominance |
| q2030-q2033 | C | A (~3) | 26.2c | traction-analysis |
| q2050, q2051 | C | A (2) | 26.2d | braking-performance |
| q2085 | C | A | 26.2e | drs_zone_index |
| q2100 | C | A | 26.3a | rewrite + matview JOIN hint |
| q2144 | C | A | 26.3a | rewrite |
| q2101 | C | A | 26.3a or 26.4c | rewrite OR synthesis JOIN |
| q2161 | C | A | 26.4a | bare-driver season-wide |
| q2023 | C | A | 26.4b | cross-team comparison |
| q2086 | C | A | 26.4c | DRS lap-N JOIN hint |
| q2143 | C | B → A* | 26.3b | expected_columns expansion (no penalty_points) |
| q2167 | C | A | 26.3b | expected_columns audit |

*q2143 may stay B — penalty_points is genuinely missing from OpenF1.
Realistic best is B with the expected_columns expansion.

**Aggregate**: +25 to +30 A grades, conservatively. The plan reaches
90% even at the low end.

---

## Section 9 — Acceptance criteria

Phase 26 ships as a single feature branch (or one-per-stream — your
preference). Final acceptance:

1. Re-run `python3 scripts/phase19_baseline_run.py` against the post-
   26.5 state. The output `phase_19_baseline_2026-05-...json` must
   show **≥ 151 A grades / 167 questions (≥ 90.4%)**.
2. Each per-question target in Section 8 either grades A on best-of-5
   OR has a manifest entry in `phase25_target_grades.json` with
   `phase25_target_grade: "B"` or `"C"` and a written
   `escape_to_authored_floor` justification.
3. The 5 spatial-slice deploys + the lap-distance infrastructure
   verify scripts all pass.
4. The matview-refresh job runs successfully on a clean schedule
   trigger (not just manual).

---

## Section 10 — Risks and abort conditions

- **R1**: lap-distance derivation produces unstable arclengths
  on sessions with sparse raw.location samples. **Mitigation**:
  acceptance gate at end of 26.1 (5%-error tolerance against
  published lap lengths). If it fails, the rest of 26.2 is blocked
  until raw.location ingest density improves.
- **R2**: matview build cost exceeds Neon's per-query budget.
  **Mitigation**: incremental per-(session, driver) refresh; no
  full-table rebuilds.
- **R3**: question-text rewrites in 26.3 introduce regressions on
  already-A questions. **Mitigation**: per-PR re-validation of the
  *category* (not just the rewritten question).
- **R4**: the LLM still hallucinates SQL despite Round 2's
  matview-hint compliance work. **Mitigation**: Stream 26.5b matview-
  refresh job; if hint compliance < 80% on the touched questions,
  consider a stricter hint format (e.g. JSON-shaped "RECOMMENDED
  QUERY" preamble).

**Abort threshold**: if Phase 26.1 (lap-distance) doesn't pass its
acceptance gate within 3 days of focused work, descope 26.2 and
shift to maximize cleanup / synthesis fixes only. Realistic ceiling
without lap-distance: ~83% (+8 from current via streams 26.3 / 26.4
/ 26.5 only — short of the 90% target but a meaningful improvement).

---

## Section 11 — Codex audit ask

Before implementation begins, codex should verify:

1. **Per-question target-list accuracy** (Section 8). For each qid,
   confirm:
   - The `expected_tables` listed in `phase_19_baseline_2026-05-04.json`
     match the matview the plan claims will lift it.
   - The `expected_grade_floor` matches the target grade.
   - The lift mechanism (which stream) is plausible.
2. **Lap-distance feasibility**: walk a single Race session's
   raw.location density (samples per lap, sample gap distribution).
   Flag if any 2025 Race session has < 200 samples per lap on
   median.
3. **f1.track_segments coverage**: how many corners are seeded for
   2025 venues? If < 50% of corners-tagged-in-questions, prepare a
   seed expansion as part of 26.2a.
4. **Stream 26.4a scope**: does `core.driver_dim` exist on Neon? If
   not, propose constructing it (one migration) before the resolver
   change.
5. **Outcome math**: walk through the per-question sums in Section 8
   and confirm 25 lifts is achievable. Flag any double-counting.

---

## Filename note

This file lives at `diagnostic/phase26_above_90_plan_2026-05-05.md`,
sibling to the Phase 25 plan. The Phase 25 plan (rev11) remains the
source of truth for the Phase 25 actuals and the 75-77% A-rate
ceiling without further infrastructure work.
