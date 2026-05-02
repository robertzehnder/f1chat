-- Verify openf1:027_user_feedback on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'core' AND table_name = 'user_feedback'
  ) THEN
    RAISE EXCEPTION 'core.user_feedback table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'core' AND indexname = 'idx_user_feedback_thumb'
  ) THEN
    RAISE EXCEPTION 'idx_user_feedback_thumb missing';
  END IF;
END $$;

ROLLBACK;
