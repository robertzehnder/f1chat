-- Revert openf1:021_saved_analysis from pg

BEGIN;

DROP INDEX IF EXISTS core.saved_analysis_created_at_idx;
DROP TABLE IF EXISTS core.saved_analysis;

COMMIT;
