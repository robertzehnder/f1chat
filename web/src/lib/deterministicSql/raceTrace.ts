import type { DeterministicSqlTemplate } from "./types";

/**
 * Race trace card — "how did the race unfold", gap evolution, and the
 * deterministic over/under-cut verdict (replaces the LLM-synthesis M02
 * flake). One row per (driver, lap): cumulative-race-time gap to the
 * leader, derived from lap durations — cleaner than the ~4s-sampled
 * raw.intervals feed and immune to its string-typed gaps.
 *
 * Neutralized (SC/VSC) laps are flagged data-first: a lap whose
 * cross-field median time exceeds 1.25x the session's median-of-medians
 * is neutralized — synchronized slowing is the signature no message
 * taxonomy can miss.
 *
 * Drivers: top 10 classified finishers, plus any resolved question pair
 * (marked is_focus for the over-cut verdict).
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildRaceTraceTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

const TRACE_TRIGGER =
  /race trace|race story|how .{0,30}race unfold|gap evolution|gaps? to the leader|gap .{0,20}evolv|lose the (?:race|lead)|under[\s-]?cut|over[\s-]?cut/;

export function buildRaceTraceTemplate(
  input: BuildRaceTraceTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (!TRACE_TRIGGER.test(lower)) return null;
  if (/\bhow many\b/.test(lower)) return null;

  const hasPair = driverA !== undefined && driverB !== undefined && driverA !== driverB;
  const isCutAnalysis = hasPair && /under[\s-]?cut|over[\s-]?cut|covering stop/.test(lower);
  const focusUnion = hasPair
    ? `UNION SELECT ${driverA} AS driver_number UNION SELECT ${driverB} AS driver_number`
    : "";
  const focusCheck = hasPair ? `c.driver_number IN (${driverA}, ${driverB})` : "FALSE";

  const sql = `
    WITH laps AS (
      SELECT driver_number, lap_number,
             MAX(driver_name) AS driver_name,
             MAX(lap_duration) AS lap_duration,
             bool_or(is_pit_lap) AS is_pit_lap
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND lap_duration IS NOT NULL
      GROUP BY driver_number, lap_number
    ),
    sel AS (
      SELECT driver_number FROM (
        SELECT DISTINCT driver_number, finish_position
        FROM core.grid_vs_finish
        WHERE session_key = ${targetSession} AND finish_position IS NOT NULL
        ORDER BY finish_position ASC
        LIMIT 10
      ) top
      ${focusUnion}
    ),
    cum AS (
      SELECT l.driver_number, l.driver_name, l.lap_number, l.is_pit_lap, l.lap_duration,
             SUM(l.lap_duration) OVER (PARTITION BY l.driver_number ORDER BY l.lap_number) AS cum_s
      FROM laps l
      JOIN sel USING (driver_number)
    ),
    leader AS (
      SELECT lap_number, MIN(cum_s) AS leader_cum FROM cum GROUP BY lap_number
    ),
    lap_meds AS (
      SELECT lap_number, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_duration) AS med
      FROM laps GROUP BY lap_number
    ),
    sess_med AS (
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY med) AS m FROM lap_meds
    ),
    outcomes AS (
      SELECT DISTINCT driver_number, grid_position, finish_position
      FROM core.grid_vs_finish WHERE session_key = ${targetSession}
    ),
    sess AS (
      SELECT country_name, location, year, session_name
      FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1
    )
    SELECT
      c.lap_number,
      c.driver_number,
      c.driver_name,
      ROUND((c.cum_s - le.leader_cum)::numeric, 3) AS gap_to_leader_s,
      c.is_pit_lap,
      (lm.med > sm.m * 1.25) AS is_neutralized,
      (${focusCheck}) AS is_focus,
      (${hasPair ? `c.driver_number = ${driverA}` : "FALSE"}) AS is_subject,
      '${isCutAnalysis ? "pit_cycle" : "trace"}' AS analysis_kind,
      o.grid_position,
      o.finish_position,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM cum c
    JOIN leader le USING (lap_number)
    JOIN lap_meds lm USING (lap_number)
    CROSS JOIN sess_med sm
    LEFT JOIN outcomes o USING (driver_number)
    ORDER BY c.driver_number, c.lap_number
  `;

  return { templateKey: "session_race_trace", sql };
}
