-- Verify openf1:015_pit_cycle_summary_mat on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'core' AND tablename = 'pit_cycle_summary_mat'
  ) THEN
    RAISE EXCEPTION '015_pit_cycle_summary_mat: core.pit_cycle_summary_mat missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relname = 'pit_cycle_summary'
      AND c.relkind IN ('v', 'r')
  ) THEN
    RAISE EXCEPTION '015_pit_cycle_summary_mat: core.pit_cycle_summary view missing';
  END IF;
END $$;

ROLLBACK;
