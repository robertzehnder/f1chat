-- Verify openf1:049_analytics_corner_analysis_alias_fix on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  monaco_rows int;
BEGIN
  SELECT COUNT(*) INTO matview_count FROM pg_matviews
   WHERE schemaname='analytics' AND matviewname='corner_analysis_data';
  IF matview_count = 0 THEN RAISE EXCEPTION 'analytics.corner_analysis_data matview missing'; END IF;

  -- Monaco 2025 race session (9979) should now have rows.
  SELECT COUNT(*) INTO monaco_rows FROM analytics.corner_analysis_data WHERE session_key = 9979;
  IF monaco_rows = 0 THEN
    RAISE EXCEPTION 'analytics.corner_analysis_data has no Monaco 2025 race rows; circuit-alias fix did not work';
  END IF;
END $$;

ROLLBACK;
