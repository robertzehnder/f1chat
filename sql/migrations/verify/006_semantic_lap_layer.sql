-- Verify openf1:006_semantic_lap_layer on pg

BEGIN;

DO $$
DECLARE
  expected_tables text[] := ARRAY[
    'compound_alias_lookup',
    'valid_lap_policy',
    'metric_registry',
    'replay_contract_registry'
  ];
  expected_views text[] := ARRAY[
    'lap_semantic_bridge',
    'laps_enriched',
    'replay_lap_frames'
  ];
  missing_tables text[];
  missing_views text[];
BEGIN
  SELECT array_agg(x) INTO missing_tables
    FROM unnest(expected_tables) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core'
        AND c.relname = x
        AND c.relkind = 'r'
    );
  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION '006_semantic_lap_layer: missing tables: %', missing_tables;
  END IF;

  SELECT array_agg(x) INTO missing_views
    FROM unnest(expected_views) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core'
        AND c.relname = x
        AND c.relkind IN ('v', 'r')
    );
  IF missing_views IS NOT NULL THEN
    RAISE EXCEPTION '006_semantic_lap_layer: missing views: %', missing_views;
  END IF;
END $$;

ROLLBACK;
