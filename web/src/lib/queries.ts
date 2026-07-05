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

// F08 (golden-set audit 2026-07-02): every core.* relation on Neon is an
// unmaterialized view, so `EXISTS (SELECT 1 FROM core.pit_cycle_summary)`
// computes the aggregating view (~15s cold) even without a session filter.
// "Is this relation globally populated?" is answered identically — and at
// index-seek cost — by probing the RAW base table that feeds each view.
// (Mirrors the PROBE_PROXY already applied to the session-scoped probe in
// queries/sessions.ts.)
const GLOBAL_PROBE_PROXY: Record<string, string> = {
  "core.sessions": "raw.sessions",
  "core.session_drivers": "raw.drivers",
  "core.lap_semantic_bridge": "raw.laps",
  "core.laps_enriched": "raw.laps",
  "core.driver_session_summary": "raw.laps",
  "core.stint_summary": "raw.stints",
  "core.strategy_summary": "raw.stints",
  "core.strategy_evidence_summary": "raw.stints",
  "core.pit_cycle_summary": "raw.pit",
  "core.grid_vs_finish": "raw.session_result",
  "core.race_progression_summary": "raw.position_history",
  "core.lap_phase_summary": "raw.laps",
  "core.telemetry_lap_bridge": "raw.laps",
  "core.lap_context_summary": "raw.laps",
  "core.replay_lap_frames": "raw.laps"
};

const GLOBAL_TABLE_COUNT_SQL: Record<string, string> = Object.fromEntries(
  GLOBAL_TABLE_COUNT_TABLES.map((t) => [t, existsProbeSql(GLOBAL_PROBE_PROXY[t] ?? t)])
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

/**
 * Last-resort fallback SQL for the anthropic-timeout path ONLY.
 *
 * Golden-set audit 2026-07-02 (F01/F07): the old version was a
 * context-free keyword router whose default branch returned 25 recent
 * (2026) sessions — synthesis then fabricated "this 2025 session is not
 * in the dataset" claims that contradicted the app's own 0.99-confidence
 * session pin. Rules now:
 *   - context-first: every data branch REQUIRES the pinned sessionKey;
 *   - all resolved drivers (plural) are honored, not just the first;
 *   - laps_enriched reads are deduped (the Neon view returns exact 2×
 *     duplicate rows) and carry venue/year columns for verification;
 *   - NO catch-all: if nothing topical matches, return null and let
 *     orchestration take the honest structured-failure path.
 */
export function buildHeuristicSql(message: string, context?: {
  sessionKey?: number;
  driverNumber?: number;
  driverNumbers?: number[];
}): string | null {
  const lower = message.toLowerCase();
  const sessionKeyRaw = Number(context?.sessionKey);
  const sessionKey = Number.isFinite(sessionKeyRaw) ? Math.trunc(sessionKeyRaw) : undefined;
  const drivers = [
    ...(context?.driverNumbers ?? []),
    ...(context?.driverNumber !== undefined ? [context.driverNumber] : [])
  ]
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n))
    .filter((n, i, a) => a.indexOf(n) === i);

  const venueCols = sessionKey
    ? `,
        (SELECT s.location FROM core.sessions s WHERE s.session_key = ${sessionKey} LIMIT 1) AS location,
        (SELECT s.country_name FROM core.sessions s WHERE s.session_key = ${sessionKey} LIMIT 1) AS country_name,
        (SELECT s.year FROM core.sessions s WHERE s.session_key = ${sessionKey} LIMIT 1) AS year`
    : "";

  if (lower.includes("fastest") && sessionKey) {
    // Full-field top 5 by best valid lap, PLUS the asked drivers' rows so
    // the subject of the question is always present (F07: Ocon/Sainz were
    // absent from their own speed-map answers).
    const driverUnion = drivers.length
      ? ` OR r.driver_number IN (${drivers.join(", ")})`
      : "";
    return `
      WITH best AS (
        SELECT
          l.driver_number,
          MIN(l.lap_duration) AS best_lap_duration
        FROM core.laps_enriched l
        WHERE l.session_key = ${sessionKey}
          AND l.lap_duration IS NOT NULL
          AND COALESCE(l.is_valid, TRUE) = TRUE
        GROUP BY l.driver_number
      ),
      ranked AS (
        SELECT b.*, RANK() OVER (ORDER BY b.best_lap_duration ASC) AS lap_rank
        FROM best b
      )
      SELECT
        ${sessionKey} AS session_key,
        r.driver_number,
        d.full_name,
        d.team_name,
        r.best_lap_duration,
        r.lap_rank${venueCols}
      FROM ranked r
      LEFT JOIN core.session_drivers d
        ON d.session_key = ${sessionKey}
       AND d.driver_number = r.driver_number
      WHERE r.lap_rank <= 5${driverUnion}
      ORDER BY r.lap_rank ASC
      LIMIT 30
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

  if ((lower.includes("lap") || lower.includes("pace") || lower.includes("stint")) && sessionKey) {
    if (drivers.length > 0) {
      // Per-lap rows for ALL resolved drivers, deduped (laps_enriched
      // returns exact 2× duplicates on Neon), venue columns included.
      return `
        SELECT
          driver_number,
          lap_number,
          MAX(driver_name) AS driver_name,
          MAX(lap_duration) AS lap_duration,
          MAX(duration_sector_1) AS duration_sector_1,
          MAX(duration_sector_2) AS duration_sector_2,
          MAX(duration_sector_3) AS duration_sector_3${venueCols}
        FROM core.laps_enriched
        WHERE session_key = ${sessionKey}
          AND driver_number IN (${drivers.join(", ")})
        GROUP BY driver_number, lap_number
        ORDER BY driver_number ASC, lap_number ASC
      `;
    }
    return `
      SELECT
        driver_number,
        lap_number,
        MAX(lap_duration) AS lap_duration${venueCols}
      FROM core.laps_enriched
      WHERE session_key = ${sessionKey}
        AND lap_duration IS NOT NULL
      GROUP BY driver_number, lap_number
      ORDER BY MAX(lap_duration) ASC NULLS LAST
      LIMIT 200
    `;
  }

  // No topical branch matched: NO catch-all (F01). The old recent-sessions
  // default fed synthesis 25 unrelated 2026 rows and produced fabricated
  // "not in the dataset" claims. Null routes the caller to honest failure.
  return null;
}
