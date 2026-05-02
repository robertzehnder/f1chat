-- Verify openf1:020_perf_indexes on pg

BEGIN;

DO $$
DECLARE
  expected_indexes text[] := ARRAY[
    'idx_raw_laps_session_include',
    'idx_raw_stints_session_driver_window',
    'idx_raw_pit_session_driver_lap',
    'idx_raw_position_history_session_date',
    'idx_raw_laps_session_driver_valid_partial'
  ];
  missing_indexes text[];
  invalid_indexes text[];
BEGIN
  SELECT array_agg(x) INTO missing_indexes
    FROM unnest(expected_indexes) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'raw'
        AND c.relname = x
        AND c.relkind = 'i'
    );
  IF missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION '020_perf_indexes: missing perf indexes: %', missing_indexes;
  END IF;

  SELECT array_agg(c.relname) INTO invalid_indexes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'raw'
      AND c.relname = ANY(expected_indexes)
      AND NOT i.indisvalid;
  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION '020_perf_indexes: indexes present but indisvalid=false: %', invalid_indexes;
  END IF;
END $$;

ROLLBACK;
