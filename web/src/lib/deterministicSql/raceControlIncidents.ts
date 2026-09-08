import type { DeterministicSqlTemplate } from "./types";

/**
 * Session steward/penalty incidents card (M15) — "how many penalty points
 * were issued by stewards at <race>?" Sources analytics.race_control_incidents.
 *
 * Honesty contract: FIA penalty POINTS are not ingested (penalty_points is
 * always NULL in this warehouse) — the insight builder states that
 * explicitly and reports what IS recorded: incident count, penalised
 * incidents, penalty seconds. Without this template the LLM repeatedly
 * fails to express that nuance in one valid statement (2025 São Paulo
 * incident: sql_generation_failed after auto-repair).
 *
 * Output rows match the event_timeline detector: lap + kind + driver.
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildRaceControlIncidentsTemplateInput = {
  lower: string;
  targetSession: number;
  /** Resolved drivers (1–2): rows are filtered to those cars and the
   *  builder switches to a driver-focused answer for off-track questions. */
  driverNumbers?: number[] | null;
};

const OFFTRACK_TRIGGER = /gravel|ran wide|run wide|off[\s-]?track|excursion|went off|lap deleted|deleted lap|track limits/;

const INCIDENT_TRIGGER = /penalt|steward|investigat|reprimand|track limits|drive[\s-]?through|gravel|ran wide|run wide|off[\s-]?track|excursion|went off|lap deleted|deleted lap|black and white/;

export function buildRaceControlIncidentsTemplate(
  input: BuildRaceControlIncidentsTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverNumbers } = input;
  if (!INCIDENT_TRIGGER.test(lower)) return null;
  const focus = (driverNumbers ?? []).filter((n) => Number.isInteger(n)).slice(0, 2);
  const list = focus.join(", ");
  const driverFilter = focus.length ? `AND (driver_number IN (${list}) OR second_driver_number IN (${list}))` : "";
  const mode = OFFTRACK_TRIGGER.test(lower) && focus.length ? "offtrack" : "stewards";

  const sql = `
    WITH inc AS (
      SELECT DISTINCT
        lap_number,
        occurred_lap,
        driver_number,
        incident_kind,
        action_status,
        penalty_seconds,
        penalty_points,
        message_text,
        source_kind,
        NULLIF((regexp_match(UPPER(message_text), 'TURN\\s+(\\d+)'))[1], '')::int AS corner,
        date
      FROM analytics.race_control_incidents
      WHERE session_key = ${targetSession}
      ${driverFilter}
    ),
    names AS (
      SELECT DISTINCT driver_number, full_name
      FROM core.session_drivers
      WHERE session_key = ${targetSession}
    ),
    sess AS (
      SELECT country_name, location, circuit_short_name, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    )
    SELECT
      COALESCE(i.lap_number, 0) AS lap,
      COALESCE(n.full_name, 'Race control') AS driver,
      COALESCE(i.incident_kind, 'incident') AS kind,
      i.message_text AS message,
      i.action_status,
      i.source_kind,
      i.occurred_lap,
      i.corner,
      '${mode}'::text AS question_mode,
      ROUND(i.penalty_seconds::numeric, 1) AS penalty_seconds,
      i.penalty_points,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM inc i
    LEFT JOIN names n USING (driver_number)
    ORDER BY COALESCE(i.lap_number, 0), i.date
    LIMIT 60
  `;

  return { templateKey: "session_race_control_incidents", sql };
}
