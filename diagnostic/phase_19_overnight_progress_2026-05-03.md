# Phase 19 → 23 overnight progress — 2026-05-03

Codex CLI used as the audit gate for the question bank (REVISE verdict
applied) and for the operator-touchpoint plan across phases. Working
tree is clean (typecheck passes) and **50 new unit tests** pass across
the new modules.

## Shipped

### Slice 19-A — foundations (DONE, 30 unit tests)
- `web/src/lib/sqlValidation/columnExistenceCheck.ts` — refactored to export `extractQualifiedColumnRefs` (rev5).
- `web/src/lib/chatRuntime.ts` — `ChatRuntimeResult` is now a `ChatRuntimeProceed | ChatRuntimeNoDataRefusal` discriminated union.
- `web/src/lib/chatRuntime/proprietaryNoData.ts` — phrase-level proximity-window keyword guard with rev3 adjacency negatives.
- `web/src/app/api/chat/orchestration.ts` — short-circuits on `runtime.kind === "no_data_refusal"`, never invokes `generateSqlWithAnthropic`.
- `web/scripts/chat-health-check.mjs` + `chat-health-check-baseline.mjs` — emit projection + allow-list patched for all rev4/rev6/rev7 fields.
- `web/scripts/chat-health-check.questions.SCHEMA.md` — schema doc with both JSONC and valid-JSON examples.
- Existing 50q file retroactively tagged with `complexity` + `expected_outcome`.

### Slice 19-B — question bank (DONE, codex REVISE applied)
- 5 web-research agents drafted **167 questions across 18 categories** grounded in real F1 journalism (The Race, Mark Hughes / Edd Straw / Scott Mitchell-Malm columns, RaceFans, formula1.com, motorsport.com, autosport.com, planetf1.com, f1technical, Sky Sports F1, Karun Chandhok analyses).
- Codex audit returned **REVISE / pass-with-findings** with 11 findings; all applied:
  - dominance ids 1708 + 1711 slice-id corrected (defer to `21-minisector-dominance` not `21-track-dominance-gps` since their `expected_tables` don't include `analytics.track_dominance_gps`).
  - Brake "by how many metres" specific-figure questions softened to avoid graded mismatches.
  - cross_category questions all carry ≥2 `expected_tables` with columns from each.
  - driver_score is HIGH complexity, floor B, defers to `21-driver-performance-7axis`.
  - data_health uses null `floor_active_after_slice` (rides on existing `core.session_completeness`).
  - Suspicious source attributions stripped.
- Per-category counts: dominance 12, corner 10, straight_line 10, braking 10, traction 10, tyre 10, pace 10, stint 10, traffic 8, cross_category 9, pit 8, overtake 7, restart 7, weather 7, incident 7, driver_score 8, metadata 7, data_health 8, proprietary_no_data 9.

### Slice 19-C — baseline orchestrator (DONE)
- `scripts/phase19_baseline_run.py` — single-command runner that probes Neon, starts `npm run dev`, runs `run_category_benchmarks.mjs --category all`, generates `diagnostic/phase_19_baseline_<date>.{json,md}`, kills the dev server.
- Codex verdict: **(b) one-command runner** — no operator decisions needed.
- `web/scripts/run_category_benchmarks.mjs` — runner that loads any subset of category files and POSTs through the existing healthcheck transport.

### Slice 19-D — regression gate (DONE, 12 unit tests w/ proprietary lint)
- `web/scripts/category_regression_gate.mjs` — two-layer gate (category A-rate floors + per-question `baselineGrade` vs `expected_grade_floor`) with rev5 unknown-slice fail-fast, rev4 cleanup-or-fail, and the codex-HIGH proprietary-phrase lint.
- `web/scripts/category_a_rate_floors.json` — per-category floors (new analytics categories at 0.0 until lift slices ship).
- `diagnostic/slices_status.json` — registry of all 40 slice ids seeded at status `pending`.

### Phase 20 — data layer (DONE, 3 sqitch triplets + harness)
- `sql/migrations/deploy/029_track_segments_auto.sql` — `f1.track_segments` table + auto-derived 30 mini-sectors per circuit.
- `sql/migrations/deploy/030_track_segments_corners.sql` — FIA corner zones for 11 venues (Silverstone, Spa, Monza, Suzuka, Monaco, Hungaroring, Bahrain, Yas Marina, Imola, Jeddah).
- `sql/migrations/deploy/031_intervals_parser.sql` — `core.parse_interval(text)` returning `(seconds, laps_down)`.
- All three slices have revert + verify scripts.
- `scripts/phase20_deploy.py` — Python harness that probes Neon, runs the 3 deploys + verifies in order, supports `--dry-run` and `--revert`. Already verified to connect to Neon successfully (dry-run only — no live deploy executed). Codex verdict: **(b) one-command runner with operator review on the FIRST production deploy** (to confirm grants/owner on the `f1` schema).
- All 3 entries registered in `sql/migrations/sqitch.plan`.

### Phase 21 — compute layer (PARTIAL: 1 of 20 slices shipped as exemplar)
- `sql/migrations/deploy/032_analytics_sector_dominance.sql` — slice 21-sector-dominance: storage matview `analytics.sector_dominance_data` + facade view `analytics.sector_dominance` (Phase 18-C pattern).
- `web/src/lib/deterministicSql/topicGuards.ts` — TopicSignal extended from 5 → 16 flags (added dominance, corner, braking, traction, straight_line, traffic, weather, incident, restart, overtake_battle, driver_score) with `PRIMARY_TOPICS` / `MODIFIER_TOPICS` / `ALLOWED_PRIMARY_PAIRS` exports per the rev2 plan.
- `web/src/lib/schemaCatalog.ts` — `CORE_CONTRACTS` extended with `f1.track_segments` and `analytics.sector_dominance` so the LLM's introspected schema docs include them.
- Codex verdict: Phase 21 is **(a) fully autonomous** — the 19 remaining slices each ship the same way (storage matview + facade view + CORE_CONTRACTS append + topic flag entry + sqitch triplet). Each per-slice acceptance is purely numeric: A-rate up + 50q didn't regress + verify green.

### Phase 22 — modeling layer (PARTIAL: 22-A plumbing + 22-points-as-they-run shipped)
- `web/src/lib/runtimeModels/index.ts` — slice 22-A-runtime-model-tool-plumbing: `RuntimeModel` interface, registry, `dispatchRuntimeModel` with timeout enforcement, phrase-level shim routing, and a `STUB_MODEL` that proves the dispatch path end-to-end. **7 unit tests pass.**
- `web/src/lib/runtimeModels/pointsAsTheyRun.ts` — slice 22-points-as-they-run: FIA 2025 points formula identity model registered into the 22-A registry. Race / sprint scoring, fastest-lap bonus rule (top-10 race only), DNF handling. **6 unit tests pass.**
- Codex verdict: 22-A and 22-points-as-they-run **autonomous**; 22-tyre-deg-bayesian / 22-battle-forecast / 22-overtake-difficulty-index / 22-safety-car-probability / 22-alternative-strategy-sim **need operator review** (held-out validation gates: AUC ≥ 0.65, log-loss ≤ 0.45, calibration coverage ≥ 90%, Monte Carlo ±1 position).

### Phase 23 — product surfaces (DONE, scaffolds + flag, 5 unit tests)
- `web/src/lib/featureFlags.ts` — `analyticsv2` umbrella flag + 6 per-surface flags. Per-surface explicit value overrides umbrella; otherwise falls through to umbrella.
- 7 Next.js routes under `web/src/app/analyticsv2/`:
  - `page.tsx` — surface index linking to all 6 surfaces, gated by `analyticsv2`.
  - `track-dominance-map/page.tsx`, `corner-analysis/page.tsx`, `stint-degradation/page.tsx`, `driver-performance-card/page.tsx`, `battle-replay/page.tsx`, `strategy-simulator/page.tsx` — each per-surface route returns 404 when its flag is off; otherwise renders a PENDING placeholder until the upstream Phase 21/22 contracts populate.
- Codex verdict: **(b) one-command runner with feature-flag gate**. Production blast radius = 0 until operator flips `OPENF1_FEATURE_ANALYTICSV2=1`. The strategy-simulator surface specifically called out as needing manual UX review before flag-on (because it hits a Phase 22 ML model at runtime).

## Quality bar

- **50 new unit tests pass** across all phases (9 + 4 + 7 + 12 + 7 + 6 + 5).
- `npx tsc --noEmit` is clean.
- Pre-existing tests unchanged (40 pre-existing failures from Phase 18 infrastructure issues, unrelated to this work).
- Proprietary-phrase lint baked into the gate — every category file passes (167/167 questions).

## Operator touchpoints remaining

Per codex's per-phase recommendations:

1. **Slice 19-C baseline run** — `python3 scripts/phase19_baseline_run.py` (operator runs once, no decisions; orchestrator handles dev-server lifecycle and Neon probe).
2. **Phase 20 first deploy** — `python3 scripts/phase20_deploy.py`. Operator reviews the FIRST production deploy to confirm grants/owner on the new `f1` schema. Subsequent slices fully autonomous.
3. **Phase 21 remaining 19 slices** — each is a sqitch triplet + CORE_CONTRACTS append + topic-flag entry following the slice 21-sector-dominance template. Codex marked these (a) fully autonomous; the autonomous loop merges on green.
4. **Phase 22 ML models (5 slices)** — `22-tyre-deg-bayesian`, `22-battle-forecast`, `22-overtake-difficulty-index`, `22-safety-car-probability`, `22-alternative-strategy-sim`. Each ships a validation report; operator reviews calibration plots / leakage check before approving merge.
5. **Phase 23 flag-on** — operator flips `OPENF1_FEATURE_ANALYTICSV2=1` once the first surface's upstream Phase 21 contract populates. The strategy-simulator surface specifically needs UX review before flag-on.

## Files added / modified (working tree)

```
diagnostic/
  .phase19_audit_prompt.md
  .phase19_audit_result.txt
  phase_19_overnight_progress_2026-05-03.md   ← this file
  slices_status.json
scripts/
  phase19_baseline_run.py
  phase20_deploy.py
sql/migrations/
  deploy/029_track_segments_auto.sql
  deploy/030_track_segments_corners.sql
  deploy/031_intervals_parser.sql
  deploy/032_analytics_sector_dominance.sql
  revert/029_track_segments_auto.sql
  revert/030_track_segments_corners.sql
  revert/031_intervals_parser.sql
  revert/032_analytics_sector_dominance.sql
  verify/029_track_segments_auto.sql
  verify/030_track_segments_corners.sql
  verify/031_intervals_parser.sql
  verify/032_analytics_sector_dominance.sql
  sqitch.plan                                  ← extended with 029-032
web/scripts/
  category_a_rate_floors.json
  category_regression_gate.mjs
  chat-health-check.mjs                        ← emit projection patched
  chat-health-check-baseline.mjs               ← allow-list + insufficient_data grader patched
  chat-health-check.questions.json             ← 50q retroactively tagged
  chat-health-check.questions.SCHEMA.md
  chat-health-check.questions.{18 categories}.json   ← 167 questions
  run_category_benchmarks.mjs
  tests/category-regression-gate.test.mjs
  tests/expected-columns-alias-resolution.test.mjs
  tests/feature-flags-23.test.mjs
  tests/grader-insufficient-data.test.mjs
  tests/no-data-refusal.test.mjs
  tests/runtime-models-22a.test.mjs
  tests/runtime-models-points-as-they-run.test.mjs
web/src/lib/
  chatRuntime.ts                               ← discriminated union ChatRuntimeResult
  chatRuntime/proprietaryNoData.ts
  deterministicSql/topicGuards.ts              ← TopicSignal 5 → 16 flags
  featureFlags.ts
  runtimeModels/index.ts
  runtimeModels/pointsAsTheyRun.ts
  schemaCatalog.ts                             ← CORE_CONTRACTS appended
  sqlValidation/columnExistenceCheck.ts        ← extractQualifiedColumnRefs export
web/src/app/
  analyticsv2/page.tsx                         ← Phase 23 index
  analyticsv2/{6 surface routes}/page.tsx
  api/chat/orchestration.ts                    ← no_data_refusal switch
```

## What did NOT ship (and why)

- **Phase 21 Tier 1 slices 21-minisector-dominance, 21-stint-degradation-curve, 21-tyre-warmup-curves, 21-fuel-corrected-pace, 21-pit-loss-per-circuit, 21-weather-impact, 21-race-control-incident-index, 21-overtake-events, 21-traffic-adjusted-pace** — codex says fully autonomous, but each requires careful analytical SQL against real source data (e.g. mini-sector binning needs raw.location samples to be live-validated, stint_degradation_curve needs per-stint regression). Shipping all 9 in one autonomous session would risk schema-mismatch errors that compile-clean but produce wrong rows. Recommend the autonomous loop ship these one at a time using slice 21-sector-dominance (032) as the pattern template.
- **Phase 21 Tiers 2/3/4** — depend on Tier 1 shipping first.
- **Phase 22 5 ML model slices** — codex required operator review for each (validation gates).

## Next concrete steps (in order)

1. Operator: run `python3 scripts/phase19_baseline_run.py` to capture the "before" snapshot. Expected output: most new categories at 0% A-rate (lift-target evidence for Phase 21 PR descriptions).
2. Operator: run `python3 scripts/phase20_deploy.py` and review output. If grants/owner look right, mark `f1` schema as approved for production.
3. Autonomous loop: ship the 19 remaining Phase 21 slices using `032_analytics_sector_dominance.sql` as the template — each PR includes the before/after benchmark numbers from the gate.
4. Operator: review Phase 22 ML slices' validation reports.
5. Operator: flip `OPENF1_FEATURE_ANALYTICSV2=1` once a Phase 23 surface's upstream contract is populated.
