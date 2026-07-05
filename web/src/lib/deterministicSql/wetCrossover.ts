import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair inter→slick crossover card (M14) — "what was the
 * inter-to-slick crossover lap for the McLarens at Australia 2025?"
 * Sources analytics.weather_impact, which carries per-lap lap times, a
 * wet-track flag, and the precomputed inter_to_slick_crossover_lap.
 *
 * Output: one row per (driver, lap) with lap_time_s + wet_track (0/1) +
 * driver_name — the dual-axis line detector's shape (lap time on y1, the
 * wet-track indicator on y2 shows exactly when the track dried and both
 * cars crossed over).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildWetCrossoverTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

const CROSSOVER_TRIGGER =
  /cross[\s-]?over|inter[\s-]?to[\s-]?slick|slick[\s-]?to[\s-]?inter|switch(?:ed)? (?:from )?(?:inters?|wets?|intermediates?) to|from inters? to slicks?/;

export function buildWetCrossoverTemplate(
  input: BuildWetCrossoverTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (!CROSSOVER_TRIGGER.test(lower)) return null;

  // F14 (golden-set audit 2026-07-02): analytics.weather_impact emits a
  // boundary/pit lap TWICE per driver (it falls inside both the outgoing
  // and incoming stint windows) with contradictory {wet:0, slick} vs
  // {wet:1, inter} readings. SELECT DISTINCT can't collapse rows that
  // genuinely differ, so the builder saw phantom 1-lap stints (Hard 33→33
  // → Int 33→33) and unstable wet-lap counts. The view has no
  // stint_number, so dedup deterministically by (driver, lap) preferring
  // the DRY reading (is_wet_lap ASC): on a drying-track transition this
  // keeps the wet→dry progression monotonic (a slick lap can't flip back
  // to wet). The crossover lap itself comes from the view column, so this
  // choice only shifts the ±1 wet-lap count, not the crossover point.
  const sql = `
    WITH sess AS (
      SELECT country_name, location, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    ),
    ranked AS (
      SELECT
        w.lap_number,
        w.driver_name,
        w.lap_duration_s,
        w.is_wet_lap,
        w.compound_name,
        w.inter_to_slick_crossover_lap,
        ROW_NUMBER() OVER (
          PARTITION BY w.driver_number, w.lap_number
          ORDER BY w.is_wet_lap ASC, w.compound_name
        ) AS rn
      FROM analytics.weather_impact w
      WHERE w.session_key = ${targetSession}
        AND w.driver_number IN (${driverA}, ${driverB})
        AND w.lap_duration_s IS NOT NULL
    )
    SELECT
      r.lap_number,
      r.driver_name,
      ROUND(r.lap_duration_s::numeric, 3) AS lap_time_s,
      CASE WHEN r.is_wet_lap THEN 1 ELSE 0 END AS wet_track,
      r.compound_name,
      r.inter_to_slick_crossover_lap,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM ranked r
    WHERE r.rn = 1
    ORDER BY r.driver_name, r.lap_number
  `;

  return { templateKey: "driver_pair_wet_crossover", sql };
}
