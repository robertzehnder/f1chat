import type { DeterministicSqlTemplate } from "./types";

/**
 * Single-driver speed / traction map card — "where is X fastest around
 * the lap", "show X's traction zones". One summary row (fastest valid
 * lap + min/max speed over it); the per-point gradient ribbon is drawn
 * client-side from the track-outline API's telemetry channels for the
 * SAME lap (the row carries session_key + driver_number + map_channel
 * so the renderer fetches the exact reference).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildSpeedMapTemplateInput = {
  lower: string;
  targetSession: number;
  driverNumber: number | undefined;
};

const SPEED_MAP_TRIGGER =
  /speed[\s-]?map|fastest (?:parts?|sections?|portions?)|slowest (?:parts?|sections?|portions?)|where (?:is|was) \w+ (?:fastest|slowest)|speed around the (?:lap|track|circuit)/;
const TRACTION_TRIGGER =
  /traction zones?|throttle[\s-]?map|braking zones? map|full[\s-]?throttle (?:zones?|sections?|map)|flat[\s-]?out (?:zones?|sections?)|brake and throttle/;

export function buildSpeedMapTemplate(
  input: BuildSpeedMapTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverNumber } = input;
  if (driverNumber === undefined) return null;
  const traction = TRACTION_TRIGGER.test(lower);
  if (!traction && !SPEED_MAP_TRIGGER.test(lower)) return null;
  const channel = traction ? "throttle_brake" : "speed";

  const sql = `
    WITH fastest AS (
      SELECT driver_number, MAX(driver_name) AS driver_name, lap_number,
             lap_duration, lap_start_ts, lap_end_ts
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND driver_number = ${driverNumber}
        AND lap_duration IS NOT NULL
        AND COALESCE(is_valid, TRUE) = TRUE
        AND COALESCE(is_pit_lap, FALSE) = FALSE
        AND COALESCE(is_pit_out_lap, FALSE) = FALSE
        AND lap_start_ts IS NOT NULL
        AND lap_end_ts IS NOT NULL
      GROUP BY driver_number, lap_number, lap_duration, lap_start_ts, lap_end_ts
      ORDER BY lap_duration ASC
      LIMIT 1
    ),
    speeds AS (
      SELECT MAX(cd.speed) AS max_speed_kph, MIN(cd.speed) AS min_speed_kph
      FROM raw.car_data cd
      JOIN fastest f ON cd.driver_number = f.driver_number
      WHERE cd.session_key = ${targetSession}
        AND cd.date BETWEEN f.lap_start_ts AND f.lap_end_ts
        AND cd.speed IS NOT NULL
        AND cd.speed > 0
    ),
    sess AS (
      SELECT circuit_short_name, country_name, location, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    )
    SELECT
      f.driver_number,
      f.driver_name,
      f.lap_number AS fastest_lap_number,
      ROUND(f.lap_duration::numeric, 3) AS lap_duration,
      s.max_speed_kph,
      s.min_speed_kph,
      '${channel}' AS map_channel,
      ${targetSession} AS map_session_key,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM fastest f
    CROSS JOIN speeds s
  `;

  return { templateKey: "single_driver_speed_map", sql };
}
