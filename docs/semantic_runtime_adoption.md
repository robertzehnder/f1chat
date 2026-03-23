# Semantic Runtime Adoption

This note tracks runtime behavior.  
For contract status classification, see `docs/semantic_contract_map.md`.

## Runtime default behavior

Runtime/planner logic is semantic-first for analytical families:

- pace/sector/head-to-head: `core.laps_enriched`, `core.driver_session_summary`
- stint/strategy: `core.stint_summary`, `core.strategy_summary`
- pit-cycle/undercut evidence: `core.pit_cycle_summary`, `core.strategy_evidence_summary`
- positions gained and progression: `core.grid_vs_finish`, `core.race_progression_summary`
- telemetry-lap analysis: `core.telemetry_lap_bridge` (with raw fact fallback as needed)

Primary implementation points:

- `web/src/lib/chatRuntime.ts`
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/queries.ts`
- `web/src/lib/anthropic.ts`

## Resolver and governance adoption

Resolver normalization and gating currently use:

- `core.session_search_lookup`
- `core.driver_identity_lookup`
- `core.team_identity_lookup`
- `core.session_completeness`

Planner recommendations also include:

- `core.weekend_session_coverage`
- `core.weekend_session_expectation_audit`
- `core.source_anomaly_tracking`

## Raw path policy in runtime

- Raw tables remain available for resilience and fact domains that are not fully abstracted.
- For analytical questions, raw use is fallback-first, not default.
- Explicit raw fact domains still expected in places:
  - high-frequency telemetry/location/event streams (`raw.car_data`, `raw.location`, `raw.weather`, `raw.race_control`, `raw.team_radio`)

## Synthesis guardrails

Post-query sanity checks (answer-level guardrails) are active via:

- `web/src/lib/answerSanity.ts`
- `web/src/app/api/chat/route.ts`

Current guardrail focus:

- stop/stint consistency
- sector summary consistency
- pit-cycle/undercut evidence sufficiency
- grid/finish evidence for positions-gained claims

## Open adoption opportunities

- Broader runtime use of weekend/anomaly governance views.
- Stronger runtime utilization of `core.metric_registry`.
- More consistent replay-contract usage where progression analysis benefits from it.
