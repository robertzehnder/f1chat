import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair ALL-CORNER entry/apex/exit delta card (A5). For a resolved
 * pair, one row per corner in analytics.corner_analysis. That matview is
 * per-(session, driver, LAP, corner): each row is one lap's entry / apex /
 * exit speed at one corner.
 *
 * Representative lap: for each (driver, corner) we take the SINGLE lap where
 * the driver carried the highest apex speed (their best cornering attempt),
 * and read entry / apex / exit all from THAT one lap. This keeps the three
 * phase speeds internally consistent — earlier the template aggregated each
 * phase independently (MAX entry, MIN apex, MAX exit) across ALL laps, so the
 * apex figure was actually each driver's WORST apex, mixed with best-entry /
 * best-exit from other laps, producing implausible deltas.
 *
 * Only laps that sampled all three sub-zones (entry, apex, exit all non-null)
 * are eligible, so no phase is fabricated and the delta detector never has to
 * coerce a missing value to zero. This is a telemetry corner-sample
 * approximation, not a continuous trace.
 *
 * The marker column `corner_delta_kind` routes the rows to the
 * corner_delta_grid detector (priority 108). `total_corners` (distinct corners
 * with telemetry this session) lets the card caption "N of M corners".
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts (no semicolon anywhere, comments included).
 */

type BuildCornerDeltaTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

const CORNER_TRIGGER = /\b(corner|apex|entry speed|exit speed|turn[- ]?in|every turn|each turn|all corners|corner[- ]by[- ]corner)\b/;
const COMPARE_TRIGGER = /\b(compare|comparison|vs|versus|against|delta|gain(?:ed|s)?|lose|lost|faster|quicker|slower|where|edge|advantage|deficit)\b/;
const TURN_LIST = /\bturns?\s+\d+(\s*,\s*\d+)*/;

export function buildCornerDeltaTemplate(
  input: BuildCornerDeltaTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (!CORNER_TRIGGER.test(lower) && !TURN_LIST.test(lower)) return null;
  if (!COMPARE_TRIGGER.test(lower) && !TURN_LIST.test(lower)) return null;

  const sql = `
    WITH per_lap AS (
      -- One row per (driver, corner, lap), keeping only laps that fully
      -- sampled the corner (entry, apex and exit all present) so no phase is
      -- fabricated downstream.
      SELECT
        corner_number,
        corner_label,
        driver_number,
        driver_name,
        start_normalized,
        end_normalized,
        entry_speed_kph,
        apex_min_speed_kph,
        exit_speed_kph,
        sample_count
      FROM analytics.corner_analysis
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
        AND entry_speed_kph IS NOT NULL
        AND apex_min_speed_kph IS NOT NULL
        AND exit_speed_kph IS NOT NULL
    ),
    best AS (
      -- The representative lap per (driver, corner): the highest apex speed
      -- (best cornering attempt). Tie-break toward the better-sampled lap.
      SELECT DISTINCT ON (driver_number, corner_number)
        corner_number,
        corner_label,
        driver_number,
        driver_name,
        start_normalized AS zone_f0,
        end_normalized   AS zone_f1,
        entry_speed_kph  AS entry_kph,
        apex_min_speed_kph AS apex_kph,
        exit_speed_kph   AS exit_kph
      FROM per_lap
      ORDER BY driver_number, corner_number, apex_min_speed_kph DESC, sample_count DESC
    ),
    all_corners AS (
      SELECT COUNT(DISTINCT corner_number) AS total_corners
      FROM analytics.corner_analysis
      WHERE session_key = ${targetSession}
    ),
    a AS (
      SELECT * FROM best WHERE driver_number = ${driverA}
    ),
    b AS (
      SELECT * FROM best WHERE driver_number = ${driverB}
    ),
    sess AS (
      SELECT circuit_short_name, country_name, location, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    )
    SELECT
      'corner_delta' AS corner_delta_kind,
      a.corner_number,
      a.corner_label,
      ROUND(COALESCE(a.zone_f0, b.zone_f0)::numeric, 4) AS zone_f0,
      ROUND(COALESCE(a.zone_f1, b.zone_f1)::numeric, 4) AS zone_f1,
      ${driverA} AS a_driver_number,
      ${driverB} AS b_driver_number,
      (SELECT MAX(driver_name) FROM a) AS a_driver_name,
      (SELECT MAX(driver_name) FROM b) AS b_driver_name,
      (SELECT total_corners FROM all_corners) AS total_corners,
      ROUND(a.entry_kph::numeric, 1) AS a_entry_kph,
      ROUND(b.entry_kph::numeric, 1) AS b_entry_kph,
      ROUND(a.apex_kph::numeric, 1) AS a_apex_kph,
      ROUND(b.apex_kph::numeric, 1) AS b_apex_kph,
      ROUND(a.exit_kph::numeric, 1) AS a_exit_kph,
      ROUND(b.exit_kph::numeric, 1) AS b_exit_kph,
      ROUND((a.entry_kph - b.entry_kph)::numeric, 1) AS entry_delta_kph,
      ROUND((a.apex_kph - b.apex_kph)::numeric, 1) AS apex_delta_kph,
      ROUND((a.exit_kph - b.exit_kph)::numeric, 1) AS exit_delta_kph,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM a
    JOIN b ON b.corner_number = a.corner_number
    ORDER BY a.corner_number
  `;

  return { templateKey: "driver_pair_corner_delta", sql };
}
