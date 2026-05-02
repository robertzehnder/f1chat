-- Verify openf1:021_saved_analysis on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relname = 'saved_analysis'
      AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION '021_saved_analysis: core.saved_analysis table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_analysis_name_nonempty'
  ) THEN
    RAISE EXCEPTION '021_saved_analysis: check constraint saved_analysis_name_nonempty missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = 'saved_analysis_created_at_idx'
  ) THEN
    RAISE EXCEPTION '021_saved_analysis: index saved_analysis_created_at_idx missing';
  END IF;
END $$;

ROLLBACK;
