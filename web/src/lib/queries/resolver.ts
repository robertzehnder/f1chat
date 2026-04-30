import { sql } from "../db";
import { clampInt } from "../querySafety";

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

function nullableLike(value?: string): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  return `%${value.trim()}%`;
}

function safeLimit(value: number | undefined, fallback: number, max: number): number {
  return clampInt(value ?? fallback, 1, max);
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
