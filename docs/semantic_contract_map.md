# Canonical Semantic Contract Map and Adoption Status

This is the single source of truth for semantic contract status in `openf1`.

## Status legend

- `canonical`: default contract for runtime/templates in that domain.
- `canonical_raw_fact`: raw table is the correct fact source (semantic wrapper optional).
- `experimental`: useful but not yet default for most analytics flows.
- `under_adopted`: implemented and valid, but not yet broadly used.
- `fallback_only`: allowed only when canonical contracts are unavailable.

## Contract map

| Contract | Status | Domain | Primary definition | Runtime adoption note |
|---|---|---|---|---|
| `core.session_search_lookup` | canonical | session resolution | `sql/005_helper_tables.sql` | Used by resolver queries in `web/src/lib/queries.ts`. |
| `core.driver_identity_lookup` | canonical | driver normalization | `sql/005_helper_tables.sql` | Default identity source in resolver queries. |
| `core.team_identity_lookup` | canonical | team normalization | `sql/005_helper_tables.sql` | Used to canonicalize team names in resolver queries. |
| `core.session_completeness` | canonical | coverage/gating | `sql/005_helper_tables.sql` | Used by resolver filtering and planner guidance. |
| `core.weekend_session_coverage` | under_adopted | weekend coverage | `sql/005_helper_tables.sql` | Exposed to planner, limited deterministic-template usage. |
| `core.weekend_session_expectation_audit` | under_adopted | weekend expectation governance | `sql/005_helper_tables.sql` | Exposed to planner, not a common default query target yet. |
| `core.source_anomaly_tracking` | under_adopted | anomaly governance | `sql/005_helper_tables.sql` | Exposed to planner/data-health flows; limited downstream automation. |
| `core.valid_lap_policy` | canonical | lap validity policy | `sql/006_semantic_lap_layer.sql` | Backing policy for `core.laps_enriched` validity fields. |
| `core.metric_registry` | under_adopted | metric governance | `sql/006_semantic_lap_layer.sql` | Registry exists; runtime does not yet consume it broadly for synthesis/reporting. |
| `core.lap_semantic_bridge` | canonical | lap semantic base layer | `sql/006_semantic_lap_layer.sql` | Internal base for enriched/summary contracts. |
| `core.laps_enriched` | canonical | lap analytics | `sql/006_semantic_lap_layer.sql` | Default for pace/sector/clean-lap/head-to-head families. |
| `core.driver_session_summary` | canonical | session-level pace summary | `sql/007_semantic_summary_contracts.sql` | Used by planner + several deterministic families. |
| `core.stint_summary` | canonical | stint analytics | `sql/007_semantic_summary_contracts.sql` | Default for stint/compound/degradation families. |
| `core.strategy_summary` | canonical | strategy analytics | `sql/007_semantic_summary_contracts.sql` | Default for stops/strategy-type/opening/closing stint families. |
| `core.pit_cycle_summary` | canonical | pit-cycle evidence | `sql/007_semantic_summary_contracts.sql` | Default for pit-cycle gain analysis. |
| `core.strategy_evidence_summary` | canonical | undercut/overcut evidence | `sql/007_semantic_summary_contracts.sql` | Default for strategy-evidence claims and evidence sufficiency flags. |
| `core.grid_vs_finish` | canonical | result delta | `sql/007_semantic_summary_contracts.sql` | Default for positions gained/lost families. |
| `core.race_progression_summary` | canonical | running-order progression | `sql/007_semantic_summary_contracts.sql` | Default for running-order progression families. |
| `core.lap_phase_summary` | canonical | phase/fresh-vs-used analysis | `sql/007_semantic_summary_contracts.sql` | Used in deterministic fresh/used-tire templates. |
| `core.lap_context_summary` | canonical | contextual lap summaries | `sql/007_semantic_summary_contracts.sql` | Available in planner and table counts; moderate direct template usage. |
| `core.telemetry_lap_bridge` | canonical | telemetry-lap alignment | `sql/007_semantic_summary_contracts.sql` | Preferred semantic bridge when telemetry questions can use lap context. |
| `core.replay_contract_registry` | experimental | replay governance | `sql/006_semantic_lap_layer.sql` | Contract metadata exists; runtime consumers are limited. |
| `core.replay_lap_frames` | experimental | replay frame layer | `sql/006_semantic_lap_layer.sql` | Used in planner recommendations; not yet the dominant progression interface. |

## Raw table policy

### Canonical raw fact sources (`canonical_raw_fact`)

These remain valid direct sources when no better semantic abstraction exists:

- `raw.car_data` (high-frequency speed/throttle/brake samples, top-speed facts)
- `raw.location` (high-frequency position traces)
- `raw.weather`, `raw.race_control`, `raw.team_radio` (event/context streams)

### Fallback-only raw sources (`fallback_only`)

Prefer semantic contracts first. Use raw only when canonical semantic contracts are missing for the exact question:

- `raw.laps`, `raw.pit`, `raw.stints`, `raw.position_history`, `raw.drivers`
- `raw.session_result`, `raw.starting_grid`, `raw.overtakes` (also subject to coverage quality caveats)

## Current adoption snapshot

### Canonical and broadly adopted

- Lap pace/sector/head-to-head: `core.laps_enriched` (+ `core.driver_session_summary`).
- Strategy/stints: `core.stint_summary`, `core.strategy_summary`.
- Pit-cycle and undercut/overcut evidence: `core.pit_cycle_summary`, `core.strategy_evidence_summary`.
- Position/race progression: `core.grid_vs_finish`, `core.race_progression_summary`.
- Resolver normalization: `core.session_search_lookup`, `core.driver_identity_lookup`, `core.team_identity_lookup`.

### Present but still under-adopted

- `core.weekend_session_coverage`
- `core.weekend_session_expectation_audit`
- `core.source_anomaly_tracking`
- `core.metric_registry`
- `core.lap_context_summary` (relative to other summary contracts)

## Deprecation guidance for maintainers

When adding or updating SQL templates:

1. Start from canonical `core.*` contracts for the question family.
2. If raw fallback is necessary, annotate why in code comments (coverage gap, missing semantic contract, or unavoidable raw fact domain).
3. Prefer evidence-bearing summary contracts (`core.pit_cycle_summary`, `core.strategy_evidence_summary`, `core.grid_vs_finish`) for claims that can overstate without evidence.

## Related docs

- `docs/semantic_runtime_adoption.md` (runtime/planner behavior)
- `docs/source_audit_runbook.md` (how audit findings become tracked fixes)
- `docs/helper_repo_adoption_status.md` (high-level status pointer doc)
