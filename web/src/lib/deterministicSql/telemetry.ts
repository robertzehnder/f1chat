import type { DeterministicSqlTemplate } from "./types";

type BuildTelemetryTemplateInput = {
  lower: string;
  targetSession: number;
  driverPairSql: string | undefined;
  includesAny: (text: string, candidates: string[]) => boolean;
};

export function buildTelemetryTemplate(input: BuildTelemetryTemplateInput): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverPairSql, includesAny } = input;

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

  return null;
}
