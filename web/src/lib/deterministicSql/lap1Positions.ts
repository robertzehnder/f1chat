import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair lap-1 launch card (M12) — "did A or B gain more positions
 * on the lap-1 launch?" Positions gained = grid position minus position
 * at the end of lap 1, from core.race_progression_summary +
 * core.grid_vs_finish (the LLM path used analytics.restart_performance,
 * whose position_before is NULL for lap 1, and hedged).
 *
 * Output: one row per driver with a `position_delta` column — the
 * diverging-bar detector's key (positive = positions gained).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildLap1PositionsTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

const LAP1_TRIGGER = /lap[\s-]?1\b|lap one|opening lap|launch|race start|off the line|first lap/;
const GAIN_TRIGGER = /gain|gained|lost|lose|position/;

export function buildLap1PositionsTemplate(
  input: BuildLap1PositionsTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (!LAP1_TRIGGER.test(lower)) return null;
  if (!GAIN_TRIGGER.test(lower)) return null;

  const sql = `
    WITH first_recorded AS (
      -- The progression feed logs position CHANGES — a driver with no
      -- early rows HELD their grid position (2025 Australia: the winner
      -- led from pole and first appears at lap 44). Earliest recorded
      -- lap 1-3 per driver, with absence falling back to grid below.
      SELECT DISTINCT ON (driver_number)
        driver_number,
        driver_name,
        lap_number AS measured_lap,
        position_end_of_lap
      FROM core.race_progression_summary
      WHERE session_key = ${targetSession}
        AND lap_number <= 3
        AND driver_number IN (${driverA}, ${driverB})
      ORDER BY driver_number, lap_number
    ),
    names AS (
      SELECT DISTINCT driver_number, full_name
      FROM core.session_drivers
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
    ),
    grid AS (
      SELECT DISTINCT driver_number, grid_position
      FROM core.grid_vs_finish
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
    ),
    sess AS (
      SELECT country_name, location, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    )
    SELECT
      g.driver_number,
      COALESCE(fr.driver_name, n.full_name) AS driver_name,
      g.grid_position,
      COALESCE(fr.position_end_of_lap, g.grid_position) AS lap1_position,
      COALESCE(fr.measured_lap, 1) AS measured_lap,
      (fr.position_end_of_lap IS NULL) AS inferred_hold,
      (g.grid_position - COALESCE(fr.position_end_of_lap, g.grid_position)) AS position_delta,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM grid g
    LEFT JOIN first_recorded fr USING (driver_number)
    LEFT JOIN names n USING (driver_number)
    ORDER BY CASE WHEN g.driver_number = ${driverA} THEN 0 ELSE 1 END
  `;

  return { templateKey: "driver_pair_lap1_positions", sql };
}
