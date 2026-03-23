# Prompt 6 Diagnostic: Helper-Repo Adoption at the Data-Modeling Layer

## 1) Adopted patterns

### A. Armchair-Strategist style transformed-lap semantics: adopted in schema

Adopted patterns already formalized in `openf1`:

1. Raw vs transformed separation
- Implemented as `core.laps_enriched` on top of `raw.*` lap/stint/pit/position/weather/race-control sources.
- Evidence:
  - `openf1/sql/006_semantic_lap_layer.sql`
  - `openf1/docs/transformed_lap_schema.md`

2. Policy-based lap validity (not ad hoc)
- Implemented as versioned `core.valid_lap_policy` with default `openf1_semantic v1`.
- Includes bounds, pit in/out filtering, sector completeness, known/slick compound requirements.
- Evidence: `openf1/sql/006_semantic_lap_layer.sql`

3. Compound normalization contract
- Implemented via `core.compound_alias_lookup` with slick/intermediate/wet grouping and alias mappings (`C0-C6`, etc.).
- Evidence: `openf1/sql/006_semantic_lap_layer.sql`

4. FastF1-inspired derived pace metrics
- Implemented in `core.laps_enriched`:
  - `delta_to_rep`, `pct_from_rep`
  - `delta_to_fastest`, `pct_from_fastest`
  - `delta_to_lap_rep`, `pct_from_lap_rep`
  - `fuel_adj_lap_time` (experimental)
- Evidence:
  - `openf1/sql/006_semantic_lap_layer.sql`
  - `openf1/docs/transformed_lap_schema.md`
  - original semantic inspiration: `openf1/helper-repos/Armchair-Strategist/SCHEMA.md`

5. Canonical metric governance object
- Implemented as `core.metric_registry` (metric key/category/grain/status/definition/source hints).
- Evidence: `openf1/sql/006_semantic_lap_layer.sql`

### B. f1-race-replay style intermediate replay contracts: adopted in schema

1. Replay contract registry
- Implemented as `core.replay_contract_registry`.

2. Lap-frame intermediate model
- Implemented as `core.replay_lap_frames` with frame identity, lap-level leader/pace, weather overlay, race-control flag.

3. Bridge pattern for cross-table semantics
- Implemented as `core.lap_semantic_bridge` (lap + stint + pit + position + track flag context).

Evidence:
- `openf1/sql/006_semantic_lap_layer.sql`
- `openf1/docs/transformed_lap_schema.md`
- helper inspiration: `openf1/helper-repos/f1-race-replay/telemetry.md`, `.../src/services/stream.py`

### C. Resolver/helper seed patterns: adopted

1. Alias and lookup helper tables/views
- `core.session_venue_alias_lookup`, `core.driver_alias_lookup`, `core.session_type_alias_lookup`
- `core.session_search_lookup`, `core.driver_identity_lookup`, `core.session_completeness`
- Evidence:
  - `openf1/sql/005_helper_tables.sql`
  - `openf1/docs/helper_repo_adoption_status.md`

## 2) Missing patterns

### A. Modeled but not operationalized in runtime contracts

The biggest gap is not “missing table definitions” alone; it is missing runtime formalization of those tables as first-class query contracts.

1. Semantic objects are not the default query targets
- Runtime still prioritizes `raw.laps`, `raw.stints`, `raw.car_data` for analysis families.
- Evidence:
  - `openf1/web/src/lib/chatRuntime.ts` (required/recommended tables)
  - `openf1/web/src/lib/deterministicSql.ts` (raw-table-centric templates)

2. LLM SQL prompt surface does not advertise semantic/replay objects
- System prompt table list includes `core.sessions`, `core.session_drivers`, and `raw.*`, but not `core.laps_enriched`, `core.lap_semantic_bridge`, `core.replay_lap_frames`.
- Evidence: `openf1/web/src/lib/anthropic.ts`

### B. Documented next-phase semantic objects not yet formalized

Documented in helper-adoption planning, but not implemented as warehouse contracts:

1. `core.driver_session_summary`
2. `core.stint_summary`
3. `core.strategy_summary`
4. `core.grid_vs_finish`
5. `core.race_progression_summary`
6. (implied from benchmark/design needs) `core.lap_phase_summary`
7. (implied) `core.telemetry_lap_bridge`

Evidence:
- `openf1/docs/helper_repo_adoption_status.md`
- `openf1/f1_codex_helpers/README.md`
- negative implementation signal: no SQL definitions for these in `openf1/sql/*.sql`

### C. Helper-repo patterns not yet productized

From `f1-race-replay`, these are still missing in `openf1` runtime:

1. stream endpoint over replay frames
2. multi-consumer telemetry/replay contracts in app runtime
3. reusable telemetry payload contract between backend and UI consumers

Evidence:
- helper references: `openf1/helper-repos/f1-race-replay/telemetry.md`, `.../src/services/stream.py`
- no equivalent runtime implementation in current `openf1/web/src`

## 3) Highest-value modeling adoptions

### Keep OpenF1 primary; adopt helper logic as semantic enrichment

No current evidence strongly justifies replacing OpenF1 as primary source.

Evidence:
- Source audit recommends OpenF1 for session resolution with high confidence; most other themes are low-confidence ties.
- `openf1/fastf1_audit/exports/audit_20260316T234249Z/source_audit_report.md`

### Highest-value next modeling adoptions

1. Formal semantic-lap contract hardening (v2 policy + reasons)
- Extend `core.valid_lap_policy` and `invalid_reason` taxonomy:
  - explicit track-flag/track-status handling tiers
  - clearer policy profiles by session type
  - versioned migration path (`v2+`)
- Why: this is the central dependency for clean-lap, pace, and strategy reliability.

2. Canonical derived summaries on top of `core.laps_enriched`
- Build:
  - `core.driver_session_summary`
  - `core.stint_summary`
  - `core.strategy_summary`
  - `core.grid_vs_finish`
  - `core.race_progression_summary`
- Why: eliminates repeated ad hoc SQL and normalizes interpretation across benchmarks.

3. Replay-oriented intermediate modeling expansion (not full app rewrite)
- Keep to warehouse-first contracts:
  - stabilize `core.replay_lap_frames` v1 payload shape
  - add `core.telemetry_lap_bridge` for lap-window telemetry joins
  - optionally add `core.replay_event_frames` for race-control/weather/pit overlays
- Why: directly reuses f1-race-replay architecture patterns without adopting GUI stack.

4. Metric-registry promotion from documentation to enforcement
- Use `core.metric_registry` to define approved metric keys for templates and runtime planning.
- Why: avoids silent metric drift and inconsistent naming/logic.

5. Source-of-truth by theme (recommended stance)
- Session resolution: OpenF1 primary.
- Canonical race/session metadata: OpenF1 primary.
- Clean-lap semantics and pace metrics: OpenF1 data, helper-inspired semantic layer primary.
- Pit/strategy and race progression semantics: OpenF1 data + new derived summaries primary.
- Telemetry overlays: OpenF1 data + replay-style contracts primary; keep FastF1 as validation/comparison path.

## 4) Risks of not adopting them

1. Benchmark quality plateau despite “more prompting”
- If semantic contracts stay optional, lap/strategy/progression families remain fragile and low-trust under intense grading.

2. Semantic drift and inconsistent conclusions
- Without canonical summary views and metric enforcement, different templates/LLM plans compute subtly different definitions.

3. Synthesis contradictions remain likely
- If derived facts are not pre-modeled in warehouse contracts, answer synthesis continues to infer too much from ad hoc row sets.

4. Replay and telemetry features stall at prototype stage
- Without formal telemetry-lap/replay event bridges, downstream streaming/overlay work remains bespoke and brittle.

5. Source comparison remains low-confidence tie-heavy
- Without stronger semantic normalization, FastF1 vs OpenF1 audit results cannot cleanly distinguish source limitations from modeling limitations.

## 5) Recommended next implementation wave

### Wave E1: Formal semantic-lap hardening (highest priority)

1. Add `core.valid_lap_policy` v2 with configurable track-flag/phase handling.
2. Expand `invalid_reason` taxonomy (machine-readable categories).
3. Add policy validation fixtures for known benchmark sessions.
4. Promote metric keys from `core.metric_registry` into deterministic template contracts.

### Wave E2: Summary-model layer (helper-inspired, OpenF1-native)

1. Implement `core.driver_session_summary`.
2. Implement `core.stint_summary` and `core.strategy_summary`.
3. Implement `core.grid_vs_finish` and `core.race_progression_summary`.
4. Add `core.lap_phase_summary` for opening/mid/final-third semantics.

### Wave E3: Replay/telemetry intermediate contracts

1. Implement `core.telemetry_lap_bridge`.
2. Version and stabilize replay frame contracts (`core.replay_contract_registry` + payload docs).
3. Expose a minimal streamable frame API from these core views (no GUI migration required).

### Wave E4: Runtime contract adoption

1. Make semantic/summarized core views first-choice tables in runtime planning and deterministic templates.
2. Update LLM SQL table surface to include the new core semantic objects.
3. Keep raw-table paths as explicit fallback with downgraded confidence labels.

### Wave E5: Source-of-truth governance

1. Keep OpenF1 as primary warehouse source.
2. Use FastF1 primarily for audit, calibration, and edge-case validation.
3. Track source decision confidence by theme in recurring source-audit reports.

---

## Bottom line

The repo has already adopted the right helper-repo direction at schema level: transformed-lap semantics and replay intermediates are in place. The main remaining gap is formalization in runtime contracts and summary-layer modeling, not replacing OpenF1.

Best next move: keep OpenF1 primary, operationalize helper-inspired semantic contracts as default query surfaces, then add summary/replay bridge models that turn those semantics into stable product behavior.
