-- Deploy openf1:022_session_result_extend_columns to pg
-- requires: 021_saved_analysis
--
-- Phase 13: extend raw.session_result with the OpenF1 /v1/session_result
-- columns that have no current home: number_of_laps, duration,
-- gap_to_leader. Without these the chat path cannot answer
-- "how far behind did Y finish?" / "Y's race time was T" /
-- "Y completed N of M laps" type questions.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-deploys are safe.

BEGIN;

ALTER TABLE raw.session_result
  ADD COLUMN IF NOT EXISTS number_of_laps INTEGER,
  ADD COLUMN IF NOT EXISTS duration       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gap_to_leader  DOUBLE PRECISION;

COMMIT;
