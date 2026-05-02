-- Revert openf1:009_driver_session_summary_mat from pg

BEGIN;

-- See deep-revert note in revert/010_laps_enriched_mat.sql. Predecessor
-- 007_semantic_summary_contracts creates VIEW core.driver_session_summary;
-- this revert drops the matview-backed replacement and the storage table.
DROP VIEW IF EXISTS core.driver_session_summary;
DROP TABLE IF EXISTS core.driver_session_summary_mat;

COMMIT;
