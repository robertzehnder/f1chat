-- Revert openf1:007_semantic_summary_contracts from pg

BEGIN;

DROP VIEW IF EXISTS core.telemetry_lap_bridge;
DROP VIEW IF EXISTS core.lap_context_summary;
DROP VIEW IF EXISTS core.lap_phase_summary;
DROP VIEW IF EXISTS core.strategy_evidence_summary;
DROP VIEW IF EXISTS core.pit_cycle_summary;
DROP VIEW IF EXISTS core.race_progression_summary;
DROP VIEW IF EXISTS core.driver_session_summary;
DROP VIEW IF EXISTS core.strategy_summary;
DROP VIEW IF EXISTS core.stint_summary;
DROP VIEW IF EXISTS core.grid_vs_finish;

COMMIT;
