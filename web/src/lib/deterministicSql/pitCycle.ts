import type { DeterministicSqlTemplate } from "./types";

/**
 * Single-driver pit-stop "cycle" template — drives the `pit_event_strip`
 * visualization (In-lap / Pit lane / Out-lap strip + before→after→recovered
 * position flow). Fires for questions like "Verstappen's first stop at
 * Canada 2025 — what happened in the cycle?" or "Hamilton's second pit stop".
 *
 * Output is shaped so ONLY the pit_event_strip detector (priority 81,
 * keys on phase_label + duration_sec) matches: the carried per-row columns
 * deliberately avoid names other detectors key on (lap_number / lap /
 * driver_name / compound / corner_label / label / position_delta /
 * minisector_index / kind). The detector reads the post-cycle / metric
 * columns from rows[0].
 *
 * Data-source notes:
 *   - Spine is `raw.pit` (cheap raw table) for pit_lap + pit_duration +
 *     ROW_NUMBER() ordinal. We deliberately do NOT use core.pit_cycle_summary:
 *     on Neon it is the un-materialized aggregating view and a single SELECT
 *     against it costs ~15s, blowing the statement timeout the moment it is
 *     joined to anything.
 *   - `core.laps_enriched` carries duplicate rows per (session, driver, lap)
 *     in the deployed warehouse, so the `laps` CTE de-dupes with GROUP BY +
 *     MAX(). CTEs are MATERIALIZED so the (non-trivial) laps_enriched scan
 *     runs once instead of being re-inlined per correlated subquery.
 *   - There is NO stationary-time column anywhere in the schema (only total
 *     pit-lane duration), so `stationary_s` is emitted NULL — the card shows
 *     total pit-lane loss instead and omits a stationary tile.
 *   - Position is sparse (pit-out laps and many green laps are NULL), so
 *     before/after positions use the nearest non-null lap on each side and
 *     are left NULL when genuinely absent; the detector then omits the
 *     position flow rather than rendering a broken one.
 */

type BuildPitCycleTemplateInput = {
  lower: string;
  targetSession: number;
  driverNumber: number | undefined;
};

// "first/second/.../fifth stop", "1st/2nd/3rd stop", "last/final stop",
// "pit cycle", "stop … cycle", or a bare "stop lap" all signal a
// single-stop cycle question.
const STOP_CYCLE_TRIGGER =
  /\b(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|final)\s+(?:pit\s+)?stop\b|\bpit cycle\b|\bstop lap\b|(?=.*\bstop\b)(?=.*\bcycle\b)/;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5
};

type StopSelector = { kind: "n"; n: number } | { kind: "last" };

function parseStopSelector(lower: string): StopSelector {
  if (/\b(?:last|final)\s+(?:pit\s+)?stop\b/.test(lower)) {
    return { kind: "last" };
  }
  for (const [word, n] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      return { kind: "n", n };
    }
  }
  const numeric = /\b(\d+)(?:st|nd|rd|th)\b/.exec(lower);
  if (numeric) {
    return { kind: "n", n: Math.max(1, Number(numeric[1])) };
  }
  // A "pit cycle" / "stop lap" question with no explicit ordinal defaults
  // to the first stop.
  return { kind: "n", n: 1 };
}

export function buildPitCycleTemplate(
  input: BuildPitCycleTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverNumber } = input;

  if (driverNumber === undefined) return null;
  if (!STOP_CYCLE_TRIGGER.test(lower)) return null;
  // "how many" / count questions belong to the pit-stop-count template, not
  // the single-cycle detail card.
  if (/\bhow many\b/.test(lower)) return null;

  const selector = parseStopSelector(lower);
  const sequencePredicate =
    selector.kind === "last"
      ? "pit_sequence = (SELECT MAX(pit_sequence) FROM pits)"
      : `pit_sequence = ${selector.n}`;

  const sql = `
    WITH pits AS MATERIALIZED (
      SELECT
        lap_number AS pit_lap,
        pit_duration,
        ROW_NUMBER() OVER (ORDER BY lap_number) AS pit_sequence
      FROM raw.pit
      WHERE session_key = ${targetSession}
        AND driver_number = ${driverNumber}
    ),
    chosen AS MATERIALIZED (
      SELECT pit_lap, pit_duration, pit_sequence
      FROM pits
      WHERE ${sequencePredicate}
    ),
    laps AS MATERIALIZED (
      SELECT
        lap_number,
        MAX(lap_duration) AS lap_s,
        MAX(position_end_of_lap) AS pos,
        MAX(compound_name) AS compound,
        MAX(driver_name) AS driver_name
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND driver_number = ${driverNumber}
      GROUP BY lap_number
    ),
    venue AS MATERIALIZED (
      -- F04: venue metadata lives in core.sessions — a 1-row PK lookup —
      -- so this no longer re-scans the (large, unmaterialized) laps view.
      SELECT country_name, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    ),
    agg AS MATERIALIZED (
      SELECT
        c.pit_lap,
        c.pit_duration,
        c.pit_sequence,
        MAX(l.driver_name) AS full_name,
        MAX(CASE WHEN l.lap_number = c.pit_lap - 1 THEN l.lap_s END) AS in_lap_s,
        MAX(CASE WHEN l.lap_number = c.pit_lap + 1 THEN l.lap_s END) AS out_lap_s,
        MAX(CASE WHEN l.lap_number = c.pit_lap - 1 THEN l.compound END) AS compound_before,
        MAX(CASE WHEN l.lap_number = c.pit_lap + 1 THEN l.compound END) AS compound_after,
        MAX(CASE WHEN l.lap_number < c.pit_lap AND l.pos IS NOT NULL THEN l.lap_number END) AS before_lap,
        MIN(CASE WHEN l.lap_number > c.pit_lap AND l.pos IS NOT NULL THEN l.lap_number END) AS after_lap
      FROM chosen c
      CROSS JOIN laps l
      GROUP BY c.pit_lap, c.pit_duration, c.pit_sequence
    ),
    final AS MATERIALIZED (
      SELECT
        a.*,
        bl.pos AS before_position,
        al.pos AS after_position
      FROM agg a
      LEFT JOIN laps bl ON bl.lap_number = a.before_lap
      LEFT JOIN laps al ON al.lap_number = a.after_lap
    )
    SELECT
      ph.phase_label,
      ROUND(ph.duration_sec::numeric, 3) AS duration_sec,
      f.pit_lap AS stop_lap,
      ROUND(f.pit_duration::numeric, 3) AS total_pit_loss_s,
      NULL::numeric AS stationary_s,
      f.before_position,
      f.after_position,
      (
        SELECT MIN(l2.lap_number)
        FROM laps l2
        WHERE l2.lap_number > f.pit_lap
          AND l2.pos IS NOT NULL
          AND f.before_position IS NOT NULL
          AND l2.pos <= f.before_position
      ) AS recovered_by_lap,
      f.compound_before,
      f.compound_after,
      f.full_name,
      f.pit_sequence,
      v.country_name,
      v.year,
      v.session_name
    FROM final f
    CROSS JOIN venue v
    -- Strip phases. The left bar is the last green lap BEFORE the box
    -- (pit_lap - 1), not the in-lap itself (pit_lap, the slow pit lap whose
    -- duration would double-count the pit-lane loss shown separately).
    -- Labelled "Lap N" (not "In-lap") to stay consistent with the stop lap.
    -- The pit-lane segment IS the stop lap and pit_lap + 1 is the out-lap.
    -- NOTE keep this whole SQL free of the statement-separator character --
    -- the read-only SQL guard counts statements by splitting on it and would
    -- reject a query that contains one even inside a comment.
    CROSS JOIN LATERAL (VALUES
      ('Lap ' || (f.pit_lap - 1), f.in_lap_s, 1),
      ('Pit lane', f.pit_duration, 2),
      ('Out-lap (' || (f.pit_lap + 1) || ')', f.out_lap_s, 3)
    ) AS ph(phase_label, duration_sec, ord)
    ORDER BY ph.ord
  `;

  return { templateKey: "single_driver_pit_cycle", sql };
}
