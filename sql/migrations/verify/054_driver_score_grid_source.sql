-- Verify openf1:054_driver_score_grid_source on pg

BEGIN;

DO $$
DECLARE
  n int;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_matviews
  WHERE schemaname = 'analytics' AND matviewname = 'driver_performance_score_data'
    AND definition LIKE '%starting_grid%';
  IF n = 0 THEN RAISE EXCEPTION 'driver_performance_score_data missing or lacks starting_grid'; END IF;

  -- The grid join must read Qualifying sessions (where OpenF1 attaches
  -- grid rows), not Race sessions.
  SELECT COUNT(*) INTO n FROM pg_matviews
  WHERE schemaname = 'analytics' AND matviewname = 'driver_performance_score_data'
    AND definition LIKE '%starting_grid%'
    AND definition ~ 'starting_grid[^;]*Qualifying';
  IF n = 0 THEN RAISE EXCEPTION 'qual_axis_raw still joins grid to Race sessions'; END IF;

  SELECT COUNT(*) INTO n FROM pg_views
  WHERE schemaname = 'analytics' AND viewname = 'driver_performance_score';
  IF n = 0 THEN RAISE EXCEPTION 'driver_performance_score facade missing'; END IF;
END $$;

ROLLBACK;
