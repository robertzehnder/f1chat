-- Verify openf1:049_analytics_corner_analysis_alias_fix on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  monaco_rows int;
  monaco_has_source boolean;
BEGIN
  SELECT COUNT(*) INTO matview_count FROM pg_matviews
   WHERE schemaname='analytics' AND matviewname='corner_analysis_data';
  IF matview_count = 0 THEN RAISE EXCEPTION 'analytics.corner_analysis_data matview missing'; END IF;

  -- Data-quality assertion: Monaco 2025 race session (9979) should have rows
  -- once the circuit-alias fix is applied. This only runs on a POPULATED
  -- warehouse — on a fresh/empty deploy target (e.g. the migration round-trip
  -- gate) raw.car_data has no Monaco rows, so the matview is legitimately empty
  -- and the alias-fix check is skipped rather than false-failing on absent data.
  SELECT EXISTS (SELECT 1 FROM raw.car_data WHERE session_key = 9979) INTO monaco_has_source;
  IF monaco_has_source THEN
    SELECT COUNT(*) INTO monaco_rows FROM analytics.corner_analysis_data WHERE session_key = 9979;
    IF monaco_rows = 0 THEN
      RAISE EXCEPTION 'analytics.corner_analysis_data has no Monaco 2025 race rows; circuit-alias fix did not work';
    END IF;
  END IF;
END $$;

ROLLBACK;
