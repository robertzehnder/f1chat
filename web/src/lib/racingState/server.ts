/**
 * Racing-state layer — server side (visuals plan S1.1). Loads the 062 view
 * and the sector-yellow messages for ONE trusted race session and attaches
 * the layer to a chat payload. Never throws: a load failure becomes
 * source="failed" with its note, so the chart says so instead of drawing
 * nothing silently.
 */
import { sql } from "@/lib/db";
import type { RacingStateLayer } from "@/lib/chart-types";
import {
  HEURISTIC_SC_METRIC_LABEL,
  HEURISTIC_SC_SENTENCE_RE,
  HEURISTIC_SC_TAKEAWAY_RE,
  describeRacingStateForTrace
} from "@/lib/synthesis/raceTraceInsight";
import {
  buildRacingStateLayer,
  failedRacingStateLayer,
  trustedSessionKey,
  type RacingStateIntervalRow,
  type SectorFlagRow
} from "./build";

type SessionMeta = { session_type: string | null; total_laps: number | string | null };

export async function loadRacingState(sessionKey: number): Promise<RacingStateLayer> {
  try {
    const [intervalRows, sectorRows, feed] = await Promise.all([
      sql<RacingStateIntervalRow>(
        `SELECT kind, start_ts, end_ts, start_lap, end_lap, endpoint_inferred, opened_by_message, closed_by_message
         FROM analytics.racing_state_intervals WHERE session_key = $1 ORDER BY start_ts, interval_no`,
        [sessionKey]
      ),
      sql<SectorFlagRow>(
        `SELECT lap_number, sector, flag, date FROM raw.race_control
         WHERE session_key = $1 AND category = 'Flag' AND scope = 'Sector'
           AND UPPER(COALESCE(flag, '')) LIKE '%YELLOW%' ORDER BY date, id`,
        [sessionKey]
      ),
      sql<{ n: string | number; chq: boolean | null; total_laps: string | number | null }>(
        `SELECT (SELECT COUNT(*) FROM raw.race_control WHERE session_key = $1) AS n,
                (SELECT bool_or(UPPER(COALESCE(message, '')) LIKE 'CHEQUERED%') FROM raw.race_control WHERE session_key = $1) AS chq,
                (SELECT MAX(lap_number) FROM raw.laps WHERE session_key = $1) AS total_laps`,
        [sessionKey]
      )
    ]);
    const f = feed[0];
    return buildRacingStateLayer({
      sessionKey,
      intervalRows,
      sectorRows,
      raceControlRowCount: Number(f?.n ?? 0),
      hasChequered: f?.chq === true,
      totalLaps: f?.total_laps == null ? null : Number(f.total_laps)
    });
  } catch {
    return failedRacingStateLayer(sessionKey);
  }
}

async function isRaceSession(sessionKey: number): Promise<boolean> {
  try {
    const rows = await sql<SessionMeta>(
      `SELECT session_type, NULL::int AS total_laps FROM core.sessions WHERE session_key = $1 LIMIT 1`,
      [sessionKey]
    );
    return String(rows[0]?.session_type ?? "").toLowerCase() === "race";
  } catch {
    return false;
  }
}

/**
 * Attach `racingState` to a successful chat payload when (a) the turn
 * produced rows, (b) the resolved session is a race, and (c) the rows are
 * trusted to belong to it. Mutates the payload in place (it is the route
 * outcome, about to be persisted and sent).
 */
export async function attachRacingStateToPayload(payload: Record<string, unknown>): Promise<void> {
  const result = payload.result as { rows?: Record<string, unknown>[] } | undefined;
  const rows = result?.rows ?? [];
  if (!rows.length) return;
  const runtime = payload.runtime as { resolution?: { selectedSession?: { sessionKey?: number } } } | undefined;
  const resolvedSessionKey = runtime?.resolution?.selectedSession?.sessionKey ?? null;
  const key = trustedSessionKey({
    resolvedSessionKey,
    deterministicTemplate: payload.generationSource === "deterministic_template",
    sql: typeof payload.sql === "string" ? payload.sql : null,
    rows
  });
  if (key == null) return;
  if (!(await isRaceSession(key))) return;
  const layer = await loadRacingState(key);
  payload.racingState = layer;
  reconcileRaceTraceProse(payload, layer);
}

/**
 * The deterministic race-trace card's prose describes SC/VSC windows from a
 * lap-time heuristic and says so. Once the record is attached the chart draws
 * the record, so the sentence, the metric tile and the takeaway are replaced
 * with the race-control periods. Pure string/JSON surgery on strings the
 * builder itself exports — anything else is left untouched.
 */
export function reconcileRaceTraceProse(payload: Record<string, unknown>, layer: RacingStateLayer): void {
  if (layer.source !== "available" && layer.source !== "incomplete") return;
  const rec = describeRacingStateForTrace(layer);
  if (typeof payload.answer === "string" && HEURISTIC_SC_SENTENCE_RE.test(payload.answer)) {
    payload.answer = payload.answer.replace(HEURISTIC_SC_SENTENCE_RE, rec.sentence);
  }
  const insight = payload.insight as
    | { metrics?: Array<{ label: string; value: string; context?: string }>; key_takeaways?: string[] }
    | null
    | undefined;
  if (!insight) return;
  if (Array.isArray(insight.metrics)) {
    insight.metrics = insight.metrics.map((m) => (m.label === HEURISTIC_SC_METRIC_LABEL ? rec.metric : m));
  }
  if (Array.isArray(insight.key_takeaways)) {
    insight.key_takeaways = insight.key_takeaways.map((t) => (HEURISTIC_SC_TAKEAWAY_RE.test(t) ? rec.takeaway : t));
  }
}
