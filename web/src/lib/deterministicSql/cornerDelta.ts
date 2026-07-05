import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair ALL-CORNER entry/apex/exit delta card (A5). For a resolved
 * pair, one row per corner in analytics.corner_analysis carrying each
 * driver's BEST phase speed across their valid laps (max entry, min apex,
 * max exit), the three signed phase deltas (A - B), and the corner window
 * (zone_f0/zone_f1) for the track-map nodes. The marker column
 * `corner_delta_kind` routes the rows to the corner_delta_grid detector
 * (priority 108) rather than the generic grouped_bar / brake-zone detectors.
 *
 * Corner-phase counterpart to buildSectorDominanceTemplate: that 3-row
 * S1/S2/S3 card explicitly rejects entry/apex/exit and named-turn phrasings
 * and lets them fall to the LLM. This template catches exactly those.
 *
 * Best-per-phase across laps (not lap 1 only, unlike brakeZones.ts). Apex
 * uses MIN (slowest point); entry/exit use MAX (peak carried in/out).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
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
    WITH best AS (
      SELECT
        corner_number,
        corner_label,
        driver_number,
        MAX(driver_name) AS driver_name,
        MIN(start_normalized) AS zone_f0,
        MAX(end_normalized) AS zone_f1,
        MAX(entry_speed_kph) AS entry_kph,
        MIN(apex_min_speed_kph) AS apex_kph,
        MAX(exit_speed_kph) AS exit_kph
      FROM analytics.corner_analysis
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
      GROUP BY corner_number, corner_label, driver_number
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
    WHERE a.apex_kph IS NOT NULL AND b.apex_kph IS NOT NULL
    ORDER BY a.corner_number
  `;

  return { templateKey: "driver_pair_corner_delta", sql };
}
