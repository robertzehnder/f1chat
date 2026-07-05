import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair heaviest-brake-zone card (M05) — "across the three heaviest
 * brake zones, did A's lap-1 brake-zone delta to B foreshadow the
 * lap-pace deficit?" Sources analytics.corner_analysis (per driver/lap/
 * corner entry/apex/exit speeds).
 *
 * "Heaviest brake zones" = the three corners with the largest average
 * entry→apex speed drop across both drivers' race laps. Rows are lap-1
 * per-driver speeds at those corners (long format: corner_label +
 * driver_name + absolute speed columns → grouped_bar detector), with a
 * shared-green-lap pace delta repeated on every row so the insight builder
 * can answer the "foreshadow" part deterministically. The pace delta is
 * the MEDIAN of per-lap differences over laps BOTH drivers ran green —
 * independent per-driver averages are meaningless in mixed-condition
 * races (Silverstone 2025: wet-phase laps inflated one mean by 16s/lap).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildBrakeZonesTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

const BRAKE_TRIGGER = /brak(?:e|ing)/;
const ZONE_TRIGGER = /zone|corner|turn|delta|deficit|compare|vs|versus/;

export function buildBrakeZonesTemplate(
  input: BuildBrakeZonesTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (!BRAKE_TRIGGER.test(lower)) return null;
  if (!ZONE_TRIGGER.test(lower)) return null;

  const sql = `
    WITH zones AS (
      SELECT
        corner_label,
        AVG(entry_speed_kph - apex_min_speed_kph) AS avg_drop,
        MIN(start_normalized) AS zone_f0,
        MAX(end_normalized) AS zone_f1
      FROM analytics.corner_analysis
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
        AND entry_speed_kph IS NOT NULL
        AND apex_min_speed_kph IS NOT NULL
      GROUP BY corner_label
      ORDER BY avg_drop DESC
      LIMIT 3
    ),
    lap1 AS (
      SELECT DISTINCT
        ca.corner_label,
        ca.driver_number,
        ca.driver_name,
        ca.entry_speed_kph,
        ca.apex_min_speed_kph
      FROM analytics.corner_analysis ca
      JOIN zones z ON z.corner_label = ca.corner_label
      WHERE ca.session_key = ${targetSession}
        AND ca.lap_number = 1
        AND ca.driver_number IN (${driverA}, ${driverB})
    ),
    green AS (
      SELECT driver_number, lap_number, MAX(lap_duration) AS lap_duration
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
        AND lap_duration IS NOT NULL
        AND COALESCE(is_valid, TRUE) = TRUE
        AND COALESCE(is_pit_out_lap, FALSE) = FALSE
        AND COALESCE(is_pit_lap, FALSE) = FALSE
      GROUP BY driver_number, lap_number
    ),
    shared_pace AS (
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ga.lap_duration - gb.lap_duration) AS pace_delta_s,
        COUNT(*) AS shared_green_laps
      FROM green ga
      JOIN green gb ON gb.lap_number = ga.lap_number AND gb.driver_number = ${driverB}
      WHERE ga.driver_number = ${driverA}
    ),
    sess AS (
      SELECT circuit_short_name, country_name, location, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    )
    SELECT
      l.corner_label,
      l.driver_number,
      l.driver_name,
      ROUND(l.entry_speed_kph::numeric, 1) AS entry_speed_kph,
      ROUND(l.apex_min_speed_kph::numeric, 1) AS apex_min_speed_kph,
      ROUND((l.entry_speed_kph - l.apex_min_speed_kph)::numeric, 1) AS brake_drop_kph,
      ROUND(z.avg_drop::numeric, 1) AS zone_avg_drop_kph,
      ROUND(z.zone_f0::numeric, 4) AS zone_f0,
      ROUND(z.zone_f1::numeric, 4) AS zone_f1,
      ROUND((SELECT pace_delta_s FROM shared_pace)::numeric, 3) AS shared_pace_delta_s,
      (SELECT shared_green_laps FROM shared_pace) AS shared_green_laps,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM lap1 l
    JOIN zones z ON z.corner_label = l.corner_label
    ORDER BY z.avg_drop DESC, CASE WHEN l.driver_number = ${driverA} THEN 0 ELSE 1 END
  `;

  return { templateKey: "driver_pair_brake_zones", sql };
}
