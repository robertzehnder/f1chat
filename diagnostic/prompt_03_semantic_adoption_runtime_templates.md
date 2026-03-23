# Prompt 3 — Semantic Adoption Plan for Runtime and Templates

## 1) Current runtime/table-selection behavior

Current table/view selection is primarily driven by runtime heuristics in `chatRuntime.ts`, then applied by deterministic templates or LLM SQL generation.

### Runtime selection logic today

1. `requiredTablesForQuestion(...)`
- Uses question type + text heuristics to choose required tables.
- Aggregate/comparison/telemetry families default to raw tables.
- Evidence: [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:668).

2. `grainForQuestion(...)`
- Recommends raw tables for analytical grains:
  - aggregate: `raw.laps`
  - comparison: `raw.laps`, `raw.stints`
  - telemetry: `raw.laps`, `raw.car_data`, `raw.location`
- Evidence: [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:737).

3. Query plan assembly
- `primary_tables` are a merge of required + recommended tables from the above.
- Evidence: [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:851).

4. Route execution order
- Deterministic templates first, then LLM SQL, then heuristic fallback.
- Evidence: [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:257).

5. LLM system prompt table surface
- Includes `core.sessions/core.session_drivers` and many `raw.*`, but excludes semantic lap/replay views.
- Evidence: [anthropic.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/anthropic.ts:52).

6. Deterministic template body usage
- Current deterministic templates are overwhelmingly `raw.*`-centric.
- Evidence: [deterministicSql.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/deterministicSql.ts:107).

## 2) Where raw-table overuse still exists

Raw overuse is most visible in families where semantic contracts already exist or are intended to exist.

### Families currently overusing raw tables

1. Fastest-lap / pace
- Uses `raw.laps` and `raw.drivers` instead of `core.laps_enriched` for many derived pace questions.

2. Sector comparison
- Uses direct `raw.laps` aggregation where valid-lap semantics should be centralized.

3. Head-to-head pace
- Recomputes comparison metrics from `raw.laps` each time rather than consuming canonical semantic metrics.

4. Stint/pit strategy
- Heavy direct use of `raw.stints` + `raw.pit`; no canonical strategy summary object in route.

5. Race progression
- Uses bespoke `raw.position_history` joins instead of progression contracts.

6. Telemetry comparison
- Direct raw telemetry windowing (`raw.car_data`/`raw.location`) without telemetry-lap bridge.

### Benchmark signal confirming this overuse

- Intense run has broad semantic-contract failures, especially `all_ideal_tables_used` and `required_sql_patterns`.
- Evidence: [chat_health_check_2026-03-17T00-24-31-350Z.md](/Users/robertzehnder/Documents/coding/f1/openf1/web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md:13).

## 3) Proposed semantic-first routing model

Design principle: semantic contracts should be the default analytical interface; raw tables should be fallback.

### 3.1 Routing policy hierarchy

For each analytical question family, use this table-preference order:

1. Canonical semantic summary views (if available)
- Example targets: `core.stint_summary`, `core.strategy_summary`, `core.grid_vs_finish`, `core.race_progression_summary`.

2. Canonical transformed/bridge views
- `core.laps_enriched`, `core.lap_semantic_bridge`, `core.replay_lap_frames`.

3. Raw derivation fallback
- `raw.*` only when semantic surfaces are unavailable or session coverage is insufficient.

### 3.2 Runtime and template selection changes (design)

1. `requiredTablesForQuestion` and `grainForQuestion`
- Replace raw defaults with semantic defaults for analytical types.
- Keep raw table lists as explicit fallback candidates, not primary recommendations.

2. Deterministic template router
- Split templates into:
  - semantic templates (first choice)
  - raw fallback templates (second choice)
- Template key should include source tier metadata (`semantic_primary`, `raw_fallback`).

3. LLM SQL generation prompt
- Expand allowed table surface to include semantic views.
- Pass runtime-provided preferred semantic tables and prohibited raw tables when semantic coverage is sufficient.

4. Query plan contract
- Add fields:
  - `semantic_tier` (`summary`, `enriched`, `raw_fallback`)
  - `metric_keys_requested` (from metric registry)
  - `fallback_reason` when raw is used.

### 3.3 Resolver context + template routing + metric registry interaction

1. Resolver context responsibilities
- Resolve `session_key`, `driver_numbers`, and family intent.
- Provide quality signals (confidence and completeness) to route semantic tier.

2. Template routing responsibilities
- Select semantic template by family + available semantic objects.
- If unavailable/insufficient, explicitly downgrade to fallback template.

3. Metric registry responsibilities
- Template and planner must reference registered metric keys.
- Registry controls canonical vs experimental metric use.
- Experimental metrics (e.g., `fuel_adj_lap_time`) should require explicit opt-in flags.

## 4) Question-family-to-view mapping

### Priority semantic mapping

1. Fastest-lap / pace
- Primary: `core.laps_enriched`
- Secondary: `core.lap_semantic_bridge`
- Raw fallback: `raw.laps`, `raw.drivers`

2. Sector comparison
- Primary: `core.laps_enriched` (valid-lap constrained sector metrics)
- Secondary: `core.lap_semantic_bridge`
- Raw fallback: `raw.laps`

3. Head-to-head pace
- Primary: `core.laps_enriched`
- Next: `core.driver_session_summary` (when implemented)
- Raw fallback: `raw.laps`, `raw.stints`

4. Stint and pit strategy
- Primary: `core.stint_summary`, `core.strategy_summary` (planned)
- Secondary: `core.lap_semantic_bridge`
- Raw fallback: `raw.stints`, `raw.pit`, `raw.position_history`

5. Positions gained / result
- Primary: `core.grid_vs_finish` (planned)
- Secondary: semantic bridge + result snapshot views
- Raw fallback: `raw.starting_grid`, `raw.session_result`, `raw.position_history`

6. Race progression
- Primary: `core.race_progression_summary` (planned)
- Secondary: `core.replay_lap_frames`
- Raw fallback: `raw.position_history`, `raw.laps`, `raw.race_control`

7. Telemetry comparison
- Primary: `core.telemetry_lap_bridge` (planned)
- Secondary: `core.replay_lap_frames` + `core.laps_enriched`
- Raw fallback: `raw.car_data`, `raw.location`, `raw.laps`

## 5) Fallback strategy

Fallback should be explicit and policy-driven, not implicit.

### 5.1 When raw fallback is allowed

1. Semantic object not implemented.
2. Semantic object exists but no rows for selected session.
3. Required metric key missing from semantic layer or metric registry.
4. Semantic query fails safety/execution and no equivalent semantic alternative is available.

### 5.2 Fallback levels

1. Level A: semantic summary (best)
2. Level B: semantic enriched/bridge
3. Level C: raw derivation with `inferred` labeling
4. Level D: clarification/unavailable

### 5.3 Response contract on fallback

Whenever Level C is used, runtime should include:
1. `semantic_tier=raw_fallback`
2. `fallback_reason`
3. lower confidence marker in synthesis prompt and user-facing caveat.

## 6) Recommended migration sequence

### M1: Routing and planner adoption (no new semantic SQL required)

1. Update runtime selection defaults to semantic-first for analysis families.
2. Add semantic tiers and fallback reason fields to query plan.
3. Update LLM prompt table allowlist to include semantic views.

### M2: Template migration by family (highest benchmark payoff first)

1. Migrate fastest-lap/pace, sector, head-to-head templates to `core.laps_enriched`.
2. Keep raw fallback templates for each migrated family.

### M3: Summary-contract rollout

1. Add and adopt `core.stint_summary` and `core.strategy_summary`.
2. Add and adopt `core.grid_vs_finish` and `core.race_progression_summary`.
3. Add and adopt `core.lap_phase_summary` and `core.telemetry_lap_bridge`.

### M4: Registry and governance enforcement

1. Enforce metric keys via `core.metric_registry` in template and runtime planning.
2. Require explicit opt-in for experimental metrics.
3. Track fallback rates per family in benchmark output.

---

## Bottom line

The runtime currently has a semantic layer available in warehouse but not yet adopted as the default analytical interface. The adoption path should start with routing/planner/template changes first, then add missing summary contracts, while keeping raw tables as explicit and observable fallbacks.
