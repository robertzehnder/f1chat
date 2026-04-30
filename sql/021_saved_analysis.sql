BEGIN;

CREATE TABLE IF NOT EXISTS core.saved_analysis (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'core'
      AND cl.relname = 'saved_analysis'
      AND c.conname = 'saved_analysis_name_nonempty'
  ) THEN
    ALTER TABLE core.saved_analysis
      ADD CONSTRAINT saved_analysis_name_nonempty
      CHECK (length(btrim(name)) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC);

COMMIT;
