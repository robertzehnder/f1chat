import type { DeterministicSqlTemplate } from "./types";

type BuildDataHealthTemplateInput = {
  lower: string;
  abuDhabi2025: boolean;
  includesAny: (text: string, candidates: string[]) => boolean;
};

export function buildDataHealthTemplate(ctx: BuildDataHealthTemplateInput): DeterministicSqlTemplate | null {
  const { lower, abuDhabi2025, includesAny } = ctx;
  const monaco2025 =
    lower.includes("2025") &&
    includesAny(lower, ["monaco", "monte carlo", "monte-carlo"]);

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
    monaco2025 &&
    includesAny(lower, ["coverage", "complete", "completeness"]) &&
    includesAny(lower, ["telemetry", "car data", "car_data", "location"]) &&
    includesAny(lower, ["all 20 drivers", "across all 20 drivers", "20 drivers", "all drivers"])
  ) {
    return {
      templateKey: "monaco_2025_sessions_most_complete_telemetry_coverage",
      sql: `
        WITH monaco_sessions AS (
          SELECT
            s.session_key,
            s.meeting_key,
            s.year,
            s.session_name,
            s.session_type,
            s.country_name,
            s.location,
            s.circuit_short_name,
            s.date_start
          FROM core.sessions s
          WHERE s.year = 2025
            AND (
              s.country_name ILIKE '%monaco%'
              OR s.location ILIKE '%monaco%'
              OR s.location ILIKE '%monte carlo%'
              OR s.circuit_short_name ILIKE '%monaco%'
            )
        ),
        car_drivers AS (
          SELECT DISTINCT
            cd.session_key,
            cd.driver_number
          FROM raw.car_data cd
          JOIN monaco_sessions ms
            ON ms.session_key = cd.session_key
        ),
        location_drivers AS (
          SELECT DISTINCT
            loc.session_key,
            loc.driver_number
          FROM raw.location loc
          JOIN monaco_sessions ms
            ON ms.session_key = loc.session_key
        ),
        covered_drivers AS (
          SELECT
            cd.session_key,
            cd.driver_number
          FROM car_drivers cd
          JOIN location_drivers ld
            ON ld.session_key = cd.session_key
           AND ld.driver_number = cd.driver_number
        )
        SELECT
          ms.session_key,
          ms.meeting_key,
          ms.year,
          ms.session_name,
          ms.session_type,
          ms.country_name,
          ms.location,
          ms.circuit_short_name,
          ms.date_start,
          COUNT(DISTINCT covered.driver_number) AS telemetry_complete_driver_count
        FROM monaco_sessions ms
        LEFT JOIN covered_drivers covered
          ON covered.session_key = ms.session_key
        GROUP BY
          ms.session_key,
          ms.meeting_key,
          ms.year,
          ms.session_name,
          ms.session_type,
          ms.country_name,
          ms.location,
          ms.circuit_short_name,
          ms.date_start
        ORDER BY telemetry_complete_driver_count DESC, ms.date_start DESC NULLS LAST
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

  return null;
}
