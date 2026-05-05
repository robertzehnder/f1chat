# Phase 26 — Path to ≥90% A-rate (≥151/167) — 2026-05-05 (rev2: codex audit pass 2 applied)

**Starting position** — auditable:
- Last authoritative baseline: `diagnostic/phase_19_baseline_2026-05-04.json` →
  **79 / 167 A** (47.3% A-rate).
- Phase 25.2 + Round 2 per-slice live-validation suggested ≈ 126 / 167
  (≈ 75.4%) A by the time slice 046 + Round 2 fixes shipped, but that
  number is **not auditable** until the in-flight
  `phase_19_baseline_2026-05-05.json` lands. Treat the 126 as an
  internal working estimate; treat 79 as the only currently-citable
  before-state.

**Phase 26 target: 151 / 167 ≈ 90.4%**.

The raw delta between authoritative before (79) and target (151) is
**+72 A**. Phase 25.2 has already done much of that work; Phase 26
finishes the rest. The split between "Phase 25.2 already delivered"
and "Phase 26 must deliver" cannot be resolved exactly until the
2026-05-05 baseline is read; rev2 of this plan will regenerate
Section 8 from that file.

---

## rev2 changes (codex audit pass 2 applied — 2026-05-05)

Codex audit pass 2 raised four findings; all are addressed below.

- **HIGH (Section 8.1 generation script silently drops duplicate-id
  rows)** — the rev1 script built `{r['id']: r}` as its dedup map.
  The benchmark contains duplicate qids across categories (e.g.
  q1711 appears in both `Corner analysis` and `Track dominance`,
  with the latter still C in the 2026-05-04 baseline). The dict-by-id
  collapse would silently lose the C-grade copy and undercount
  non-A questions. **Fix**: rewrote Section 8.1 generation script
  to (a) NOT dedup, (b) iterate the `results` list as a list, and
  (c) emit one row per `(id, category)` pair so the same qid in
  different categories surfaces independently. The output table's
  primary key is `(qid, category)` not `qid`.
- **HIGH (manifest exclusion conflicts with 26.3a rewrite targets)**
  — rev1's Section 8.3 said "manifest-bound qids are excluded from
  Section 8.1's lift table." But q2100 and q2144 are also explicit
  26.3a rewrite candidates — the plan's own intent is to *remove*
  their manifest cap by rewriting the source question, then watch
  them lift to A. Excluding them upfront would erase that lift
  path. **Fix**: manifest entries split into two sub-registers:
  - **Budget exceptions (not pursued in Phase 26)**: q1715, q2008,
    q2182, q2206, q2207. These stay manifest-capped; their target
    grade is the manifest entry, not A. Excluded from Section 8.1.
  - **Rewrite candidates (pursued in Phase 26)**: q2100, q2144.
    Stay in Section 8.1 with stream 26.3a. Their manifest C-cap
    is dropped as part of 26.3a's deliverable; if rewrite produces
    A, manifest entry is removed. If rewrite is rejected by review,
    they convert to budget exceptions.
  Section 9 acceptance criterion 2 is updated so rewrite-candidate
  qids count toward the ≥ 151 A target; budget-exception qids do
  not.
- **MEDIUM (live stream totals still escape the rev2 gate)** —
  Sections 26.3, 26.4, 26.5, and the abort threshold still cited
  concrete numbers ("+5 to +7", "90-91%", "~83%"). rev1 gated
  Section 1's stream table but missed these. **Fix**: every
  per-stream lift count and cumulative percentage outside the
  audit-history blocks is now marked "indicative pending baseline"
  or replaced with a relative descriptor ("targets the largest
  remaining bucket of mis-tagged questions"). The "Abort threshold"
  at the end of Section 10 keeps the qualitative claim ("realistic
  ceiling without lap-distance") but drops the specific 83%.
- **LOW (codex audit ask references the stale May 4 baseline)** —
  Section 11 told codex to walk through Section 8 against the
  2026-05-04 baseline, but rev1's whole premise is that rev2
  generates targets from the 2026-05-05 baseline. **Fix**: Section
  11 rewritten to audit against `phase_19_baseline_2026-05-05.json`
  (the freshly-generated Section 8.1 table) and explicitly
  acknowledges the May 4 baseline as historical only.

---

## rev1 changes (codex audit applied — 2026-05-05)

Codex audit pass 1 raised four findings; all are addressed below.

- **HIGH (starting A-rate not grounded in an available baseline)** —
  rev0 cited "≈ 126 / 167 ≈ 75.4%" without naming a file. The only
  authoritative before-file present locally is the 2026-05-04 baseline
  showing 79 / 167 A. **Fix**: header rewrites the starting position
  as "79 / 167 from the 2026-05-04 baseline" + flags the 126 as a
  Phase 25.2 working estimate that the 2026-05-05 baseline will
  confirm. All cumulative-percentage rows in Section 1's stream table
  are gated on the 2026-05-05 baseline. The total-lift number is
  re-stated as "raw +72 to reach 151" without claiming Phase 26 alone
  delivers all of it.
- **HIGH (Section 8 qids fabricated or already-A)** — rev0 listed
  q2010-q2013, q2030-q2033, q2050/q2051 (none exist in the baseline)
  and q1710 / q1711 / q1712 / q1713 / q1716 / q2167 (already A in
  the 2026-05-04 baseline). **Fix**: Section 8 replaced with a
  *generation procedure* (rev1) that the 2026-05-05 baseline run
  executes to produce an authoritative target list. Until rev2
  regenerates it, the numerical lift estimates per stream are marked
  "indicative, pending baseline." The placeholder fixed lift counts
  in the stream-table column are wrapped in `≈` and explicitly tied
  to "depends on remaining-non-A set after the 2026-05-05 baseline."
- **MEDIUM (spatial-slice lift overcounting)** — rev0's "21-corner-
  analysis lifts 9 of 11" was relative to a fabricated qid set.
  **Fix**: per-slice lift estimates in Section 3 are restated as
  "lift up to N of M questions in the slice's tagged set, but the
  actual lift count is whatever subset is *non-A* in the 2026-05-05
  baseline AND has the spatial dependency." The acceptance check
  measures lift against *the 2026-05-05 baseline*, not against
  fabricated counts.
- **MEDIUM (manifest-downgrade-as-acceptance double-counts A
  target)** — rev0's Section 9 allowed a Section 8 target to "pass"
  with either an A grade OR a manifest B/C entry. That conflates two
  different outcomes. **Fix**: acceptance criteria 1 and 2 in
  Section 9 are now mutually exclusive — criterion 1 (A on best-of-5)
  is the only path to count toward the ≥ 151 A target; criterion 2
  (manifest B/C) is logged as a *budget exception* with its own
  separate count. The headline acceptance is "151 A grades on
  best-of-5 against the post-Phase-26 baseline" with no double-counting.

---

## Section 1 — Where the missing A grades come from

Phase 26 splits remaining lift across 5 work streams. Per-stream lift
counts are **indicative pending the 2026-05-05 baseline**; rev2 will
regenerate exact targets. The stream lift sums together must close
the gap between the 2026-05-05 baseline's A count and 151.

| Stream | Effort | Indicative A delta | Cumulative A-rate |
|---|---|---:|---:|
| **26.1 Lap-distance derivation** (infrastructure) | 2-3 days | 0 (enabler only) | (gated) |
| **26.2 Five spatial slices** (corner / minisector / traction / braking / spatial-zone DRS+overtake) | 3-4 days | up to ≈ +14 A | (gated) |
| **26.3 Question-text cleanup pass** (false-premise + mis-tagged) | 1 day | ≈ +5 A | (gated) |
| **26.4 Resolver enhancements** (driver-without-session, cross-team compare) | 1 day | ≈ +3 A | (gated) |
| **26.5 Stochastic-variance robustness** (best-of-5 / matview-refresh ergonomics) | 0.5 day | ≈ +1 A | (gated) |
| **TOTAL** | **7-9 days focused** | **gap-dependent** | **≥ 90%** |

"Gated" = cumulative percentages and exact deltas resolve once the
2026-05-05 baseline lands. The schedule and effort estimates do not
depend on the gate.

If the 2026-05-05 baseline shows ≈ 126 A (the Phase 25.2 working
estimate), the gap is 25 → reachable at the end of Stream 26.4 with
26.5 as buffer. If it shows fewer A (e.g. 100), Phase 26 alone may
not reach 90% without Stream 26.2 over-delivering OR a rev2 plan
adding scope. If it shows more (≈ 140+), Phase 26 may reach 90% with
just streams 26.3 + 26.4 and 26.2 becomes optional polish.

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

- Tagged set: questions in the corner category whose
  `floor_active_after_slice = '21-corner-analysis'` and current
  grade ≠ A in the 2026-05-05 baseline. (rev0 said "11 questions
  q1710-q1719+q2206"; codex audit confirmed several of those are
  already A. Exact tagged-and-non-A set comes from Section 8.1.)
- Schema: per-(session, driver_number, corner_id) with
  entry_speed_kph, apex_min_speed_kph, exit_speed_kph,
  entry_brake_pressure_avg, corner_label.
- Source: raw.car_data.speed × normalized_lap_distance (from 26.1) ×
  f1.track_segments (corner zones, already deployed).
- For each lap-and-corner, find samples whose distance ∈
  [start_normalized, end_normalized]. Entry = max(speed) just before
  start_normalized; apex_min = min(speed) inside; exit = max(speed) just
  after end_normalized.
- Lift: every tagged-and-non-A corner-analysis question is a
  candidate. Manifest-bound questions (q2206 has a manifest C-cap)
  do NOT count toward 26.2a's lift; they're "budget-exception"
  rows in Section 9.

### 26.2b — `21-minisector-dominance` (slice 050)

- Tagged set: questions whose `floor_active_after_slice =
  '21-minisector-dominance'` and current grade ≠ A in 2026-05-05
  baseline. (rev0 cited "3 tagged"; verify against Section 8.1.)
- Schema: per-(session, driver_number, minisector_index) with
  best_minisector_time_s, dominance_count.
- Source: raw.car_data per-lap minisector splits, computed by binning
  samples into f1.track_segments minisector zones (750 entries
  deployed).
- Lift: every tagged-and-non-A minisector question.

### 26.2c — `21-traction-analysis` (slice 051)

- Tagged set: questions whose `floor_active_after_slice =
  '21-traction-analysis'` and current grade ≠ A in 2026-05-05
  baseline. (rev0 cited "4 tagged"; verify against Section 8.1.)
- Schema: per-(session, driver_number, corner_id) with
  exit_throttle_application_pct (% of corner-exit samples on full
  throttle), exit_speed_kph, exit_traction_loss_count.
- Source: raw.car_data.throttle × normalized_lap_distance × corner
  zones from track_segments.
- Lift: every tagged-and-non-A traction-analysis question.

### 26.2d — `21-braking-performance` (slice 052)

- Tagged set: questions whose `floor_active_after_slice =
  '21-braking-performance'` and current grade ≠ A in 2026-05-05
  baseline. (rev0 cited "2 tagged"; verify against Section 8.1.)
- Schema: per-(session, driver_number, corner_id) with
  brake_zone_speed_drop_kph (max speed - min speed in entry zone),
  brake_application_lap_distance, peak_brake_pressure_pct.
- Source: raw.car_data.speed and raw.car_data.brake × normalized_lap_distance.
- Lift: every tagged-and-non-A braking question.

### 26.2e — Spatial-zone augmentation of `21-drs-effectiveness` (revisit
slice 041 with track-zone joins)

- Update `analytics.drs_effectiveness_data` to include
  `drs_zone_index` (which DRS zone the sample was in) by joining
  raw.car_data.date + normalized_lap_distance to f1.track_segments
  (zones tagged segment_kind='drs_zone' — needs to be added to
  track_segments seed if missing).
- Lift target: q2085 (DRS-zone-percentage analysis) — verify it is
  still non-A in the 2026-05-05 baseline before scoping.

**Stream 26.2 total**: indicative lift count comes from Section 8.1
once the 2026-05-05 baseline lands. rev0's "+14 to +16 A" was
relative to a fabricated qid set and is not auditable; rev2 will
restate the count from the real non-A set.

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

**A lift**: indicative pending baseline. Up to 3 questions if all
three rewrites are accepted at review and grade A on best-of-5;
fewer if any convert to budget exceptions.

### 26.3b — `expected_columns` corrections

Several questions need 2-3 columns to grade A but only list 1 in
their source JSON. The grader checks every listed column is in the
SQL — but synthesis often picks a *different* correct column from
the same matview. Fixing this is a per-question audit.

Approach: for each non-A question, run the SQL through synthesis,
check what columns IT picked, compare to `expected_columns`. If
synthesis is correct but expected_columns is too narrow, expand
the list.

Candidates pre-baseline: q2086, q2143, q2200, q2202. Final
candidates come from Section 8.1 and depend on which qids are
non-A in the 2026-05-05 baseline.

**A lift**: indicative pending baseline. Targets the largest
remaining bucket of mis-tagged questions in the post-Phase-25.2
state.

### 26.3c — Cross-table `expected_columns` additions

Multi-matview questions whose `expected_columns` only list one
matview — synthesis correctly JOINs but the grader marks the
non-listed columns as missing. Add the implied columns.

Candidates pre-baseline: q2100 (race_control + race_progression),
q2086 (drs + battle), q2202 (traffic + degradation). Final
candidates from Section 8.1.

**A lift**: indicative pending baseline.

**Stream 26.3 total**: indicative pending baseline. Cumulative
A-rate (gated). Effort: 1 day of focused per-question audit +
JSON edits + re-validation.

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

**A lift**: indicative pending baseline. Targets q2161 plus any
other season-wide single-driver questions surfaced in Section 8.1.

### 26.4b — Cross-team comparison structural support (q2023 + others)

Currently `STRUCTURAL_COMPARISON_PATTERNS` covers steward / deg /
sequence comparisons but not "team A vs team B". Extend the pattern
list so "compare McLaren vs Mercedes / Ferrari vs Red Bull /
Mercedes pair / Ferrari drivers" patterns also bypass the driver-
pair clarification.

**A lift**: indicative pending baseline. Targets q2023 plus any
sibling cross-team comparison questions in Section 8.1.

### 26.4c — Per-lap matview-hint expansion (DRS / restart per-lap)

Some questions (q2086 DRS gap, q2101 restart leader) need synthesis
to JOIN a session-level matview against `core.race_progression_summary`
on (session_key, lap_number). The current matview hints don't
include this JOIN pattern explicitly enough. Expand the existing
hints with explicit "if you need lap-N position context, JOIN ..."
guidance.

**A lift**: indicative pending baseline.

**Stream 26.4 total**: indicative pending baseline. Cumulative
A-rate (gated). Effort: 1 day.

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

**A lift**: indicative pending baseline. Durability — borderline-A
questions that were flaking now stay A reliably.

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

## Section 8 — Per-question target list (REGENERATE FROM 2026-05-05 BASELINE)

**Status**: rev0 listed fabricated qids (`q2010-q2013`, `q2030-q2033`,
`q2050/q2051` don't exist in the benchmark) and several already-A
qids (`q1710` / `q1711` / `q1712` / `q1713` / `q1716` / `q2167` were
already A in the 2026-05-04 baseline). Codex audit pass 1 invalidated
that list. **rev1 removes it pending regeneration from the in-flight
2026-05-05 baseline.**

### 8.1 — Generation procedure

The benchmark file contains duplicate qids across categories (e.g.
q1711 appears in `Corner analysis` AND `Track dominance`, sometimes
with different grades). The script below preserves duplicate rows
keyed by `(id, category)` so a qid that's A in one category and C
in another shows up once for the C category in the lift table.

When `phase_19_baseline_2026-05-05.json` lands:

```bash
python3 - <<'PY'
import json
results = json.load(open('diagnostic/phase_19_baseline_2026-05-05.json'))['results']
# Iterate the list verbatim — DO NOT dedup by id. Multiple categories
# can carry the same qid with different grades; we want each
# (id, category) pair to surface independently.
non_a = [r for r in results if r.get('baselineGrade') != 'A']
total = len(results)
a_count = total - len(non_a)
print(f"After-state: {a_count} A / {total} total = {a_count/total*100:.1f}% A-rate")
print(f"Non-A count: {len(non_a)} (one row per (qid, category) pair)")
print()
# Sort by (qid, category) for stable output.
non_a.sort(key=lambda r: (r['id'], r.get('category', '?')))
print("| qid | category | grade-now | target | floor_active_after_slice | expected_tables | manifest? |")
print("|-----|----------|-----------|--------|--------------------------|------------------|-----------|")
manifest = json.load(open('diagnostic/phase25_target_grades.json'))['overrides']
for r in non_a:
    qid = r['id']
    qid_str = str(qid)
    grade = r.get('baselineGrade')
    target = r.get('expected_grade_floor')
    slice_id = r.get('floor_active_after_slice') or '-'
    tables = ' / '.join(r.get('expected_tables') or [])
    in_manifest = manifest.get(qid_str)
    if in_manifest:
        manifest_tag = f"yes ({in_manifest['phase25_target_grade']})"
    else:
        manifest_tag = '-'
    print(f"| q{qid} | {r.get('category','?')} | {grade} | {target} | {slice_id} | {tables} | {manifest_tag} |")
PY
```

The output of this script becomes Section 8.1's table verbatim. The
`manifest?` column flags which qids are already in the
phase25_target_grades.json manifest (per Section 8.4's split). Each
non-A row gets a stream assignment based on:

- `floor_active_after_slice` references a Phase 26 spatial slice
  (corner / minisector / traction / braking) → **26.2** with the
  matching slice letter.
- Question is in the manifest already → **manifest review** (NOT a
  Phase 26 lift — see Section 9 for the budget-exception pathway).
- `expected_tables` references multiple matviews → **26.3c** (cross-
  table expected_columns) OR **26.4c** (lap-N JOIN hint), depending
  on whether the synthesis path is structural (column shape) or
  prompt (LLM picking the wrong shape).
- Question text contains a single driver name AND season-wide phrasing
  → **26.4a** (bare-driver season-wide).
- Question text contains "compare X and Y" where X / Y are team names
  → **26.4b** (cross-team comparison).
- Question text references a specific event by lap → probe whether
  the event exists in the data; if not → **26.3a** (false-premise
  rewrite OR manifest C-cap).

### 8.2 — Per-stream sum guarantees

After Section 8.1 is generated, rev3 must demonstrate that:

- (Stream 26.2 lifts) + (Stream 26.3 lifts) + (Stream 26.4 lifts) +
  (Stream 26.5 lifts) ≥ (151 A target) − (count of A in
  2026-05-05 baseline).
- No qid is double-counted across streams.
- Manifest-bound qids are split per Section 8.4. Only "rewrite
  candidates" count toward the A target; "budget exceptions not
  pursued" do not.

If the sum doesn't close the gap, rev3 must either:
1. Expand a stream's scope (with an effort revision), OR
2. Acknowledge Phase 26 alone won't reach 90% and propose a Phase
   27 follow-up (typically a question-rewrite pass + grader
   loosening).

### 8.3 — Already-A qids that should NOT appear in 8.1

Per codex audit pass 1, these were in rev0's per-question table
erroneously and must stay excluded from any Phase 26 lift count:
- q1710, q1712, q1713, q1716, q2167 (already A in 2026-05-04
  baseline; verify against 2026-05-05 baseline before relying on
  this exclusion).
- q1711 — already A in `Corner analysis` category but still C in
  `Track dominance` category. Section 8.1 will surface the
  Track-dominance C row (per the (qid, category) keying fixed in
  rev2); the Corner-analysis A row is correctly excluded.
- q2010-q2013, q2030-q2033, q2050, q2051 (not in benchmark at
  all).

The Section 8.1 generation script naturally excludes A-graded rows
by reading the `baselineGrade != 'A'` filter.

### 8.4 — Manifest-entry split (rev2)

Codex audit pass 2 flagged that rev1 lumped all manifest entries
into "budget exceptions excluded from Section 8.1." But the
manifest contains TWO different kinds of entries:

**8.4a — Budget exceptions (NOT pursued in Phase 26)**

Excluded from Section 8.1's lift table. Their target grade is
the manifest entry, not A.

| qid  | manifest grade | reason | excluded? |
|------|----------------|--------|-----------|
| q1715 | A (promotion)  | not actually a non-A target — already a Phase 25 expected-A | yes |
| q2008 | C              | Ferrari quali-trim vs race-trim attribution; needs setup data not ingested | yes |
| q2182 | B              | per-driver telemetry coverage; matview shipped (slice 046) but the lift didn't take — Phase 27 candidate | yes |
| q2206 | C              | Leclerc Monza compound vs corner-pace causation; needs Tier-4 driver-event-attribution model | yes |
| q2207 | C              | Mercedes Spa C3 cliff cause-attribution; needs Phase 22 Bayesian deg model | yes |

**8.4b — Rewrite candidates (PURSUED in Phase 26 stream 26.3a)**

Stay in Section 8.1's lift table. The plan's intent is to remove
their manifest C-cap by rewriting the source question text, then
watch the lift to A on best-of-5.

| qid  | manifest grade | rewrite |
|------|----------------|---------|
| q2100 | C | "Who led the field on the lap-3 SC restart at the 2025 Saudi Arabian GP?" → "Who led the field on the first SC restart of the 2025 Saudi Arabian GP?" |
| q2144 | C | "Compare the lap-6 Mexico City 2025 Turn 1-to-Turn 4 sequence ..." → "Compare the lap-1 Mexico City 2025 Turn 2 incident across drivers ..." |

If the rewrite is rejected at review (e.g. the question's authored
intent must include the false specificity), the entries convert
back to budget exceptions. Otherwise their manifest entries are
deleted as part of 26.3a's deliverable, and the questions count
toward the ≥ 151 A target only if they actually grade A on
best-of-5 against the post-26 baseline.

### 8.5 — Section 8.1 generator: manifest-aware filtering

When generating Section 8.1's table, post-process to:
1. Exclude rows whose qid is in 8.4a (budget exceptions not
   pursued).
2. Keep rows whose qid is in 8.4b (rewrite candidates) with the
   `manifest?` column showing the current manifest grade and a note
   that the rewrite path is the lift mechanism.
3. Keep all other non-A rows.

The post-processing pseudocode:

```python
budget_exception_qids = {1715, 2008, 2182, 2206, 2207}
rewrite_candidate_qids = {2100, 2144}
final_targets = [r for r in non_a if r['id'] not in budget_exception_qids]
# rewrite_candidate_qids stay in final_targets but are tagged with stream 26.3a.
```

---

## Section 9 — Acceptance criteria

Phase 26 ships as a single feature branch (or one-per-stream — your
preference). Final acceptance:

**Criterion 1 (mandatory, gates pass/fail)**: re-run
`python3 scripts/phase19_baseline_run.py` against the post-26.5
state. The output `phase_19_baseline_2026-05-...json` must show
**≥ 151 A grades / 167 questions (≥ 90.4%) on best-of-5 retries**.
This is the only metric that determines pass / fail. Manifest
B/C entries do NOT count toward the 151 (criterion 2 below tracks
them separately).

**Criterion 2 (budget-exception register, informational)**: any
Section 8.1 target that does NOT grade A on best-of-5 must either:
1. Have a manifest entry in `phase25_target_grades.json` with
   `phase25_target_grade: "B"` or `"C"` and a written
   `escape_to_authored_floor` justification (counted as a
   *budget exception*), OR
2. Be flagged as a Phase 27 follow-up.

The total budget-exception count + the actual A count must equal
the Section 8.1 target list size. If the budget exception
register grows unexpectedly during implementation, criterion 1
may not be reachable — surface this and rev3 the plan with
expanded scope BEFORE final acceptance.

**Criterion 3**: the 5 spatial-slice deploys + the lap-distance
infrastructure verify scripts all pass.

**Criterion 4**: the matview-refresh job runs successfully on a
clean schedule trigger (not just manual).

### Acceptance reconciliation example

If the 2026-05-05 baseline shows 126 A and Phase 26 must reach 151:
- Gap = 25 net new A.
- Section 8.1 generation produces (167 - 126) = 41 non-A qids.
- Manifest already covers 7 (q1715, q2008, q2100, q2144, q2182,
  q2206, q2207) — these are budget exceptions, not Phase 26
  targets.
- Real Phase 26 target list = 41 - 7 = 34 qids.
- Phase 26 must lift ≥ 25 of those 34 to A on best-of-5.
- Remaining 9 either grade A natively post-Phase-26 work, OR
  become new manifest entries (criterion 2), OR are deferred to
  Phase 27.

If the 2026-05-05 baseline shows fewer A (e.g. 100), the gap grows
to 51 — Phase 26 alone is unlikely to close it without rev3
expansion. If it shows more (e.g. 145), the gap shrinks to 6 — well
within scope of streams 26.3 + 26.4 alone.

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
without lap-distance is **gated** until rev3 measures it against
the 2026-05-05 baseline — qualitatively, this is "short of the
90% target but a meaningful improvement," with the exact A-rate
ceiling depending on how many spatial-dependent questions the
2026-05-05 baseline shows still non-A.

---

## Section 11 — Codex audit ask

The 2026-05-04 baseline is **historical only** for this plan — it
anchored Phase 25's "before" state and the rev1 starting-position
discussion, but every Phase 26 audit question below is against the
freshly-generated Section 8.1 table built from
`phase_19_baseline_2026-05-05.json`. Do NOT re-audit the 2026-05-04
file for Phase 26 target accuracy.

Before implementation begins, codex should verify:

1. **Section 8.1 generation correctness**: re-run the generator
   script in Section 8.1 against `phase_19_baseline_2026-05-05.json`
   and confirm:
   - The script does NOT dedup by `id` (regression check; rev1's
     bug). Multiple `(id, category)` pairs with the same id surface
     independently when their grades differ.
   - The `manifest?` column correctly tags entries from
     `diagnostic/phase25_target_grades.json`.
   - Section 8.4a budget exceptions are filtered out of the final
     target list.
   - Section 8.4b rewrite candidates (q2100, q2144) stay in the
     final target list with stream tag 26.3a.
2. **Per-question stream assignment**: for each row in the
   regenerated Section 8.1 table, confirm:
   - The stream assignment matches the `expected_tables` /
     `floor_active_after_slice` / question-text classification
     rules listed in Section 8.1.
   - The `expected_tables` references a matview that exists OR a
     Phase 26 slice that ships it.
   - The `expected_grade_floor` matches the assigned target grade.
3. **Lap-distance feasibility**: walk a single Race session's
   raw.location density (samples per lap, sample gap distribution).
   Flag if any 2025 Race session has < 200 samples per lap on
   median.
4. **f1.track_segments coverage**: how many corners are seeded for
   2025 venues? If < 50% of corners-tagged-in-questions, prepare a
   seed expansion as part of 26.2a.
5. **Stream 26.4a scope**: does `core.driver_dim` exist on Neon? If
   not, propose constructing it (one migration) before the resolver
   change.
6. **Outcome math closure**: walk through the per-stream lift
   counts after Section 8.1 is generated. Confirm:
   - (sum of stream lifts) ≥ (151 - count of A in 2026-05-05
     baseline).
   - No qid is double-counted across streams.
   - q2100 and q2144 (rewrite candidates) are counted in 26.3a's
     lift sum, NOT in the budget-exception register.
   - The 8.4a budget exceptions are excluded from both the lift
     sum and the lift-needed denominator.

---

## Filename note

This file lives at `diagnostic/phase26_above_90_plan_2026-05-05.md`,
sibling to the Phase 25 plan. The Phase 25 plan (rev11) remains the
source of truth for the Phase 25 actuals and the 75-77% A-rate
ceiling without further infrastructure work.

## rev3 prerequisite

Before any Phase 26 implementation begins, rev3 must:

1. Read `phase_19_baseline_2026-05-05.json` (the in-flight baseline
   that anchors the auditable starting position).
2. Run the Section 8.1 generation script against that file to
   produce the per-question target list. The script must NOT dedup
   by `id` (regression check from rev2's HIGH finding); use the
   `(id, category)` pair as the row key.
3. Apply the Section 8.4 manifest split: filter out 8.4a budget
   exceptions; keep 8.4b rewrite candidates with stream 26.3a.
4. Compute the gap: (151 - actual A count) — call it `LIFT_NEEDED`.
5. Assign each Section 8.1 row to a stream (26.2a/b/c/d/e,
   26.3a/b/c, 26.4a/b/c, 26.5).
6. Verify (sum of stream lifts) ≥ `LIFT_NEEDED`. If not, rev3
   expands a stream's scope or escalates to Phase 27.
7. Update Section 1's stream table with concrete cumulative
   percentages.
8. Section 3's per-slice "tagged set" entries get exact counts.
9. Document any qids that were Phase 25.2 lift candidates but
   already-A in the 2026-05-05 baseline (these need NO Phase 26
   work and stay excluded from the lift table).

Until rev3 lands, this plan is *gated*. It cannot be implemented
because the per-question target list does not yet exist.
