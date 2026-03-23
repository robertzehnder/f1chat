# Prompt 2 — Semantic Layer Design Report

## 1) Existing semantic layer

### 1.1 Implemented semantic/core objects (warehouse-level)

The following semantic objects are already implemented in SQL and documented:

1. `core.valid_lap_policy`
- Exists: yes.
- Role: versioned lap-validity policy contract.
- Evidence: [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:50), [transformed_lap_schema.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/transformed_lap_schema.md:9).

2. `core.metric_registry`
- Exists: yes.
- Role: canonical metric dictionary with status and lineage.
- Evidence: [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:119), [transformed_lap_schema.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/transformed_lap_schema.md:11).

3. `core.lap_semantic_bridge`
- Exists: yes.
- Role: lap-grain cross-table alignment (laps + stints + pits + position + race control).
- Evidence: [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:173), [transformed_lap_schema.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/transformed_lap_schema.md:13).

4. `core.laps_enriched`
- Exists: yes.
- Role: transformed-lap semantic contract for clean-lap and pace analytics.
- Evidence: [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:272), [transformed_lap_schema.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/transformed_lap_schema.md:15).

5. `core.replay_lap_frames` (+ `core.replay_contract_registry`)
- Exists: yes.
- Role: replay-oriented intermediate frame contract at lap grain.
- Evidence: [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:446), [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:501), [transformed_lap_schema.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/transformed_lap_schema.md:95).

### 1.2 Candidate object evaluation (exists vs missing)

| Object | Status | Notes |
|---|---|---|
| `core.valid_lap_policy` | Implemented | First-pass (`openf1_semantic v1`) present; needs v2 calibration policy variants. |
| `core.laps_enriched` | Implemented | Strong transformed-lap contract exists, but runtime underuses it. |
| `core.lap_semantic_bridge` | Implemented | Core bridge for lap/stint/pit/position context exists. |
| `core.metric_registry` | Implemented | Exists as metadata; not yet enforced in runtime/template governance. |
| `core.driver_session_summary` | Planned, not implemented | Documented in helper adoption notes. |
| `core.stint_summary` | Planned, not implemented | Critical for strategy/pit family normalization. |
| `core.strategy_summary` | Planned, not implemented | Documented but no SQL contract yet. |
| `core.grid_vs_finish` | Planned, not implemented | Needed to generalize result-classification family. |
| `core.race_progression_summary` | Planned, not implemented | Needed for running-order storyline and pit-cycle logic. |
| `core.lap_phase_summary` | Not formalized (implied) | Needed for final-third/opening/mid segmentation semantics. |
| `core.telemetry_lap_bridge` | Not formalized (implied) | Needed for canonical telemetry-to-lap alignment. |
| `core.lap_context_summary` | Not formalized | Useful rollup candidate (track state, pit windows, field pace context). |

Evidence for planned-but-not-built objects: [helper_repo_adoption_status.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/helper_repo_adoption_status.md:137).

### 1.3 Canonical vs experimental metrics

From current `core.metric_registry` seeds:

Canonical/stable metrics (should be authoritative):
1. `lap_duration`
2. `is_valid`
3. `is_slick`
4. `delta_to_rep`, `pct_from_rep`
5. `delta_to_fastest`, `pct_from_fastest`
6. `delta_to_lap_rep`, `pct_from_lap_rep`
7. `position_end_of_lap`

Experimental metric:
1. `fuel_adj_lap_time`

Evidence: metric inserts in [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:148).

## 2) Missing semantic objects

### 2.1 Summary contracts missing from main semantic layer

1. `core.driver_session_summary`
- Canonical per driver-session stats contract.
- Why missing hurts: repeated ad hoc aggregation and inconsistent comparison baselines.

2. `core.stint_summary`
- Canonical stint boundaries, compound usage, tyre-age pace and degradation.
- Why missing hurts: strategy and degradation answers still recompute logic on raw tables.

3. `core.strategy_summary`
- Canonical stop-count, compound sequence, undercut/overcut windows.
- Why missing hurts: pit/strategy questions remain interpretation-heavy and fragile.

4. `core.grid_vs_finish`
- Canonical result delta contract (grid, finish, gained/lost, fallback provenance).
- Why missing hurts: result logic is currently narrow-template strong but not generalized.

5. `core.race_progression_summary`
- Lap-indexed position/progression storyline contract.
- Why missing hurts: race progression answers rely on bespoke raw joins and sparse sampling.

### 2.2 Context bridges missing

1. `core.lap_phase_summary`
- Canonical lap-phase segmentation (opening/mid/final third; optionally stint-relative phase).

2. `core.telemetry_lap_bridge`
- Canonical telemetry window aligned to lap grain and key phase markers.

3. `core.lap_context_summary`
- Canonical per-lap context rollup (flag context, pit-cycle context, representative field pace context).

### 2.3 Underuse gap (critical)

Even for implemented objects, runtime still defaults to raw-table planning and generation:
- required/recommended tables in [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:668) and [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:737) are raw-centric for aggregate/comparison/telemetry.
- LLM SQL system prompt table list omits semantic/replay views in [anthropic.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/anthropic.ts:52).

## 3) Weak benchmark families caused by semantic gaps

Using intense run outcomes (`chat_health_check_2026-03-17T00-24-31-350Z.json`), semantic-contract misses are the dominant cause of weak families.

### Family readiness snapshot (semantic-gap relevant)

1. Lap pace family: `A=2, C=7`
- Dominant gap tags: `all_ideal_tables_used`, `required_sql_patterns`.
- Implication: transformed-lap contract not consistently used.

2. Sector family: `A=0, C=3`
- Dominant gap tags: `all_ideal_tables_used`.
- Implication: sector analytics still raw-table improvisation.

3. Head-to-head pace family: `A=0, C=5`
- Dominant gap tags: `all_ideal_tables_used`.
- Implication: no canonical head-to-head semantic summary path.

4. Pit/strategy family: `A=5, C=6`
- Dominant gap tags: `all_ideal_tables_used`.
- Implication: basic pit facts are okay; advanced strategy semantics are under-modeled.

5. Race progression family: `A=0, C=1`
- Dominant gap tags: `all_ideal_tables_used`, `required_sql_patterns`.
- Implication: progression/replay semantic contracts are underused.

6. Telemetry family: `A=1, C=1`
- Mixed quality; missing telemetry-lap bridge makes behavior inconsistent.

## 4) Proposed canonical semantic architecture

### 4.1 Layered semantic contract graph

Proposed dependency graph:

1. Base raw layer
- `raw.sessions`, `raw.drivers`, `raw.laps`, `raw.stints`, `raw.pit`, `raw.position_history`, `raw.car_data`, `raw.location`, `raw.weather`, `raw.race_control`, `raw.session_result`, `raw.starting_grid`.

2. Normalization and policy layer
- `core.compound_alias_lookup`
- `core.valid_lap_policy`
- `core.metric_registry`

3. Bridge layer (canonical joins and event alignment)
- `core.lap_semantic_bridge` (already implemented)
- `core.telemetry_lap_bridge` (to add)

4. Transformed-lap contract layer
- `core.laps_enriched` (already implemented)
- Policy-enriched, metric-rich lap truth surface.

5. Summary contract layer (to add)
- `core.driver_session_summary`
- `core.stint_summary`
- `core.strategy_summary`
- `core.grid_vs_finish`
- `core.lap_phase_summary`
- `core.race_progression_summary`
- `core.lap_context_summary`

6. Replay/consumer contract layer
- `core.replay_contract_registry`
- `core.replay_lap_frames`
- (optional extension) replay event frames with telemetry overlays.

### 4.2 Canonical contract principles

1. One semantic truth per analytical concept
- Avoid re-deriving clean-lap, representative pace, stint logic in templates/prompts.

2. Policy versioning is first-class
- `is_valid` must always be tied to explicit `validity_policy_key` and `validity_rule_version`.

3. Metric definitions are centralized
- Any metric used in templates or synthesis should map to `core.metric_registry` keys.

4. Summary views are not optional conveniences
- They are required to reduce benchmark fragility and synthesis inconsistency.

5. Prompt-time SQL improvisation should be a fallback
- Canonical semantics should originate in warehouse contracts.

## 5) Highest-leverage next semantic builds

1. Runtime semantic adoption gate (highest leverage)
- Make semantic views default planning targets for pace/strategy/progression question families.

2. `core.stint_summary` + `core.strategy_summary`
- Biggest lift for Q42-Q48 class (advanced strategy/stint semantics).

3. `core.race_progression_summary`
- Biggest lift for Q45/Q46/Q49 class and replay storyline consistency.

4. `core.grid_vs_finish`
- Generalizes result/final classification and positions-gained logic beyond narrow template paths.

5. `core.lap_phase_summary`
- Stabilizes phase-based pace questions (final third/opening/mid).

6. `core.telemetry_lap_bridge`
- Stabilizes telemetry comparison and overlays by canonical lap alignment.

7. `valid_lap_policy` v2 + richer invalid taxonomy
- Improves analytical trust in clean-lap comparisons and degradation metrics.

## 6) Recommended implementation order

### Phase S1: Semantic adoption and policy hardening

1. Make `core.laps_enriched` / `core.lap_semantic_bridge` default for relevant runtime families.
2. Update planner/template/LLM table surfaces to include semantic/replay contracts.
3. Introduce `valid_lap_policy` v2 and expand invalid reason taxonomy.

### Phase S2: Summary contracts

1. Implement `core.driver_session_summary`.
2. Implement `core.stint_summary` and `core.strategy_summary`.
3. Implement `core.grid_vs_finish` and `core.race_progression_summary`.

### Phase S3: Context/bridge completion

1. Implement `core.lap_phase_summary`.
2. Implement `core.telemetry_lap_bridge`.
3. Implement `core.lap_context_summary`.

### Phase S4: Governance and consumer alignment

1. Promote `core.metric_registry` from documentation to enforcement (template/query contract checks).
2. Align replay/consumer contracts to semantic summary outputs.
3. Keep raw-table query paths as explicit fallback only.

---

## Bottom line

The semantic layer is no longer “missing” at the foundation level; it is partially implemented and underused. The next design wave should focus on canonicalizing summary contracts and enforcing semantic-first runtime behavior so benchmark quality improvements come from stable warehouse meaning, not prompt-time SQL improvisation.
