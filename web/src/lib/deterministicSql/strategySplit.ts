import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair "strategy split" template — answers "did <team> split
 * strategies between A and B / did A and B run the same strategy"
 * questions for ANY driver pair and venue with a deterministic verdict
 * and a stint-timeline (gantt) chart.
 *
 * Output: one row per driver-stint from core.stint_summary (deduped),
 * with per-driver context (team, grid/finish positions) repeated on each
 * row. Stop counts, compound sequences, and pit laps are derived in the
 * insight builder from the stint rows themselves — no dependency on
 * core.strategy_summary or the slow pit-cycle view.
 *
 * Detector/renderer notes:
 *   - Columns `compound` + `stint_start_lap`/`stint_end_lap` +
 *     `stint_number` match the stint_gantt detector (priority 85), which
 *     renders the compound timeline the question is really about.
 *   - `positions_gained` is deliberately NOT named `position_delta`,
 *     which would be stolen by the diverging-bar detector (priority 95).
 *   - Driver A (first mentioned in the question) sorts first, so the
 *     insight builder can keep the question's framing.
 *
 * Keep the whole SQL — INCLUDING COMMENTS — free of the statement
 * separator and of the banned keywords scanned by src/lib/querySafety.ts.
 */

type BuildStrategySplitTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

// Strategy-comparison language. Requires an explicit strategy mention so
// stint-delta pace questions (own template) and generic pace comparisons
// don't land here.
const STRATEGY_TRIGGER = /strateg/;
const SPLIT_COMPARE_TRIGGER =
  /\b(split|same|different|differ(?:ed|ent)?|diverg\w*|mirror\w*|identical|compare[d]?|comparison|vs|versus|alternate|offset)\b|one[\s-]?stop|two[\s-]?stop|compound sequence/;

export function buildStrategySplitTemplate(
  input: BuildStrategySplitTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (!STRATEGY_TRIGGER.test(lower)) return null;
  if (!SPLIT_COMPARE_TRIGGER.test(lower)) return null;
  if (/\bhow many\b/.test(lower)) return null;

  const sql = `
    WITH stints AS (
      SELECT DISTINCT
        driver_number,
        driver_name,
        team_name,
        stint_number,
        compound_name,
        lap_start,
        lap_end,
        stint_length_laps,
        ROUND(avg_valid_lap::numeric, 3) AS avg_valid_lap,
        country_name,
        location,
        year,
        session_name
      FROM core.stint_summary
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
    ),
    outcome AS (
      SELECT DISTINCT
        driver_number,
        grid_position,
        finish_position,
        positions_gained
      FROM core.grid_vs_finish
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
    )
    SELECT
      st.driver_number,
      st.driver_name,
      st.team_name,
      st.stint_number,
      st.compound_name AS compound,
      st.lap_start AS stint_start_lap,
      st.lap_end AS stint_end_lap,
      st.stint_length_laps,
      st.avg_valid_lap,
      o.grid_position,
      o.finish_position,
      o.positions_gained,
      st.country_name,
      st.location,
      st.year,
      st.session_name
    FROM stints st
    LEFT JOIN outcome o USING (driver_number)
    ORDER BY CASE WHEN st.driver_number = ${driverA} THEN 0 ELSE 1 END, st.stint_number
  `;

  return { templateKey: "driver_pair_strategy_split", sql };
}
