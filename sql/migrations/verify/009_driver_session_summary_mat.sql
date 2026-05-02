-- Verify openf1:009_driver_session_summary_mat on pg

BEGIN;

DO $$
BEGIN
  -- The *_mat object is a PLAIN TABLE in core (not a MATERIALIZED VIEW).
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'core' AND tablename = 'driver_session_summary_mat'
  ) THEN
    RAISE EXCEPTION '009_driver_session_summary_mat: core.driver_session_summary_mat missing';
  END IF;

  -- The dependent VIEW must be present.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relname = 'driver_session_summary'
      AND c.relkind IN ('v', 'r')
  ) THEN
    RAISE EXCEPTION '009_driver_session_summary_mat: core.driver_session_summary view missing';
  END IF;
END $$;

ROLLBACK;
