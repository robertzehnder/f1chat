-- Revert openf1:012_strategy_summary_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql.
DROP VIEW IF EXISTS core.strategy_summary;
DROP TABLE IF EXISTS core.strategy_summary_mat;

COMMIT;
