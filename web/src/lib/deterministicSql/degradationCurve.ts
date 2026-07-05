import type { DeterministicSqlTemplate } from "./types";

/**
 * Compound degradation curve — median lap-time delta vs TYRE AGE per
 * compound, each compound's baseline being its own fresh-tyre (age ≤ 2)
 * median. The per-compound line chart is the canonical encoding for
 * "deg curves" / "tyre cliff" questions (the scatter+regression card
 * fits per-driver slopes — different question).
 *
 * Scope: session-wide by default; filtered to the resolved driver(s)
 * when the question names them.
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildDegradationCurveTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

const DEG_TRIGGER =
  /deg(?:radation)? curves?|degradation (?:by|vs|over|with) (?:tyre|tire) age|(?:tyre|tire) (?:life|age) (?:curve|analysis|profile)|(?:tyre|tire) cliff|how long (?:do|does|did|can) the (?:softs?|mediums?|hards?|inters?)/;

export function buildDegradationCurveTemplate(
  input: BuildDegradationCurveTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (!DEG_TRIGGER.test(lower)) return null;
  // F11 (golden-set audit 2026-07-02): the session-wide deg-curve card
  // cannot answer a team-vs-team or per-stint deg comparison (M11:
  // "medium deg between McLaren and Red Bull in stint 2 — aero-driven?").
  // Those want the per-driver scatter+regression via the LLM path; a
  // team-comparison or explicit stint-N scope must NOT hijack them.
  if (/\b(mclaren|ferrari|mercedes|red bull|aston martin|alpine|williams|haas|sauber|racing bulls)\b.*\b(vs|versus|between|and)\b/.test(lower)) {
    return null;
  }
  if (/\bstint\s*\d/.test(lower)) return null;
  // Pre-stop graining/pace-cliff phrasings stay with the single-driver
  // pace-cliff card.
  if (/graining|pace cliff/.test(lower)) return null;
  if (/\bcliff\b/.test(lower) && driverA !== undefined && driverB === undefined) return null;
  if (/\bhow many\b/.test(lower)) return null;

  const driverFilter =
    driverA !== undefined && driverB !== undefined
      ? `AND driver_number IN (${driverA}, ${driverB})`
      : driverA !== undefined
        ? `AND driver_number = ${driverA}`
        : "";

  // F12 (golden-set audit 2026-07-02): the raw laps window admitted the
  // standing-start lap 1 and Safety-Car-paced laps into BOTH the age-≤2
  // fresh baseline and the per-age aggregate. At venues where the opening
  // laps ran under SC (Jeddah, Monaco), the "fresh" baseline was ~30s
  // slower than green pace, so every later age read tens of seconds
  // "faster" and the card claimed physically-impossible negative wear.
  // Fix: drop lap 1, drop laps slower than 1.4× the session's field median
  // (the raceTrace neutralization idiom), and raise the per-bucket floors.
  const sql = `
    WITH raw_laps AS (
      SELECT driver_number, lap_number,
             MAX(compound_name) AS compound_name,
             MAX(tyre_age_on_lap) AS tyre_age,
             MAX(lap_duration) AS lap_duration
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND lap_number > 1
        AND lap_duration IS NOT NULL
        AND tyre_age_on_lap IS NOT NULL
        AND compound_name IS NOT NULL
        AND COALESCE(is_valid, TRUE) = TRUE
        AND COALESCE(is_pit_lap, FALSE) = FALSE
        AND COALESCE(is_pit_out_lap, FALSE) = FALSE
        ${driverFilter}
      GROUP BY driver_number, lap_number
    ),
    field_median AS (
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_duration) AS med
      FROM raw_laps
    ),
    laps AS (
      SELECT rl.*
      FROM raw_laps rl, field_median fm
      WHERE rl.lap_duration < fm.med * 1.4
    ),
    agg AS (
      SELECT compound_name, tyre_age,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_duration) AS med_lap,
             COUNT(*) AS lap_count
      FROM laps
      GROUP BY compound_name, tyre_age
    ),
    baselines AS (
      SELECT compound_name,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_duration) AS base,
             COUNT(*) AS base_count
      FROM laps
      WHERE tyre_age <= 2
      GROUP BY compound_name
    ),
    sess AS (
      SELECT country_name, location, year, session_name
      FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1
    )
    SELECT
      a.compound_name,
      a.tyre_age,
      ROUND((a.med_lap - b.base)::numeric, 3) AS deg_delta_s,
      a.lap_count,
      ROUND(b.base::numeric, 3) AS compound_baseline_s,
      b.base_count AS baseline_lap_count,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM agg a
    JOIN baselines b USING (compound_name)
    WHERE a.lap_count >= 4
      AND b.base_count >= 6
    ORDER BY a.compound_name, a.tyre_age
  `;

  return { templateKey: "compound_degradation_curve", sql };
}
