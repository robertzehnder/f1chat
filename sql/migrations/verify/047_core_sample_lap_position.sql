-- Verify openf1:047_core_sample_lap_position on pg

BEGIN;

DO $$
DECLARE
  car_view_count int;
  loc_view_count int;
  car_cols text[] := ARRAY[
    'session_key','driver_number','date','brake','throttle','n_gear','rpm','speed','drs','meeting_key',
    'lap_number','sample_lap_seconds','lap_total_seconds','time_fraction'
  ];
  loc_cols text[] := ARRAY[
    'session_key','driver_number','date','x','y','z','meeting_key',
    'lap_number','sample_lap_seconds','lap_total_seconds','time_fraction'
  ];
  missing text;
BEGIN
  SELECT COUNT(*) INTO car_view_count FROM pg_views WHERE schemaname='core' AND viewname='car_data_lap_position';
  IF car_view_count = 0 THEN RAISE EXCEPTION 'core.car_data_lap_position view missing'; END IF;

  SELECT COUNT(*) INTO loc_view_count FROM pg_views WHERE schemaname='core' AND viewname='location_lap_position';
  IF loc_view_count = 0 THEN RAISE EXCEPTION 'core.location_lap_position view missing'; END IF;

  FOR missing IN
    SELECT unnest(car_cols) EXCEPT
    SELECT column_name FROM information_schema.columns WHERE table_schema='core' AND table_name='car_data_lap_position'
  LOOP
    RAISE EXCEPTION 'core.car_data_lap_position missing column: %', missing;
  END LOOP;

  FOR missing IN
    SELECT unnest(loc_cols) EXCEPT
    SELECT column_name FROM information_schema.columns WHERE table_schema='core' AND table_name='location_lap_position'
  LOOP
    RAISE EXCEPTION 'core.location_lap_position missing column: %', missing;
  END LOOP;
END $$;

ROLLBACK;
