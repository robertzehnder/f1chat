-- Verify openf1:023_starting_grid_derivation on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'raw'
      AND indexname = 'starting_grid_derived_unique'
  ) THEN
    RAISE EXCEPTION 'expected partial-unique index raw.starting_grid_derived_unique not present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM raw.starting_grid
    WHERE source_file = 'derived_from_qualifying_session_result'
      AND (grid_position IS NULL OR driver_number IS NULL)
  ) THEN
    RAISE EXCEPTION 'derived starting_grid rows have NULL grid_position or driver_number';
  END IF;
END $$;

ROLLBACK;
