import { sql, pool } from "./db";
import { assertReadOnlySql, clampInt } from "./querySafety";
import type { QueryRunResult, SessionCompleteness } from "./types";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 250;
const DEFAULT_QUERY_MAX_ROWS = Number(process.env.OPENF1_QUERY_MAX_ROWS ?? "2000");
const DEFAULT_PREVIEW_MAX_ROWS = Number(process.env.OPENF1_PREVIEW_MAX_ROWS ?? "200");
const DEFAULT_QUERY_TIMEOUT_MS = Number(process.env.OPENF1_QUERY_TIMEOUT_MS ?? "15000");

const TELEMETRY_TABLES = new Set(["car_data", "location", "intervals", "position_history"]);

export type SessionResolutionRow = {
  session_key: number;
  meeting_key: number | null;
  session_name: string | null;
  session_type: string | null;
  year: number | null;
  country_name: string | null;
  location: string | null;
  circuit_short_name: string | null;
  meeting_name: string | null;
  date_start: string | null;
};

export type DriverResolutionRow = {
  session_key?: number | null;
  driver_number: number;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  name_acronym: string | null;
  broadcast_name: string | null;
  team_name: string | null;
};

function normalizeAliasList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").toLowerCase().trim())
        .filter((value) => value.length >= 2)
    )
  );
}

const GLOBAL_TABLE_COUNT_SQL: Record<string, string> = {
  "raw.sessions": "SELECT COUNT(*)::bigint AS row_count FROM raw.sessions",
  "raw.drivers": "SELECT COUNT(*)::bigint AS row_count FROM raw.drivers",
  "raw.laps": "SELECT COUNT(*)::bigint AS row_count FROM raw.laps",
  "raw.car_data": "SELECT COUNT(*)::bigint AS row_count FROM raw.car_data",
  "raw.location": "SELECT COUNT(*)::bigint AS row_count FROM raw.location",
  "raw.intervals": "SELECT COUNT(*)::bigint AS row_count FROM raw.intervals",
  "raw.position_history": "SELECT COUNT(*)::bigint AS row_count FROM raw.position_history",
  "raw.weather": "SELECT COUNT(*)::bigint AS row_count FROM raw.weather",
  "raw.race_control": "SELECT COUNT(*)::bigint AS row_count FROM raw.race_control",
  "raw.pit": "SELECT COUNT(*)::bigint AS row_count FROM raw.pit",
  "raw.stints": "SELECT COUNT(*)::bigint AS row_count FROM raw.stints",
  "raw.team_radio": "SELECT COUNT(*)::bigint AS row_count FROM raw.team_radio",
  "raw.session_result": "SELECT COUNT(*)::bigint AS row_count FROM raw.session_result",
  "raw.starting_grid": "SELECT COUNT(*)::bigint AS row_count FROM raw.starting_grid",
  "raw.overtakes": "SELECT COUNT(*)::bigint AS row_count FROM raw.overtakes",
  "raw.championship_drivers": "SELECT COUNT(*)::bigint AS row_count FROM raw.championship_drivers",
  "raw.championship_teams": "SELECT COUNT(*)::bigint AS row_count FROM raw.championship_teams",
  "core.sessions": "SELECT COUNT(*)::bigint AS row_count FROM core.sessions",
  "core.session_drivers": "SELECT COUNT(*)::bigint AS row_count FROM core.session_drivers",
  "core.lap_semantic_bridge": "SELECT COUNT(*)::bigint AS row_count FROM core.lap_semantic_bridge",
  "core.laps_enriched": "SELECT COUNT(*)::bigint AS row_count FROM core.laps_enriched",
  "core.driver_session_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.driver_session_summary",
  "core.stint_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.stint_summary",
  "core.strategy_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.strategy_summary",
  "core.pit_cycle_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.pit_cycle_summary",
  "core.strategy_evidence_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.strategy_evidence_summary",
  "core.grid_vs_finish": "SELECT COUNT(*)::bigint AS row_count FROM core.grid_vs_finish",
  "core.race_progression_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.race_progression_summary",
  "core.lap_phase_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.lap_phase_summary",
  "core.telemetry_lap_bridge": "SELECT COUNT(*)::bigint AS row_count FROM core.telemetry_lap_bridge",
  "core.lap_context_summary": "SELECT COUNT(*)::bigint AS row_count FROM core.lap_context_summary",
  "core.replay_lap_frames": "SELECT COUNT(*)::bigint AS row_count FROM core.replay_lap_frames"
};

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

export async function getOverviewStats(): Promise<Record<string, unknown>> {
  // Full COUNT(*) on raw.laps / car_data / location can exceed statement_timeout on large DBs.
  // pg_stat_all_tables.n_live_tup is an approximate live row count (updated by ANALYZE / autovacuum).
  const rows = await sql<Record<string, unknown>>(
    `
    SELECT
      COALESCE(SUM(CASE WHEN c.relname = 'sessions' THEN COALESCE(st.n_live_tup, 0) ELSE 0 END), 0)::bigint AS sessions,
      COALESCE(SUM(CASE WHEN c.relname = 'drivers' THEN COALESCE(st.n_live_tup, 0) ELSE 0 END), 0)::bigint AS drivers,
      COALESCE(SUM(CASE WHEN c.relname = 'laps' THEN COALESCE(st.n_live_tup, 0) ELSE 0 END), 0)::bigint AS laps,
      COALESCE(SUM(CASE WHEN c.relname = 'intervals' THEN COALESCE(st.n_live_tup, 0) ELSE 0 END), 0)::bigint AS intervals,
      COALESCE(SUM(CASE WHEN c.relname = 'car_data' THEN COALESCE(st.n_live_tup, 0) ELSE 0 END), 0)::bigint AS car_data,
      COALESCE(SUM(CASE WHEN c.relname = 'location' THEN COALESCE(st.n_live_tup, 0) ELSE 0 END), 0)::bigint AS location
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_all_tables st ON st.relid = c.oid
    WHERE n.nspname = 'raw'
      AND c.relkind = 'r'
      AND c.relname IN (
        'sessions',
        'drivers',
        'laps',
        'intervals',
        'car_data',
        'location'
      )
    `
  );
  return rows[0] ?? {};
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

export async function getSessionsForResolution(filters: {
  year?: number;
  sessionName?: string;
  includeFutureSessions?: boolean;
  includePlaceholderSessions?: boolean;
  limit?: number;
} = {}): Promise<SessionResolutionRow[]> {
  const limit = safeLimit(filters.limit, 300, 1000);
  const includeFutureSessions = Boolean(filters.includeFutureSessions);
  const includePlaceholderSessions = Boolean(filters.includePlaceholderSessions);
  return sql<SessionResolutionRow>(
    `
    SELECT
      s.session_key,
      s.meeting_key,
      s.session_name,
      s.session_type,
      s.year,
      s.country_name,
      s.location,
      s.circuit_short_name,
      s.meeting_name,
      s.date_start
    FROM core.sessions s
    LEFT JOIN core.session_completeness sc
      ON sc.session_key = s.session_key
    WHERE
      ($1::int IS NULL OR s.year = $1)
      AND ($2::text IS NULL OR s.session_name ILIKE $2)
      AND ($3::boolean OR COALESCE(sc.is_future_session, false) = false)
      AND ($4::boolean OR COALESCE(sc.is_placeholder, false) = false)
    ORDER BY s.date_start DESC NULLS LAST, s.session_key DESC
    LIMIT $5
    `,
    [
      filters.year ?? null,
      nullableLike(filters.sessionName),
      includeFutureSessions,
      includePlaceholderSessions,
      limit
    ]
  );
}

export async function getDriversForResolution(args: {
  sessionKey?: number;
  limit?: number;
} = {}): Promise<DriverResolutionRow[]> {
  const limit = safeLimit(args.limit, 400, 2000);
  if (args.sessionKey) {
    return sql<DriverResolutionRow>(
      `
      WITH identity AS (
        SELECT DISTINCT ON (di.driver_number)
          di.driver_number,
          di.canonical_full_name AS full_name,
          di.first_name,
          di.last_name,
          di.name_acronym,
          di.broadcast_name
        FROM core.driver_identity_lookup di
        ORDER BY di.driver_number, di.alias_source DESC
      )
      SELECT
        sd.session_key,
        sd.driver_number,
        COALESCE(sd.full_name, id.full_name) AS full_name,
        id.first_name,
        id.last_name,
        id.name_acronym,
        COALESCE(sd.broadcast_name, id.broadcast_name) AS broadcast_name,
        COALESCE(ti.canonical_team_name, sd.team_name) AS team_name
      FROM core.session_drivers sd
      LEFT JOIN core.sessions s
        ON s.session_key = sd.session_key
      LEFT JOIN identity id
        ON id.driver_number = sd.driver_number
      LEFT JOIN LATERAL (
        SELECT
          til.canonical_team_name
        FROM core.team_identity_lookup til
        WHERE til.normalized_alias = LOWER(BTRIM(COALESCE(sd.team_name, '')))
          AND (til.active_from_year IS NULL OR s.year IS NULL OR s.year >= til.active_from_year)
          AND (til.active_to_year IS NULL OR s.year IS NULL OR s.year <= til.active_to_year)
        ORDER BY
          CASE WHEN til.active_from_year IS NULL THEN 0 ELSE 1 END DESC,
          COALESCE(til.active_from_year, -9999) DESC,
          COALESCE(til.active_to_year, 9999) ASC,
          til.alias_source DESC
        LIMIT 1
      ) ti
        ON TRUE
      WHERE sd.session_key = $1
      ORDER BY sd.driver_number ASC NULLS LAST
      LIMIT $2
      `,
      [args.sessionKey, limit]
    );
  }

  return sql<DriverResolutionRow>(
    `
    WITH identity AS (
      SELECT DISTINCT ON (di.driver_number)
        di.driver_number,
        di.canonical_full_name AS full_name,
        di.first_name,
        di.last_name,
        di.name_acronym,
        di.broadcast_name
      FROM core.driver_identity_lookup di
      ORDER BY di.driver_number, di.alias_source DESC
    ),
    latest_session_driver AS (
      SELECT DISTINCT ON (sd.driver_number)
        sd.session_key,
        sd.driver_number,
        sd.full_name,
        sd.broadcast_name,
        sd.team_name,
        s.year AS season_year
      FROM core.session_drivers sd
      LEFT JOIN core.sessions s
        ON s.session_key = sd.session_key
      ORDER BY sd.driver_number, COALESCE(s.year, 0) DESC, sd.session_key DESC
    )
    SELECT
      lsd.session_key,
      i.driver_number,
      COALESCE(lsd.full_name, i.full_name) AS full_name,
      i.first_name,
      i.last_name,
      i.name_acronym,
      COALESCE(lsd.broadcast_name, i.broadcast_name) AS broadcast_name,
      COALESCE(ti.canonical_team_name, lsd.team_name) AS team_name
    FROM identity i
    LEFT JOIN latest_session_driver lsd
      ON lsd.driver_number = i.driver_number
    LEFT JOIN LATERAL (
      SELECT
        til.canonical_team_name
      FROM core.team_identity_lookup til
      WHERE til.normalized_alias = LOWER(BTRIM(COALESCE(lsd.team_name, '')))
        AND (til.active_from_year IS NULL OR lsd.season_year IS NULL OR lsd.season_year >= til.active_from_year)
        AND (til.active_to_year IS NULL OR lsd.season_year IS NULL OR lsd.season_year <= til.active_to_year)
      ORDER BY
        CASE WHEN til.active_from_year IS NULL THEN 0 ELSE 1 END DESC,
        COALESCE(til.active_from_year, -9999) DESC,
        COALESCE(til.active_to_year, 9999) ASC,
        til.alias_source DESC
      LIMIT 1
    ) ti
      ON TRUE
    ORDER BY i.driver_number ASC NULLS LAST
    LIMIT $1
    `,
    [limit]
  );
}

export async function getSessionsFromSearchLookup(filters: {
  aliases: string[];
  year?: number;
  sessionName?: string;
  includeFutureSessions?: boolean;
  includePlaceholderSessions?: boolean;
  limit?: number;
}): Promise<SessionResolutionRow[]> {
  const aliases = normalizeAliasList(filters.aliases);
  if (aliases.length === 0) {
    return [];
  }

  const limit = safeLimit(filters.limit, 120, 500);
  const includeFutureSessions = Boolean(filters.includeFutureSessions);
  const includePlaceholderSessions = Boolean(filters.includePlaceholderSessions);
  return sql<SessionResolutionRow>(
    `
    WITH matched AS (
      SELECT
        ssl.session_key,
        ssl.meeting_key,
        ssl.session_name,
        ssl.session_type,
        ssl.year,
        ssl.country_name,
        ssl.location,
        ssl.circuit_short_name,
        ssl.meeting_name,
        ssl.date_start,
        COUNT(*)::int AS alias_hits
      FROM core.session_search_lookup ssl
      LEFT JOIN core.session_completeness sc
        ON sc.session_key = ssl.session_key
      WHERE ($1::int IS NULL OR ssl.year = $1)
        AND ($2::text IS NULL OR ssl.session_name ILIKE $2)
        AND ssl.normalized_alias = ANY($3::text[])
        AND ($4::boolean OR COALESCE(sc.is_future_session, false) = false)
        AND ($5::boolean OR COALESCE(sc.is_placeholder, false) = false)
      GROUP BY
        ssl.session_key,
        ssl.meeting_key,
        ssl.session_name,
        ssl.session_type,
        ssl.year,
        ssl.country_name,
        ssl.location,
        ssl.circuit_short_name,
        ssl.meeting_name,
        ssl.date_start
    )
    SELECT
      session_key,
      meeting_key,
      session_name,
      session_type,
      year,
      country_name,
      location,
      circuit_short_name,
      meeting_name,
      date_start
    FROM matched
    ORDER BY alias_hits DESC, date_start DESC NULLS LAST, session_key DESC
    LIMIT $6
    `,
    [
      filters.year ?? null,
      nullableLike(filters.sessionName),
      aliases,
      includeFutureSessions,
      includePlaceholderSessions,
      limit
    ]
  );
}

export async function getDriversFromIdentityLookup(args: {
  aliases: string[];
  sessionKey?: number;
  limit?: number;
}): Promise<DriverResolutionRow[]> {
  const aliases = normalizeAliasList(args.aliases);
  if (aliases.length === 0) {
    return [];
  }

  const limit = safeLimit(args.limit, 60, 500);
  return sql<DriverResolutionRow>(
    `
    WITH matched AS (
      SELECT
        di.driver_number,
        MAX(di.canonical_full_name) AS full_name,
        MAX(di.first_name) AS first_name,
        MAX(di.last_name) AS last_name,
        MAX(di.name_acronym) AS name_acronym,
        MAX(di.broadcast_name) AS broadcast_name,
        COUNT(*)::int AS alias_hits
      FROM core.driver_identity_lookup di
      WHERE di.normalized_alias = ANY($1::text[])
      GROUP BY di.driver_number
    ),
    latest_driver_row AS (
      SELECT DISTINCT ON (sd.driver_number)
        sd.session_key,
        sd.driver_number,
        sd.full_name,
        sd.broadcast_name,
        sd.team_name,
        s.year AS season_year
      FROM core.session_drivers sd
      LEFT JOIN core.sessions s
        ON s.session_key = sd.session_key
      WHERE ($2::bigint IS NULL OR sd.session_key = $2)
      ORDER BY sd.driver_number, COALESCE(s.year, 0) DESC, sd.session_key DESC
    )
    SELECT
      COALESCE(ld.session_key, $2::bigint) AS session_key,
      m.driver_number,
      COALESCE(ld.full_name, m.full_name) AS full_name,
      m.first_name,
      m.last_name,
      m.name_acronym,
      COALESCE(ld.broadcast_name, m.broadcast_name) AS broadcast_name,
      COALESCE(ti.canonical_team_name, ld.team_name) AS team_name
    FROM matched m
    LEFT JOIN latest_driver_row ld
      ON ld.driver_number = m.driver_number
    LEFT JOIN LATERAL (
      SELECT
        til.canonical_team_name
      FROM core.team_identity_lookup til
      WHERE til.normalized_alias = LOWER(BTRIM(COALESCE(ld.team_name, '')))
        AND (til.active_from_year IS NULL OR ld.season_year IS NULL OR ld.season_year >= til.active_from_year)
        AND (til.active_to_year IS NULL OR ld.season_year IS NULL OR ld.season_year <= til.active_to_year)
      ORDER BY
        CASE WHEN til.active_from_year IS NULL THEN 0 ELSE 1 END DESC,
        COALESCE(til.active_from_year, -9999) DESC,
        COALESCE(til.active_to_year, 9999) ASC,
        til.alias_source DESC
      LIMIT 1
    ) ti
      ON TRUE
    ORDER BY m.alias_hits DESC, m.driver_number ASC
    LIMIT $3
    `,
    [aliases, args.sessionKey ?? null, limit]
  );
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

export async function getGlobalTableCounts(tableNames: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(tableNames));
  const counts: Record<string, number> = {};

  await Promise.all(
    unique.map(async (tableName) => {
      const text = GLOBAL_TABLE_COUNT_SQL[tableName];
      if (!text) {
        counts[tableName] = -1;
        return;
      }
      const rows = await sql<{ row_count: number | string }>(text);
      counts[tableName] = parseCountValue(rows[0]?.row_count);
    })
  );

  return counts;
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

export async function getSchemaCatalog(): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema IN ('raw', 'core')
    ORDER BY table_schema, table_name, ordinal_position
    `
  );
}

export async function runReadOnlySql(
  inputSql: string,
  options: { maxRows?: number; timeoutMs?: number; preview?: boolean } = {}
): Promise<QueryRunResult> {
  const cleanedSql = assertReadOnlySql(inputSql);
  const maxRows = safeLimit(
    options.maxRows,
    options.preview ? DEFAULT_PREVIEW_MAX_ROWS : DEFAULT_QUERY_MAX_ROWS,
    10_000
  );
  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, 1000, 120_000);
  const wrappedSql = `SELECT * FROM (${cleanedSql}) AS q LIMIT $1`;
  const startedAt = Date.now();

  // Inline transaction via pool.connect() so SET LOCAL statement_timeout
  // takes effect for this query only. Inlined (rather than using
  // db/driver.ts withTransaction) to avoid touching db.ts or queries.ts
  // imports in a way that breaks the existing driver-fallback /
  // pooled-url-assertion test sandboxes (both transpile db.ts into a
  // tmp dir without the db/ subdirectory). Neon-only by design — this
  // slice scope does not include local-PGlite transaction behavior.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await client.query<Record<string, unknown>>(wrappedSql, [maxRows + 1]);
    await client.query("COMMIT");
    const truncated = result.rows.length > maxRows;
    const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;
    return {
      sql: cleanedSql,
      rowCount: rows.length,
      elapsedMs: Date.now() - startedAt,
      truncated,
      rows: rows as Record<string, unknown>[]
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* surface original error */ }
    throw error;
  } finally {
    client.release();
  }
}

export function buildHeuristicSql(message: string, context?: {
  sessionKey?: number;
  driverNumber?: number;
}): string {
  const lower = message.toLowerCase();
  const sessionKeyRaw = Number(context?.sessionKey);
  const driverNumberRaw = Number(context?.driverNumber);
  const sessionKey = Number.isFinite(sessionKeyRaw) ? Math.trunc(sessionKeyRaw) : undefined;
  const driverNumber = Number.isFinite(driverNumberRaw) ? Math.trunc(driverNumberRaw) : undefined;

  if (lower.includes("fastest") && sessionKey) {
    return `
      SELECT
        l.session_key,
        l.driver_number,
        d.full_name,
        d.team_name,
        MIN(l.lap_duration) AS best_lap_duration
      FROM core.laps_enriched l
      LEFT JOIN core.session_drivers d
        ON d.session_key = l.session_key
       AND d.driver_number = l.driver_number
      WHERE l.session_key = ${sessionKey}
        AND l.lap_duration IS NOT NULL
        AND COALESCE(l.is_valid, TRUE) = TRUE
      GROUP BY l.session_key, l.driver_number, d.full_name, d.team_name
      ORDER BY best_lap_duration ASC NULLS LAST
      LIMIT 5
    `;
  }

  if (lower.includes("fastest") && lower.includes("abu dhabi") && lower.includes("2025")) {
    return `
      SELECT
        s.session_key,
        s.meeting_name,
        s.date_start,
        l.driver_number,
        d.full_name,
        d.team_name,
        MIN(l.lap_duration) AS best_lap_duration
      FROM core.sessions s
      JOIN core.laps_enriched l
        ON l.session_key = s.session_key
      LEFT JOIN core.session_drivers d
        ON d.session_key = l.session_key
       AND d.driver_number = l.driver_number
      WHERE s.year = 2025
        AND s.session_name = 'Race'
        AND (
          s.meeting_name ILIKE '%abu dhabi%'
          OR s.location ILIKE '%abu dhabi%'
          OR s.location ILIKE '%yas%'
          OR s.circuit_short_name ILIKE '%yas%'
        )
        AND COALESCE(l.is_valid, TRUE) = TRUE
      GROUP BY s.session_key, s.meeting_name, s.date_start, l.driver_number, d.full_name, d.team_name
      ORDER BY best_lap_duration ASC NULLS LAST
      LIMIT 5
    `;
  }

  if (
    lower.includes("coverage") ||
    lower.includes("downstream data") ||
    lower.includes("most complete") ||
    lower.includes("completeness")
  ) {
    return `
      WITH coverage AS (
        SELECT
          s.session_key,
          s.meeting_key,
          s.year,
          s.session_name,
          s.country_name,
          s.location,
          s.date_start,
          CASE WHEN EXISTS (SELECT 1 FROM raw.laps l WHERE l.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_laps,
          CASE WHEN EXISTS (SELECT 1 FROM raw.car_data cd WHERE cd.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_car_data,
          CASE WHEN EXISTS (SELECT 1 FROM raw.location loc WHERE loc.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_location,
          CASE WHEN EXISTS (SELECT 1 FROM raw.pit p WHERE p.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_pit,
          CASE WHEN EXISTS (SELECT 1 FROM raw.stints st WHERE st.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_stints,
          CASE WHEN EXISTS (SELECT 1 FROM raw.weather w WHERE w.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_weather,
          CASE WHEN EXISTS (SELECT 1 FROM raw.team_radio tr WHERE tr.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_team_radio,
          CASE WHEN EXISTS (SELECT 1 FROM raw.position_history ph WHERE ph.session_key = s.session_key LIMIT 1) THEN 1 ELSE 0 END AS has_position_history
        FROM core.sessions s
      )
      SELECT
        session_key,
        meeting_key,
        year,
        session_name,
        country_name,
        location,
        date_start,
        (has_laps + has_car_data + has_location + has_pit + has_stints + has_weather + has_team_radio + has_position_history) AS downstream_coverage_score,
        has_laps,
        has_car_data,
        has_location,
        has_pit,
        has_stints,
        has_weather,
        has_team_radio,
        has_position_history
      FROM coverage
      ORDER BY downstream_coverage_score DESC, date_start DESC NULLS LAST
      LIMIT 25
    `;
  }

  if (lower.includes("missing")) {
    return `
      SELECT
        s.session_key,
        s.session_name,
        s.date_start,
        (SELECT COUNT(*) FROM raw.drivers d WHERE d.session_key = s.session_key) AS drivers,
        (SELECT COUNT(*) FROM raw.laps l WHERE l.session_key = s.session_key) AS laps,
        (SELECT COUNT(*) FROM raw.car_data c WHERE c.session_key = s.session_key) AS car_data,
        (SELECT COUNT(*) FROM raw.location loc WHERE loc.session_key = s.session_key) AS location
      FROM core.sessions s
      ORDER BY s.date_start DESC NULLS LAST
      LIMIT 25
    `;
  }

  if (lower.includes("weather") && sessionKey) {
    return `
      SELECT date, air_temperature, track_temperature, humidity, rainfall, wind_speed
      FROM raw.weather
      WHERE session_key = ${sessionKey}
      ORDER BY date ASC NULLS LAST
    `;
  }

  if (
    sessionKey &&
    (lower.includes("who drove") ||
      lower.includes("which drivers") ||
      lower.includes("roster") ||
      lower.includes("driver and team"))
  ) {
    return `
      SELECT driver_number, full_name, team_name
      FROM core.session_drivers
      WHERE session_key = ${sessionKey}
      ORDER BY driver_number ASC NULLS LAST
      LIMIT 60
    `;
  }

  if (sessionKey && (lower.includes("which teams were present") || lower.includes("teams were present"))) {
    return `
      SELECT DISTINCT team_name
      FROM core.session_drivers
      WHERE session_key = ${sessionKey}
        AND team_name IS NOT NULL
      ORDER BY team_name ASC
      LIMIT 30
    `;
  }

  if ((lower.includes("lap") || lower.includes("pace")) && sessionKey) {
    if (driverNumber) {
      return `
        SELECT lap_number, lap_duration, duration_sector_1, duration_sector_2, duration_sector_3
        FROM core.laps_enriched
        WHERE session_key = ${sessionKey} AND driver_number = ${driverNumber}
        ORDER BY lap_number ASC
      `;
    }
    return `
      SELECT driver_number, lap_number, lap_duration
      FROM core.laps_enriched
      WHERE session_key = ${sessionKey}
      ORDER BY lap_duration ASC NULLS LAST
      LIMIT 200
    `;
  }

  if ((lower.includes("telemetry") || lower.includes("speed")) && sessionKey && driverNumber) {
    return `
      SELECT date, speed, throttle, brake, n_gear, rpm, drs
      FROM raw.car_data
      WHERE session_key = ${sessionKey}
        AND driver_number = ${driverNumber}
      ORDER BY date ASC NULLS LAST
      LIMIT 2000
    `;
  }

  return `
    SELECT session_key, session_name, date_start, year, country_name, location
    FROM core.sessions
    ORDER BY date_start DESC NULLS LAST
    LIMIT 25
  `;
}
