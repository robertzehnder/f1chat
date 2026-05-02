-- Verify openf1:005_helper_tables on pg

BEGIN;

DO $$
DECLARE
  expected_tables text[] := ARRAY[
    'session_venue_alias_lookup',
    'driver_alias_lookup',
    'session_type_alias_lookup',
    'team_alias_lookup',
    'weekend_session_expectation_rules',
    'source_anomaly_manual',
    'benchmark_question_type_lookup',
    'query_template_registry'
  ];
  expected_views text[] := ARRAY[
    'session_search_lookup',
    'driver_identity_lookup',
    'team_identity_lookup',
    'session_completeness',
    'weekend_session_coverage',
    'weekend_session_expectation_audit',
    'source_anomaly_tracking'
  ];
  expected_constraints text[] := ARRAY[
    'ck_weekend_session_expectation_rules_format',
    'ck_weekend_session_expectation_rules_counts'
  ];
  missing_tables text[];
  missing_views text[];
  missing_cons text[];
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
    RAISE EXCEPTION '005_helper_tables: missing core tables: %', missing_tables;
  END IF;

  SELECT array_agg(x) INTO missing_views
    FROM unnest(expected_views) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core'
        AND c.relname = x
        AND c.relkind = 'v'
    );
  IF missing_views IS NOT NULL THEN
    RAISE EXCEPTION '005_helper_tables: missing core views: %', missing_views;
  END IF;

  SELECT array_agg(x) INTO missing_cons
    FROM unnest(expected_constraints) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = x
    );
  IF missing_cons IS NOT NULL THEN
    RAISE EXCEPTION '005_helper_tables: missing check constraints: %', missing_cons;
  END IF;
END $$;

ROLLBACK;
