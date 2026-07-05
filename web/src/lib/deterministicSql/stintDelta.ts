import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair stint-by-stint lap-delta template — answers "did A's deltas
 * to B reverse / grow / shrink across stints" questions ("Did Hamilton's
 * middle-stint medium deltas to Leclerc reverse on the final hard stint?")
 * for ANY driver pair and venue.
 *
 * Output: one row per SHARED green lap (both drivers set a valid,
 * non-pit-in/out lap time), carrying the per-lap delta (A − B), the stint
 * window it falls in (driver A's stint numbering from raw.stints), each
 * driver's compound for that lap, and per-stint aggregates (avg / median /
 * lap count) repeated on every row of the stint. Aggregating in SQL is the
 * point: the per-stint stats can never be truncated by the row cap the way
 * a raw-laps cross join was (the 2025 Bahrain incident returned 200
 * duplicated stint-1 rows and concluded "hard-stint data absent").
 *
 * Detector/renderer notes:
 *   - Columns are shaped for the stint_delta_line detector (registry.ts):
 *     lap_number + delta_s + stint_number + driver_a_name. It renders a
 *     single delta line with a zero reference line and a stint-boundary
 *     marker labelled with the compound at each is_stint_start row.
 *   - driver_name / compound / stint_start_lap are deliberately NOT used
 *     as column names so the line / stint_gantt / radar detectors can't
 *     grab these rows first.
 *   - Stint windows follow driver A's stints. b_compound is B's compound
 *     on that lap, so the insight builder can caveat offset strategies.
 *
 * Keep the whole SQL — INCLUDING COMMENTS — free of the statement
 * separator and of the banned keywords scanned by src/lib/querySafety.ts.
 */

type BuildStintDeltaTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

// A stint mention plus delta/comparison language signals a stint-level
// pace-gap question. Bare "close" is excluded (too common); reversal,
// gap and faster/slower phrasings are all covered.
const STINT_TRIGGER = /\bstint/;
const DELTA_COMPARE_TRIGGER =
  /\b(deltas?|gaps?|deficit|advantage|margin|revers(?:e|ed|al)|flip(?:ped)?|swing|swung|swapp?ed|faster|slower|quicker|compar(?:e|ed|ison)|versus|vs|ahead|behind|stronger|weaker)\b/;

export function buildStintDeltaTemplate(
  input: BuildStintDeltaTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (!STINT_TRIGGER.test(lower)) return null;
  if (!DELTA_COMPARE_TRIGGER.test(lower)) return null;
  if (/\bhow many\b/.test(lower)) return null;
  // Strategy-flavored questions ("compare the tyre stint strategies of A
  // and B") belong to the strategy-split card (gantt + split verdict),
  // which runs right after this template — this card answers pace deltas.
  if (/strateg/.test(lower)) return null;
  // Degradation-curve questions ("compare medium-compound deg curves…")
  // belong to the scatter+regression path (per-lap points + slope), not a
  // stint-average delta line.
  if (/\bdeg\b|degrad|curve/.test(lower)) return null;
  // Single-stint-scoped pace comparisons ("race pace across the first
  // stint") read best as two absolute lap-time lines (the M09 shape); the
  // stint-by-stint delta card is for multi-stint evolution. Fire only when
  // the question signals multiple stints or a reversal/swing.
  const multiStint =
    /\bstints\b|across stints|each stint|by stint|every stint|stint[\s-]?by[\s-]?stint|revers|flip|swing|swung|swap/.test(
      lower
    );
  if (!multiStint && /\b(first|opening|second|middle|third|final|closing|last)\s+stint\b/.test(lower)) {
    return null;
  }

  // F04: read core.laps_enriched ONCE for both drivers (was two full
  // scans, a_laps + b_laps, of the large unmaterialized view). a_laps and
  // b_laps are now cheap filters over the single materialized scan.
  const bothLapsCte = `
    both_laps AS MATERIALIZED (
      -- laps_enriched ships duplicate rows in the warehouse, so collapse
      -- to one row per (driver, lap) before joining.
      SELECT
        driver_number,
        lap_number,
        MAX(lap_duration) AS lap_duration,
        bool_or(is_pit_lap) AS is_pit_lap,
        bool_or(is_pit_out_lap) AS is_pit_out_lap,
        bool_or(COALESCE(is_valid, TRUE)) AS is_valid,
        MAX(driver_name) AS driver_name,
        MAX(country_name) AS country_name,
        MAX(location) AS location,
        MAX(year) AS year,
        MAX(session_name) AS session_name
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND driver_number IN (${driverA}, ${driverB})
      GROUP BY driver_number, lap_number
    )`;
  const lapsFilter = (alias: string, driverNumber: number) => `
    ${alias} AS (
      SELECT lap_number, lap_duration, is_pit_lap, is_pit_out_lap, is_valid,
             driver_name, country_name, location, year, session_name
      FROM both_laps WHERE driver_number = ${driverNumber}
    )`;

  const sql = `
    WITH ${bothLapsCte},
    ${lapsFilter("a_laps", driverA)},
    ${lapsFilter("b_laps", driverB)},
    a_stints AS (
      SELECT DISTINCT stint_number, lap_start, lap_end, compound
      FROM raw.stints
      WHERE session_key = ${targetSession} AND driver_number = ${driverA}
    ),
    b_stints AS (
      SELECT DISTINCT stint_number, lap_start, lap_end, compound
      FROM raw.stints
      WHERE session_key = ${targetSession} AND driver_number = ${driverB}
    ),
    paired_all AS (
      -- Shared green laps only: lap 2 onward (the standing start is not
      -- green pace), both drivers valid and not pitting in or out.
      SELECT
        a.lap_number,
        a.lap_duration - b.lap_duration AS delta_s,
        sa.stint_number,
        sa.compound AS a_compound,
        sb.compound AS b_compound,
        a.driver_name AS driver_a_name,
        b.driver_name AS driver_b_name,
        a.country_name,
        a.location,
        a.year,
        a.session_name
      FROM a_laps a
      JOIN b_laps b USING (lap_number)
      LEFT JOIN a_stints sa ON a.lap_number BETWEEN sa.lap_start AND sa.lap_end
      LEFT JOIN b_stints sb ON a.lap_number BETWEEN sb.lap_start AND sb.lap_end
      WHERE a.lap_number >= 2
        AND a.lap_duration IS NOT NULL AND b.lap_duration IS NOT NULL
        AND NOT a.is_pit_lap AND NOT a.is_pit_out_lap AND a.is_valid
        AND NOT b.is_pit_lap AND NOT b.is_pit_out_lap AND b.is_valid
        AND sa.stint_number IS NOT NULL
    ),
    paired AS (
      -- A gap above 5s on a single lap is a safety car, traffic, an
      -- off, or a timing artifact — not relative pace. One such lap can
      -- flip a stint average on its own (2025 Bahrain lap 34 ran -6.9s),
      -- so these laps are excluded from BOTH the stats and the chart and
      -- surfaced via outlier_lap_count instead.
      SELECT * FROM paired_all WHERE ABS(delta_s) <= 5
    ),
    outliers AS (
      SELECT COUNT(*) AS outlier_lap_count FROM paired_all WHERE ABS(delta_s) > 5
    ),
    stint_stats AS (
      SELECT
        stint_number,
        AVG(delta_s) AS stint_avg_delta,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta_s) AS stint_median_delta,
        COUNT(*) AS stint_lap_count,
        MIN(lap_number) AS stint_first_shared_lap
      FROM paired
      GROUP BY stint_number
    )
    SELECT
      p.lap_number,
      ROUND(p.delta_s::numeric, 3) AS delta_s,
      p.stint_number,
      p.a_compound,
      p.b_compound,
      (p.a_compound IS NOT DISTINCT FROM p.b_compound) AS same_compound,
      ROUND(s.stint_avg_delta::numeric, 3) AS stint_avg_delta,
      ROUND(s.stint_median_delta::numeric, 3) AS stint_median_delta,
      s.stint_lap_count,
      (p.lap_number = s.stint_first_shared_lap) AS is_stint_start,
      o.outlier_lap_count,
      p.driver_a_name,
      p.driver_b_name,
      p.country_name,
      p.location,
      p.year,
      p.session_name
    FROM paired p
    JOIN stint_stats s USING (stint_number)
    CROSS JOIN outliers o
    ORDER BY p.lap_number
  `;

  return { templateKey: "driver_pair_stint_delta", sql };
}
