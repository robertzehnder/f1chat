-- Deploy openf1:052_analytics_year_unlock to pg
-- requires: 051_analytics_traction_braking
--
-- 2026 season backfill (2026-07-12): the five telemetry matviews were
-- created with a hard "s.year = 2025" scope to bound Neon build cost.
-- Raw 2026 telemetry (car_data/location, rounds 1-9) is now ingested,
-- so rebuild each with "s.year >= 2025" — rolls forward automatically
-- for future seasons while keeping the heavy 2023/2024 history out.
-- Definitions are otherwise verbatim from 045/049/050/051.

BEGIN;

-- ── analytics.driver_performance_score_data (from 045) ──
DROP MATERIALIZED VIEW IF EXISTS analytics.driver_performance_score_data CASCADE;
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.driver_performance_score_data AS
WITH season_drivers AS (
  -- Drivers active in the season (have at least one race session row)
  SELECT DISTINCT
    s.year                      AS season_year,
    sd.driver_number,
    MAX(sd.full_name)           AS driver_name,
    MAX(sd.team_name)           AS team_name
  FROM core.session_drivers sd
  JOIN core.sessions s ON s.session_key = sd.session_key
  WHERE s.year >= 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
  GROUP BY s.year, sd.driver_number
),
-- Per-axis raw signals
qual_axis_raw AS (
  SELECT
    s.year AS season_year,
    sg.driver_number,
    AVG(sg.grid_position::DOUBLE PRECISION) AS avg_grid_position
  FROM raw.starting_grid sg
  JOIN core.sessions s ON s.session_key = sg.session_key
  WHERE s.year >= 2025
    AND s.session_name = 'Race'
    AND sg.grid_position IS NOT NULL
  GROUP BY s.year, sg.driver_number
),
race_axis_raw AS (
  SELECT
    s.year AS season_year,
    sr.driver_number,
    AVG(sr.position::DOUBLE PRECISION) AS avg_race_position
  FROM raw.session_result sr
  JOIN core.sessions s ON s.session_key = sr.session_key
  WHERE s.year >= 2025
    AND s.session_name = 'Race'
    AND sr.position IS NOT NULL
  GROUP BY s.year, sr.driver_number
),
tyre_axis_raw AS (
  SELECT
    s.year AS season_year,
    sdc.driver_number,
    AVG(sdc.degradation_per_lap_s) AS avg_deg_s
  FROM analytics.stint_degradation_curve sdc
  JOIN core.sessions s ON s.session_key = sdc.session_key
  WHERE s.year >= 2025
    AND sdc.degradation_per_lap_s IS NOT NULL
  GROUP BY s.year, sdc.driver_number
),
restart_axis_raw AS (
  SELECT
    s.year AS season_year,
    rp.driver_number,
    AVG(rp.position_delta::DOUBLE PRECISION) AS avg_restart_delta
  FROM analytics.restart_performance rp
  JOIN core.sessions s ON s.session_key = rp.session_key
  WHERE s.year >= 2025
    AND rp.position_delta IS NOT NULL
  GROUP BY s.year, rp.driver_number
),
traffic_axis_raw AS (
  SELECT
    s.year AS season_year,
    tap.driver_number,
    AVG(tap.traffic_pace_delta_s) AS avg_traffic_delta_s
  FROM analytics.traffic_adjusted_pace tap
  JOIN core.sessions s ON s.session_key = tap.session_key
  WHERE s.year >= 2025
    AND tap.traffic_pace_delta_s IS NOT NULL
  GROUP BY s.year, tap.driver_number
),
overtake_axis_raw AS (
  SELECT
    s.year AS season_year,
    oe.overtaking_driver_number AS driver_number,
    COUNT(*) AS season_overtakes
  FROM analytics.overtake_events oe
  JOIN core.sessions s ON s.session_key = oe.session_key
  WHERE s.year >= 2025
  GROUP BY s.year, oe.overtaking_driver_number
),
error_axis_raw AS (
  SELECT
    s.year AS season_year,
    rci.driver_number,
    COUNT(*) FILTER (WHERE rci.action_status IN ('time_penalty', 'drive_through', 'grid_penalty')) AS season_penalties
  FROM analytics.race_control_incidents rci
  JOIN core.sessions s ON s.session_key = rci.session_key
  WHERE s.year >= 2025
    AND rci.driver_number IS NOT NULL
  GROUP BY s.year, rci.driver_number
)
SELECT
  sd.season_year,
  sd.driver_number,
  sd.driver_name,
  sd.team_name,
  -- qualifying_axis: lower avg_grid_position = better.
  -- Score = (21 - position) / 20 * 100, clamped 0-100.
  GREATEST(0, LEAST(100, (21.0 - COALESCE(qa.avg_grid_position, 21.0)) / 20.0 * 100.0))::DOUBLE PRECISION
    AS qualifying_axis,
  -- race_pace_axis: same shape but for race finish positions.
  GREATEST(0, LEAST(100, (21.0 - COALESCE(ra.avg_race_position, 21.0)) / 20.0 * 100.0))::DOUBLE PRECISION
    AS race_pace_axis,
  -- tyre_management_axis: lower degradation = better. Scale so
  -- 0 deg/lap = 100; 0.3 s/lap deg = 0.
  GREATEST(0, LEAST(100, (1.0 - LEAST(COALESCE(ta.avg_deg_s, 0.3), 0.3) / 0.3) * 100.0))::DOUBLE PRECISION
    AS tyre_management_axis,
  -- restart_axis: more positions GAINED on restart = better. Negative
  -- avg_restart_delta means gained positions; map -3..+1 to 100..0.
  GREATEST(0, LEAST(100, (1.0 - LEAST(GREATEST(COALESCE(rest.avg_restart_delta, 0.0), -3.0), 1.0) / 4.0 - 0.25 + 0.25) * 100.0 / 1.0))::DOUBLE PRECISION
    AS restart_axis,
  -- traffic_handling_axis: lower traffic-pace-delta = better. 0 sec
  -- delta = 100; 3-sec delta = 0.
  GREATEST(0, LEAST(100, (1.0 - LEAST(COALESCE(tr.avg_traffic_delta_s, 3.0), 3.0) / 3.0) * 100.0))::DOUBLE PRECISION
    AS traffic_handling_axis,
  -- overtake_difficulty_axis: more overtakes = higher score. 50+ = 100.
  GREATEST(0, LEAST(100, COALESCE(ov.season_overtakes, 0) * 2.0))::DOUBLE PRECISION
    AS overtake_difficulty_axis,
  -- error_rate_axis: fewer penalties = higher score. 0 = 100; 10+ = 0.
  GREATEST(0, LEAST(100, (10.0 - LEAST(COALESCE(er.season_penalties, 0), 10)) * 10.0))::DOUBLE PRECISION
    AS error_rate_axis,
  -- helpful raw aggregates surfaced for transparency
  qa.avg_grid_position,
  ra.avg_race_position,
  ta.avg_deg_s,
  rest.avg_restart_delta,
  tr.avg_traffic_delta_s,
  COALESCE(ov.season_overtakes, 0) AS season_overtakes,
  COALESCE(er.season_penalties, 0) AS season_penalties
FROM season_drivers sd
LEFT JOIN qual_axis_raw     qa   ON qa.season_year   = sd.season_year AND qa.driver_number   = sd.driver_number
LEFT JOIN race_axis_raw     ra   ON ra.season_year   = sd.season_year AND ra.driver_number   = sd.driver_number
LEFT JOIN tyre_axis_raw     ta   ON ta.season_year   = sd.season_year AND ta.driver_number   = sd.driver_number
LEFT JOIN restart_axis_raw  rest ON rest.season_year = sd.season_year AND rest.driver_number = sd.driver_number
LEFT JOIN traffic_axis_raw  tr   ON tr.season_year   = sd.season_year AND tr.driver_number   = sd.driver_number
LEFT JOIN overtake_axis_raw ov   ON ov.season_year   = sd.season_year AND ov.driver_number   = sd.driver_number
LEFT JOIN error_axis_raw    er   ON er.season_year   = sd.season_year AND er.driver_number   = sd.driver_number;

CREATE UNIQUE INDEX IF NOT EXISTS driver_performance_score_data_pk
  ON analytics.driver_performance_score_data (season_year, driver_number);

CREATE INDEX IF NOT EXISTS driver_performance_score_data_year_idx
  ON analytics.driver_performance_score_data (season_year);

CREATE OR REPLACE VIEW analytics.driver_performance_score AS
SELECT * FROM analytics.driver_performance_score_data;

COMMENT ON VIEW analytics.driver_performance_score IS
  'Phase 21 Tier 4 (slice 21-driver-performance-7axis): per-(season, driver) seven-axis performance score. Each axis is a 0-100 derived score (higher = better). qualifying_axis uses avg grid position; race_pace_axis uses avg race-finish position; tyre_management_axis is the inverse of avg stint_degradation_curve.degradation_per_lap_s; restart_axis is the inverse of avg restart_performance.position_delta; traffic_handling_axis is the inverse of avg traffic_adjusted_pace.traffic_pace_delta_s; overtake_difficulty_axis = season_overtakes * 2 (capped at 100); error_rate_axis = (10 - season_penalties) * 10. Helpful raw aggregates surfaced for transparency.';

-- ── analytics.corner_analysis_data (from 049) ──
DROP MATERIALIZED VIEW IF EXISTS analytics.corner_analysis_data CASCADE;

CREATE MATERIALIZED VIEW analytics.corner_analysis_data AS
WITH circuit_alias AS (
  SELECT 'Monte Carlo'::text         AS sessions_name, 'Monaco'::text         AS segments_name UNION ALL
  SELECT 'Yas Marina Circuit'::text, 'Yas Marina'::text                                         UNION ALL
  SELECT 'Hungaroring'::text,        'Hungaroring'::text                                        UNION ALL
  SELECT 'Imola'::text,              'Imola'::text                                              UNION ALL
  SELECT 'Jeddah'::text,             'Jeddah'::text                                             UNION ALL
  SELECT 'Monza'::text,              'Monza'::text                                              UNION ALL
  SELECT 'Sakhir'::text,             'Sakhir'::text                                             UNION ALL
  SELECT 'Silverstone'::text,        'Silverstone'::text                                        UNION ALL
  SELECT 'Spa-Francorchamps'::text,  'Spa-Francorchamps'::text                                  UNION ALL
  SELECT 'Suzuka'::text,             'Suzuka'::text
),
eligible_sessions AS (
  SELECT s.session_key, ca.segments_name AS circuit_short_name
  FROM core.sessions s
  JOIN circuit_alias ca ON ca.sessions_name = s.circuit_short_name
  WHERE s.year >= 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
),
corners AS (
  SELECT
    es.session_key,
    es.circuit_short_name,
    ts.id            AS corner_id,
    ts.segment_index AS corner_number,
    ts.segment_label AS corner_label,
    ts.start_normalized,
    ts.end_normalized
  FROM eligible_sessions es
  JOIN f1.track_segments ts
    ON ts.circuit_short_name = es.circuit_short_name
   AND ts.segment_kind = 'corner'
),
samples_in_corner_zone AS (
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    cdlp.speed,
    cdlp.time_fraction,
    c.corner_id,
    c.corner_number,
    c.corner_label,
    c.start_normalized,
    c.end_normalized
  FROM core.car_data_lap_position cdlp
  JOIN corners c
    ON c.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= GREATEST(0.0, c.start_normalized - 0.015)
   AND cdlp.time_fraction <= LEAST(1.0, c.end_normalized + 0.015)
  WHERE cdlp.speed IS NOT NULL
)
SELECT
  scz.session_key,
  scz.driver_number,
  MAX(rd.full_name)            AS driver_name,
  MAX(rd.team_name)            AS team_name,
  scz.lap_number,
  scz.corner_id,
  scz.corner_number,
  MAX(scz.corner_label)        AS corner_label,
  MAX(scz.start_normalized)    AS start_normalized,
  MAX(scz.end_normalized)      AS end_normalized,
  MAX(scz.speed) FILTER (
    WHERE scz.time_fraction >= GREATEST(0.0, scz.start_normalized - 0.01)
      AND scz.time_fraction <= scz.start_normalized + 0.005
  )::DOUBLE PRECISION                   AS entry_speed_kph,
  MIN(scz.speed) FILTER (
    WHERE scz.time_fraction >= scz.start_normalized
      AND scz.time_fraction <= scz.end_normalized
  )::DOUBLE PRECISION                   AS apex_min_speed_kph,
  MAX(scz.speed) FILTER (
    WHERE scz.time_fraction >= scz.end_normalized - 0.005
      AND scz.time_fraction <= LEAST(1.0, scz.end_normalized + 0.01)
  )::DOUBLE PRECISION                   AS exit_speed_kph,
  COUNT(*)                              AS sample_count
FROM samples_in_corner_zone scz
LEFT JOIN raw.drivers rd
  ON rd.session_key   = scz.session_key
 AND rd.driver_number = scz.driver_number
GROUP BY scz.session_key, scz.driver_number, scz.lap_number, scz.corner_id, scz.corner_number;

CREATE INDEX IF NOT EXISTS corner_analysis_data_session_idx
  ON analytics.corner_analysis_data (session_key);

CREATE INDEX IF NOT EXISTS corner_analysis_data_driver_idx
  ON analytics.corner_analysis_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS corner_analysis_data_corner_idx
  ON analytics.corner_analysis_data (session_key, corner_id);

CREATE OR REPLACE VIEW analytics.corner_analysis AS
SELECT * FROM analytics.corner_analysis_data;

COMMENT ON VIEW analytics.corner_analysis IS
  'Phase 21 (slice 21-corner-analysis): per-(session, driver, lap, corner_id) entry / apex / exit speeds. Filter session_key + driver_number + corner_label for "what was X driver''s apex speed at Turn N?" answers. Time-fraction approximation may slightly overestimate corner-sample counts vs spatially-normalized arc-length; first-cut accurate at named-corner level. Circuit-alias CTE handles core.sessions vs f1.track_segments naming differences (Monte Carlo / Monaco; Yas Marina Circuit / Yas Marina).';

-- ── analytics.minisector_dominance_data (from 050) ──
DROP MATERIALIZED VIEW IF EXISTS analytics.minisector_dominance_data CASCADE;
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.minisector_dominance_data AS
WITH circuit_alias AS (
  SELECT 'Monte Carlo'::text         AS sessions_name, 'Monaco'::text         AS segments_name UNION ALL
  SELECT 'Yas Marina Circuit'::text, 'Yas Marina'::text                                         UNION ALL
  SELECT 'Hungaroring'::text,        'Hungaroring'::text                                        UNION ALL
  SELECT 'Imola'::text,              'Imola'::text                                              UNION ALL
  SELECT 'Jeddah'::text,             'Jeddah'::text                                             UNION ALL
  SELECT 'Monza'::text,              'Monza'::text                                              UNION ALL
  SELECT 'Sakhir'::text,             'Sakhir'::text                                             UNION ALL
  SELECT 'Silverstone'::text,        'Silverstone'::text                                        UNION ALL
  SELECT 'Spa-Francorchamps'::text,  'Spa-Francorchamps'::text                                  UNION ALL
  SELECT 'Suzuka'::text,             'Suzuka'::text
),
eligible_sessions AS (
  SELECT s.session_key, ca.segments_name AS circuit_short_name
  FROM core.sessions s
  JOIN circuit_alias ca ON ca.sessions_name = s.circuit_short_name
  WHERE s.year >= 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
),
minisectors AS (
  SELECT
    es.session_key,
    es.circuit_short_name,
    ts.id            AS minisector_id,
    ts.segment_index AS minisector_index,
    ts.start_normalized,
    ts.end_normalized
  FROM eligible_sessions es
  JOIN f1.track_segments ts
    ON ts.circuit_short_name = es.circuit_short_name
   AND ts.segment_kind = 'minisector'
),
per_lap_minisector AS (
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    m.minisector_id,
    m.minisector_index,
    AVG(cdlp.speed)::DOUBLE PRECISION AS avg_speed_kph
  FROM core.car_data_lap_position cdlp
  JOIN minisectors m
    ON m.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= m.start_normalized
   AND cdlp.time_fraction <= m.end_normalized
  WHERE cdlp.speed IS NOT NULL AND cdlp.speed > 0
  GROUP BY cdlp.session_key, cdlp.driver_number, cdlp.lap_number, m.minisector_id, m.minisector_index
),
ranked AS (
  SELECT
    *,
    RANK() OVER (PARTITION BY session_key, lap_number, minisector_id ORDER BY avg_speed_kph DESC) AS lap_rank
  FROM per_lap_minisector
)
SELECT
  ranked.session_key,
  ranked.driver_number,
  MAX(rd.full_name)              AS driver_name,
  MAX(rd.team_name)              AS team_name,
  ranked.minisector_index,
  ranked.minisector_id,
  COUNT(*)                       AS valid_lap_count,
  COUNT(*) FILTER (WHERE ranked.lap_rank = 1) AS dominant_count,
  AVG(ranked.avg_speed_kph)::DOUBLE PRECISION AS avg_speed_kph,
  MAX(ranked.avg_speed_kph)::DOUBLE PRECISION AS max_avg_speed_kph
FROM ranked
LEFT JOIN raw.drivers rd
  ON rd.session_key   = ranked.session_key
 AND rd.driver_number = ranked.driver_number
GROUP BY ranked.session_key, ranked.driver_number, ranked.minisector_index, ranked.minisector_id;

CREATE UNIQUE INDEX IF NOT EXISTS minisector_dominance_data_pk
  ON analytics.minisector_dominance_data (session_key, driver_number, minisector_id);

CREATE INDEX IF NOT EXISTS minisector_dominance_data_session_idx
  ON analytics.minisector_dominance_data (session_key);

CREATE OR REPLACE VIEW analytics.minisector_dominance AS
SELECT * FROM analytics.minisector_dominance_data;

COMMENT ON VIEW analytics.minisector_dominance IS
  'Phase 21 (slice 21-minisector-dominance): per-(session, driver, minisector) dominance count. A driver dominates a minisector on a lap when their avg-speed-in-minisector ranks 1st among drivers for that (session, lap, minisector). dominant_count = laps with rank-1 finish. valid_lap_count = laps where the driver had any speed data in the minisector. Time-fraction approximation; first-cut at named-minisector / per-sector level.';

-- ── analytics.traction_analysis_data + braking_performance_data (from 051) ──
DROP MATERIALIZED VIEW IF EXISTS analytics.traction_analysis_data CASCADE;
DROP MATERIALIZED VIEW IF EXISTS analytics.braking_performance_data CASCADE;
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.traction_analysis_data AS
WITH circuit_alias AS (
  SELECT 'Monte Carlo'::text         AS sessions_name, 'Monaco'::text         AS segments_name UNION ALL
  SELECT 'Yas Marina Circuit'::text, 'Yas Marina'::text                                         UNION ALL
  SELECT 'Hungaroring'::text,        'Hungaroring'::text                                        UNION ALL
  SELECT 'Imola'::text,              'Imola'::text                                              UNION ALL
  SELECT 'Jeddah'::text,             'Jeddah'::text                                             UNION ALL
  SELECT 'Monza'::text,              'Monza'::text                                              UNION ALL
  SELECT 'Sakhir'::text,             'Sakhir'::text                                             UNION ALL
  SELECT 'Silverstone'::text,        'Silverstone'::text                                        UNION ALL
  SELECT 'Spa-Francorchamps'::text,  'Spa-Francorchamps'::text                                  UNION ALL
  SELECT 'Suzuka'::text,             'Suzuka'::text
),
eligible_sessions AS (
  SELECT s.session_key, ca.segments_name AS circuit_short_name
  FROM core.sessions s
  JOIN circuit_alias ca ON ca.sessions_name = s.circuit_short_name
  WHERE s.year >= 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
),
corners AS (
  SELECT
    es.session_key,
    ts.id            AS corner_id,
    ts.segment_index AS corner_number,
    ts.segment_label AS corner_label,
    ts.start_normalized,
    ts.end_normalized
  FROM eligible_sessions es
  JOIN f1.track_segments ts
    ON ts.circuit_short_name = es.circuit_short_name
   AND ts.segment_kind = 'corner'
),
exit_zone_samples AS (
  -- Exit window = [end_normalized - 0.005, end_normalized + 0.020].
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    cdlp.speed,
    cdlp.throttle,
    cdlp.time_fraction,
    c.corner_id,
    c.corner_number,
    c.corner_label
  FROM core.car_data_lap_position cdlp
  JOIN corners c
    ON c.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= GREATEST(0.0, c.end_normalized - 0.005)
   AND cdlp.time_fraction <= LEAST(1.0, c.end_normalized + 0.020)
  WHERE cdlp.speed IS NOT NULL
)
SELECT
  ezs.session_key,
  ezs.driver_number,
  MAX(rd.full_name)                                  AS driver_name,
  MAX(rd.team_name)                                  AS team_name,
  ezs.corner_id,
  ezs.corner_number,
  MAX(ezs.corner_label)                              AS corner_label,
  MAX(ezs.speed)::DOUBLE PRECISION                   AS exit_speed_kph,
  AVG(ezs.throttle)::DOUBLE PRECISION                AS avg_exit_throttle_pct,
  100.0 * COUNT(*) FILTER (WHERE ezs.throttle > 90)::DOUBLE PRECISION
    / NULLIF(COUNT(*), 0)::DOUBLE PRECISION          AS exit_throttle_application_pct,
  COUNT(DISTINCT ezs.lap_number)                     AS valid_lap_count,
  COUNT(*)                                           AS sample_count
FROM exit_zone_samples ezs
LEFT JOIN raw.drivers rd
  ON rd.session_key   = ezs.session_key
 AND rd.driver_number = ezs.driver_number
GROUP BY ezs.session_key, ezs.driver_number, ezs.corner_id, ezs.corner_number;

CREATE INDEX IF NOT EXISTS traction_analysis_data_session_idx
  ON analytics.traction_analysis_data (session_key);
CREATE INDEX IF NOT EXISTS traction_analysis_data_driver_idx
  ON analytics.traction_analysis_data (session_key, driver_number);

CREATE OR REPLACE VIEW analytics.traction_analysis AS
SELECT * FROM analytics.traction_analysis_data;

COMMENT ON VIEW analytics.traction_analysis IS
  'Phase 21 (slice 21-traction-analysis): per-(session, driver, corner) corner-exit traction metrics. exit_throttle_application_pct = % of exit-zone samples on throttle > 90; exit_speed_kph = MAX(speed) in exit window. Time-fraction approximation; first-cut at named-corner level.';


CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.braking_performance_data AS
WITH circuit_alias AS (
  SELECT 'Monte Carlo'::text         AS sessions_name, 'Monaco'::text         AS segments_name UNION ALL
  SELECT 'Yas Marina Circuit'::text, 'Yas Marina'::text                                         UNION ALL
  SELECT 'Hungaroring'::text,        'Hungaroring'::text                                        UNION ALL
  SELECT 'Imola'::text,              'Imola'::text                                              UNION ALL
  SELECT 'Jeddah'::text,             'Jeddah'::text                                             UNION ALL
  SELECT 'Monza'::text,              'Monza'::text                                              UNION ALL
  SELECT 'Sakhir'::text,             'Sakhir'::text                                             UNION ALL
  SELECT 'Silverstone'::text,        'Silverstone'::text                                        UNION ALL
  SELECT 'Spa-Francorchamps'::text,  'Spa-Francorchamps'::text                                  UNION ALL
  SELECT 'Suzuka'::text,             'Suzuka'::text
),
eligible_sessions AS (
  SELECT s.session_key, ca.segments_name AS circuit_short_name
  FROM core.sessions s
  JOIN circuit_alias ca ON ca.sessions_name = s.circuit_short_name
  WHERE s.year >= 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
),
corners AS (
  SELECT
    es.session_key,
    ts.id            AS corner_id,
    ts.segment_index AS corner_number,
    ts.segment_label AS corner_label,
    ts.start_normalized,
    ts.end_normalized
  FROM eligible_sessions es
  JOIN f1.track_segments ts
    ON ts.circuit_short_name = es.circuit_short_name
   AND ts.segment_kind = 'corner'
),
brake_zone_samples AS (
  -- Entry / brake-zone window = [start_normalized - 0.020,
  -- start_normalized + 0.005]. Captures the deceleration phase.
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    cdlp.speed,
    cdlp.brake,
    cdlp.time_fraction,
    c.corner_id,
    c.corner_number,
    c.corner_label
  FROM core.car_data_lap_position cdlp
  JOIN corners c
    ON c.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= GREATEST(0.0, c.start_normalized - 0.020)
   AND cdlp.time_fraction <= LEAST(1.0, c.start_normalized + 0.005)
  WHERE cdlp.speed IS NOT NULL
)
SELECT
  bzs.session_key,
  bzs.driver_number,
  MAX(rd.full_name)                                          AS driver_name,
  MAX(rd.team_name)                                          AS team_name,
  bzs.corner_id,
  bzs.corner_number,
  MAX(bzs.corner_label)                                      AS corner_label,
  MAX(bzs.speed)::DOUBLE PRECISION                           AS approach_speed_kph,
  MIN(bzs.speed)::DOUBLE PRECISION                           AS min_brake_zone_speed_kph,
  (MAX(bzs.speed) - MIN(bzs.speed))::DOUBLE PRECISION        AS brake_zone_speed_drop_kph,
  MAX(bzs.brake)::DOUBLE PRECISION                           AS peak_brake_pressure_pct,
  AVG(bzs.brake)::DOUBLE PRECISION                           AS avg_brake_pressure_pct,
  COUNT(DISTINCT bzs.lap_number)                             AS valid_lap_count,
  COUNT(*)                                                   AS sample_count
FROM brake_zone_samples bzs
LEFT JOIN raw.drivers rd
  ON rd.session_key   = bzs.session_key
 AND rd.driver_number = bzs.driver_number
GROUP BY bzs.session_key, bzs.driver_number, bzs.corner_id, bzs.corner_number;

CREATE INDEX IF NOT EXISTS braking_performance_data_session_idx
  ON analytics.braking_performance_data (session_key);
CREATE INDEX IF NOT EXISTS braking_performance_data_driver_idx
  ON analytics.braking_performance_data (session_key, driver_number);

CREATE OR REPLACE VIEW analytics.braking_performance AS
SELECT * FROM analytics.braking_performance_data;

COMMENT ON VIEW analytics.braking_performance IS
  'Phase 21 (slice 21-braking-performance): per-(session, driver, corner) brake-zone metrics. brake_zone_speed_drop_kph = approach_speed minus min-brake-zone-speed. peak_brake_pressure_pct = MAX(brake) in entry window. Time-fraction approximation; first-cut at named-corner level.';

COMMIT;
