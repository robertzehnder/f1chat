-- Verify openf1:062_racing_state_and_incident_honesty on pg

BEGIN;

SELECT race_control_id, session_key, meeting_key, lap_number, date, driver_number, second_driver_number,
       incident_kind, action_status, penalty_seconds, penalty_points, message_text, source_kind, occurred_lap
FROM analytics.race_control_incidents WHERE FALSE;

SELECT session_key, meeting_key, interval_no, kind, start_ts, end_ts, start_lap, end_lap, laps_affected,
       duration_s, endpoint_inferred, opened_by_message, closed_by_message
FROM analytics.racing_state_intervals WHERE FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'analytics' AND p.proname = 'racing_state_intervals_fn') THEN
    RAISE EXCEPTION 'analytics.racing_state_intervals_fn missing';
  END IF;
  -- Data-dependent honesty check: guarded so it passes on an empty sandbox.
  IF EXISTS (SELECT 1 FROM raw.race_control WHERE session_key = 11361) THEN
    IF NOT EXISTS (SELECT 1 FROM analytics.racing_state_intervals WHERE session_key = 11361 AND kind = 'vsc' AND start_lap = 28) THEN
      RAISE EXCEPTION 'Monza 2026 VSC (lap 28) missing from racing_state_intervals';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM analytics.race_control_incidents WHERE session_key = 11361 AND driver_number = 12 AND action_status = 'lap_deleted' AND occurred_lap = 49) THEN
      RAISE EXCEPTION 'Antonelli lap-49 deletion missing from race_control_incidents';
    END IF;
  END IF;
END $$;

ROLLBACK;
