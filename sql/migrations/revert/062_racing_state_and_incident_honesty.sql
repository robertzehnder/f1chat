-- Revert openf1:062_racing_state_and_incident_honesty from pg
--
-- Restores the 034 stewards-only FILTER for race_control_incidents. The two
-- columns 062 appended (source_kind, occurred_lap) are kept as constants
-- because CREATE OR REPLACE VIEW cannot drop columns and the facade view
-- cannot be dropped (analytics.driver_performance_score_data depends on it).

BEGIN;

DROP VIEW IF EXISTS analytics.racing_state_intervals;
DROP MATERIALIZED VIEW IF EXISTS analytics.racing_state_intervals_data;
DROP FUNCTION IF EXISTS analytics.racing_state_intervals_fn(BIGINT);

CREATE MATERIALIZED VIEW analytics.race_control_incidents_data_v0 AS
WITH stewards AS (
  SELECT
    rc.id              AS race_control_id,
    rc.session_key,
    rc.meeting_key,
    rc.lap_number,
    rc.date,
    rc.message,
    UPPER(rc.message)  AS message_upper
  FROM raw.race_control rc
  WHERE UPPER(rc.message) LIKE 'FIA STEWARDS:%'
),
parsed AS (
  SELECT
    s.race_control_id,
    s.session_key,
    s.meeting_key,
    s.lap_number,
    s.date,
    s.message,
    -- driver_number: first number following "CAR " in the message.
    NULLIF(
      (regexp_match(s.message_upper, 'CAR\s+(\d+)'))[1],
      ''
    )::INTEGER AS driver_number,
    -- second driver if message references two cars.
    NULLIF(
      (regexp_match(s.message_upper, 'CARS\s+\d+\s*\([A-Z]+\)\s+AND\s+(\d+)'))[1],
      ''
    )::INTEGER AS second_driver_number,
    -- penalty_seconds: number preceding "SECOND TIME PENALTY".
    NULLIF(
      (regexp_match(s.message_upper, '(\d+)\s+SECOND\s+TIME\s+PENALTY'))[1],
      ''
    )::INTEGER AS penalty_seconds,
    -- action_status: classify the steward action.
    CASE
      WHEN s.message_upper LIKE '%TIME PENALTY%'                THEN 'time_penalty'
      WHEN s.message_upper LIKE '%DRIVE-THROUGH%'
        OR s.message_upper LIKE '%DRIVE THROUGH%'               THEN 'drive_through'
      WHEN s.message_upper LIKE '%REPRIMAND%'                   THEN 'reprimand'
      WHEN s.message_upper LIKE '%GRID PENALTY%'
        OR s.message_upper LIKE '%GRID DROP%'                   THEN 'grid_penalty'
      WHEN s.message_upper LIKE '%NO FURTHER ACTION%'
        OR s.message_upper LIKE '%NO FURTHER INVESTIGATION%'    THEN 'no_further_action'
      WHEN s.message_upper LIKE '%UNDER INVESTIGATION%'         THEN 'under_investigation'
      WHEN s.message_upper LIKE '%WILL BE INVESTIGATED%'        THEN 'investigation_deferred'
      ELSE 'other'
    END AS action_status,
    -- incident_kind: classify the incident reason.
    CASE
      WHEN s.message_upper LIKE '%TRACK LIMITS%'
        OR s.message_upper LIKE '%TRACK LIMIT %'                THEN 'track_limits'
      WHEN s.message_upper LIKE '%LEAVING THE TRACK AND GAINING%'
        OR s.message_upper LIKE '%LEAVING THE TRACK%'           THEN 'leaving_track_advantage'
      WHEN s.message_upper LIKE '%CAUSING A COLLISION%'
        OR s.message_upper LIKE '%COLLISION%'                   THEN 'collision'
      WHEN s.message_upper LIKE '%FORCING ANOTHER DRIVER%'      THEN 'forcing_off'
      WHEN s.message_upper LIKE '%UNSAFE RELEASE%'              THEN 'unsafe_release'
      WHEN s.message_upper LIKE '%SPEEDING IN THE PIT LANE%'    THEN 'pit_speeding'
      WHEN s.message_upper LIKE '%PIT LANE %'
        OR s.message_upper LIKE '%PIT ENTRY %'                  THEN 'pit_lane_infraction'
      WHEN s.message_upper LIKE '%FALSE START%'
        OR s.message_upper LIKE '%JUMPED START%'                THEN 'false_start'
      WHEN s.message_upper LIKE '%INCORRECT STARTING%'          THEN 'incorrect_grid_position'
      WHEN s.message_upper LIKE '%MULTIPLE TRACK LIMIT%'        THEN 'multiple_track_limits'
      WHEN s.message_upper LIKE '%NOT ENTERING PIT LANE%'       THEN 'not_entering_pit_lane'
      WHEN s.message_upper LIKE '%TYRES%'
        OR s.message_upper LIKE '%TYRE %'                       THEN 'tyre_compliance'
      ELSE 'other'
    END AS incident_kind
  FROM stewards s
)
SELECT
  p.race_control_id, p.session_key, p.meeting_key, p.lap_number, p.date,
  p.driver_number, p.second_driver_number, p.incident_kind, p.action_status,
  p.penalty_seconds, NULL::INTEGER AS penalty_points, p.message AS message_text,
  'stewards'::text AS source_kind, NULL::INTEGER AS occurred_lap
FROM parsed p;

CREATE OR REPLACE VIEW analytics.race_control_incidents AS
SELECT * FROM analytics.race_control_incidents_data_v0;

DROP MATERIALIZED VIEW IF EXISTS analytics.race_control_incidents_data;
ALTER MATERIALIZED VIEW analytics.race_control_incidents_data_v0 RENAME TO race_control_incidents_data;

CREATE INDEX IF NOT EXISTS race_control_incidents_data_session_idx
  ON analytics.race_control_incidents_data (session_key);
CREATE INDEX IF NOT EXISTS race_control_incidents_data_driver_idx
  ON analytics.race_control_incidents_data (session_key, driver_number);
CREATE INDEX IF NOT EXISTS race_control_incidents_data_kind_idx
  ON analytics.race_control_incidents_data (incident_kind);

COMMENT ON VIEW analytics.race_control_incidents IS
  'Phase 21 (slice 21-race-control-incident-index): parsed FIA STEWARDS messages from raw.race_control (062 reverted: stewards-only filter restored; source_kind/occurred_lap retained as constants).';

COMMIT;
