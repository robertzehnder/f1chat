import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver telemetry overlay card — stacked speed / gear / throttle+brake
 * traces for one or two drivers' fastest valid laps. The SQL returns a
 * summary row per driver (lap identity + top speed) — the per-point
 * traces are fetched client-side from /api/lap-telemetry pinned to the
 * exact session+drivers via the overlay_session_key column.
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildTelemetryOverlayTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

const OVERLAY_TRIGGER =
  /speed trace|telemetry (?:overlay|comparison|trace|stack)|(?:compare|overlay) .{0,40}(?:qualifying |fastest |pole )?laps?(?: trace| telemetry)|where did (?:the )?pole (?:lap )?(?:win|gain)|lap telemetry/;

export function buildTelemetryOverlayTemplate(
  input: BuildTelemetryOverlayTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined) return null;
  if (!OVERLAY_TRIGGER.test(lower)) return null;

  const driverList =
    driverB !== undefined && driverB !== driverA ? `${driverA}, ${driverB}` : `${driverA}`;
  // A spine of the REQUESTED drivers, not just those with a valid lap —
  // when one retired on lap 1 (Sainz, Spielberg 2025) the card must say
  // "no valid lap for X", not silently shrink to a single-driver card.
  const requestedSpine =
    driverB !== undefined && driverB !== driverA
      ? `SELECT ${driverA} AS driver_number, 0 AS ord UNION ALL SELECT ${driverB} AS driver_number, 1 AS ord`
      : `SELECT ${driverA} AS driver_number, 0 AS ord`;

  const sql = `
    WITH requested AS (
      ${requestedSpine}
    ),
    raced AS (
      SELECT driver_number, MAX(driver_name) AS driver_name,
             COUNT(DISTINCT lap_number) AS laps_completed
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverList})
      GROUP BY driver_number
    ),
    fastest AS (
      SELECT DISTINCT ON (driver_number)
        driver_number, driver_name, lap_number, lap_duration, lap_start_ts, lap_end_ts
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverList})
        AND lap_duration IS NOT NULL
        AND COALESCE(is_valid, TRUE) = TRUE
        AND COALESCE(is_pit_lap, FALSE) = FALSE
        AND COALESCE(is_pit_out_lap, FALSE) = FALSE
        AND lap_start_ts IS NOT NULL
        AND lap_end_ts IS NOT NULL
      ORDER BY driver_number, lap_duration ASC
    ),
    speeds AS (
      SELECT f.driver_number, MAX(cd.speed) AS top_speed_kph
      FROM fastest f
      JOIN raw.car_data cd
        ON cd.session_key = ${targetSession}
       AND cd.driver_number = f.driver_number
       AND cd.date BETWEEN f.lap_start_ts AND f.lap_end_ts
      WHERE cd.speed IS NOT NULL
      GROUP BY f.driver_number
    ),
    sess AS (
      SELECT circuit_short_name, country_name, location, year, session_name
      FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1
    )
    SELECT
      r.driver_number,
      COALESCE(f.driver_name, rc.driver_name, 'Driver #' || r.driver_number) AS driver_name,
      f.lap_number AS fastest_lap_number,
      ROUND(f.lap_duration::numeric, 3) AS lap_duration,
      s.top_speed_kph,
      COALESCE(rc.laps_completed, 0) AS laps_completed,
      ${targetSession} AS overlay_session_key,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM requested r
    LEFT JOIN raced rc USING (driver_number)
    LEFT JOIN fastest f USING (driver_number)
    LEFT JOIN speeds s USING (driver_number)
    ORDER BY r.ord
  `;

  return { templateKey: "driver_telemetry_overlay", sql };
}
