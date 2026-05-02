-- Verify openf1:008_core_build_schema on pg

BEGIN;

DO $$
DECLARE
  expected_views text[] := ARRAY[
    'laps_enriched',
    'grid_vs_finish',
    'stint_summary',
    'strategy_summary',
    'race_progression_summary',
    'lap_phase_summary',
    'lap_context_summary',
    'telemetry_lap_bridge',
    'driver_session_summary',
    'pit_cycle_summary',
    'strategy_evidence_summary'
  ];
  missing text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_build') THEN
    RAISE EXCEPTION '008_core_build_schema: schema core_build missing';
  END IF;

  SELECT array_agg(x) INTO missing
    FROM unnest(expected_views) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core_build'
        AND c.relname = x
        AND c.relkind IN ('v', 'r')
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '008_core_build_schema: missing core_build views: %', missing;
  END IF;
END $$;

ROLLBACK;
