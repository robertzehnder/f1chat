-- Verify openf1:052_analytics_year_unlock on pg

BEGIN;

DO $$
DECLARE
  mv text;
  mvs text[] := ARRAY[
    'driver_performance_score_data',
    'corner_analysis_data',
    'minisector_dominance_data',
    'traction_analysis_data',
    'braking_performance_data'
  ];
  facades text[] := ARRAY[
    'driver_performance_score',
    'corner_analysis',
    'minisector_dominance',
    'traction_analysis',
    'braking_performance'
  ];
  fc text;
  n int;
BEGIN
  FOREACH mv IN ARRAY mvs LOOP
    SELECT COUNT(*) INTO n FROM pg_matviews
    WHERE schemaname = 'analytics' AND matviewname = mv;
    IF n = 0 THEN
      RAISE EXCEPTION 'analytics.% missing', mv;
    END IF;

    SELECT COUNT(*) INTO n FROM pg_matviews
    WHERE schemaname = 'analytics' AND matviewname = mv
      AND definition LIKE '%>= 2025%';
    IF n = 0 THEN
      RAISE EXCEPTION 'analytics.% still year-locked (definition lacks ">= 2025")', mv;
    END IF;
  END LOOP;

  FOREACH fc IN ARRAY facades LOOP
    SELECT COUNT(*) INTO n FROM pg_views
    WHERE schemaname = 'analytics' AND viewname = fc;
    IF n = 0 THEN
      RAISE EXCEPTION 'analytics.% facade missing', fc;
    END IF;
  END LOOP;
END $$;

ROLLBACK;
