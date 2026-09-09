/**
 * Racing-state layer — pure builders (no DB, no React). Visuals plan S1.1.
 *
 *   buildRacingStateLayer  rows from analytics.racing_state_intervals +
 *                          sector-yellow rows from raw.race_control → layer
 *                          with source classification and honesty notes.
 *   trustedSessionKey      the ONLY rule by which a layer may be attached to
 *                          a result set: the resolved session must be the
 *                          one the rows are about. Ambiguity → no layer.
 *   attachRacingStateToChart  lap-axis charts get `racing_state`; the
 *                          legacy track_flag bands / lap-time heuristic are
 *                          dropped when the record is available, kept (and
 *                          labelled heuristic by the renderer) when absent.
 */
import type {
  ChartSpec,
  ChartType,
  RacingStateKind,
  RacingStateLayer,
  RacingStatePeriod,
  SectorFlagObservation
} from "@/lib/chart-types";
import { extractSessionKeyLiterals } from "@/lib/sqlValidation/sessionKeyExtraction";

export const LAP_AXIS_CHART_TYPES: ReadonlySet<ChartType> = new Set<ChartType>([
  "race_trace",
  "position_changes",
  "line_with_stint_markers"
]);

export type RacingStateIntervalRow = {
  kind: string;
  start_ts: string | Date;
  end_ts: string | Date | null;
  start_lap: number | string | null;
  end_lap: number | string | null;
  endpoint_inferred: string | null;
  opened_by_message: string | null;
  closed_by_message: string | null;
};

export type SectorFlagRow = {
  lap_number: number | string | null;
  sector: number | string | null;
  flag: string | null;
  date: string | Date | null;
};

const iso = (v: string | Date | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);
const int = (v: unknown): number | null => {
  if (v == null || v === "") return null; // Number(null) is 0 — never a lap or a key
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Endpoint codes whose timestamp is a real message (the period was cut
 *  short by the next state message or the restart). Exact, no glyph. */
const EXACT_CLOSURE = /^(superseded_by_|resumption_state_msg$)/;

/** True when the period's end is inferred (lap-end / message-time guesses,
 *  or never closed) — draws the inferred-end glyph and a note. */
export function isInferredEnd(code: string | null | undefined): boolean {
  if (!code) return false;
  return !EXACT_CLOSURE.test(code);
}

const KIND_LABEL: Record<RacingStateKind, string> = { sc: "SC", vsc: "VSC", red: "Red flag" };

function inferredReason(kind: RacingStateKind, code: string): string {
  if (code.startsWith("ending_")) return `no ${KIND_LABEL[kind]} end message recorded`;
  if (code.startsWith("lights_on_") || code.startsWith("in_this_lap_")) return "end of the SC-in lap, no end message recorded";
  if (code === "unclosed_at_chequered" || code === "never_closed") return "no end message before the chequered flag";
  return `end code ${code}`;
}

export function buildRacingStateLayer(input: {
  sessionKey: number | null;
  intervalRows: RacingStateIntervalRow[];
  sectorRows: SectorFlagRow[];
  raceControlRowCount: number;
  hasChequered: boolean;
  totalLaps?: number | null;
}): RacingStateLayer {
  const { sessionKey, intervalRows, sectorRows, raceControlRowCount, hasChequered } = input;
  if (raceControlRowCount === 0) {
    return {
      source: "absent",
      session_key: sessionKey,
      periods: [],
      sector_flags: [],
      notes: ["race-control feed unavailable for this session; cautions not shown"],
      total_laps: input.totalLaps ?? null
    };
  }
  const periods: RacingStatePeriod[] = intervalRows
    .map((r): RacingStatePeriod | null => {
      const kind = String(r.kind ?? "").toLowerCase();
      if (kind !== "sc" && kind !== "vsc" && kind !== "red") return null;
      const from = int(r.start_lap);
      if (from == null) return null;
      return {
        kind,
        start_ts: iso(r.start_ts) ?? "",
        end_ts: iso(r.end_ts),
        from_lap: from,
        to_lap: int(r.end_lap),
        endpoint_inferred: r.endpoint_inferred ?? null,
        opened_by: r.opened_by_message ?? null,
        closed_by: r.closed_by_message ?? null
      };
    })
    .filter((p): p is RacingStatePeriod => p !== null)
    .sort((a, b) => a.start_ts.localeCompare(b.start_ts));

  const sector_flags: SectorFlagObservation[] = sectorRows
    .map((r): SectorFlagObservation | null => {
      const lap = int(r.lap_number);
      const sector = int(r.sector);
      const flag = String(r.flag ?? "").toUpperCase();
      if (lap == null || sector == null || lap <= 0) return null;
      if (!/YELLOW/.test(flag)) return null;
      return {
        lap,
        sector,
        level: /DOUBLE/.test(flag) ? "double_yellow" : "yellow",
        issued_at: iso(r.date) ?? ""
      };
    })
    .filter((f): f is SectorFlagObservation => f !== null)
    .sort((a, b) => a.lap - b.lap || a.sector - b.sector);
  // The feed re-issues the same sector yellow within a lap; one tick per
  // (lap, sector), the stronger level winning, earliest issue time kept.
  const dedup = new Map<string, SectorFlagObservation>();
  for (const f of sector_flags) {
    const k = `${f.lap}:${f.sector}`;
    const prev = dedup.get(k);
    if (!prev) dedup.set(k, f);
    else if (prev.level === "yellow" && f.level === "double_yellow") dedup.set(k, { ...f, issued_at: prev.issued_at });
  }
  const sectorFlagsUnique = [...dedup.values()];

  const notes: string[] = [];
  for (const p of periods) {
    if (!isInferredEnd(p.endpoint_inferred)) continue;
    const where = p.to_lap == null ? "never closed" : `placed at L${p.to_lap} end`;
    notes.push(`${KIND_LABEL[p.kind]} end ${where}; ${inferredReason(p.kind, p.endpoint_inferred!)}`);
  }
  if (!hasChequered) notes.push("race-control feed ends before the chequered flag; later cautions may be missing");
  return {
    source: notes.length ? "incomplete" : "available",
    session_key: sessionKey,
    periods,
    sector_flags: sectorFlagsUnique,
    notes,
    total_laps: input.totalLaps ?? null
  };
}

export function failedRacingStateLayer(sessionKey: number | null): RacingStateLayer {
  return {
    source: "failed",
    session_key: sessionKey,
    periods: [],
    sector_flags: [],
    notes: ["race-control state unavailable; cautions not shown"]
  };
}

/**
 * The attachment rule. Returns the session key the layer may be loaded for,
 * or null when the rows cannot be trusted to belong to the resolved session:
 *   - rows carry a session_key column → it must be a single value equal to
 *     the resolved key;
 *   - deterministic templates are built for the resolved session → trusted;
 *   - LLM SQL → exactly one session_key literal in the SQL, equal to the
 *     resolved key. Multi-session or unresolvable SQL → null.
 */
export function trustedSessionKey(input: {
  resolvedSessionKey: number | null | undefined;
  deterministicTemplate: boolean;
  sql: string | null | undefined;
  rows: Record<string, unknown>[];
}): number | null {
  const resolved = int(input.resolvedSessionKey);
  if (resolved == null) return null;
  const rows = input.rows ?? [];
  if (rows.length && rows.some((r) => "session_key" in r)) {
    const distinct = new Set(rows.map((r) => int(r.session_key)).filter((v): v is number => v != null));
    return distinct.size === 1 && distinct.has(resolved) ? resolved : null;
  }
  if (input.deterministicTemplate) return resolved;
  const literals = [...new Set(extractSessionKeyLiterals(input.sql ?? ""))];
  return literals.length === 1 && literals[0] === resolved ? resolved : null;
}

/** Fold-side attachment. Pure: returns a new spec, never mutates. */
export function attachRacingStateToChart(chart: ChartSpec, state: RacingStateLayer): ChartSpec {
  if (!LAP_AXIS_CHART_TYPES.has(chart.type)) return chart;
  const next: ChartSpec = { ...chart, racing_state: state };
  if (state.source === "available" || state.source === "incomplete") {
    // The record replaces the lossy track_flag bands and the lap-time
    // heuristic; an honest absence of periods draws nothing.
    delete next.caution_bands;
    delete next.neutralized_laps;
  }
  return next;
}
