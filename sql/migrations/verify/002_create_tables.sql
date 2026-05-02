-- Verify openf1:002_create_tables on pg

BEGIN;

DO $$
DECLARE
  expected text[] := ARRAY[
    'meetings','sessions','drivers','laps','pit','stints',
    'team_radio','race_control','weather','session_result',
    'starting_grid','overtakes','championship_drivers',
    'championship_teams','car_data','location','intervals',
    'position_history','ingestion_runs','ingestion_files'
  ];
  missing text[];
BEGIN
  SELECT array_agg(x) INTO missing
    FROM unnest(expected) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'raw'
        AND c.relname = x
        AND c.relkind = 'r'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '002_create_tables: missing raw tables: %', missing;
  END IF;
END $$;

ROLLBACK;
