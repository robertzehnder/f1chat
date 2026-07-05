import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair "minisector dominance" template — drives the track_heatmap
 * (minisector strip) card: per minisector, which of two drivers was faster
 * (higher average speed) and by how much.
 *
 * Source: analytics.minisector_dominance (per session/driver/minisector
 * avg_speed_kph), joined to f1.track_segments for the corner/minisector
 * labels, ordered by track position (start_normalized).
 *
 * Honest limits, reflected in the insight builder:
 *   - "Dominance" is by AVERAGE SPEED (km/h), not a lap-time delta — the
 *     data has no per-minisector time. delta_unit is therefore "km/h".
 *   - The data has NO sector (1/2/3) -> minisector mapping (distances are
 *     NULL), so this is whole-lap; it can't be filtered to "Sector 2".
 *
 * Output matches the track_heatmap detector (minisector_index + name +
 * leader + delta_ms), plus delta_unit and venue columns for the renderer
 * and insight. Keep the SQL — including comments — free of semicolons and
 * of the banned keywords scanned by src/lib/querySafety.ts.
 */

type BuildMinisectorDominanceTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

// Explicit minisector asks only — corner/sector dominance questions route
// to the sector-level card (driver_pair_sector_dominance), whose timing
// data is artifact-free. The max-speed source here showed +151 km/h
// ghosts from pit/SC samples (2025 Silverstone).
const MINISECTOR_TRIGGER = /\bmini[\s-]?sector/;

export function buildMinisectorDominanceTemplate(
  input: BuildMinisectorDominanceTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (!MINISECTOR_TRIGGER.test(lower)) return null;

  const sql = `
    WITH a AS (
      -- max_avg_speed_kph = the driver's BEST run through each minisector.
      -- Better than session-average for a qualifying "dominance" question
      -- (quali is judged on the best lap, not laps averaged with out/in runs).
      SELECT minisector_index, max_avg_speed_kph AS spd, driver_name
      FROM analytics.minisector_dominance
      WHERE session_key = ${targetSession} AND driver_number = ${driverA}
    ),
    b AS (
      SELECT minisector_index, max_avg_speed_kph AS spd, driver_name
      FROM analytics.minisector_dominance
      WHERE session_key = ${targetSession} AND driver_number = ${driverB}
    ),
    sess AS (SELECT circuit_short_name, location, year FROM core.sessions WHERE session_key = ${targetSession}),
    seg AS (
      SELECT segment_index, segment_label, start_normalized
      FROM f1.track_segments
      WHERE circuit_short_name = (SELECT circuit_short_name FROM sess)
        AND segment_kind = 'minisector'
    )
    SELECT
      s.segment_index AS minisector_index,
      s.segment_label AS name,
      CASE WHEN a.spd >= b.spd THEN a.driver_name ELSE b.driver_name END AS leader,
      ROUND(ABS(a.spd - b.spd)::numeric, 0) AS delta_ms,
      'km/h' AS delta_unit,
      a.driver_name AS driver_a,
      b.driver_name AS driver_b,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year
    FROM a
    JOIN b USING (minisector_index)
    JOIN seg s ON s.segment_index = a.minisector_index
    ORDER BY s.start_normalized
  `;

  return { templateKey: "minisector_dominance", sql };
}
