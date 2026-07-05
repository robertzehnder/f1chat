import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair season performance radar (M17) — "where does A's edge over
 * B come from — qualifying axis or race-pace axis?" Sources the 7-axis
 * season scores from analytics.driver_performance_score (season grain, no
 * session needed — this template runs BEFORE the session gate in the
 * router, like the data-health templates).
 *
 * Output: one row per driver with the 7 `_axis` columns — exactly the
 * shape the radar detector keys on (≥3 columns ending in `_axis`).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildPerformanceRadarTemplateInput = {
  lower: string;
  driverA: number | undefined;
  driverB: number | undefined;
};

const RADAR_TRIGGER =
  /\b(?:7|seven)[\s-]?axis\b|\baxis\b|driver (?:score|rating)|performance (?:profile|radar|score)|edge over/;

export function buildPerformanceRadarTemplate(
  input: BuildPerformanceRadarTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (!RADAR_TRIGGER.test(lower)) return null;
  const yearMatch = /\b(20\d{2})\b/.exec(lower);
  if (!yearMatch) return null;
  const seasonYear = Number(yearMatch[1]);

  const sql = `
    SELECT
      driver_number,
      driver_name,
      team_name,
      season_year,
      ROUND(qualifying_axis::numeric, 1) AS qualifying_axis,
      ROUND(race_pace_axis::numeric, 1) AS race_pace_axis,
      ROUND(tyre_management_axis::numeric, 1) AS tyre_management_axis,
      ROUND(restart_axis::numeric, 1) AS restart_axis,
      ROUND(traffic_handling_axis::numeric, 1) AS traffic_handling_axis,
      ROUND(overtake_difficulty_axis::numeric, 1) AS overtake_difficulty_axis,
      ROUND(error_rate_axis::numeric, 1) AS error_rate_axis
    FROM analytics.driver_performance_score
    WHERE season_year = ${seasonYear}
      AND driver_number IN (${driverA}, ${driverB})
    ORDER BY CASE WHEN driver_number = ${driverA} THEN 0 ELSE 1 END
  `;

  return { templateKey: "driver_pair_performance_radar", sql };
}
