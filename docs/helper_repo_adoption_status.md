# Helper-Repo Adoption Status

This document is now a concise status pointer.  
For the canonical contract-by-contract state, use `docs/semantic_contract_map.md`.

## Primary references

- Canonical contract map and status: `docs/semantic_contract_map.md`
- Runtime/planner adoption details: `docs/semantic_runtime_adoption.md`
- Source-audit operations and anomaly workflow: `docs/source_audit_runbook.md`
- Strategy-level helper analysis background: `docs/helper_repo_analysis.md`

## Current status (2026-03)

- Semantic lap layer from helper concepts is implemented and in runtime default use:
  - `core.laps_enriched`, `core.valid_lap_policy`, `core.metric_registry`
- Summary contracts are implemented and adopted for benchmark-critical families:
  - `core.driver_session_summary`, `core.stint_summary`, `core.strategy_summary`
  - `core.grid_vs_finish`, `core.race_progression_summary`
  - `core.pit_cycle_summary`, `core.strategy_evidence_summary`
- Governance/lookup contracts are implemented:
  - `core.team_alias_lookup`, `core.driver_alias_lookup`, session/weekend coverage and anomaly tracking views
- Replay contracts exist but remain partial in practical runtime usage:
  - `core.replay_contract_registry`, `core.replay_lap_frames`

## Corrected stale assumptions

- Summary contracts are no longer “next wave”; they are already implemented.
- Pit-cycle/undercut analysis no longer depends on bespoke raw joins by default; canonical evidence contracts exist.
- Session completeness and expectation governance are implemented, though some surfaces are still under-adopted.

## Remaining adoption focus

- Increase runtime/template use of under-adopted governance contracts:
  - `core.weekend_session_coverage`
  - `core.weekend_session_expectation_audit`
  - `core.source_anomaly_tracking`
- Expand practical use of `core.metric_registry` and replay contracts in user-facing flows.
