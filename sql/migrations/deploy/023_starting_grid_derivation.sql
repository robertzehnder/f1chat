-- Deploy openf1:023_starting_grid_derivation to pg
-- requires: 022_session_result_extend_columns
--
-- Phase 13: populate raw.starting_grid by deriving grid positions
-- from each meeting's qualifying-session_result. Rows are keyed on
-- the RACE session_key (matching the existing schema at
-- sql/002_create_tables.sql:168 and the indexes at
-- sql/003_indexes.sql:24, and aligning with the UNION in
-- core_build.grid_vs_finish at sql/008_core_build_schema.sql:186).
--
-- Two derivation passes:
--   (a) Race grid from Qualifying session results
--   (b) Sprint grid from Sprint Qualifying / Sprint Shootout results
--
-- Idempotent via INSERT ... ON CONFLICT DO NOTHING. The conflict
-- target is enforced by a partial unique index added below; existing
-- rows (e.g. from a future API endpoint) are preserved.
--
-- v1 limitation (documented for follow-up): grid penalties are NOT
-- applied. A driver who qualifies P3 but starts P8 due to an
-- engine-change penalty will show grid_position = 3 here. A
-- follow-up slice can compare lap-1 raw.position_history against
-- this derived grid to detect and correct penalty-affected starts.

BEGIN;

-- Partial unique index to support ON CONFLICT DO NOTHING. Limited to
-- rows produced by this derivation (source_file = 'derived_from_qualifying_session_result')
-- so it does not conflict with rows that may later come from a real
-- /v1/starting_grid endpoint or other sources.
CREATE UNIQUE INDEX IF NOT EXISTS starting_grid_derived_unique
  ON raw.starting_grid (session_key, driver_number)
  WHERE source_file = 'derived_from_qualifying_session_result';

-- (a) Race grid from Qualifying
INSERT INTO raw.starting_grid (
  session_key,
  meeting_key,
  driver_number,
  grid_position,
  source_file
)
SELECT
  race.session_key,
  race.meeting_key,
  q_result.driver_number,
  q_result.position AS grid_position,
  'derived_from_qualifying_session_result' AS source_file
FROM raw.sessions race
JOIN raw.sessions q
  ON q.meeting_key = race.meeting_key
 AND q.session_type = 'Qualifying'
JOIN raw.session_result q_result
  ON q_result.session_key = q.session_key
WHERE race.session_type = 'Race'
  AND q_result.position IS NOT NULL
  AND q_result.driver_number IS NOT NULL
ON CONFLICT (session_key, driver_number)
  WHERE source_file = 'derived_from_qualifying_session_result'
  DO NOTHING;

-- (b) Sprint grid from Sprint Qualifying / Sprint Shootout
INSERT INTO raw.starting_grid (
  session_key,
  meeting_key,
  driver_number,
  grid_position,
  source_file
)
SELECT
  sprint.session_key,
  sprint.meeting_key,
  sq_result.driver_number,
  sq_result.position AS grid_position,
  'derived_from_qualifying_session_result' AS source_file
FROM raw.sessions sprint
JOIN raw.sessions sq
  ON sq.meeting_key = sprint.meeting_key
 AND sq.session_type IN ('Sprint Qualifying', 'Sprint Shootout')
JOIN raw.session_result sq_result
  ON sq_result.session_key = sq.session_key
WHERE sprint.session_type = 'Sprint'
  AND sq_result.position IS NOT NULL
  AND sq_result.driver_number IS NOT NULL
ON CONFLICT (session_key, driver_number)
  WHERE source_file = 'derived_from_qualifying_session_result'
  DO NOTHING;

COMMIT;
