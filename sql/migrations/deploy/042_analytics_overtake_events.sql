-- Deploy openf1:042_analytics_overtake_events to pg
-- requires: 041_analytics_drs_effectiveness
--
-- Phase 21 Tier 1 (slice 21-overtake-events): per-(session,
-- overtaking_driver, overtaken_driver, lap) on-track overtake
-- events sourced from raw.overtakes. Surface a count + lap
-- granularity for "how many overtakes" / "where on the circuit"
-- questions.
--
-- location_corner is NULL until f1.track_segments ships (Phase 20-B).

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.overtake_events_data AS
SELECT
  o.session_key,
  o.meeting_key,
  o.lap_number AS overtake_lap,
  -- Neon raw.overtakes uses `overtaker_driver_number` (not the
  -- broadcast-style `overtaking_driver_number`); we expose it under
  -- the broadcast-style name in the facade so question prompts that
  -- cite "overtaking_driver_number" stay valid.
  o.overtaker_driver_number  AS overtaking_driver_number,
  o.overtaken_driver_number,
  -- session-level overtake count (each row carries the count for
  -- aggregation-free single-row answers).
  COUNT(*) OVER (PARTITION BY o.session_key) AS overtake_count,
  -- raw.overtakes does not carry a position_change column on this
  -- Neon; expose NULL so the facade column shape stays stable
  -- across deployments where the upstream feed differs.
  NULL::INTEGER AS position_change,
  o.date,
  -- location_corner: NULL until 20-track-segments-corners ships
  NULL::TEXT AS location_corner
FROM raw.overtakes o
WHERE o.lap_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS overtake_events_data_session_idx
  ON analytics.overtake_events_data (session_key);

CREATE INDEX IF NOT EXISTS overtake_events_data_overtaker_idx
  ON analytics.overtake_events_data (session_key, overtaking_driver_number);

CREATE OR REPLACE VIEW analytics.overtake_events AS
SELECT * FROM analytics.overtake_events_data;

COMMENT ON VIEW analytics.overtake_events IS
  'Phase 21 (slice 21-overtake-events): on-track overtake events from raw.overtakes. overtake_count is the session-total carried on every row so single-row "how many overtakes" answers don''t need an aggregate. location_corner is NULL until Phase 20-B f1.track_segments-corners ships.';

COMMIT;
