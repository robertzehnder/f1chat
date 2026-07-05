import { sql } from "../db";
import { clampInt } from "../querySafety";
import type { SessionCompleteness } from "../types";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 250;

const TELEMETRY_TABLES = new Set(["car_data", "location", "intervals", "position_history"]);

// Phase 17 (post-deploy diagnostic 2026-05-02): the chatRuntime resolver
// coverage-bonus path called this 30+ times concurrently, each running a
// session-scoped COUNT(*). Caller only branches on `> 0`, so an EXISTS
// probe is sufficient and is bounded by index seek, not a row count.
function existsBySessionSql(table: string): string {
  return `SELECT (CASE WHEN EXISTS (SELECT 1 FROM ${table} WHERE session_key = $1) THEN 1 ELSE 0 END)::bigint AS row_count`;
}

const SESSION_TABLE_COUNT_TABLES: ReadonlyArray<string> = [
  "raw.sessions",
  "raw.drivers",
  "raw.laps",
  "raw.car_data",
  "raw.location",
  "raw.intervals",
  "raw.position_history",
  "raw.weather",
  "raw.race_control",
  "raw.pit",
  "raw.stints",
  "raw.team_radio",
  "raw.session_result",
  "raw.starting_grid",
  "raw.overtakes",
  "raw.championship_drivers",
  "raw.championship_teams",
  "core.sessions",
  "core.session_drivers",
  "core.lap_semantic_bridge",
  "core.laps_enriched",
  "core.driver_session_summary",
  "core.stint_summary",
  "core.strategy_summary",
  "core.pit_cycle_summary",
  "core.strategy_evidence_summary",
  "core.grid_vs_finish",
  "core.race_progression_summary",
  "core.lap_phase_summary",
  "core.telemetry_lap_bridge",
  "core.lap_context_summary",
  "core.replay_lap_frames"
];

// Coverage probes ask "is this relation populated for the session?" and
// callers branch on > 0 only. Every core.* relation in the probe list is
// an UNMATERIALIZED view (verified against pg_class 2026-06-10): EXISTS
// still executes the view body, and the aggregating ones cost 3–8s per
// probe on Neon (driver_session_summary ≈ 7.5s, laps_enriched ≈ 3.7s).
// On a 5-candidate weekend the sequential probe loop blew the 150s
// resolve deadline (seed-7 stint_delta Silverstone timeouts). Probe the
// base table that FEEDS each view instead — presence of feed rows is the
// same populated/empty signal at index-seek cost (10–16ms measured).
const PROBE_PROXY: Record<string, string> = {
  "core.sessions": "raw.sessions",
  "core.session_drivers": "raw.drivers",
  "core.laps_enriched": "raw.laps",
  "core.lap_semantic_bridge": "raw.laps",
  "core.driver_session_summary": "raw.laps",
  "core.stint_summary": "raw.stints",
  "core.strategy_summary": "raw.stints",
  "core.strategy_evidence_summary": "raw.stints",
  "core.pit_cycle_summary": "raw.pit",
  "core.grid_vs_finish": "raw.session_result",
  "core.race_progression_summary": "raw.position_history",
  "core.lap_phase_summary": "raw.laps",
  "core.lap_context_summary": "raw.laps",
  "core.telemetry_lap_bridge": "raw.laps",
  "core.replay_lap_frames": "raw.laps"
};

const SESSION_TABLE_COUNT_SQL: Record<string, string> = Object.fromEntries(
  SESSION_TABLE_COUNT_TABLES.map((t) => [t, existsBySessionSql(PROBE_PROXY[t] ?? t)])
);

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

export async function getSessionDriverPace(sessionKey: number): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      driver_number,
      driver_name,
      team_name,
      lap_count,
      valid_lap_count,
      best_lap,
      median_lap,
      avg_lap,
      best_valid_lap,
      median_valid_lap,
      best_s1,
      best_s2,
      best_s3,
      avg_s1,
      avg_s2,
      avg_s3
    FROM core.driver_session_summary
    WHERE session_key = $1
    ORDER BY best_valid_lap ASC NULLS LAST, best_lap ASC NULLS LAST
    `,
    [sessionKey]
  );
}

export async function getSessionStintTimeline(sessionKey: number): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      driver_number,
      driver_name,
      team_name,
      stint_number,
      compound_name,
      lap_start,
      lap_end,
      tyre_age_at_start,
      fresh_tyre,
      stint_length_laps,
      lap_count,
      valid_lap_count,
      avg_lap,
      best_lap,
      avg_valid_lap,
      best_valid_lap,
      degradation_per_lap
    FROM core.stint_summary
    WHERE session_key = $1
    ORDER BY driver_number ASC, stint_number ASC
    `,
    [sessionKey]
  );
}

export async function getSessionRaceProgression(sessionKey: number): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      driver_number,
      driver_name,
      team_name,
      lap_number,
      frame_time,
      position_end_of_lap,
      previous_position,
      positions_gained_this_lap,
      opening_position,
      latest_position,
      best_position,
      worst_position
    FROM core.race_progression_summary
    WHERE session_key = $1
    ORDER BY lap_number ASC, position_end_of_lap ASC NULLS LAST
    `,
    [sessionKey]
  );
}

export async function getSessionReplayFrames(sessionKey: number): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      lap_number,
      frame_time,
      leader_driver_number,
      leader_position,
      best_valid_lap_on_lap,
      avg_valid_lap_on_lap,
      weather_track_temperature,
      weather_air_temperature,
      race_control_flag
    FROM core.replay_lap_frames
    WHERE session_key = $1
    ORDER BY lap_number ASC
    `,
    [sessionKey]
  );
}

export async function getSessionStrategySummary(sessionKey: number): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      driver_number,
      driver_name,
      team_name,
      total_stints,
      pit_stop_count,
      compounds_used,
      strategy_type,
      total_pit_duration_seconds,
      pit_laps
    FROM core.strategy_summary
    WHERE session_key = $1
    ORDER BY driver_number ASC
    `,
    [sessionKey]
  );
}

type CatalogCompletenessFilters = {
  year?: number;
  status?: string;
  limit?: number;
  offset?: number;
};

export async function getCatalogCompleteness(
  filters?: CatalogCompletenessFilters
): Promise<Record<string, unknown>[]> {
  const limit = safeLimit(filters?.limit, 200, 500);
  const offset = clampInt(filters?.offset ?? 0, 0, 1_000_000);
  const status = filters?.status && filters.status.trim() ? filters.status.trim() : null;

  return sql<Record<string, unknown>>(
    `
    SELECT
      session_key,
      meeting_key,
      year,
      meeting_name,
      session_name,
      normalized_session_type,
      country_name,
      location,
      date_start,
      completeness_status,
      completeness_score,
      has_core_analysis_pack,
      has_drivers,
      has_laps,
      has_pit,
      has_stints,
      has_weather,
      has_team_radio,
      has_position_history,
      has_intervals,
      has_car_data,
      has_location,
      has_session_result,
      has_starting_grid,
      has_race_control
    FROM core.session_completeness
    WHERE
      ($1::int IS NULL OR year = $1)
      AND ($2::text IS NULL OR completeness_status = $2)
    ORDER BY date_start DESC NULLS LAST, session_key DESC
    LIMIT $3 OFFSET $4
    `,
    [filters?.year ?? null, status, limit, offset]
  );
}

// Phase 17 (post-deploy diagnostic 2026-05-02): per-session "is this table
// populated for sessionKey?" is also a stable answer (data only grows once
// ingested), so cache by `(sessionKey, tableName)`. Eliminates repeated
// cold-cache fetches on the same probe.
const sessionCountCache = new Map<string, Promise<number>>();

function loadSessionCount(sessionKey: number, tableName: string): Promise<number> {
  const text = SESSION_TABLE_COUNT_SQL[tableName];
  if (!text) return Promise.resolve(-1);
  return sql<{ row_count: number | string }>(text, [sessionKey]).then(
    (rows) => parseCountValue(rows[0]?.row_count),
    () => -1
  );
}

export async function getSessionTableCounts(
  sessionKey: number,
  tableNames: string[]
): Promise<Record<string, number>> {
  const unique = Array.from(new Set(tableNames));
  const counts: Record<string, number> = {};

  await Promise.all(
    unique.map(async (tableName) => {
      const key = `${sessionKey}|${tableName}`;
      let cached = sessionCountCache.get(key);
      if (!cached) {
        cached = loadSessionCount(sessionKey, tableName);
        sessionCountCache.set(key, cached);
      }
      const value = await cached;
      if (value < 0) sessionCountCache.delete(key);
      counts[tableName] = value;
    })
  );

  return counts;
}
