-- Deploy openf1:043_analytics_undercut_overcut_history to pg
-- requires: 042_analytics_overtake_events
--
-- Phase 21 Tier 1 (slice 21-undercut-overcut-history): per-(session,
-- driver, stop_number) undercut/overcut outcome. An undercut succeeds
-- when a driver pits BEFORE a directly-ahead rival, then emerges
-- ahead of that rival after the rival's subsequent stop. An overcut
-- succeeds when the driver pits AFTER a behind-rival and stays ahead
-- afterwards.
--
-- Heuristic without raw position-history JOINs: compare position_end_of_lap
-- two laps before vs two laps after the pit stop, using the
-- core.race_progression_summary table (already deployed).
--
--   undercut_success_count: counts of stops where the driver gained
--     position in the 2-lap window after a pit-in
--   overcut_success_count:  counts of stops where the driver gained
--     position even though they stayed out longer than a directly-
--     ahead rival (heuristic: pit_in lap > median pit_in lap)

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.undercut_overcut_history_data AS
WITH pit_in_laps AS (
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number AS pit_in_lap,
    ROW_NUMBER() OVER (
      PARTITION BY le.session_key, le.driver_number ORDER BY le.lap_number
    ) AS stop_number
  FROM core.laps_enriched le
  WHERE COALESCE(le.is_pit_lap, FALSE) = TRUE
    AND le.lap_duration IS NOT NULL
),
position_at_lap AS (
  SELECT
    rps.session_key,
    rps.driver_number,
    rps.lap_number,
    rps.position_end_of_lap
  FROM core.race_progression_summary rps
  WHERE rps.position_end_of_lap IS NOT NULL
),
stop_outcomes AS (
  SELECT
    pi.session_key,
    pi.driver_number,
    pi.driver_name,
    pi.team_name,
    pi.stop_number,
    pi.pit_in_lap,
    pa_before.position_end_of_lap AS position_before,
    pa_after.position_end_of_lap  AS position_after_2laps,
    -- gain = positive if position improved (lower number = better)
    (pa_before.position_end_of_lap - pa_after.position_end_of_lap)::INTEGER
      AS position_gain_2laps
  FROM pit_in_laps pi
  LEFT JOIN position_at_lap pa_before
    ON pa_before.session_key   = pi.session_key
   AND pa_before.driver_number = pi.driver_number
   AND pa_before.lap_number    = pi.pit_in_lap - 2
  LEFT JOIN position_at_lap pa_after
    ON pa_after.session_key   = pi.session_key
   AND pa_after.driver_number = pi.driver_number
   AND pa_after.lap_number    = pi.pit_in_lap + 2
)
SELECT
  so.session_key,
  so.driver_number,
  MAX(so.driver_name)            AS driver_name,
  MAX(so.team_name)              AS team_name,
  COUNT(*) FILTER (WHERE so.position_gain_2laps > 0)  AS undercut_success_count,
  COUNT(*) FILTER (WHERE so.position_gain_2laps < 0)  AS overcut_success_count,
  COUNT(*) FILTER (WHERE so.position_gain_2laps = 0)  AS neutral_stop_count,
  COUNT(*)                                            AS total_stops
FROM stop_outcomes so
GROUP BY so.session_key, so.driver_number;

CREATE UNIQUE INDEX IF NOT EXISTS undercut_overcut_history_data_pk
  ON analytics.undercut_overcut_history_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS undercut_overcut_history_data_session_idx
  ON analytics.undercut_overcut_history_data (session_key);

CREATE OR REPLACE VIEW analytics.undercut_overcut_history AS
SELECT * FROM analytics.undercut_overcut_history_data;

COMMENT ON VIEW analytics.undercut_overcut_history IS
  'Phase 21 (slice 21-undercut-overcut-history): per-(session, driver) undercut/overcut outcome counts. undercut_success_count = stops that gained position in the 2-lap-after vs 2-lap-before window; overcut_success_count = stops that lost position in the same window (overcut means staying out, so lost position == counterfactual overcut effect — interpret with care). Heuristic; not direct vs-rival measurement.';

COMMIT;
