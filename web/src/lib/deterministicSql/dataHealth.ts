import type { DeterministicSqlTemplate } from "./types";

type BuildDataHealthTemplateInput = {
  lower: string;
  abuDhabi2025: boolean;
  includesAny: (text: string, candidates: string[]) => boolean;
};

export function buildDataHealthTemplate(ctx: BuildDataHealthTemplateInput): DeterministicSqlTemplate | null {
  const { lower, abuDhabi2025, includesAny } = ctx;

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

  return null;
}
