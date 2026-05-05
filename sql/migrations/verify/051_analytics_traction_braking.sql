-- Verify openf1:051_analytics_traction_braking on pg

BEGIN;

DO $$
DECLARE
  m1 int; m2 int; v1 int; v2 int;
  trc_cols text[] := ARRAY[
    'session_key','driver_number','driver_name','team_name',
    'corner_id','corner_number','corner_label',
    'exit_speed_kph','avg_exit_throttle_pct','exit_throttle_application_pct',
    'valid_lap_count','sample_count'
  ];
  brk_cols text[] := ARRAY[
    'session_key','driver_number','driver_name','team_name',
    'corner_id','corner_number','corner_label',
    'approach_speed_kph','min_brake_zone_speed_kph','brake_zone_speed_drop_kph',
    'peak_brake_pressure_pct','avg_brake_pressure_pct','valid_lap_count','sample_count'
  ];
  missing text;
BEGIN
  SELECT COUNT(*) INTO m1 FROM pg_matviews WHERE schemaname='analytics' AND matviewname='traction_analysis_data';
  IF m1 = 0 THEN RAISE EXCEPTION 'analytics.traction_analysis_data missing'; END IF;
  SELECT COUNT(*) INTO m2 FROM pg_matviews WHERE schemaname='analytics' AND matviewname='braking_performance_data';
  IF m2 = 0 THEN RAISE EXCEPTION 'analytics.braking_performance_data missing'; END IF;
  SELECT COUNT(*) INTO v1 FROM pg_views WHERE schemaname='analytics' AND viewname='traction_analysis';
  IF v1 = 0 THEN RAISE EXCEPTION 'analytics.traction_analysis facade missing'; END IF;
  SELECT COUNT(*) INTO v2 FROM pg_views WHERE schemaname='analytics' AND viewname='braking_performance';
  IF v2 = 0 THEN RAISE EXCEPTION 'analytics.braking_performance facade missing'; END IF;

  FOR missing IN
    SELECT unnest(trc_cols) EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='traction_analysis'
  LOOP RAISE EXCEPTION 'analytics.traction_analysis missing column: %', missing; END LOOP;

  FOR missing IN
    SELECT unnest(brk_cols) EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='braking_performance'
  LOOP RAISE EXCEPTION 'analytics.braking_performance missing column: %', missing; END LOOP;
END $$;

ROLLBACK;
