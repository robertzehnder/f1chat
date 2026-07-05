import type { DeterministicSqlTemplate } from "./types";

/**
 * Single-driver pre-stop "pace cliff" template — drives a deterministic
 * verdict card + lap-pace line for questions like "Did Piastri's graining at
 * Imola coincide with a pace cliff before his stop?".
 *
 * It returns the pre-stop stint lap-by-lap (laps 1..first pit, deduped),
 * with a 3-lap rolling average, the delta to it, and a deterministic
 * `is_cliff_onset` flag: the first green lap whose time exceeds the stint's
 * best sustained pace (min rolling-3 average) by >0.4s AND stays elevated
 * the following lap. Scoping to the pre-stop window (not the whole race) is
 * deliberate — it makes the cliff the focus of the chart instead of a blip.
 *
 * Detector/​renderer notes:
 *   - Columns are shaped so `line_with_stint_markers` (priority 83) wins:
 *     lap_number + delta + is_pit_lap satisfy its match. We emit `full_name`
 *     (NOT driver_name) so the detector takes its single-driver path and
 *     plots absolute lap pace, and so the radar detector can't grab it.
 *   - `is_cliff_onset` is read by both the detector (to add a "Cliff" marker)
 *     and the deterministic insight builder (verdict + metrics) — one source
 *     of truth for the cliff lap.
 *   - There is NO graining / tyre-temperature signal in the data, so the
 *     insight phrases this as a PACE cliff "consistent with graining", never
 *     "graining-driven".
 *
 * Keep the whole SQL — INCLUDING COMMENTS — free of two things the
 * read-only guard scans for over the raw text: the statement-separator
 * character (it splits on it to count statements) and the banned DDL/DML
 * keywords in src/lib/querySafety.ts (insert/update/delete/alter/drop/
 * create/grant/revoke/truncate/copy/vacuum/analyze/refresh/call/do). A
 * stray "drop"/";" in a comment fails the query and silently drops to the
 * heuristic fallback.
 */

type BuildPaceCliffTemplateInput = {
  lower: string;
  targetSession: number;
  driverNumber: number | undefined;
};

// "pace cliff", "graining", "deg cliff", "cliff" near a pace/stint/stop word,
// or a "drop/fall off" phrasing all signal a pre-stop degradation question.
const PACE_CLIFF_TRIGGER =
  /\bpace cliff\b|\bgraining\b|\bdeg cliff\b|\bcliff\b(?=[\s\S]*\b(pace|stop|stint|tyre|tire|deg|degrad)\b)|\b(?:pace|tyre|tire)\s+(?:drop|fall)[\s-]?off\b|\b(?:drop|fall)[\s-]?off\b(?=[\s\S]*\b(pace|stint|stop|tyre|tire)\b)/;

export function buildPaceCliffTemplate(
  input: BuildPaceCliffTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverNumber } = input;
  if (driverNumber === undefined) return null;
  if (!PACE_CLIFF_TRIGGER.test(lower)) return null;
  if (/\bhow many\b/.test(lower)) return null;

  const sql = `
    WITH first_pit AS (
      SELECT MIN(lap_number) AS pit_lap
      FROM raw.pit
      WHERE session_key = ${targetSession} AND driver_number = ${driverNumber}
    ),
    laps AS (
      SELECT
        lap_number,
        MAX(lap_duration) AS lap_duration,
        MAX(compound_name) AS compound_name,
        MAX(tyre_age_on_lap) AS tyre_age_on_lap,
        bool_or(is_pit_lap) AS is_pit_lap,
        bool_or(is_pit_out_lap) AS is_pit_out_lap,
        bool_or(COALESCE(is_valid, TRUE)) AS is_valid,
        MAX(driver_name) AS full_name,
        MAX(country_name) AS country_name,
        MAX(location) AS location,
        MAX(year) AS year,
        MAX(session_name) AS session_name
      FROM core.laps_enriched
      WHERE session_key = ${targetSession} AND driver_number = ${driverNumber}
      GROUP BY lap_number
    ),
    scoped AS (
      -- lap_number >= 2 excludes the standing-start lap (not green pace)
      SELECT l.*
      FROM laps l
      CROSS JOIN first_pit fp
      WHERE (fp.pit_lap IS NULL OR l.lap_number <= fp.pit_lap)
        AND l.lap_number >= 2
    ),
    green AS (
      SELECT lap_number, lap_duration
      FROM scoped
      WHERE NOT is_pit_lap AND NOT is_pit_out_lap AND is_valid
    ),
    rolling AS (
      SELECT
        lap_number,
        lap_duration,
        AVG(lap_duration) OVER (ORDER BY lap_number ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS rolling_avg_prev3
      FROM green
    ),
    baseline AS (
      SELECT MIN(rolling_avg_prev3) AS base
      FROM rolling
      WHERE rolling_avg_prev3 IS NOT NULL
    ),
    flags AS (
      SELECT
        r.lap_number,
        r.lap_duration,
        r.rolling_avg_prev3,
        b.base,
        r.lap_duration - r.rolling_avg_prev3 AS delta_vs_rolling_avg,
        (r.rolling_avg_prev3 IS NOT NULL AND r.lap_duration > b.base + 0.4) AS over_thresh,
        LEAD(r.lap_duration) OVER (ORDER BY r.lap_number) AS next_dur
      FROM rolling r
      CROSS JOIN baseline b
    ),
    onset AS (
      SELECT MIN(lap_number) AS cliff_lap
      FROM flags
      WHERE over_thresh AND COALESCE(next_dur, 0) > base + 0.25
    )
    SELECT
      s.lap_number,
      ROUND(s.lap_duration::numeric, 3) AS lap_duration,
      s.compound_name,
      s.tyre_age_on_lap,
      s.is_pit_lap,
      s.is_pit_out_lap,
      ROUND(f.rolling_avg_prev3::numeric, 3) AS rolling_avg_prev3,
      ROUND(f.delta_vs_rolling_avg::numeric, 3) AS delta_vs_rolling_avg,
      (s.lap_number = o.cliff_lap) AS is_cliff_onset,
      fp.pit_lap AS first_pit_lap,
      s.full_name,
      s.country_name,
      s.location,
      s.year,
      s.session_name
    FROM scoped s
    LEFT JOIN flags f ON f.lap_number = s.lap_number
    CROSS JOIN onset o
    CROSS JOIN first_pit fp
    ORDER BY s.lap_number
  `;

  return { templateKey: "single_driver_pace_cliff", sql };
}
