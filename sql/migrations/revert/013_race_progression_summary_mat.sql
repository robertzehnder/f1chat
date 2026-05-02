-- Revert openf1:013_race_progression_summary_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql.
DROP VIEW IF EXISTS core.race_progression_summary;
DROP INDEX IF EXISTS core.race_progression_summary_mat_session_driver_lap_idx;
DROP INDEX IF EXISTS core.race_progression_summary_mat_session_idx;
DROP TABLE IF EXISTS core.race_progression_summary_mat;

COMMIT;
