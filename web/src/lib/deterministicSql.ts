import type { DeterministicSqlTemplate } from "./deterministicSql/types";
export type { DeterministicSqlTemplate } from "./deterministicSql/types";
import { buildPaceTemplate } from "./deterministicSql/pace";
import { buildStrategyTemplate } from "./deterministicSql/strategy";
export { buildStrategyTemplate } from "./deterministicSql/strategy";
import { buildResultTemplate } from "./deterministicSql/result";
export { buildResultTemplate } from "./deterministicSql/result";
import { buildTelemetryTemplate } from "./deterministicSql/telemetry";

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

  const pace = buildPaceTemplate({
    lower,
    targetSession,
    driverPairSql,
    hasComparisonLanguage,
    driverNumbers: context.driverNumbers,
    mentionsMax,
    mentionsLeclerc,
    normalizeInt,
    includesAny,
    MAX_VERSTAPPEN,
    CHARLES_LECLERC,
  });
  if (pace) return pace;

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

  const telemetry = buildTelemetryTemplate({
    lower,
    targetSession,
    driverPairSql,
    includesAny,
  });
  if (telemetry) return telemetry;

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

  const strategy = buildStrategyTemplate({
    lower,
    targetSession,
    driverPairSql,
    includesAny,
  });
  if (strategy) return strategy;

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

  const result = buildResultTemplate({
    lower,
    targetSession,
    driverPairSql,
    includesAny,
  });
  if (result) return result;

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

  return null;
}
