-- Verify openf1:034_analytics_race_control_incidents on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'race_control_id', 'session_key', 'meeting_key', 'lap_number', 'date',
    'driver_number', 'second_driver_number',
    'incident_kind', 'action_status',
    'penalty_seconds', 'penalty_points',
    'message_text'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='race_control_incidents_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.race_control_incidents_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='race_control_incidents';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.race_control_incidents facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='race_control_incidents'
  LOOP
    RAISE EXCEPTION 'analytics.race_control_incidents missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
