-- Verify openf1:017_lap_phase_summary_mat on pg

BEGIN;

DO $$
DECLARE
  expected_indexes text[] := ARRAY[
    'lap_phase_summary_mat_session_driver_lap_idx',
    'lap_phase_summary_mat_session_idx'
  ];
  missing_indexes text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'core' AND tablename = 'lap_phase_summary_mat'
  ) THEN
    RAISE EXCEPTION '017_lap_phase_summary_mat: core.lap_phase_summary_mat missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relname = 'lap_phase_summary'
      AND c.relkind IN ('v', 'r')
  ) THEN
    RAISE EXCEPTION '017_lap_phase_summary_mat: core.lap_phase_summary view missing';
  END IF;

  SELECT array_agg(x) INTO missing_indexes
    FROM unnest(expected_indexes) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = x
    );
  IF missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION '017_lap_phase_summary_mat: missing indexes: %', missing_indexes;
  END IF;
END $$;

ROLLBACK;
