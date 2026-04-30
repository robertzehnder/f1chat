import type { DeterministicSqlTemplate } from "./types";

type BuildPaceTemplateInput = {
  lower: string;
  targetSession: number;
  driverPairSql: string | undefined;
  hasComparisonLanguage: boolean;
  driverNumbers: number[] | undefined;
  mentionsMax: boolean;
  mentionsLeclerc: boolean;
  normalizeInt: (value: unknown) => number | undefined;
  includesAny: (text: string, candidates: string[]) => boolean;
  MAX_VERSTAPPEN: number;
  CHARLES_LECLERC: number;
};

export function buildPaceTemplate(input: BuildPaceTemplateInput): DeterministicSqlTemplate | null {
  const {
    lower,
    targetSession,
    driverPairSql,
    hasComparisonLanguage,
    driverNumbers,
    mentionsMax,
    mentionsLeclerc,
    normalizeInt,
    includesAny,
    MAX_VERSTAPPEN,
    CHARLES_LECLERC,
  } = input;

  const mentionsPractice = includesAny(lower, [
    "practice",
    "practices",
    "fp1",
    "fp2",
    "fp3",
    "free practice"
  ]);
  const mentionsRacePaceComparison = includesAny(lower, [
    "race pace",
    "representative race",
    "matched",
    "best matched",
    "closest",
    "compare",
    "comparison",
    "against the race",
    "against his race",
    "against her race",
    "vs race",
    "versus race",
    "relative to race",
    "delta to race",
    "similar to race"
  ]);

  let practiceVsRaceDriver: number | undefined;
  if (driverNumbers?.length === 1) {
    practiceVsRaceDriver = normalizeInt(driverNumbers[0]);
  } else if (mentionsMax && !mentionsLeclerc) {
    practiceVsRaceDriver = MAX_VERSTAPPEN;
  } else if (mentionsLeclerc && !mentionsMax) {
    practiceVsRaceDriver = CHARLES_LECLERC;
  } else if (driverNumbers?.length) {
    practiceVsRaceDriver = normalizeInt(driverNumbers[0]);
  }

  if (mentionsPractice && mentionsRacePaceComparison && practiceVsRaceDriver !== undefined) {
    return {
      templateKey: "practice_laps_vs_race_pace_same_meeting",
      sql: `
        WITH anchor AS (
          SELECT meeting_key
          FROM core.sessions
          WHERE session_key = ${targetSession}
          LIMIT 1
        ),
        race_sess AS (
          SELECT s.session_key, s.session_name, s.session_type
          FROM core.sessions s
          JOIN anchor a ON s.meeting_key = a.meeting_key
          WHERE (
              s.session_name ILIKE '%Race%'
              OR s.session_type ILIKE '%race%'
            )
            AND s.session_name NOT ILIKE '%sprint%'
          ORDER BY
            CASE
              WHEN s.session_name ILIKE 'Race' OR s.session_name ILIKE '% Grand Prix%' THEN 0
              ELSE 1
            END,
            s.date_start ASC NULLS LAST
          LIMIT 1
        ),
        practice_sessions AS (
          SELECT s.session_key, s.session_name, s.session_type, s.date_start
          FROM core.sessions s
          JOIN anchor a ON s.meeting_key = a.meeting_key
          WHERE s.session_key <> (SELECT session_key FROM race_sess)
            AND (
              s.session_type ILIKE '%practice%'
              OR upper(trim(s.session_name)) LIKE 'FP1%'
              OR upper(trim(s.session_name)) LIKE 'FP2%'
              OR upper(trim(s.session_name)) LIKE 'FP3%'
              OR s.session_name ILIKE '%Practice 1%'
              OR s.session_name ILIKE '%Practice 2%'
              OR s.session_name ILIKE '%Practice 3%'
            )
        ),
        race_target AS (
          SELECT
            dss.session_key AS race_session_key,
            MAX(dss.session_name) AS race_session_name,
            COALESCE(MAX(dss.avg_valid_lap), MAX(dss.median_valid_lap), MAX(dss.best_valid_lap)) AS race_reference_lap_s
          FROM core.driver_session_summary dss
          WHERE dss.session_key = (SELECT session_key FROM race_sess)
            AND dss.driver_number = ${practiceVsRaceDriver}
          GROUP BY dss.session_key
        ),
        practice_laps AS (
          SELECT
            le.session_key AS practice_session_key,
            ps.session_name AS practice_session_name,
            ps.session_type AS practice_session_type,
            le.lap_number,
            le.lap_duration,
            le.compound_name,
            le.tyre_age_on_lap,
            rt.race_session_key,
            rt.race_session_name,
            rt.race_reference_lap_s,
            le.lap_duration - rt.race_reference_lap_s AS delta_to_race_reference_s,
            ABS(le.lap_duration - rt.race_reference_lap_s) AS abs_delta_to_race_reference_s
          FROM core.laps_enriched le
          JOIN practice_sessions ps ON ps.session_key = le.session_key
          CROSS JOIN race_target rt
          WHERE le.driver_number = ${practiceVsRaceDriver}
            AND le.lap_duration IS NOT NULL
            AND le.lap_duration > 0
            AND COALESCE(le.is_valid, TRUE) = TRUE
            AND COALESCE(le.is_pit_out_lap, FALSE) = FALSE
            AND rt.race_reference_lap_s IS NOT NULL
        )
        SELECT
          (SELECT meeting_key FROM anchor) AS meeting_key,
          race_session_key,
          race_session_name,
          ROUND(race_reference_lap_s::numeric, 3) AS race_reference_lap_s,
          practice_session_key,
          practice_session_name,
          practice_session_type,
          lap_number,
          ROUND(lap_duration::numeric, 3) AS lap_duration_s,
          ROUND(delta_to_race_reference_s::numeric, 3) AS delta_to_race_reference_s,
          ROUND(abs_delta_to_race_reference_s::numeric, 3) AS abs_delta_s,
          compound_name,
          tyre_age_on_lap
        FROM practice_laps
        ORDER BY abs_delta_to_race_reference_s ASC, practice_session_name ASC, lap_number ASC
        LIMIT 60
      `
    };
  }

  if (lower.includes("average clean-lap pace") && driverPairSql) {
    return {
      templateKey: "max_leclerc_avg_clean_lap_pace",
      sql: `
        WITH target_laps AS (
          SELECT
            l.driver_number,
            d.full_name,
            l.lap_number,
            l.lap_duration,
            l.is_pit_out_lap
          FROM core.laps_enriched l
          JOIN core.session_drivers d
            ON d.session_key = l.session_key
           AND d.driver_number = l.driver_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.is_pit_out_lap, false) = false
        ),
        lap_stats AS (
          SELECT
            driver_number,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY lap_duration) AS q1,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY lap_duration) AS q3
          FROM target_laps
          GROUP BY driver_number
        ),
        clean_laps AS (
          SELECT t.*
          FROM target_laps t
          JOIN lap_stats s
            ON t.driver_number = s.driver_number
          WHERE t.lap_duration BETWEEN (s.q1 - 1.5 * (s.q3 - s.q1))
                                   AND (s.q3 + 1.5 * (s.q3 - s.q1))
        )
        SELECT
          driver_number,
          full_name,
          COUNT(*) AS clean_lap_count,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_clean_lap,
          ROUND(MIN(lap_duration)::numeric, 3) AS best_clean_lap,
          ROUND(STDDEV_POP(lap_duration)::numeric, 3) AS clean_lap_stddev
        FROM clean_laps
        GROUP BY driver_number, full_name
        ORDER BY avg_clean_lap ASC
      `
    };
  }

  if (lower.includes("degradation trend") && driverPairSql) {
    return {
      templateKey: "max_leclerc_lap_degradation_by_stint",
      sql: `
        WITH stint_laps AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, sd.full_name) AS full_name,
            COALESCE(l.stint_number, 0) AS stint_number,
            COALESCE(l.compound_name, 'UNKNOWN') AS compound,
            l.tyre_age_on_lap,
            l.lap_number,
            l.lap_duration
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers sd
            ON sd.session_key = l.session_key
           AND sd.driver_number = l.driver_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.is_pit_out_lap, FALSE) = FALSE
            AND COALESCE(l.stint_number, 0) > 0
        )
        SELECT
          driver_number,
          full_name,
          stint_number,
          compound,
          COUNT(*) AS laps_in_stint,
          ROUND(MIN(tyre_age_on_lap)::numeric, 3) AS tyre_age_start,
          ROUND(MAX(tyre_age_on_lap)::numeric, 3) AS tyre_age_end,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_lap,
          ROUND(REGR_SLOPE(lap_duration::numeric, COALESCE(tyre_age_on_lap, lap_number)::numeric)::numeric, 4) AS sec_per_lap_degradation
        FROM stint_laps
        GROUP BY driver_number, full_name, stint_number, compound
        ORDER BY driver_number, stint_number
      `
    };
  }

  if (lower.includes("final third") && driverPairSql) {
    return {
      templateKey: "max_leclerc_final_third_pace",
      sql: `
        WITH max_lap AS (
          SELECT MAX(lap_number) AS max_lap
          FROM core.laps_enriched
          WHERE session_key = ${targetSession}
        ),
        cutoff AS (
          SELECT FLOOR(max_lap * 2.0 / 3.0) AS cutoff_lap
          FROM max_lap
        ),
        final_third AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, d.full_name) AS full_name,
            l.lap_number,
            l.lap_duration
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers d
            ON d.session_key = l.session_key
           AND d.driver_number = l.driver_number
          CROSS JOIN cutoff c
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_number > c.cutoff_lap
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.is_pit_out_lap, false) = false
        )
        SELECT
          driver_number,
          full_name,
          COUNT(*) AS laps_in_final_third,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_lap_final_third,
          ROUND(MIN(lap_duration)::numeric, 3) AS best_lap_final_third
        FROM final_third
        GROUP BY driver_number, full_name
        ORDER BY avg_lap_final_third ASC
      `
    };
  }

  if (driverPairSql && lower.includes("same lap window")) {
    return {
      templateKey: "max_leclerc_common_lap_window_pace",
      sql: `
        WITH common_laps AS (
          SELECT lap_number
          FROM core.laps_enriched
          WHERE session_key = ${targetSession}
            AND driver_number ${driverPairSql}
            AND lap_duration IS NOT NULL
            AND lap_duration > 0
            AND COALESCE(is_valid, TRUE) = TRUE
          GROUP BY lap_number
          HAVING COUNT(DISTINCT driver_number) = 2
        ),
        lap_data AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, d.full_name) AS full_name,
            l.lap_number,
            l.lap_duration
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers d
            ON d.session_key = l.session_key
           AND d.driver_number = l.driver_number
          JOIN common_laps c
            ON c.lap_number = l.lap_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
        )
        SELECT
          driver_number,
          full_name,
          MIN(lap_number) AS first_common_lap,
          MAX(lap_number) AS last_common_lap,
          COUNT(*) AS common_laps_count,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_common_lap
        FROM lap_data
        GROUP BY driver_number, full_name
        ORDER BY avg_common_lap ASC
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["undercut", "overcut"])) {
    return {
      templateKey: "max_leclerc_pre_post_pit_pace",
      sql: `
        WITH pit_events AS (
          SELECT
            ss.session_key,
            ss.driver_number,
            ss.driver_name AS full_name,
            pl.lap_number AS pit_lap
          FROM core.strategy_summary ss
          JOIN LATERAL UNNEST(COALESCE(ss.pit_laps, ARRAY[]::integer[])) AS pl(lap_number)
            ON TRUE
          WHERE ss.session_key = ${targetSession}
            AND ss.driver_number ${driverPairSql}
        ),
        pace_windows AS (
          SELECT
            pe.driver_number,
            pe.full_name,
            pe.pit_lap,
            ROUND(AVG(le.lap_duration) FILTER (
              WHERE le.lap_number BETWEEN pe.pit_lap - 3 AND pe.pit_lap - 1
                AND le.lap_duration IS NOT NULL
                AND le.lap_duration > 0
                AND COALESCE(le.is_valid, TRUE) = TRUE
            )::numeric, 3) AS pre_avg_lap,
            ROUND(AVG(le.lap_duration) FILTER (
              WHERE le.lap_number BETWEEN pe.pit_lap + 1 AND pe.pit_lap + 3
                AND le.lap_duration IS NOT NULL
                AND le.lap_duration > 0
                AND COALESCE(le.is_valid, TRUE) = TRUE
            )::numeric, 3) AS post_avg_lap,
            ROUND(AVG(lc.avg_valid_lap_on_number) FILTER (
              WHERE lc.lap_number BETWEEN pe.pit_lap - 3 AND pe.pit_lap - 1
            )::numeric, 3) AS pre_window_context_avg_valid_lap,
            ROUND(AVG(lc.avg_valid_lap_on_number) FILTER (
              WHERE lc.lap_number BETWEEN pe.pit_lap + 1 AND pe.pit_lap + 3
            )::numeric, 3) AS post_window_context_avg_valid_lap
          FROM pit_events pe
          LEFT JOIN core.laps_enriched le
            ON le.session_key = pe.session_key
           AND le.driver_number = pe.driver_number
          LEFT JOIN core.lap_semantic_bridge lsb
            ON lsb.session_key = pe.session_key
           AND lsb.driver_number = pe.driver_number
           AND lsb.lap_number = le.lap_number
          LEFT JOIN core.lap_context_summary lc
            ON lc.session_key = pe.session_key
           AND lc.lap_number = le.lap_number
          GROUP BY pe.driver_number, pe.full_name, pe.pit_lap
        ),
        position_pairs AS (
          SELECT
            pe.driver_number,
            pe.full_name,
            pe.pit_lap,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap - 1 THEN rp.position_end_of_lap END) AS pre_pit_position,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap + 1 THEN rp.position_end_of_lap END) AS post_pit_position
          FROM pit_events pe
          LEFT JOIN core.race_progression_summary rp
            ON rp.session_key = pe.session_key
           AND rp.driver_number = pe.driver_number
          GROUP BY pe.driver_number, pe.full_name, pe.pit_lap
        ),
        combined AS (
          SELECT
            pp.driver_number,
            pp.full_name,
            pp.pit_lap,
            pp.pre_pit_position,
            pp.post_pit_position,
            pw.pre_avg_lap,
            pw.post_avg_lap,
            pw.pre_window_context_avg_valid_lap,
            pw.post_window_context_avg_valid_lap,
            CASE
              WHEN pp.pre_pit_position IS NULL OR pp.post_pit_position IS NULL THEN NULL
              ELSE pp.pre_pit_position - pp.post_pit_position
            END AS positions_gained_after_pit,
            CASE
              WHEN pw.pre_avg_lap IS NULL OR pw.post_avg_lap IS NULL THEN NULL
              ELSE pw.post_avg_lap - pw.pre_avg_lap
            END AS post_minus_pre_lap_delta
          FROM position_pairs pp
          LEFT JOIN pace_windows pw
            ON pw.driver_number = pp.driver_number
           AND pw.pit_lap = pp.pit_lap
        ),
        paired AS (
          SELECT
            a.*,
            b.driver_number AS rival_driver_number,
            b.full_name AS rival_full_name,
            b.pit_lap AS rival_pit_lap,
            CASE
              WHEN a.pre_pit_position IS NULL OR b.pre_pit_position IS NULL THEN NULL
              ELSE a.pre_pit_position - b.pre_pit_position
            END AS relative_position_delta_pre,
            CASE
              WHEN a.post_pit_position IS NULL OR b.post_pit_position IS NULL THEN NULL
              ELSE a.post_pit_position - b.post_pit_position
            END AS relative_position_delta_post
          FROM combined a
          LEFT JOIN combined b
            ON b.driver_number <> a.driver_number
        )
        SELECT
          driver_number,
          full_name,
          pit_lap,
          pre_pit_position,
          post_pit_position,
          pre_avg_lap,
          post_avg_lap,
          pre_window_context_avg_valid_lap,
          post_window_context_avg_valid_lap,
          positions_gained_after_pit,
          post_minus_pre_lap_delta,
          rival_driver_number,
          rival_full_name,
          rival_pit_lap,
          relative_position_delta_pre,
          relative_position_delta_post,
          CASE
            WHEN relative_position_delta_pre IS NULL OR relative_position_delta_post IS NULL THEN NULL
            ELSE relative_position_delta_pre - relative_position_delta_post
          END AS relative_positions_gained_vs_rival,
          CASE
            WHEN relative_position_delta_pre IS NULL OR relative_position_delta_post IS NULL THEN 'insufficient_evidence'
            WHEN (relative_position_delta_pre - relative_position_delta_post) > 0 THEN 'undercut_or_overcut_gain'
            WHEN (relative_position_delta_pre - relative_position_delta_post) < 0 THEN 'pit_cycle_loss'
            ELSE 'neutral'
          END AS undercut_overcut_signal,
          (
            pre_pit_position IS NOT NULL
            AND post_pit_position IS NOT NULL
            AND rival_driver_number IS NOT NULL
          ) AS evidence_sufficient_for_undercut_overcut_claim,
          CASE
            WHEN pre_pit_position IS NULL OR post_pit_position IS NULL THEN 'low'
            ELSE 'medium'
          END AS evidence_confidence
        FROM paired
        ORDER BY driver_number, pit_lap
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["strongest pace relative to tire age", "strongest pace relative to tyre age"])) {
    return {
      templateKey: "max_leclerc_stint_pace_vs_tire_age",
      sql: `
        WITH stint_laps AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, sd.full_name) AS full_name,
            COALESCE(l.stint_number, 0) AS stint_number,
            COALESCE(l.compound_name, 'UNKNOWN') AS compound,
            l.tyre_age_on_lap,
            l.lap_number,
            l.lap_duration
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers sd
            ON sd.session_key = l.session_key
           AND sd.driver_number = l.driver_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.is_pit_out_lap, FALSE) = FALSE
            AND COALESCE(l.stint_number, 0) > 0
        )
        SELECT
          driver_number,
          full_name,
          stint_number,
          compound,
          COUNT(*) AS laps_in_stint,
          ROUND(MIN(tyre_age_on_lap)::numeric, 3) AS tyre_age_start,
          ROUND(MAX(tyre_age_on_lap)::numeric, 3) AS tyre_age_end,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_lap,
          ROUND(REGR_SLOPE(lap_duration::numeric, COALESCE(tyre_age_on_lap, lap_number)::numeric)::numeric, 4) AS degradation_per_lap
        FROM stint_laps
        GROUP BY driver_number, full_name, stint_number, compound
        ORDER BY avg_lap ASC
      `
    };
  }

  if (driverPairSql && lower.includes("after pit stops")) {
    return {
      templateKey: "max_leclerc_post_pit_pace",
      sql: `
        WITH pit_events AS (
          SELECT
            p.driver_number,
            COALESCE(sd.full_name, CONCAT('Driver #', p.driver_number::text)) AS full_name,
            p.lap_number AS pit_lap,
            p.pit_duration
          FROM raw.pit p
          LEFT JOIN core.session_drivers sd
            ON sd.session_key = p.session_key
           AND sd.driver_number = p.driver_number
          WHERE p.session_key = ${targetSession}
            AND p.driver_number ${driverPairSql}
          GROUP BY p.driver_number, sd.full_name, p.lap_number, p.pit_duration
        ),
        post_pit_laps AS (
          SELECT
            pe.driver_number,
            pe.full_name,
            pe.pit_lap,
            pe.pit_duration,
            le.lap_number,
            le.lap_duration
          FROM pit_events pe
          JOIN core.laps_enriched le
            ON le.session_key = ${targetSession}
           AND le.driver_number = pe.driver_number
          WHERE le.lap_number BETWEEN pe.pit_lap + 1 AND pe.pit_lap + 5
            AND le.lap_duration IS NOT NULL
            AND le.lap_duration > 0
            AND COALESCE(le.is_valid, TRUE) = TRUE
        )
        SELECT
          driver_number,
          full_name,
          pit_lap,
          pit_duration,
          BOOL_OR(lap_number >= pit_lap + 1) AS is_pit_lap,
          COUNT(*) AS laps_used,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_post_pit_lap,
          ROUND(MIN(lap_duration)::numeric, 3) AS best_post_pit_lap
        FROM post_pit_laps
        GROUP BY driver_number, full_name, pit_lap, pit_duration
        ORDER BY avg_post_pit_lap ASC
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["lap pace", "compare"]) && hasComparisonLanguage) {
    return {
      templateKey: "max_leclerc_lap_pace_summary",
      sql: `
        WITH lap_data AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, d.full_name) AS full_name,
            l.lap_number,
            l.lap_duration,
            l.duration_sector_1,
            l.duration_sector_2,
            l.duration_sector_3,
            l.is_pit_out_lap
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers d
            ON d.session_key = l.session_key
           AND d.driver_number = l.driver_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
        )
        SELECT
          driver_number,
          full_name,
          COUNT(*) AS total_laps,
          ROUND(MIN(lap_duration)::numeric, 3) AS best_lap,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_lap,
          ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_duration)::numeric, 3) AS median_lap,
          ROUND(STDDEV_POP(lap_duration)::numeric, 3) AS lap_stddev
        FROM lap_data
        GROUP BY driver_number, full_name
        ORDER BY avg_lap ASC
      `
    };
  }

  return null;
}
