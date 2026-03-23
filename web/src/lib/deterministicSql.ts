export type DeterministicSqlTemplate = {
  templateKey: string;
  sql: string;
};

type DeterministicContext = {
  sessionKey?: number;
  driverNumbers?: number[];
};

const MAX_VERSTAPPEN = 1;
const CHARLES_LECLERC = 16;

function normalizeInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.trunc(parsed);
}

function includesAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function includesAll(text: string, candidates: string[]): boolean {
  return candidates.every((candidate) => text.includes(candidate));
}

export function buildDeterministicSqlTemplate(
  message: string,
  context: DeterministicContext = {}
): DeterministicSqlTemplate | null {
  const lower = message.toLowerCase();
  const sessionKey = normalizeInt(context.sessionKey);
  const mentionsAbuDhabi = includesAny(lower, ["abu dhabi", "yas island", "yas marina"]);
  const mentions2025 = lower.includes("2025");
  const abuDhabi2025 = mentionsAbuDhabi && mentions2025;

  const mentionsMax = includesAny(lower, ["max verstappen", "verstappen"]);
  const mentionsLeclerc = includesAny(lower, ["charles leclerc", "leclerc"]);
  const isMaxVsLeclerc = mentionsMax && mentionsLeclerc;
  const hasComparisonLanguage = includesAny(lower, ["between", "compare", "vs"]);

  const resolvedDriverPair =
    context.driverNumbers?.length && context.driverNumbers.length >= 2
      ? context.driverNumbers
          .map((value) => normalizeInt(value))
          .filter((value): value is number => value !== undefined)
          .slice(0, 2)
      : [];
  const useFixedPair = isMaxVsLeclerc || (resolvedDriverPair.includes(MAX_VERSTAPPEN) && resolvedDriverPair.includes(CHARLES_LECLERC));
  const driverPairSql = useFixedPair
    ? `IN (${MAX_VERSTAPPEN}, ${CHARLES_LECLERC})`
    : resolvedDriverPair.length === 2
      ? `IN (${resolvedDriverPair[0]}, ${resolvedDriverPair[1]})`
      : undefined;

  const targetSession = sessionKey ?? (abuDhabi2025 ? 9839 : undefined);

  if (
    includesAny(lower, ["canonical ids", "canonical id", "canonical"]) &&
    abuDhabi2025 &&
    lower.includes("race")
  ) {
    return {
      templateKey: "canonical_id_lookup_abu_dhabi_2025_race",
      sql: `
        SELECT
          session_key,
          meeting_key,
          session_name,
          session_type,
          year,
          country_name,
          location,
          circuit_short_name,
          date_start,
          date_end
        FROM core.sessions
        WHERE year = 2025
          AND session_name ILIKE 'Race'
          AND (
            country_name ILIKE '%united arab emirates%'
            OR location ILIKE '%yas%'
            OR location ILIKE '%abu dhabi%'
            OR circuit_short_name ILIKE '%yas%'
          )
        ORDER BY date_start DESC
        LIMIT 10
      `
    };
  }

  if (
    lower.includes("most complete downstream data coverage") ||
    (lower.includes("most complete") && lower.includes("downstream") && lower.includes("coverage"))
  ) {
    return {
      templateKey: "sessions_most_complete_downstream_coverage",
      sql: `
        WITH coverage AS (
          SELECT
            s.session_key,
            s.meeting_key,
            s.year,
            s.session_name,
            s.country_name,
            s.location,
            s.date_start,
            CASE WHEN EXISTS (SELECT 1 FROM raw.laps l WHERE l.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_laps,
            CASE WHEN EXISTS (SELECT 1 FROM raw.car_data cd WHERE cd.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_car_data,
            CASE WHEN EXISTS (SELECT 1 FROM raw.location loc WHERE loc.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_location,
            CASE WHEN EXISTS (SELECT 1 FROM raw.pit p WHERE p.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_pit,
            CASE WHEN EXISTS (SELECT 1 FROM raw.stints st WHERE st.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_stints,
            CASE WHEN EXISTS (SELECT 1 FROM raw.weather w WHERE w.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_weather,
            CASE WHEN EXISTS (SELECT 1 FROM raw.team_radio tr WHERE tr.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_team_radio,
            CASE WHEN EXISTS (SELECT 1 FROM raw.position_history ph WHERE ph.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_position_history
          FROM core.sessions s
        )
        SELECT
          session_key,
          meeting_key,
          year,
          session_name,
          country_name,
          location,
          date_start,
          (has_laps + has_car_data + has_location + has_pit + has_stints + has_weather + has_team_radio + has_position_history) AS downstream_coverage_score,
          has_laps,
          has_car_data,
          has_location,
          has_pit,
          has_stints,
          has_weather,
          has_team_radio,
          has_position_history
        FROM coverage
        ORDER BY downstream_coverage_score DESC, date_start DESC NULLS LAST
        LIMIT 25
      `
    };
  }

  if (!targetSession) {
    return null;
  }

  if (lower.includes("who set the fastest lap")) {
    return {
      templateKey: "fastest_lap_by_driver",
      sql: `
        WITH fastest_laps AS (
          SELECT
            l.driver_number,
            MIN(l.lap_duration) AS best_lap_duration
          FROM core.laps_enriched l
          WHERE l.session_key = ${targetSession}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
          GROUP BY l.driver_number
        )
        SELECT
          fl.driver_number,
          d.full_name,
          d.team_name,
          ROUND(fl.best_lap_duration::numeric, 3) AS best_lap_duration
        FROM fastest_laps fl
        JOIN core.session_drivers d
          ON d.session_key = ${targetSession}
         AND d.driver_number = fl.driver_number
        ORDER BY fl.best_lap_duration ASC
        LIMIT 5
      `
    };
  }

  if (lower.includes("top 10") && includesAny(lower, ["fastest laps", "fastest lap"])) {
    return {
      templateKey: "top10_fastest_laps_overall",
      sql: `
        SELECT
          l.driver_number,
          d.full_name,
          d.team_name,
          l.lap_number,
          ROUND(l.lap_duration::numeric, 3) AS lap_duration
        FROM core.laps_enriched l
        JOIN core.session_drivers d
          ON d.session_key = l.session_key
         AND d.driver_number = l.driver_number
        WHERE l.session_key = ${targetSession}
          AND l.lap_duration IS NOT NULL
          AND l.lap_duration > 0
          AND COALESCE(l.is_valid, TRUE) = TRUE
        ORDER BY l.lap_duration ASC
        LIMIT 10
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

  if (
    lower.includes("qualifying") &&
    driverPairSql &&
    includesAny(lower, ["improved more", "improved the most"])
  ) {
    const qualifyingSessionSelector = sessionKey
      ? `SELECT ${sessionKey} AS session_key`
      : `
          SELECT
            session_key
          FROM core.sessions
          WHERE year = 2025
            AND (
              country_name ILIKE '%united arab emirates%'
              OR location ILIKE '%yas%'
              OR location ILIKE '%abu dhabi%'
              OR circuit_short_name ILIKE '%yas%'
            )
            AND (
              session_name ILIKE '%qualifying%'
              OR session_type ILIKE '%qualifying%'
            )
          ORDER BY date_start DESC
          LIMIT 1
        `;
    return {
      templateKey: "max_leclerc_qualifying_improvement",
      sql: `
        WITH qual_session AS (
          ${qualifyingSessionSelector}
        ),
        qual_laps AS (
          SELECT
            l.driver_number,
            d.full_name,
            l.lap_duration,
            l.lap_start_ts,
            ROW_NUMBER() OVER (PARTITION BY l.driver_number ORDER BY l.lap_start_ts ASC) AS seq_asc,
            ROW_NUMBER() OVER (PARTITION BY l.driver_number ORDER BY l.lap_start_ts DESC) AS seq_desc
          FROM core.laps_enriched l
          JOIN core.session_drivers d
            ON d.session_key = l.session_key
           AND d.driver_number = l.driver_number
          WHERE l.session_key = (SELECT session_key FROM qual_session)
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
        ),
        first_last AS (
          SELECT
            driver_number,
            full_name,
            MAX(CASE WHEN seq_asc = 1 THEN lap_duration END) AS first_timed_lap,
            MAX(CASE WHEN seq_desc = 1 THEN lap_duration END) AS last_timed_lap
          FROM qual_laps
          GROUP BY driver_number, full_name
        )
        SELECT
          (SELECT session_key FROM qual_session) AS qualifying_session_key,
          driver_number,
          full_name,
          ROUND(first_timed_lap::numeric, 3) AS first_timed_lap,
          ROUND(last_timed_lap::numeric, 3) AS last_timed_lap,
          ROUND((first_timed_lap - last_timed_lap)::numeric, 3) AS improvement_seconds
        FROM first_last
        ORDER BY improvement_seconds DESC
      `
    };
  }

  if (lower.includes("smallest spread") && includesAny(lower, ["weekend", "competitive laps"])) {
    return {
      templateKey: "abu_dhabi_weekend_smallest_spread_and_comparison",
      sql: `
        WITH abu_dhabi_sessions AS (
          SELECT
            session_key,
            session_name,
            session_type,
            date_start
          FROM core.sessions
          WHERE year = 2025
            AND (
              country_name ILIKE '%united arab emirates%'
              OR location ILIKE '%yas%'
              OR location ILIKE '%abu dhabi%'
              OR circuit_short_name ILIKE '%yas%'
            )
        ),
        competitive_laps AS (
          SELECT
            l.session_key,
            l.lap_duration
          FROM core.laps_enriched l
          JOIN abu_dhabi_sessions s
            ON s.session_key = l.session_key
          WHERE l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.is_pit_out_lap, false) = false
        ),
        lap_stats AS (
          SELECT
            session_key,
            MIN(lap_duration) AS fastest_lap,
            MAX(lap_duration) AS slowest_lap,
            MAX(lap_duration) - MIN(lap_duration) AS lap_spread,
            COUNT(*) AS lap_count
          FROM competitive_laps
          GROUP BY session_key
        ),
        best_session AS (
          SELECT
            s.session_key,
            s.session_name,
            s.session_type,
            s.date_start,
            ls.fastest_lap,
            ls.slowest_lap,
            ls.lap_spread,
            ls.lap_count
          FROM lap_stats ls
          JOIN abu_dhabi_sessions s
            ON s.session_key = ls.session_key
          ORDER BY ls.lap_spread ASC
          LIMIT 1
        ),
        driver_compare AS (
          SELECT
            l.driver_number,
            MAX(l.driver_name) AS full_name,
            AVG(l.lap_duration) AS avg_lap,
            MIN(l.lap_duration) AS best_lap
          FROM core.laps_enriched l
          WHERE l.session_key = (SELECT session_key FROM best_session)
            AND l.driver_number IN (${MAX_VERSTAPPEN}, ${CHARLES_LECLERC})
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.is_pit_out_lap, false) = false
          GROUP BY l.driver_number
        )
        SELECT
          bs.session_key,
          bs.session_name,
          bs.session_type,
          bs.date_start,
          ROUND(bs.fastest_lap::numeric, 3) AS fastest_lap,
          ROUND(bs.slowest_lap::numeric, 3) AS slowest_lap,
          ROUND(bs.lap_spread::numeric, 3) AS lap_spread,
          bs.lap_count,
          dc.driver_number,
          dc.full_name,
          ROUND(dc.avg_lap::numeric, 3) AS avg_lap,
          ROUND(dc.best_lap::numeric, 3) AS best_lap
        FROM best_session bs
        LEFT JOIN driver_compare dc
          ON TRUE
        ORDER BY dc.driver_number
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

  if (
    driverPairSql &&
    includesAny(lower, ["fastest laps for", "fastest laps for max", "which laps were the fastest laps"])
  ) {
    return {
      templateKey: "max_leclerc_fastest_lap_per_driver",
      sql: `
        WITH driver_best AS (
          SELECT
            l.driver_number,
            MIN(l.lap_duration) AS best_lap_duration
          FROM core.laps_enriched l
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
          GROUP BY l.driver_number
        )
        SELECT
          l.driver_number,
          COALESCE(l.driver_name, d.full_name) AS full_name,
          l.lap_number,
          ROUND(l.lap_duration::numeric, 3) AS lap_duration
        FROM core.laps_enriched l
        JOIN driver_best b
          ON b.driver_number = l.driver_number
         AND b.best_lap_duration = l.lap_duration
        LEFT JOIN core.session_drivers d
          ON d.session_key = l.session_key
         AND d.driver_number = l.driver_number
        WHERE l.session_key = ${targetSession}
          AND l.driver_number ${driverPairSql}
        ORDER BY l.driver_number, l.lap_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["sector 1", "sector 2", "sector 3", "sector times", "specific sector"])) {
    return {
      templateKey: "max_leclerc_sector_comparison",
      sql: `
        SELECT
          l.driver_number,
          COALESCE(l.driver_name, d.full_name) AS full_name,
          ROUND(MIN(l.duration_sector_1)::numeric, 3) AS best_s1,
          ROUND(AVG(l.duration_sector_1)::numeric, 3) AS avg_s1,
          ROUND(MIN(l.duration_sector_2)::numeric, 3) AS best_s2,
          ROUND(AVG(l.duration_sector_2)::numeric, 3) AS avg_s2,
          ROUND(MIN(l.duration_sector_3)::numeric, 3) AS best_s3,
          ROUND(AVG(l.duration_sector_3)::numeric, 3) AS avg_s3
        FROM core.laps_enriched l
        LEFT JOIN core.session_drivers d
          ON d.session_key = l.session_key
         AND d.driver_number = l.driver_number
        WHERE l.session_key = ${targetSession}
          AND l.driver_number ${driverPairSql}
          AND l.duration_sector_1 IS NOT NULL
          AND l.duration_sector_2 IS NOT NULL
          AND l.duration_sector_3 IS NOT NULL
          AND COALESCE(l.is_valid, TRUE) = TRUE
          AND COALESCE(l.is_pit_out_lap, false) = false
        GROUP BY l.driver_number, COALESCE(l.driver_name, d.full_name)
        ORDER BY l.driver_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["lap-to-lap", "lap to lap"]) && lower.includes("consistent")) {
    return {
      templateKey: "max_leclerc_lap_consistency",
      sql: `
        WITH valid_laps AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, d.full_name) AS full_name,
            l.lap_duration
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers d
            ON d.session_key = l.session_key
           AND d.driver_number = l.driver_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.is_pit_out_lap, false) = false
        )
        SELECT
          driver_number,
          full_name,
          COUNT(*) AS lap_count,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_lap,
          ROUND(STDDEV_POP(lap_duration)::numeric, 3) AS lap_stddev,
          ROUND((STDDEV_POP(lap_duration) / AVG(lap_duration) * 100)::numeric, 4) AS coeff_var_pct
        FROM valid_laps
        GROUP BY driver_number, full_name
        ORDER BY lap_stddev ASC
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["braked later", "carried more speed"])) {
    return {
      templateKey: "max_leclerc_fastest_lap_telemetry_window",
      sql: `
        WITH fastest_laps AS (
          SELECT
            l.driver_number,
            MIN(l.lap_duration) AS best_lap_time
          FROM core.laps_enriched l
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_duration IS NOT NULL
            AND l.lap_duration > 0
            AND COALESCE(l.is_valid, TRUE) = TRUE
          GROUP BY l.driver_number
        ),
        telemetry_window AS (
          SELECT
            tlb.driver_number,
            COALESCE(tlb.driver_name, sd.full_name) AS full_name,
            tlb.lap_number,
            tlb.max_speed AS max_speed_on_fastest_lap,
            tlb.first_brake_time_sec
          FROM core.telemetry_lap_bridge tlb
          JOIN fastest_laps fl
            ON fl.driver_number = tlb.driver_number
          LEFT JOIN core.session_drivers sd
            ON sd.session_key = tlb.session_key
           AND sd.driver_number = tlb.driver_number
          WHERE tlb.session_key = ${targetSession}
            AND tlb.driver_number ${driverPairSql}
            AND tlb.lap_number IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM core.laps_enriched l
              WHERE l.session_key = tlb.session_key
                AND l.driver_number = tlb.driver_number
                AND l.lap_number = tlb.lap_number
                AND l.lap_duration = fl.best_lap_time
            )
        )
        SELECT
          driver_number,
          full_name,
          lap_number,
          ROUND(MAX(max_speed_on_fastest_lap)::numeric, 3) AS max_speed_on_fastest_lap,
          ROUND(MIN(first_brake_time_sec)::numeric, 3) AS first_brake_time_sec
        FROM telemetry_window
        GROUP BY driver_number, full_name, lap_number
        ORDER BY driver_number
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

  if (driverPairSql && lower.includes("higher top speed")) {
    return {
      templateKey: "max_leclerc_top_speed",
      sql: `
        SELECT
          d.full_name,
          cd.driver_number,
          MAX(cd.speed) AS top_speed
        FROM raw.car_data cd
        JOIN raw.drivers d
          ON d.session_key = cd.session_key
         AND d.driver_number = cd.driver_number
        WHERE cd.session_key = ${targetSession}
          AND cd.driver_number ${driverPairSql}
        GROUP BY d.full_name, cd.driver_number
        ORDER BY top_speed DESC
      `
    };
  }

  if (driverPairSql && lower.includes("how many pit stops")) {
    return {
      templateKey: "max_leclerc_pit_stop_count",
      sql: `
        SELECT
          driver_name AS full_name,
          driver_number,
          pit_stop_count
        FROM core.strategy_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number
      `
    };
  }

  if (driverPairSql && lower.includes("on which laps") && lower.includes("pit")) {
    return {
      templateKey: "max_leclerc_pit_laps",
      sql: `
        SELECT
          s.driver_number,
          s.driver_name AS full_name,
          pl.lap_number,
          p.pit_duration
        FROM core.strategy_summary s
        LEFT JOIN LATERAL UNNEST(COALESCE(s.pit_laps, ARRAY[]::integer[])) AS pl(lap_number)
          ON TRUE
        LEFT JOIN raw.pit p
          ON p.session_key = s.session_key
         AND p.driver_number = s.driver_number
         AND p.lap_number = pl.lap_number
        WHERE s.session_key = ${targetSession}
          AND s.driver_number ${driverPairSql}
        ORDER BY s.driver_number, pl.lap_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["shorter stationary pit stop", "shortest stationary pit stop"])) {
    return {
      templateKey: "max_leclerc_shortest_pit_stop",
      sql: `
        SELECT
          p.driver_number,
          d.full_name,
          MIN(p.pit_duration) AS best_pit_duration
        FROM raw.pit p
        JOIN raw.drivers d
          ON d.session_key = p.session_key
         AND d.driver_number = p.driver_number
        WHERE p.session_key = ${targetSession}
          AND p.driver_number ${driverPairSql}
        GROUP BY p.driver_number, d.full_name
        ORDER BY best_pit_duration ASC
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["less total time in the pit lane", "least total time in the pit lane"])) {
    return {
      templateKey: "max_leclerc_total_pit_time",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          total_pit_duration_seconds
        FROM core.strategy_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY total_pit_duration_seconds ASC
      `
    };
  }

  if (driverPairSql && lower.includes("stint lengths")) {
    return {
      templateKey: "max_leclerc_stint_lengths",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          stint_number,
          compound_name AS compound,
          lap_start,
          lap_end,
          stint_length_laps,
          tyre_age_at_start
        FROM core.stint_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number, stint_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["tire compounds", "tyre compounds"])) {
    return {
      templateKey: "max_leclerc_compounds_used",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          stint_number,
          compound_name AS compound,
          lap_start,
          lap_end
        FROM core.stint_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number, stint_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["one-stop", "two-stop"])) {
    return {
      templateKey: "max_leclerc_strategy_type",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          total_stints,
          pit_stop_count AS pit_stops,
          strategy_type
        FROM core.strategy_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number
      `
    };
  }

  if (driverPairSql && lower.includes("pit cycle")) {
    return {
      templateKey: "max_leclerc_position_change_around_pit_cycle",
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
        pit_lap_semantics AS (
          SELECT
            lsb.session_key,
            lsb.driver_number,
            lsb.lap_number AS pit_lap,
            BOOL_OR(lsb.is_pit_lap) AS is_pit_lap
          FROM core.lap_semantic_bridge lsb
          WHERE lsb.session_key = ${targetSession}
            AND lsb.driver_number ${driverPairSql}
          GROUP BY lsb.session_key, lsb.driver_number, lsb.lap_number
        ),
        position_pairs AS (
          SELECT
            pe.driver_number,
            pe.full_name,
            pe.pit_lap,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap - 1 THEN rp.position_end_of_lap END) AS pre_pit_position,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap + 1 THEN rp.position_end_of_lap END) AS post_pit_position,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap THEN rp.previous_position END) AS previous_position,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap THEN rp.positions_gained_this_lap END) AS positions_gained_this_lap
          FROM pit_events pe
          LEFT JOIN core.race_progression_summary rp
            ON rp.session_key = pe.session_key
           AND rp.driver_number = pe.driver_number
          GROUP BY pe.driver_number, pe.full_name, pe.pit_lap
        )
        SELECT
          pp.driver_number,
          pp.full_name,
          pp.pit_lap,
          pls.is_pit_lap,
          pp.pre_pit_position,
          pp.post_pit_position,
          pp.previous_position,
          pp.positions_gained_this_lap,
          CASE
            WHEN pp.pre_pit_position IS NULL OR pp.post_pit_position IS NULL THEN NULL
            ELSE pp.pre_pit_position - pp.post_pit_position
          END AS positions_gained_after_pit,
          (
            pp.pre_pit_position IS NOT NULL
            AND pp.post_pit_position IS NOT NULL
            AND COALESCE(pls.is_pit_lap, FALSE) = TRUE
          ) AS evidence_sufficient_for_pit_cycle_claim
        FROM position_pairs pp
        LEFT JOIN pit_lap_semantics pls
          ON pls.session_key = ${targetSession}
         AND pls.driver_number = pp.driver_number
         AND pls.pit_lap = pp.pit_lap
        ORDER BY pp.driver_number, pp.pit_lap
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

  if (driverPairSql && lower.includes("opening stint") && lower.includes("closing stint")) {
    return {
      templateKey: "max_leclerc_opening_closing_stint_lengths",
      sql: `
        WITH stint_lengths AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, sd.full_name) AS full_name,
            COALESCE(l.stint_number, 0) AS stint_number,
            MIN(l.lap_number) AS lap_start,
            MAX(l.lap_number) AS lap_end
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers sd
            ON sd.session_key = l.session_key
           AND sd.driver_number = l.driver_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_number IS NOT NULL
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.stint_number, 0) > 0
          GROUP BY l.driver_number, COALESCE(l.driver_name, sd.full_name), COALESCE(l.stint_number, 0)
        ),
        ranked_stints AS (
          SELECT
            sl.*,
            ROW_NUMBER() OVER (PARTITION BY sl.driver_number ORDER BY sl.stint_number ASC) AS rn_open,
            ROW_NUMBER() OVER (PARTITION BY sl.driver_number ORDER BY sl.stint_number DESC) AS rn_close
          FROM stint_lengths sl
        ),
        opening_closing AS (
          SELECT
            driver_number,
            full_name,
            MAX(CASE WHEN rn_open = 1 THEN stint_number END) AS opening_stint_number,
            MAX(CASE WHEN rn_close = 1 THEN stint_number END) AS closing_stint_number,
            MIN(CASE WHEN rn_open = 1 THEN lap_start END) AS opening_lap_start,
            MAX(CASE WHEN rn_open = 1 THEN lap_end END) AS opening_lap_end,
            MIN(CASE WHEN rn_close = 1 THEN lap_start END) AS closing_lap_start,
            MAX(CASE WHEN rn_close = 1 THEN lap_end END) AS closing_lap_end
          FROM ranked_stints
          GROUP BY driver_number, full_name
        )
        SELECT
          driver_number,
          full_name,
          opening_stint_number,
          closing_stint_number,
          opening_lap_start,
          opening_lap_end,
          closing_lap_start,
          closing_lap_end,
          GREATEST(opening_lap_end - opening_lap_start + 1, 0) AS opening_stint_length,
          GREATEST(closing_lap_end - closing_lap_start + 1, 0) AS closing_stint_length
        FROM opening_closing
        ORDER BY driver_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["running order change", "running order"])) {
    return {
      templateKey: "max_leclerc_running_order_progression",
      sql: `
        SELECT
          lap_number,
          driver_number,
          driver_name AS full_name,
          team_name,
          position_end_of_lap AS position
        FROM core.race_progression_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY lap_number ASC, position ASC
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["gained or lost more positions", "gained or lost"])) {
    return {
      templateKey: "max_leclerc_positions_gained_or_lost",
      sql: `
        SELECT
          driver_name AS full_name,
          driver_number,
          grid_position,
          finish_position,
          positions_gained
        FROM core.grid_vs_finish
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY positions_gained DESC
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

  if (driverPairSql && includesAny(lower, ["fresh tires", "fresh tyres"])) {
    return {
      templateKey: "max_leclerc_fresh_vs_used_tires",
      sql: `
        WITH lap_buckets AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, sd.full_name) AS full_name,
            CASE
              WHEN COALESCE(l.tyre_age_on_lap, 99) <= 3 THEN 'fresh'
              ELSE 'used'
            END AS tyre_state,
            COALESCE(l.compound_name, 'UNKNOWN') AS compound_name,
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
        )
        SELECT
          driver_number,
          full_name,
          tyre_state,
          MAX(compound_name) AS compound_name,
          COUNT(*) AS lap_count,
          ROUND(AVG(lap_duration)::numeric, 3) AS avg_lap,
          ROUND(MIN(lap_duration)::numeric, 3) AS best_lap
        FROM lap_buckets
        GROUP BY driver_number, full_name, tyre_state
        ORDER BY driver_number, tyre_state
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
