-- Revert openf1:014_grid_vs_finish_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql.
DROP VIEW IF EXISTS core.grid_vs_finish;
DROP TABLE IF EXISTS core.grid_vs_finish_mat;

COMMIT;
