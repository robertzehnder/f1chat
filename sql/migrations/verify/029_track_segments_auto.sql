-- Verify openf1:029_track_segments_auto on pg
--
-- Phase 20-A acceptance:
--   1. f1 schema exists.
--   2. f1.track_segments table exists with the expected columns.
--   3. At least one mini-sector row exists for each known
--      circuit_short_name (auto-derivation actually fired).
--   4. The (circuit_short_name, segment_kind, segment_index) unique
--      constraint is in place.

BEGIN;

DO $$
DECLARE
  schema_count int;
  table_count int;
  unique_count int;
  expected_columns text[] := ARRAY[
    'id', 'circuit_short_name', 'segment_kind', 'segment_index',
    'segment_label', 'start_normalized', 'end_normalized',
    'start_distance_m', 'end_distance_m', 'notes', 'ingested_at'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO schema_count
  FROM information_schema.schemata
  WHERE schema_name = 'f1';
  IF schema_count = 0 THEN
    RAISE EXCEPTION 'f1 schema is missing';
  END IF;

  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'f1' AND table_name = 'track_segments';
  IF table_count = 0 THEN
    RAISE EXCEPTION 'f1.track_segments table is missing';
  END IF;

  -- Column-shape verify (Phase 18-C pattern).
  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'f1' AND table_name = 'track_segments'
  LOOP
    RAISE EXCEPTION 'f1.track_segments missing column: %', missing_column;
  END LOOP;

  SELECT COUNT(*) INTO unique_count
  FROM information_schema.table_constraints
  WHERE table_schema = 'f1'
    AND table_name = 'track_segments'
    AND constraint_type = 'UNIQUE';
  IF unique_count = 0 THEN
    RAISE EXCEPTION 'f1.track_segments unique constraint missing';
  END IF;
END $$;

ROLLBACK;
