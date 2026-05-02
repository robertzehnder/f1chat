-- Revert openf1:022_session_result_extend_columns from pg

BEGIN;

ALTER TABLE raw.session_result
  DROP COLUMN IF EXISTS number_of_laps,
  DROP COLUMN IF EXISTS duration,
  DROP COLUMN IF EXISTS gap_to_leader;

COMMIT;
