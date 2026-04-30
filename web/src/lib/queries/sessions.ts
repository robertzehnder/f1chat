import { sql } from "../db";
import { clampInt } from "../querySafety";
import type { SessionCompleteness } from "../types";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 250;

const TELEMETRY_TABLES = new Set(["car_data", "location", "intervals", "position_history"]);

const SESSION_TABLE_COUNT_SQL: Record<string, string> = {
  "raw.sessions": "SELECT COUNT(*)::bigint AS row_count FROM raw.sessions WHERE session_key = $1",
  "raw.drivers": "SELECT COUNT(*)::bigint AS row_count FROM raw.drivers WHERE session_key = $1",
  "raw.laps": "SELECT COUNT(*)::bigint AS row_count FROM raw.laps WHERE session_key = $1",
  "raw.car_data": "SELECT COUNT(*)::bigint AS row_count FROM raw.car_data WHERE session_key = $1",
  "raw.location": "SELECT COUNT(*)::bigint AS row_count FROM raw.location WHERE session_key = $1",
  "raw.intervals": "SELECT COUNT(*)::bigint AS row_count FROM raw.intervals WHERE session_key = $1",
  "raw.position_history": "SELECT COUNT(*)::bigint AS row_count FROM raw.position_history WHERE session_key = $1",
  "raw.weather": "SELECT COUNT(*)::bigint AS row_count FROM raw.weather WHERE session_key = $1",
  "raw.race_control": "SELECT COUNT(*)::bigint AS row_count FROM raw.race_control WHERE session_key = $1",
  "raw.pit": "SELECT COUNT(*)::bigint AS row_count FROM raw.pit WHERE session_key = $1",
  "raw.stints": "SELECT COUNT(*)::bigint AS row_count FROM raw.stints WHERE session_key = $1",
  "raw.team_radio": "SELECT COUNT(*)::bigint AS row_count FROM raw.team_radio WHERE session_key = $1",
  "raw.session_result": "SELECT COUNT(*)::bigint AS row_count FROM raw.session_result WHERE session_key = $1",
  "raw.starting_grid": "SELECT COUNT(*)::bigint AS row_count FROM raw.starting_grid WHERE session_key = $1",
  "raw.overtakes": "SELECT COUNT(*)::bigint AS row_count FROM raw.overtakes WHERE session_key = $1",
  "raw.championship_drivers":
    "SELECT COUNT(*)::bigint AS row_count FROM raw.championship_drivers WHERE session_key = $1",
  "raw.championship_teams":
    "SELECT COUNT(*)::bigint AS row_count FROM raw.championship_teams WHERE session_key = $1",
  "core.sessions": "SELECT COUNT(*)::bigint AS row_count FROM core.sessions WHERE session_key = $1",
  "core.session_drivers": "SELECT COUNT(*)::bigint AS row_count FROM core.session_drivers WHERE session_key = $1",
  "core.lap_semantic_bridge":
    "SELECT COUNT(*)::bigint AS row_count FROM core.lap_semantic_bridge WHERE session_key = $1",
  "core.laps_enriched":
    "SELECT COUNT(*)::bigint AS row_count FROM core.laps_enriched WHERE session_key = $1",
  "core.driver_session_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.driver_session_summary WHERE session_key = $1",
  "core.stint_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.stint_summary WHERE session_key = $1",
  "core.strategy_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.strategy_summary WHERE session_key = $1",
  "core.pit_cycle_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.pit_cycle_summary WHERE session_key = $1",
  "core.strategy_evidence_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.strategy_evidence_summary WHERE session_key = $1",
  "core.grid_vs_finish":
    "SELECT COUNT(*)::bigint AS row_count FROM core.grid_vs_finish WHERE session_key = $1",
  "core.race_progression_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.race_progression_summary WHERE session_key = $1",
  "core.lap_phase_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.lap_phase_summary WHERE session_key = $1",
  "core.telemetry_lap_bridge":
    "SELECT COUNT(*)::bigint AS row_count FROM core.telemetry_lap_bridge WHERE session_key = $1",
  "core.lap_context_summary":
    "SELECT COUNT(*)::bigint AS row_count FROM core.lap_context_summary WHERE session_key = $1",
  "core.replay_lap_frames":
    "SELECT COUNT(*)::bigint AS row_count FROM core.replay_lap_frames WHERE session_key = $1"
};

function nullableLike(value?: string): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  return `%${value.trim()}%`;
}

function safeLimit(value: number | undefined, fallback: number, max: number): number {
  return clampInt(value ?? fallback, 1, max);
}

function parseCountValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getSessions(filters: {
  year?: number;
  country?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<Record<string, unknown>[]> {
  const limit = safeLimit(filters.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = clampInt(filters.offset ?? 0, 0, 1_000_000);

  return sql<Record<string, unknown>>(
    `
    SELECT
      s.session_key,
      s.meeting_key,
      s.session_name,
      s.session_type,
      s.date_start,
      s.year,
      s.country_name,
      s.location,
      s.circuit_short_name,
      s.meeting_name,
      (SELECT COUNT(*) FROM raw.drivers d WHERE d.session_key = s.session_key) AS driver_count,
      (SELECT COUNT(*) FROM raw.laps l WHERE l.session_key = s.session_key) AS lap_rows,
      (SELECT COUNT(*) FROM raw.intervals i WHERE i.session_key = s.session_key) AS interval_rows,
      (SELECT COUNT(*) FROM raw.position_history p WHERE p.session_key = s.session_key) AS position_rows,
      (SELECT COUNT(*) FROM raw.car_data c WHERE c.session_key = s.session_key) AS car_rows,
      (SELECT COUNT(*) FROM raw.location loc WHERE loc.session_key = s.session_key) AS location_rows
    FROM core.sessions s
    WHERE
      ($1::int IS NULL OR s.year = $1)
      AND ($2::text IS NULL OR s.country_name ILIKE $2)
      AND (
        $3::text IS NULL
        OR s.meeting_name ILIKE $3
        OR s.location ILIKE $3
        OR s.circuit_short_name ILIKE $3
      )
    ORDER BY s.date_start DESC NULLS LAST
    LIMIT $4 OFFSET $5
    `,
    [filters.year ?? null, nullableLike(filters.country), nullableLike(filters.search), limit, offset]
  );
}

export async function getSessionByKey(sessionKey: number): Promise<Record<string, unknown> | null> {
  const rows = await sql<Record<string, unknown>>(
    `
    SELECT *
    FROM core.sessions
    WHERE session_key = $1
    LIMIT 1
    `,
    [sessionKey]
  );
  return rows[0] ?? null;
}

export async function getSessionDrivers(sessionKey: number): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT *
    FROM core.session_drivers
    WHERE session_key = $1
    ORDER BY driver_number ASC NULLS LAST
    `,
    [sessionKey]
  );
}

export async function getSessionLaps(args: {
  sessionKey: number;
  driverNumber?: number;
  limit?: number;
  offset?: number;
}): Promise<Record<string, unknown>[]> {
  const limit = safeLimit(args.limit, 200, 1000);
  const offset = clampInt(args.offset ?? 0, 0, 1_000_000);

  return sql<Record<string, unknown>>(
    `
    SELECT
      session_key,
      driver_number,
      lap_number,
      lap_duration,
      duration_sector_1,
      duration_sector_2,
      duration_sector_3,
      is_pit_out_lap,
      date_start
    FROM raw.laps
    WHERE session_key = $1
      AND ($2::int IS NULL OR driver_number = $2)
    ORDER BY lap_number ASC NULLS LAST, driver_number ASC NULLS LAST
    LIMIT $3 OFFSET $4
    `,
    [args.sessionKey, args.driverNumber ?? null, limit, offset]
  );
}

export async function getSessionWeather(sessionKey: number, limit = 500): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT *
    FROM raw.weather
    WHERE session_key = $1
    ORDER BY date ASC NULLS LAST
    LIMIT $2
    `,
    [sessionKey, safeLimit(limit, 500, 5000)]
  );
}

export async function getSessionRaceControl(sessionKey: number, limit = 500): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      session_key,
      date,
      category,
      flag,
      scope,
      sector,
      lap_number,
      driver_number,
      message
    FROM raw.race_control
    WHERE session_key = $1
    ORDER BY date ASC NULLS LAST
    LIMIT $2
    `,
    [sessionKey, safeLimit(limit, 500, 5000)]
  );
}

export async function getSessionTelemetry(args: {
  sessionKey: number;
  table: string;
  driverNumber?: number;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  if (!TELEMETRY_TABLES.has(args.table)) {
    throw new Error(`Unsupported telemetry table: ${args.table}`);
  }

  const limit = safeLimit(args.limit, 1000, 10000);
  const table = args.table;

  const text = `
    SELECT *
    FROM raw.${table}
    WHERE session_key = $1
      AND ($2::int IS NULL OR driver_number = $2)
      AND ($3::timestamptz IS NULL OR date >= $3)
      AND ($4::timestamptz IS NULL OR date <= $4)
    ORDER BY date ASC NULLS LAST
    LIMIT $5
  `;

  return sql<Record<string, unknown>>(text, [
    args.sessionKey,
    args.driverNumber ?? null,
    args.fromDate ?? null,
    args.toDate ?? null,
    limit
  ]);
}

export async function getSessionCompleteness(sessionKey: number): Promise<SessionCompleteness | null> {
  const rows = await sql<SessionCompleteness>(
    `
    SELECT
      session_key,
      meeting_key,
      session_type,
      normalized_session_type,
      is_future_session,
      is_placeholder,
      completeness_status,
      completeness_score,
      has_meeting_name,
      has_core_analysis_pack,
      has_drivers,
      has_laps,
      has_intervals,
      has_position_history,
      has_car_data,
      has_location,
      has_weather,
      has_race_control,
      has_pit,
      has_stints,
      has_team_radio,
      has_session_result,
      has_starting_grid,
      drivers_rows AS driver_rows,
      laps_rows AS lap_rows,
      intervals_rows AS interval_rows,
      position_history_rows AS position_rows,
      car_data_rows AS car_rows,
      location_rows,
      weather_rows,
      race_control_rows,
      pit_rows,
      team_radio_rows,
      session_result_rows,
      starting_grid_rows
    FROM core.session_completeness
    WHERE session_key = $1
    LIMIT 1
    `,
    [sessionKey]
  );
  return rows[0] ?? null;
}

export async function getSessionTableCounts(
  sessionKey: number,
  tableNames: string[]
): Promise<Record<string, number>> {
  const unique = Array.from(new Set(tableNames));
  const counts: Record<string, number> = {};

  await Promise.all(
    unique.map(async (tableName) => {
      const text = SESSION_TABLE_COUNT_SQL[tableName];
      if (!text) {
        counts[tableName] = -1;
        return;
      }
      const rows = await sql<{ row_count: number | string }>(text, [sessionKey]);
      counts[tableName] = parseCountValue(rows[0]?.row_count);
    })
  );

  return counts;
}
