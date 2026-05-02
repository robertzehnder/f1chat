-- Revert openf1:023_starting_grid_derivation from pg

BEGIN;

DELETE FROM raw.starting_grid
  WHERE source_file = 'derived_from_qualifying_session_result';

DROP INDEX IF EXISTS raw.starting_grid_derived_unique;

COMMIT;
