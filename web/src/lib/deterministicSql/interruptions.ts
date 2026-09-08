import type { DeterministicSqlTemplate } from "./types";

/**
 * Session interruptions card (analyst probe honesty fix G3): "which laps had
 * a safety car / VSC / red flag at <race>?", "how many disrupted laps",
 * "was it won on pure pace / without a safety car?".
 *
 * Sources analytics.racing_state_intervals (migration 062) — SC/VSC/red
 * periods with the exact temporal contract of the analyst packet, including
 * inferred endpoints flagged in endpoint_inferred. The LLM route fabricated
 * the ABSENCE of a VSC at Monza 2026 ("zero disrupted laps") because VSC rows
 * carry category='SafetyCar', flag=NULL and only the message text; this card
 * answers from the materialised periods and, when there are none, says so
 * from a query rather than a guess: the SQL emits one sentinel row
 * (kind='none') so the builder can state a data-backed absence.
 *
 * Output rows match the event_timeline detector: lap + kind + driver.
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildInterruptionsTemplateInput = {
  lower: string;
  targetSession: number;
};

const INTERRUPTION_TRIGGER =
  /safety car|virtual safety|\bvsc\b|red flag|red-flag|interrupt|neutrali[sz]|disrupted lap|caution period|pure pace|without a safety car/;

export function buildInterruptionsTemplate(
  input: BuildInterruptionsTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession } = input;
  if (!INTERRUPTION_TRIGGER.test(lower)) return null;

  const sql = `
    WITH periods AS (
      SELECT interval_no, kind, start_lap, end_lap, laps_affected, duration_s,
             endpoint_inferred, opened_by_message, closed_by_message, start_ts
      FROM analytics.racing_state_intervals
      WHERE session_key = ${targetSession}
    ),
    sess AS (
      SELECT country_name, location, circuit_short_name, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    ),
    has_rc AS (
      SELECT COUNT(*) AS n FROM raw.race_control WHERE session_key = ${targetSession}
    ),
    rows_out AS (
      SELECT
        COALESCE(p.start_lap, 0) AS lap,
        'Race control'::text AS driver,
        p.kind AS kind,
        p.opened_by_message AS message,
        p.end_lap,
        p.laps_affected,
        p.duration_s,
        p.endpoint_inferred,
        p.closed_by_message,
        p.start_ts
      FROM periods p
      UNION ALL
      SELECT 0, 'Race control', 'none', 'no SC / VSC / red-flag period in the race-control feed',
             NULL, 0, NULL, NULL, NULL, NULL
      WHERE NOT EXISTS (SELECT 1 FROM periods) AND (SELECT n FROM has_rc) > 0
    )
    SELECT
      r.lap, r.driver, r.kind, r.message, r.end_lap, r.laps_affected, r.duration_s,
      r.endpoint_inferred, r.closed_by_message,
      (SELECT n FROM has_rc) AS race_control_rows,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM rows_out r
    ORDER BY r.start_ts NULLS LAST
    LIMIT 40
  `;

  return { templateKey: "session_interruptions", sql };
}
