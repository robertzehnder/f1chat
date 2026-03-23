BEGIN;

CREATE OR REPLACE VIEW fastf1_core.session_summary AS
SELECT
    s.session_uid,
    s.year,
    s.round_number,
    s.event_name,
    s.session_name,
    s.session_type,
    s.country,
    s.location,
    s.session_date,
    COUNT(DISTINCT d.driver_number) AS driver_count,
    COUNT(l.*) AS lap_rows,
    COUNT(w.*) AS weather_rows,
    COUNT(t.*) AS telemetry_rows,
    COUNT(r.*) AS result_rows
FROM fastf1_raw.sessions s
LEFT JOIN fastf1_raw.drivers d
    ON d.session_uid = s.session_uid
LEFT JOIN fastf1_raw.laps l
    ON l.session_uid = s.session_uid
LEFT JOIN fastf1_raw.weather w
    ON w.session_uid = s.session_uid
LEFT JOIN fastf1_raw.telemetry t
    ON t.session_uid = s.session_uid
LEFT JOIN fastf1_raw.results r
    ON r.session_uid = s.session_uid
GROUP BY
    s.session_uid,
    s.year,
    s.round_number,
    s.event_name,
    s.session_name,
    s.session_type,
    s.country,
    s.location,
    s.session_date;

CREATE OR REPLACE VIEW fastf1_core.driver_session_summary AS
SELECT
    l.session_uid,
    l.driver_number,
    COUNT(*) AS lap_count,
    MIN(l.lap_time_seconds) AS best_lap_seconds,
    AVG(l.lap_time_seconds) AS avg_lap_seconds,
    MIN(l.sector1_time_seconds) AS best_sector1_seconds,
    MIN(l.sector2_time_seconds) AS best_sector2_seconds,
    MIN(l.sector3_time_seconds) AS best_sector3_seconds,
    SUM(CASE WHEN l.pit_in_time_seconds IS NOT NULL THEN 1 ELSE 0 END) AS pit_in_events,
    COUNT(DISTINCT l.stint) AS distinct_stints
FROM fastf1_raw.laps l
GROUP BY l.session_uid, l.driver_number;

COMMIT;
