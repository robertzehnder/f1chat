import type { DeterministicSqlTemplate } from "./types";

/**
 * Race position-changes card — every classified driver's position per
 * lap from grid to flag. The progression feed logs position CHANGES
 * only, so rows are sparse: a synthetic lap-0 row anchors each driver
 * at their grid slot and the renderer forward-fills between updates
 * (same semantics the lap-1 launch card established).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildPositionChangesTemplateInput = {
  lower: string;
  targetSession: number;
};

const POSITION_TRIGGER =
  /position changes?|race progression|recovery drive|(?:gained|lost|made up|climbed) .{0,15}(?:positions?|places)|places (?:gained|lost)|who (?:gained|climbed|fell|recovered)/;

export function buildPositionChangesTemplate(
  input: BuildPositionChangesTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession } = input;
  if (!POSITION_TRIGGER.test(lower)) return null;
  // Lap-1 launch phrasings belong to the driver-pair lap-1 card, which
  // runs earlier in the chain anyway — this guard keeps single-driver
  // launch questions out too.
  if (/lap[\s-]?1\b|lap one|opening lap|launch/.test(lower)) return null;
  if (/\bhow many\b/.test(lower)) return null;

  const sql = `
    WITH prog AS (
      SELECT DISTINCT driver_number, driver_name, lap_number, position_end_of_lap
      FROM core.race_progression_summary
      WHERE session_key = ${targetSession}
    ),
    outcomes AS (
      SELECT DISTINCT driver_number, grid_position, finish_position
      FROM core.grid_vs_finish
      WHERE session_key = ${targetSession}
    ),
    names AS (
      SELECT DISTINCT driver_number, full_name
      FROM core.session_drivers
      WHERE session_key = ${targetSession}
    ),
    total AS (
      SELECT MAX(lap_number) AS total_laps FROM prog
    ),
    rows_union AS (
      SELECT p.driver_number, p.driver_name, p.lap_number, p.position_end_of_lap AS position
      FROM prog p
      UNION ALL
      SELECT o.driver_number, n.full_name, 0 AS lap_number, o.grid_position AS position
      FROM outcomes o
      LEFT JOIN names n USING (driver_number)
      WHERE o.grid_position IS NOT NULL
    )
    SELECT
      r.driver_number,
      COALESCE(r.driver_name, n.full_name) AS driver_name,
      r.lap_number,
      r.position,
      o.grid_position,
      o.finish_position,
      (SELECT total_laps FROM total) AS total_laps,
      (SELECT country_name FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1) AS country_name,
      (SELECT location FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1) AS location,
      (SELECT year FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1) AS year,
      (SELECT session_name FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1) AS session_name
    FROM rows_union r
    LEFT JOIN outcomes o USING (driver_number)
    LEFT JOIN names n USING (driver_number)
    WHERE r.position IS NOT NULL
    ORDER BY r.driver_number, r.lap_number
  `;

  return { templateKey: "race_position_changes", sql };
}
