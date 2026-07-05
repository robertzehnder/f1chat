CREATE OR REPLACE VIEW core.lap_semantic_bridge AS
 WITH lap_base AS (
         SELECT l.session_key,
            l.meeting_key,
            s.year,
            s.session_name,
            s.session_type,
            s.country_name,
            s.location,
            s.circuit_short_name,
            s.date_start AS session_date_start,
            l.driver_number,
            d.full_name AS driver_name,
            d.team_name,
            l.lap_number,
            l.lap_duration,
            l.duration_sector_1,
            l.duration_sector_2,
            l.duration_sector_3,
            l.is_pit_out_lap,
            l.date_start AS lap_start_ts,
            l.date_start + COALESCE(NULLIF(l.lap_duration, 0::double precision), 120::double precision) * '00:00:01'::interval AS lap_end_ts,
            st.stint_number,
            st.compound AS compound_raw,
            ca.normalized_compound,
            COALESCE(ca.is_slick, false) AS is_slick,
            st.tyre_age_at_start,
                CASE
                    WHEN st.lap_start IS NULL OR l.lap_number IS NULL THEN NULL::integer
                    ELSE COALESCE(st.tyre_age_at_start, 0) + (l.lap_number - st.lap_start)
                END AS tyre_age_on_lap,
            p.pit_duration,
            p.id IS NOT NULL AS is_pit_lap
           FROM raw.laps l
             JOIN raw.sessions s ON s.session_key = l.session_key
             LEFT JOIN raw.drivers d ON d.session_key = l.session_key AND d.driver_number = l.driver_number
             LEFT JOIN LATERAL (SELECT st2.* FROM raw.stints st2 WHERE st2.session_key = l.session_key AND st2.driver_number = l.driver_number AND l.lap_number >= st2.lap_start AND l.lap_number <= st2.lap_end ORDER BY st2.stint_number ASC LIMIT 1) st ON true
             LEFT JOIN core.compound_alias_lookup ca ON upper(btrim(COALESCE(st.compound, 'UNKNOWN'::text))) = ca.raw_compound
             LEFT JOIN raw.pit p ON p.session_key = l.session_key AND p.driver_number = l.driver_number AND p.lap_number = l.lap_number
        ), lap_with_position AS (
         SELECT b_1.session_key,
            b_1.meeting_key,
            b_1.year,
            b_1.session_name,
            b_1.session_type,
            b_1.country_name,
            b_1.location,
            b_1.circuit_short_name,
            b_1.session_date_start,
            b_1.driver_number,
            b_1.driver_name,
            b_1.team_name,
            b_1.lap_number,
            b_1.lap_duration,
            b_1.duration_sector_1,
            b_1.duration_sector_2,
            b_1.duration_sector_3,
            b_1.is_pit_out_lap,
            b_1.lap_start_ts,
            b_1.lap_end_ts,
            b_1.stint_number,
            b_1.compound_raw,
            b_1.normalized_compound,
            b_1.is_slick,
            b_1.tyre_age_at_start,
            b_1.tyre_age_on_lap,
            b_1.pit_duration,
            b_1.is_pit_lap,
            ph."position" AS position_end_of_lap
           FROM lap_base b_1
             LEFT JOIN LATERAL ( SELECT ph_1."position"
                   FROM raw.position_history ph_1
                  WHERE ph_1.session_key = b_1.session_key AND ph_1.driver_number = b_1.driver_number AND b_1.lap_start_ts IS NOT NULL AND ph_1.date >= b_1.lap_start_ts AND ph_1.date < b_1.lap_end_ts
                  ORDER BY ph_1.date DESC
                 LIMIT 1) ph ON true
        ), lap_with_flag AS (
         SELECT b_1.session_key,
            b_1.meeting_key,
            b_1.year,
            b_1.session_name,
            b_1.session_type,
            b_1.country_name,
            b_1.location,
            b_1.circuit_short_name,
            b_1.session_date_start,
            b_1.driver_number,
            b_1.driver_name,
            b_1.team_name,
            b_1.lap_number,
            b_1.lap_duration,
            b_1.duration_sector_1,
            b_1.duration_sector_2,
            b_1.duration_sector_3,
            b_1.is_pit_out_lap,
            b_1.lap_start_ts,
            b_1.lap_end_ts,
            b_1.stint_number,
            b_1.compound_raw,
            b_1.normalized_compound,
            b_1.is_slick,
            b_1.tyre_age_at_start,
            b_1.tyre_age_on_lap,
            b_1.pit_duration,
            b_1.is_pit_lap,
            b_1.position_end_of_lap,
            rc.flag AS track_flag
           FROM lap_with_position b_1
             LEFT JOIN LATERAL ( SELECT rc_1.flag
                   FROM raw.race_control rc_1
                  WHERE rc_1.session_key = b_1.session_key AND rc_1.date <= COALESCE(b_1.lap_end_ts, b_1.lap_start_ts, b_1.session_date_start)
                  ORDER BY rc_1.date DESC
                 LIMIT 1) rc ON true
        )
 SELECT session_key,
    meeting_key,
    year,
    session_name,
    session_type,
    country_name,
    location,
    circuit_short_name,
    session_date_start,
    driver_number,
    driver_name,
    team_name,
    lap_number,
    lap_duration,
    duration_sector_1,
    duration_sector_2,
    duration_sector_3,
    is_pit_out_lap,
    lap_start_ts,
    lap_end_ts,
    stint_number,
    compound_raw,
    normalized_compound,
    is_slick,
    tyre_age_at_start,
    tyre_age_on_lap,
    pit_duration,
    is_pit_lap,
    position_end_of_lap,
    track_flag,
    min(lap_duration) FILTER (WHERE lap_duration > 0::double precision AND COALESCE(is_pit_out_lap, false) = false) OVER (PARTITION BY session_key, driver_number) AS best_driver_lap,
    lap_duration IS NOT NULL AND lap_duration > 0::double precision AND lap_duration = min(lap_duration) FILTER (WHERE lap_duration > 0::double precision AND COALESCE(is_pit_out_lap, false) = false) OVER (PARTITION BY session_key, driver_number) AS is_personal_best_proxy
   FROM lap_with_flag b;
