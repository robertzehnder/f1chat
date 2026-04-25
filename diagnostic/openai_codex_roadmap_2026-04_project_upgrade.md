# OpenF1 Upgrade Roadmap - OpenAI Codex Assessment

**Date:** 2026-04-25
**Author:** OpenAI Codex
**Purpose:** Separate roadmap notes so Claude or another agent can compare this assessment against `diagnostic/roadmap_2026-04_performance_and_upgrade.md`.

---

## 1. Current State

This project is no longer just an MVP. It is a production-minded local analytics warehouse with a semantic layer and a Next.js chat/query runtime.

The architecture is coherent:

- Python ingestion loads CSV history into `raw.*`.
- SQL migrations define raw tables, helper contracts, semantic lap contracts, and semantic summary contracts.
- `core.*` is the intended application and LLM query surface.
- The web app provides sessions, telemetry, schema/catalog, saved analyses, and chat APIs.
- The chat runtime combines deterministic SQL templates, LLM SQL generation, repair, execution safety, answer synthesis, and grading.

Local verification performed during this assessment:

- `npm run typecheck` passed.
- `npm run test:grading` passed.
- `npm run build` passed when network access was allowed for `next/font/google`.
- Python files compiled with `py_compile`.
- Shell scripts passed `bash -n`.

Local warehouse snapshot from read-only Postgres checks:

- `core.sessions`: 387
- Session year range: 2023 to 2026
- Latest session date in warehouse: 2026-12-06 13:00:00+00
- `core.session_completeness`: 242 analytic-ready, 34 partially loaded, 16 metadata-only, 95 future/placeholders
- `raw.laps`: 159,793
- `core.laps_enriched`: 167,172
- `raw.car_data`: 114,823,541
- `raw.location`: 125,287,376
- `core.stint_summary`: 20,654
- `core.strategy_summary`: 5,554
- `core.race_progression_summary`: 17,864

Important workspace note:

- There are pre-existing modified files:
  - `web/src/app/api/chat/route.ts`
  - `web/src/components/chat/ContextChip.tsx`
  - `web/tsconfig.tsbuildinfo`
- I did not modify or revert those changes.

---

## 2. Key Correction To Older Diagnostics

Some older diagnostic notes say semantic contracts were implemented but under-consumed. That was likely true earlier, but the current codebase has moved forward.

Evidence:

- `sql/007_semantic_summary_contracts.sql` now defines the second-wave summary contracts.
- `docs/semantic_contract_map.md` labels many `core.*` contracts as canonical.
- `web/src/lib/chatRuntime.ts` routes most analytical families toward `core.*`.
- `web/src/lib/anthropic.ts` includes semantic contracts in the allowlist and tells the model to prefer them.
- `web/src/lib/deterministicSql.ts` heavily uses `core.laps_enriched`, `core.driver_session_summary`, `core.strategy_summary`, `core.stint_summary`, `core.race_progression_summary`, and related contracts.

So the next upgrade should not be framed as "make semantic-first exist." It should be framed as:

1. Make semantic-first fast.
2. Make semantic-first observable.
3. Make semantic-first easier to maintain.
4. Close the remaining raw-table and synthesis-quality gaps.

---

## 3. Main Risks

### 3.1 Performance Risk

The project has very large telemetry/location tables and many semantic contracts are currently views. If a chat query expands a view stack over raw tables, latency can become dominated by repeated aggregation.

Most important risk:

- `core.*` semantic contracts are correct interfaces, but some should become backed operational surfaces rather than expensive view expansions.

### 3.2 Runtime Complexity Risk

The core TypeScript files are large:

- `web/src/lib/chatRuntime.ts`: 2,036 lines
- `web/src/lib/deterministicSql.ts`: 1,480 lines
- `web/src/lib/queries.ts`: 1,011 lines
- `web/src/app/api/chat/route.ts`: 816 lines
- `web/src/lib/answerSanity.ts`: 609 lines

These are still workable, but the next feature wave will become slower and riskier unless responsibilities are split into smaller modules.

### 3.3 Dependency And Security Risk

`npm audit --omit=dev` reports:

- high severity issue in `next`
- moderate severity issue in `postcss`

`npm outdated --long` shows:

- `next`: current 15.5.12, wanted 15.5.15, latest 16.2.4
- `react` / `react-dom`: current 19.2.4, wanted/latest 19.2.5
- `postcss`: current 8.5.8, wanted/latest 8.5.10
- `tailwindcss`: current 3.4.19, latest 4.2.4
- `typescript`: current 5.9.3, latest 6.0.3

Recommendation:

- Patch within the current major first.
- Treat Next 16, Tailwind 4, and TypeScript 6 as separate upgrade projects.

### 3.4 Build Reproducibility Risk

Production build depends on Google font fetches through `next/font/google`. Offline builds fail unless network is available.

Recommendation:

- Either self-host fonts or accept/document network dependency in CI/build environments.

### 3.5 Test Coverage Risk

Current JS grading fixtures are useful and pass, but there is no visible GitHub Actions CI, no Python unit test harness, no ruff config, and no small ingestion fixture test.

Recommendation:

- Add CI before deeper refactors.

### 3.6 Generated Artifact Hygiene

`web/tsconfig.tsbuildinfo` is tracked and changed after verification commands.

Recommendation:

- Stop tracking it and add it to `web/.gitignore` or root `.gitignore`.

---

## 4. Roadmap

### Phase 0 - Hygiene And Baseline

Goal: make the repo safer to upgrade.

Work:

1. Add `web/tsconfig.tsbuildinfo` to ignore and remove it from version control.
2. Add GitHub Actions CI:
   - `npm ci`
   - `npm run typecheck`
   - `npm run test:grading`
   - `npm run build`
   - Python compile check
   - shell syntax check
3. Run `npm audit fix` for patch-level Next/PostCSS fixes.
4. Update patch/minor dependencies that are low risk:
   - Next 15.5.12 to 15.5.15
   - React 19.2.4 to 19.2.5
   - React DOM 19.2.4 to 19.2.5
   - PostCSS 8.5.8 to 8.5.10
   - Autoprefixer 10.4.27 to 10.5.0
   - `@types/pg` to 8.20.0
5. Document build-time font/network behavior.

Exit criteria:

- Clean CI on every push.
- `npm audit --omit=dev` has no high severity production vulnerabilities.
- Build succeeds predictably in the intended CI environment.

### Phase 1 - Performance Instrumentation

Goal: create a reliable before/after measurement system.

Work:

1. Add per-stage timing for `/api/chat`:
   - request intake
   - runtime classification
   - resolver DB calls
   - deterministic template selection
   - LLM SQL generation
   - SQL execution
   - SQL repair
   - answer synthesis
   - answer sanity checks
   - total
2. Log stage timings as structured JSON.
3. Add a small perf summary script or route that aggregates recent traces.
4. Run a fixed 10 to 20 question benchmark and save p50/p95.

Exit criteria:

- Every performance change can quote before/after numbers.
- Slow requests can be attributed to DB, LLM, resolver, synthesis, or cold start.

### Phase 2 - Materialize Hot Semantic Contracts

Goal: keep `core.*` as the canonical interface while making it operationally fast.

Recommended approach:

- Create backed tables for hot summaries.
- Keep existing `core.*` names as compatibility views over the backed tables, or introduce `_mat`/`_cache` tables behind the scenes.
- Refresh by affected `session_key` after ingest rather than doing full warehouse refreshes.

Priority contracts:

1. `core.laps_enriched`
2. `core.driver_session_summary`
3. `core.stint_summary`
4. `core.strategy_summary`
5. `core.grid_vs_finish`
6. `core.race_progression_summary`
7. `core.pit_cycle_summary`
8. `core.strategy_evidence_summary`
9. `core.lap_phase_summary`
10. `core.lap_context_summary`
11. `core.telemetry_lap_bridge`, if common telemetry questions are too slow

Supporting work:

- Add primary/unique keys for each materialized surface.
- Add incremental refresh script, likely `src/refresh_summaries.py`.
- Add post-ingest refresh hooks in `src/ingest.py`.
- Add parity checks comparing source views to backed tables during transition.

Exit criteria:

- Session-scoped summary queries are consistently sub-100ms to low hundreds of ms.
- Existing runtime code can keep querying canonical `core.*` names.

### Phase 3 - Targeted Indexes And Query Plans

Goal: remove avoidable sequential scans from common query paths.

Work:

1. Add targeted indexes for raw and materialized semantic access patterns.
2. Run `EXPLAIN (ANALYZE, BUFFERS)` against representative benchmark SQL.
3. Store query plan notes in a diagnostic doc.

Likely index families:

- `raw.laps (session_key, driver_number, lap_number)`
- partial or covering indexes for valid-lap filters
- `raw.stints (session_key, driver_number)`
- `raw.pit (session_key, driver_number)`
- `raw.position_history (session_key, date)`
- materialized semantic tables keyed by `(session_key, driver_number, ...)`

Exit criteria:

- Hot benchmark queries use index scans or materialized summaries.
- No common chat path scans huge raw telemetry/location tables unless the question truly needs them.

### Phase 4 - App-Layer Caches

Goal: stop recomputing stable work.

Work:

1. Resolver cache:
   - cache session, driver, and team resolution for 15 minutes or by ingest version.
2. Deterministic template cache:
   - cache question classification/template match where safe.
3. Full-answer cache:
   - key by normalized question plus ingest version.
   - start in-process; move to Redis only if multi-instance deployment needs it.
4. Schema/contract prompt cache:
   - cache static prompt fragments and schema descriptions.

Exit criteria:

- Repeated common questions return in under 200ms when answer cache hits.
- Resolver time is near zero on warm cache.

### Phase 5 - LLM Prompt And Synthesis Hardening

Goal: reduce LLM cost/latency and prevent prose drift.

Work:

1. Split prompt builders into static prefix and dynamic suffix.
2. Add prompt caching if the Anthropic model and SDK support it.
3. Move toward typed fact payloads between SQL execution and prose synthesis.
4. Expand `answerSanity.ts` into validators for:
   - pit stops vs stints
   - sector winner consistency
   - grid vs finish claims
   - undercut/overcut evidence sufficiency
   - count/list parity
   - null-aware comparative claims
5. Make synthesis consume:
   - typed facts
   - compact row samples
   - explicit evidence sufficiency flags

Exit criteria:

- Fewer raw row dumps.
- Fewer unsupported strategic claims.
- Quality failures can be labeled as resolver, SQL, data sufficiency, or synthesis failures.

### Phase 6 - Runtime Refactor

Goal: keep the next wave of work maintainable.

Refactor candidates:

- Split `chatRuntime.ts` into:
  - question classification
  - entity resolution
  - completeness gating
  - table recommendation
  - planner trace types
- Split `deterministicSql.ts` into question-family modules:
  - pace
  - strategy
  - result/progression
  - telemetry
  - data health
- Split `queries.ts` into:
  - catalog/schema
  - resolver
  - session APIs
  - execution wrapper
- Keep `route.ts` as orchestration only.

Exit criteria:

- New question family can be added without editing a 1,000+ line file.
- Existing tests pass unchanged after refactor.

### Phase 7 - Product Surfaces Beyond Chat

Goal: make the semantic warehouse useful even when the user does not ask free-form questions.

Work:

1. Session detail upgrades:
   - driver roster
   - completeness status
   - lap pace table/chart
   - stint timeline
   - strategy summary
   - grid vs finish
2. Data health/catalog upgrades:
   - expose `core.session_completeness`
   - expose `core.weekend_session_coverage`
   - expose `core.source_anomaly_tracking`
3. Saved analyses:
   - persist SQL, typed fact payload, answer, and chart config
4. Replay/progression:
   - use `core.replay_lap_frames` and `core.race_progression_summary`

Exit criteria:

- The app is useful as a structured analyst console, not only as a chat demo.

### Phase 8 - Production Deployment Track

Goal: make local Docker and hosted Postgres both first-class.

Work:

1. Keep local `pg` path working.
2. For Neon/serverless production:
   - use pooled endpoint
   - consider `@neondatabase/serverless`
   - avoid prepared-statement assumptions under pooling
   - track cold starts
   - consider cron warmup before disabling autosuspend
3. Add read-replica support only after measurements show ingest/read contention.
4. Add environment assertions so production does not accidentally connect to local-style DB vars.

Exit criteria:

- Production connection behavior is explicit, measured, and documented.
- Local development remains simple.

---

## 5. Suggested Execution Order

1. Phase 0: hygiene, CI, audit fixes.
2. Phase 1: performance instrumentation.
3. Phase 2: materialize hot semantic contracts.
4. Phase 3: targeted indexes and query plans.
5. Phase 4: resolver/template/answer caches.
6. Phase 5: prompt caching and typed synthesis.
7. Phase 6: runtime refactor.
8. Phase 7: richer app surfaces.
9. Phase 8: production deployment hardening, as real production measurements demand.

This order is deliberate: measurement before optimization, operational speed before product expansion, and CI before large refactors.

---

## 6. What I Would Change In The Existing Claude Draft

The existing draft is strong and performance-focused. I would adjust it in these ways:

1. Soften any claim that semantic-first planning has not started. It has. The remaining issue is consistency, speed, and maintainability.
2. Put CI, audit fixes, and generated-artifact hygiene before Neon-specific work.
3. Treat Neon driver changes as production-track work that should follow measurement, unless production latency is already confirmed to be dominated by connection setup.
4. Prioritize materialized semantic contracts before more deterministic template expansion, because semantic-first templates can otherwise become slower.
5. Add an explicit runtime refactor phase; the large TypeScript modules are a real scaling constraint.
6. Add build reproducibility around `next/font/google`.

---

## 7. High-Confidence Next Commit Candidates

Small, safe first PR:

- Ignore/remove `web/tsconfig.tsbuildinfo`.
- Add CI workflow.
- Patch Next/PostCSS with `npm audit fix`.
- Add a simple `npm run verify` script that chains typecheck and grading tests.

Second PR:

- Add chat stage timing and structured perf traces.
- Add a small perf summary script.
- Capture a baseline report.

Third PR:

- Add first materialized/backed summary for `driver_session_summary` or `strategy_summary`.
- Wire it behind the existing `core.*` contract.
- Compare query time before/after.

---

## 8. Open Questions

1. Is Neon definitely the production target today, or only a likely future target?
2. Is chat latency currently dominated by DB execution, LLM calls, or cold connection startup?
3. Should the project prefer simple Python migration/refresh scripts over adopting a formal migration tool?
4. Should materialized semantic data be full rebuild, incremental by session, or hybrid?
5. Is the intended product primarily chat, analyst dashboard, or both?

