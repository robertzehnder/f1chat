-- Verify openf1:016_strategy_evidence_summary_mat on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'core' AND tablename = 'strategy_evidence_summary_mat'
  ) THEN
    RAISE EXCEPTION '016_strategy_evidence_summary_mat: core.strategy_evidence_summary_mat missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relname = 'strategy_evidence_summary'
      AND c.relkind IN ('v', 'r')
  ) THEN
    RAISE EXCEPTION '016_strategy_evidence_summary_mat: core.strategy_evidence_summary view missing';
  END IF;
END $$;

ROLLBACK;
