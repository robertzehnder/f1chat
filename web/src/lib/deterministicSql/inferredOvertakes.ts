import type { DeterministicSqlTemplate } from "./types";

/**
 * Session-scoped "inferred on-track overtakes" template.
 *
 * The official overtake feed (raw.overtakes) is empty in this warehouse, but
 * on-track passes ARE inferable from the classified-position feed. This
 * reconstructs each lap's running order by snapshotting raw.position_history
 * (a timestamped classified-position feed) at every driver's lap-end time,
 * then counts pairwise passes: driver A was behind B last lap and ahead this
 * lap. Pit-window laps (in-lap and out-lap, from raw.pit) are excluded so
 * pit-cycle swaps don't masquerade as on-track passes.
 *
 * It is an ESTIMATE, clearly labelled as such by the insight builder:
 *   - the position feed is the CLASSIFIED order, so safety-car shuffles,
 *     lapped traffic and retirements can't be fully separated out, and
 *   - the data records THAT positions changed, never WHERE on track — so
 *     DRS-zone / corner attribution is impossible.
 * Derived tables (core.race_progression_summary, laps_enriched.position_*)
 * are too sparse for this (≈30% of driver-laps), so we go to the raw feed.
 *
 * Output is per-driver pass counts shaped for the horizontal_bar detector
 * (driver_name + numeric overtakes); venue columns ride along for the title.
 *
 * Keep the SQL — including comments — free of semicolons and of the banned
 * keywords scanned by src/lib/querySafety.ts.
 */

type BuildInferredOvertakesTemplateInput = {
  lower: string;
  targetSession: number;
};

const OVERTAKE_TRIGGER = /\bovertak(e|es|en|ing)\b|\bon-?track pass(es|ing)?\b/;

export function buildInferredOvertakesTemplate(
  input: BuildInferredOvertakesTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession } = input;
  if (!OVERTAKE_TRIGGER.test(lower)) return null;

  const sql = `
    WITH lap_ends AS (
      SELECT driver_number, lap_number, MAX(lap_end_ts) AS lap_end_ts,
        MAX(driver_name) AS driver_name, MAX(location) AS location,
        MAX(year) AS year, MAX(session_name) AS session_name
      FROM core.laps_enriched
      WHERE session_key = ${targetSession} AND lap_end_ts IS NOT NULL
      GROUP BY driver_number, lap_number
    ),
    snap AS (
      -- Classified position at the end of each lap = latest feed value at or
      -- before that driver's lap-end timestamp (carry-forward when no change).
      SELECT le.driver_number, le.lap_number, le.driver_name, le.location, le.year, le.session_name,
        (
          SELECT ph.position
          FROM raw.position_history ph
          WHERE ph.session_key = ${targetSession}
            AND ph.driver_number = le.driver_number
            AND ph.date <= le.lap_end_ts
          ORDER BY ph.date DESC
          LIMIT 1
        ) AS pos
      FROM lap_ends le
    ),
    ranked AS (
      SELECT driver_number, lap_number, pos, driver_name, location, year, session_name,
        LAG(pos) OVER (PARTITION BY driver_number ORDER BY lap_number) AS prev_pos
      FROM snap
      WHERE pos IS NOT NULL
    ),
    pit_laps AS (
      SELECT driver_number, lap_number FROM raw.pit WHERE session_key = ${targetSession}
      UNION
      SELECT driver_number, lap_number + 1 FROM raw.pit WHERE session_key = ${targetSession}
    ),
    passes AS (
      -- A passed B on a lap: A behind B last lap, ahead this lap, neither in a
      -- pit window. One row per (A passes B) so a multi-car lap counts as many.
      SELECT a.lap_number, a.driver_name AS passer_name, a.location, a.year, a.session_name
      FROM ranked a
      JOIN ranked b
        ON b.lap_number = a.lap_number AND b.driver_number <> a.driver_number
      WHERE a.prev_pos > b.prev_pos
        AND a.pos < b.pos
        AND NOT EXISTS (SELECT 1 FROM pit_laps p WHERE p.driver_number = a.driver_number AND p.lap_number IN (a.lap_number, a.lap_number - 1))
        AND NOT EXISTS (SELECT 1 FROM pit_laps p WHERE p.driver_number = b.driver_number AND p.lap_number IN (a.lap_number, a.lap_number - 1))
    ),
    lap_counts AS (
      SELECT lap_number, COUNT(*) AS c FROM passes GROUP BY lap_number
    ),
    lapdur AS (
      -- per-lap field-median green-lap time, to flag caution / slow laps
      SELECT lap_number, percentile_cont(0.5) WITHIN GROUP (ORDER BY lapdur) AS med
      FROM (
        SELECT lap_number, MAX(lap_duration) AS lapdur
        FROM core.laps_enriched
        WHERE session_key = ${targetSession} AND lap_duration IS NOT NULL
          AND COALESCE(is_pit_lap, false) = false AND COALESCE(is_pit_out_lap, false) = false
        GROUP BY lap_number, driver_number
      ) x
      GROUP BY lap_number
    ),
    racemed AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY med) AS rm FROM lapdur),
    excluded_laps AS (
      -- Caution churn. A lap whose field-median time is >25% over the race
      -- median is a safety-car / VSC lap. A lap with >4 simultaneous swaps is
      -- a deployment / restart / first-lap shuffle. Neither is on-track racing,
      -- and both badly inflate the count (e.g. Imola 2025 lap 45 = 11 swaps).
      SELECT lap_number FROM lapdur, racemed WHERE med > rm * 1.25
      UNION
      SELECT lap_number FROM lap_counts WHERE c > 4
    ),
    clean_passes AS (
      SELECT * FROM passes WHERE lap_number NOT IN (SELECT lap_number FROM excluded_laps)
    )
    SELECT
      passer_name AS driver_name,
      COUNT(*) AS overtakes,
      MAX(location) AS location,
      MAX(year) AS year,
      MAX(session_name) AS session_name
    FROM clean_passes
    GROUP BY passer_name
    ORDER BY overtakes DESC
  `;

  return { templateKey: "inferred_overtakes", sql };
}
