-- Verify openf1:019_telemetry_lap_bridge_mat on pg

BEGIN;

DO $$
DECLARE
  expected_indexes text[] := ARRAY[
    'telemetry_lap_bridge_mat_session_driver_lap_idx',
    'telemetry_lap_bridge_mat_session_idx'
  ];
  missing_indexes text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'core' AND tablename = 'telemetry_lap_bridge_mat'
  ) THEN
    RAISE EXCEPTION '019_telemetry_lap_bridge_mat: core.telemetry_lap_bridge_mat missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core'
      AND c.relname = 'telemetry_lap_bridge'
      AND c.relkind IN ('v', 'r')
  ) THEN
    RAISE EXCEPTION '019_telemetry_lap_bridge_mat: core.telemetry_lap_bridge view missing';
  END IF;

  SELECT array_agg(x) INTO missing_indexes
    FROM unnest(expected_indexes) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = x
    );
  IF missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION '019_telemetry_lap_bridge_mat: missing indexes: %', missing_indexes;
  END IF;
END $$;

ROLLBACK;
