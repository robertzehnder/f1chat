import type { DeterministicSqlTemplate } from "./types";

/**
 * Data-health card (M18): "which sessions have telemetry but no matching
 * weather data?" Season-scoped, no session pin — runs BEFORE the session
 * gate in the router (data-health family).
 *
 * One row per session that has telemetry, with full/missing status
 * columns shaped for the status_grid detector (a column whose values are
 * full/partial/missing plus a session label). Each row also carries
 * circuit_short_name + a derived season round so the status_grid detector
 * can roll the sessions up into a per-VENUE coverage grid (24 mini
 * circuit outlines). Sessions missing weather sort first; the insight
 * builder reads the per-row statuses to report the gap count — including
 * the "0 gaps" case, which previously rendered as a bare "No rows
 * matched" instead of the actual answer ("full coverage").
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildTelemetryWeatherGapTemplateInput = {
  lower: string;
};

const TRIGGER_TELEMETRY = /telemetry|car data|car_data/;
const TRIGGER_WEATHER = /weather/;
const TRIGGER_GAP = /\bno\b|without|missing|gap|lack|but not|absent/;

export function buildTelemetryWeatherGapTemplate(
  input: BuildTelemetryWeatherGapTemplateInput
): DeterministicSqlTemplate | null {
  const { lower } = input;
  if (!TRIGGER_TELEMETRY.test(lower)) return null;
  if (!TRIGGER_WEATHER.test(lower)) return null;
  if (!TRIGGER_GAP.test(lower)) return null;
  const yearMatch = /\b(20\d{2})\b/.exec(lower);
  const yearFilter = yearMatch ? `AND s.year = ${Number(yearMatch[1])}` : "";

  const sql = `
    WITH tele AS (
      -- Telemetry presence via the per-driver coverage rollup, NOT
      -- raw.car_data — an unfiltered DISTINCT over the raw telemetry
      -- table is a full scan that blows the query timeout.
      SELECT DISTINCT session_key
      FROM analytics.telemetry_coverage_per_driver
      WHERE car_data_samples > 0
    ),
    wx AS (
      SELECT DISTINCT session_key FROM raw.weather
    ),
    rounds AS (
      -- No round column exists on raw.meetings, so derive it as the
      -- meeting's chronological rank within its season, letting the venue
      -- grid label each circuit R1..R24.
      SELECT
        meeting_key,
        DENSE_RANK() OVER (PARTITION BY year ORDER BY date_start, meeting_key) AS round
      FROM raw.meetings
    )
    SELECT
      s.session_key,
      s.session_name || ' · ' || s.location || ' ' || s.year AS session_label,
      'full' AS telemetry,
      CASE WHEN w.session_key IS NULL THEN 'missing' ELSE 'full' END AS weather,
      s.year,
      s.location,
      s.circuit_short_name,
      r.round,
      s.session_name AS session_name_raw
    FROM raw.sessions s
    JOIN tele t ON t.session_key = s.session_key
    LEFT JOIN wx w ON w.session_key = s.session_key
    LEFT JOIN rounds r ON r.meeting_key = s.meeting_key
    WHERE TRUE ${yearFilter}
    ORDER BY CASE WHEN w.session_key IS NULL THEN 0 ELSE 1 END, s.date_start
    LIMIT 200
  `;

  return { templateKey: "sessions_telemetry_without_weather", sql };
}
