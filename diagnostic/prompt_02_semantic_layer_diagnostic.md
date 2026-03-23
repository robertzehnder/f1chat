# Prompt 2 Diagnostic: Semantic Layer

## 1) Current semantic-layer inventory

### Implemented semantic objects (warehouse)

1. `core.compound_alias_lookup` (implemented)
- Purpose: normalize tyre compound labels into canonical compound families.
- Evidence: `sql/006_semantic_lap_layer.sql:4`.

2. `core.valid_lap_policy` (implemented, versioned)
- Purpose: policy-controlled valid-lap criteria (`min/max duration`, `pit in/out exclusion`, sector and compound rules).
- Evidence: `sql/006_semantic_lap_layer.sql:50`.

3. `core.metric_registry` (implemented)
- Purpose: canonical metric contract catalog for lap semantics.
- Evidence: `sql/006_semantic_lap_layer.sql:119`.

4. `core.lap_semantic_bridge` (implemented)
- Purpose: cross-table lap-grain bridge (lap + stint + pit + position + flag context).
- Evidence: `sql/006_semantic_lap_layer.sql:173`.

5. `core.laps_enriched` (implemented)
- Purpose: transformed-lap semantic contract including validity + representative-pace fields.
- Evidence: `sql/006_semantic_lap_layer.sql:272`.

6. `core.replay_contract_registry` (implemented)
- Purpose: versioned replay-frame contract metadata.
- Evidence: `sql/006_semantic_lap_layer.sql:446`.

7. `core.replay_lap_frames` (implemented)
- Purpose: lap-indexed replay/progression frames.
- Evidence: `sql/006_semantic_lap_layer.sql:501`.

8. `docs/transformed_lap_schema.md` (implemented documentation contract)
- Purpose: formal documentation of transformed-lap semantics and replay frame contract.
- Evidence: `docs/transformed_lap_schema.md`.

### Existing semantic-adjacent objects

1. `core.session_completeness`
- Purpose: session-level table availability/coverage snapshot.
- Evidence: `sql/005_helper_tables.sql:321`.
- Note: this is semantic-adjacent (data health), not lap-performance semantics.

### Material gap in usage (critical)

Although the above semantic objects exist, they are barely used by runtime SQL generation:

- Deterministic SQL templates still reference `raw.*` heavily and do not target `core.laps_enriched` / `core.lap_semantic_bridge` / `core.replay_lap_frames`.
  - Evidence: `web/src/lib/deterministicSql.ts` uses `raw.laps`, `raw.stints`, `raw.pit`, `raw.position_history`, `raw.car_data`; no `core.laps_enriched` hit.
- Query helper layer exposes no retrieval helpers for semantic views except `core.session_completeness`.
  - Evidence: `web/src/lib/queries.ts` only references `core.session_completeness` among these semantic objects.
- LLM SQL system prompt does not include semantic-layer tables.
  - Evidence: `web/src/lib/anthropic.ts:50-53` includes `core.sessions/core.session_drivers/...` + `raw.*`, but not `core.laps_enriched`, `core.lap_semantic_bridge`, or `core.replay_lap_frames`.

Conclusion: semantic objects are implemented in warehouse but not yet operationalized as primary analytical contracts.

## 2) Missing semantic-layer inventory

### A. Planned/documented but not implemented as objects

1. `core.driver_session_summary` (missing)
- Mentioned in planning/docs as a derived summary view.
- Evidence: `docs/helper_repo_adoption_status.md:139`, `docs/llm_database_context_extended.md:746`.

2. `core.stint_summary` (missing)
- Mentioned in planning/docs.
- Evidence: `docs/helper_repo_adoption_status.md:140`, `docs/llm_database_context_extended.md:748`.

3. `core.grid_vs_finish` (missing)
- Mentioned in planning/docs.
- Evidence: `docs/helper_repo_adoption_status.md:142`, `docs/llm_database_context_extended.md:216`.

4. `core.race_progression_summary` (missing)
- Mentioned in planning/docs.
- Evidence: `docs/helper_repo_adoption_status.md:143`.

5. `core.lap_phase_summary` (missing, implied)
- Not formalized as an object, but repeatedly needed for “final third / phase” style pace analysis.
- Evidence: benchmark question family around phase slicing in health checks (`Q28` behavior in `web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md`).

6. `core.telemetry_lap_bridge` (missing, implied)
- “Lap-window bridge” is explicitly recommended in docs but not implemented as a core object.
- Evidence: `docs/llm_database_context_extended.md:754`.

### B. Implemented but not fully formalized operationally

1. Clean-lap comparison set semantics
- `is_valid` exists in `core.laps_enriched`, but there is no explicit reusable “comparison cohort” object (for clean-lap set definitions by analysis mode).
- Result: templates repeatedly recompute ad hoc clean-lap logic.

2. Metric registry governance in runtime
- `core.metric_registry` exists, but templates/planner are not driven by it.
- Evidence: docs note this as next action (`docs/helper_repo_adoption_status.md:133`).

3. Replay semantics consumption
- `core.replay_lap_frames` exists, but runtime does not consume it for race progression analysis.
- Evidence: no runtime references in `web/src/*`.

### C. Semantic object inventory check (negative evidence)

No SQL definition exists today for:
- `core.driver_session_summary`
- `core.stint_summary`
- `core.grid_vs_finish`
- `core.race_progression_summary`
- `core.lap_phase_summary`
- `core.telemetry_lap_bridge`

(Repository SQL search returned no matches under `sql/*.sql`.)

## 3) Benchmark questions affected by each gap

Source run used: `web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md` (intense rubric, baseline `A=21, B=3, C=26`).

### Gap-to-question mapping

1. Missing session-level semantic coverage ranking object
- Gap: no semantic object for downstream coverage scoring beyond raw table counts.
- Affected: `Q6`.
- Symptom: returns recent sessions metadata rather than true coverage ranking.

2. `core.laps_enriched` not used as primary lap contract
- Gap: clean-lap / representative pace / lap-relative pace are still computed ad hoc on raw laps.
- Affected: `Q21, Q22, Q23, Q24, Q26, Q27, Q28, Q29, Q30, Q33, Q34, Q35, Q37`.
- Symptom: intense rubric marks repeated failures on semantic-table usage (`all_ideal_tables_used`).

3. Missing `core.stint_summary` + stint semantics reuse
- Gap: stint/tyre-age analytics are recomputed per-query from `raw.stints/raw.laps`.
- Affected: `Q27, Q31, Q32, Q42, Q43, Q47, Q48`.
- Symptom: high SQL complexity and inconsistent analytical framing across related questions.

4. Missing formal pit-cycle progression semantic object
- Gap: no canonical “pit-cycle position delta” semantic view.
- Affected: `Q45, Q46`.
- Symptom: answers often caveat missing pre/post context instead of deterministic pit-cycle metrics.

5. Missing `core.race_progression_summary` operational use
- Gap: race progression still inferred directly from raw position history in query-time SQL.
- Affected: `Q49` (and partially `Q50`).
- Symptom: progression answers depend on sparse point extraction rather than formal timeline semantics.

6. Missing lap-phase semantic object (`core.lap_phase_summary`)
- Gap: phase segmentation (opening/middle/final-third) has no reusable semantic contract.
- Affected: `Q28`, partially `Q37`, and qualifying-improvement style logic in `Q25`.

7. Missing telemetry-to-lap bridge (`core.telemetry_lap_bridge`)
- Gap: telemetry windowing is not formalized at lap grain.
- Affected: telemetry overlays and braking-point analyses (currently only one telemetry benchmark question is stable).
- Evidence of need: `docs/llm_database_context_extended.md:754` recommends this explicitly.

## 4) Highest-leverage semantic-layer builds

1. Make `core.laps_enriched` the default analytical contract for lap/stint/pace families
- Why: largest benchmark impact immediately; many current `C` questions are semantic-table-usage failures.
- Scope: enforce use for clean lap, representative pace, lap-relative pace, tyre-age pace.

2. Build `core.stint_summary`
- Why: removes repeated ad hoc stint math and stabilizes pit/strategy family answers.
- Suggested fields: `session_key`, `driver_number`, `stint_number`, `compound_name`, `laps_in_stint`, `avg_valid_lap`, `degradation_per_lap`, `opening_or_closing_flag`.

3. Build `core.race_progression_summary`
- Why: stabilizes running-order and pit-cycle reasoning; should consume `position_end_of_lap` from semantic bridge.
- Suggested fields: lap-level position snapshots, position deltas, pit-cycle windows.

4. Build `core.grid_vs_finish`
- Why: canonicalizes finishing/order delta logic and removes fallback ambiguity with sparse result/grid data.

5. Build `core.lap_phase_summary`
- Why: canonicalizes “final third / phase” pace questions now done ad hoc.

6. Build `core.telemetry_lap_bridge`
- Why: unlocks deterministic telemetry overlays and lap-window telemetry joins without huge custom SQL each time.

7. Operationalize `core.metric_registry`
- Why: convert metric definitions into runtime-enforced analytical contracts (template/planner lookup), not just metadata.

## 5) Implementation order recommendation

### Phase 1: Operationalize existing semantic contracts

1. Route relevant question families to `core.laps_enriched` and `core.lap_semantic_bridge` by default.
2. Add semantic-table usage gates in planning for lap/strategy/progression classes.
3. Expose semantic objects in LLM SQL system prompt table list.

Expected gain: immediate improvement on the largest block of intense-rubric `C` outcomes.

### Phase 2: Add missing summary contracts

1. `core.stint_summary`
2. `core.race_progression_summary`
3. `core.grid_vs_finish`
4. `core.driver_session_summary`

Expected gain: consistent strategy/progression/classification answers with less SQL improvisation.

### Phase 3: Add phase and telemetry semantic bridges

1. `core.lap_phase_summary`
2. `core.telemetry_lap_bridge`

Expected gain: robust phase-based pace narratives and telemetry-lap alignment for advanced analytical prompts.

### Phase 4: Governance and contract hardening

1. Expand `core.valid_lap_policy` versions (`v2+`) for calibrated edge cases.
2. Promote stable metrics from `core.metric_registry` into template/planner defaults.
3. Keep `docs/transformed_lap_schema.md` as the authoritative contract and update with each semantic object release.

---

## Bottom line

The semantic layer now exists structurally (especially `core.laps_enriched` + bridge + policy + replay frame contract), but the app still behaves as if it does not, because runtime SQL generation is dominated by raw-table improvisation.

The highest-return move is not more prompt tuning. It is to make semantic objects the enforced default analytical contracts, then add the missing summary/bridge objects (`stint`, `progression`, `grid_vs_finish`, `lap_phase`, `telemetry_lap_bridge`) in that order.
