-- Verify openf1:007_semantic_summary_contracts on pg

BEGIN;

DO $$
DECLARE
  expected_views text[] := ARRAY[
    'grid_vs_finish',
    'stint_summary',
    'strategy_summary',
    'driver_session_summary',
    'race_progression_summary',
    'pit_cycle_summary',
    'strategy_evidence_summary',
    'lap_phase_summary',
    'lap_context_summary',
    'telemetry_lap_bridge'
  ];
  missing text[];
BEGIN
  SELECT array_agg(x) INTO missing
    FROM unnest(expected_views) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core'
        AND c.relname = x
        AND c.relkind IN ('v', 'r')
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '007_semantic_summary_contracts: missing core summary objects: %', missing;
  END IF;
END $$;

ROLLBACK;
