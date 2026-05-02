-- Verify openf1:014_grid_vs_finish_mat on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'core' AND tablename = 'grid_vs_finish_mat'
  ) THEN
    RAISE EXCEPTION '014_grid_vs_finish_mat: core.grid_vs_finish_mat missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relname = 'grid_vs_finish'
      AND c.relkind IN ('v', 'r')
  ) THEN
    RAISE EXCEPTION '014_grid_vs_finish_mat: core.grid_vs_finish view missing';
  END IF;
END $$;

ROLLBACK;
