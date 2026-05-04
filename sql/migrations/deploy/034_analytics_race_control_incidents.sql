-- Deploy openf1:034_analytics_race_control_incidents to pg
-- requires: 033_analytics_stint_degradation_curve
--
-- Phase 21 Tier 1 (slice 21-race-control-incident-index): one row
-- per FIA STEWARDS message in raw.race_control, with parsed fields:
--
--   driver_number    (extracted from "CAR <N> (XXX)" pattern)
--   penalty_seconds  (extracted from "<N> SECOND TIME PENALTY")
--   incident_kind    (categorical bucket: track_limits / collision /
--                     leaving_track / unsafe_release / speeding /
--                     forcing_off / false_start / pit_lane_infraction
--                     / other)
--   action_status    (under_investigation / no_further_action /
--                     time_penalty / drive_through / reprimand)
--
-- Penalty *points* are NOT exposed in the OpenF1 race_control feed
-- (FIA-side announcement, not broadcast text). Questions asking
-- specifically about cumulative driver penalty points cap at B
-- (manifest entry).
--
-- Storage matview + facade view pattern (Phase 18-C). Source data
-- volume: ~1,900 STEWARDS rows across all 2024+2025 sessions, so
-- per-row regex parsing in PL/pgSQL has acceptable cost.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.race_control_incidents_data AS
WITH stewards AS (
  -- Filter raw.race_control to messages produced by the FIA stewards.
  -- The category column is sometimes 'Other' for these (the OpenF1
  -- ingest doesn't categorize them as a separate kind), so we rely
  -- on the message-text marker.
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
  p.race_control_id,
  p.session_key,
  p.meeting_key,
  p.lap_number,
  p.date,
  p.driver_number,
  p.second_driver_number,
  p.incident_kind,
  p.action_status,
  p.penalty_seconds,
  -- penalty_points: not in OpenF1 race-control feed. NULL for now;
  -- downstream synthesis cites this as a known data limitation.
  NULL::INTEGER AS penalty_points,
  p.message      AS message_text
FROM parsed p;

CREATE INDEX IF NOT EXISTS race_control_incidents_data_session_idx
  ON analytics.race_control_incidents_data (session_key);

CREATE INDEX IF NOT EXISTS race_control_incidents_data_driver_idx
  ON analytics.race_control_incidents_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS race_control_incidents_data_kind_idx
  ON analytics.race_control_incidents_data (incident_kind);

-- Facade view — the LLM-stable contract.
CREATE OR REPLACE VIEW analytics.race_control_incidents AS
SELECT * FROM analytics.race_control_incidents_data;

COMMENT ON VIEW analytics.race_control_incidents IS
  'Phase 21 (slice 21-race-control-incident-index): parsed FIA STEWARDS messages from raw.race_control. Each row is one steward-issued message with extracted driver_number, incident_kind (track_limits / collision / leaving_track_advantage / forcing_off / etc), action_status (time_penalty / drive_through / no_further_action / under_investigation / etc), and penalty_seconds when applicable. penalty_points is always NULL — the OpenF1 race-control feed does not include FIA penalty-point assignments. message_text is the original message for synthesis context.';

COMMIT;
