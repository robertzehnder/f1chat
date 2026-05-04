import { sql } from "./db";

export { runReadOnlySql } from "./queries/execute";

export {
  getDriversForResolution,
  getDriversFromIdentityLookup,
  getSessionsForResolution,
  getSessionsFromSearchLookup
} from "./queries/resolver";
export type { DriverResolutionRow, SessionResolutionRow } from "./queries/resolver";

export {
  getSessions,
  getSessionByKey,
  getSessionDrivers,
  getSessionLaps,
  getSessionWeather,
  getSessionRaceControl,
  getSessionTelemetry,
  getSessionCompleteness,
  getSessionTableCounts
} from "./queries/sessions";

// Phase 17 (post-deploy diagnostic 2026-05-02): the previous COUNT(*) form
// triggered full scans on materialized views with millions of rows. The
// caller in chatRuntime only branches on `globalRows === 0`, so an EXISTS
// probe is sufficient — and is O(1) (Postgres stops at the first row).
function existsProbeSql(table: string): string {
  return `SELECT (CASE WHEN EXISTS (SELECT 1 FROM ${table}) THEN 1 ELSE 0 END)::bigint AS row_count`;
}

const GLOBAL_TABLE_COUNT_TABLES: ReadonlyArray<string> = [
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

const GLOBAL_TABLE_COUNT_SQL: Record<string, string> = Object.fromEntries(
  GLOBAL_TABLE_COUNT_TABLES.map((t) => [t, existsProbeSql(t)])
);

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

// Phase 17 (post-deploy diagnostic 2026-05-02): "is this table populated?"
// is a stable answer for the lifetime of a server process — once a table
// has rows, we don't ingest data backwards. Cache per-table at module scope
// so the 30-query Promise.all storm only fires once. Subsequent requests
// see microsecond cache lookups instead of cold-page fetches.
const globalCountCache = new Map<string, Promise<number>>();

function loadGlobalCount(tableName: string): Promise<number> {
  const text = GLOBAL_TABLE_COUNT_SQL[tableName];
  if (!text) return Promise.resolve(-1);
  return sql<{ row_count: number | string }>(text).then(
    (rows) => parseCountValue(rows[0]?.row_count),
    () => -1 // transient errors don't poison the cache permanently
  );
}

export async function getGlobalTableCounts(tableNames: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(tableNames));
  const counts: Record<string, number> = {};

  await Promise.all(
    unique.map(async (tableName) => {
      let cached = globalCountCache.get(tableName);
      if (!cached) {
        cached = loadGlobalCount(tableName);
        globalCountCache.set(tableName, cached);
      }
      const value = await cached;
      // Cache only positive answers; if a table came back as -1 (missing or
      // transient), allow a re-probe on the next request.
      if (value <= 0) globalCountCache.delete(tableName);
      counts[tableName] = value;
    })
  );

  return counts;
}

export { getSchemaCatalog } from "./queries/catalog";

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
