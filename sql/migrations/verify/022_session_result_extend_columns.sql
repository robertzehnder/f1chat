-- Verify openf1:022_session_result_extend_columns on pg

BEGIN;

DO $$
DECLARE
  missing TEXT[];
  expected_cols TEXT[] := ARRAY['number_of_laps', 'duration', 'gap_to_leader'];
  c TEXT;
BEGIN
  FOREACH c IN ARRAY expected_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'raw'
        AND table_name = 'session_result'
        AND column_name = c
    ) THEN
      missing := COALESCE(missing, ARRAY[]::TEXT[]) || c;
    END IF;
  END LOOP;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'raw.session_result missing expected columns: %', missing;
  END IF;
END $$;

ROLLBACK;
