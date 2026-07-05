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
  /** Year range this (driver_number, name) mapping was active, from the
   *  identity lookup. Car numbers move between drivers across seasons
   *  (Norris took #1 for 2026), so a question's year must pick the
   *  mapping active THAT season. Only populated by the identity-lookup
   *  path; other resolvers leave them unset. */
  first_year?: number | null;
  last_year?: number | null;
};

// Strips combining diacritic marks via NFKD + \p{Diacritic} regex,
// then lowercases + trims. Mirrors the SQL-side normalization in
// public.f1_unaccent(lower(btrim(...))) so query-side and seed-side
// values join exactly. Phase 14 alias resolver work; see
// diagnostic/alias_resolver_plan_2026-05-01.md (rev4).
export function normalizeAliasText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function normalizeAliasList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeAliasText(value))
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
  /** Question year for the no-session branch: the "latest" session-driver
   *  name for a car number must come from that season or earlier (the
   *  unscoped latest labels #1 as 2026 Norris on a 2025 question). */
  year?: number;
} = {}): Promise<DriverResolutionRow[]> {
  const limit = safeLimit(args.limit, 400, 2000);
  const year = Number.isFinite(Number(args.year)) ? Math.trunc(Number(args.year)) : null;
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
      -- Year-scoped against OBSERVED season data: the identity seed's
      -- first/last_year is the driver's career range, not the
      -- number-mapping range (#3 carries Verstappen 2023-2026 because he
      -- ran #3 in 2026), so the only trustworthy check is "did this
      -- (number, name) pair actually race that season".
      SELECT DISTINCT ON (di.driver_number)
        di.driver_number,
        di.canonical_full_name AS full_name,
        di.first_name,
        di.last_name,
        di.name_acronym,
        di.broadcast_name,
        di.first_year,
        di.last_year
      FROM core.driver_identity_lookup di
      WHERE (
        $2::int IS NULL
        OR EXISTS (
          SELECT 1
          FROM core.session_drivers sd2
          JOIN core.sessions s2 ON s2.session_key = sd2.session_key
          WHERE sd2.driver_number = di.driver_number
            AND s2.year = $2
            AND LOWER(sd2.full_name) = LOWER(di.canonical_full_name)
        )
      )
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
      WHERE ($2::int IS NULL OR s.year IS NULL OR s.year <= $2)
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
    [limit, year]
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
  /** Question/season year. Car numbers move between drivers across
   *  seasons (Norris took #1 for 2026), so when the question names a
   *  year only identity rows ACTIVE that year may match — otherwise
   *  "Norris" on a 2025 question resolves to his 2026 number. Rows with
   *  open-ended ranges always pass. */
  year?: number;
}): Promise<DriverResolutionRow[]> {
  const aliases = normalizeAliasList(args.aliases);
  if (aliases.length === 0) {
    return [];
  }

  const limit = safeLimit(args.limit, 60, 500);
  const year = Number.isFinite(Number(args.year)) ? Math.trunc(Number(args.year)) : null;
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
        MIN(di.first_year)::int AS first_year,
        MAX(di.last_year)::int AS last_year,
        COUNT(*)::int AS alias_hits
      FROM core.driver_identity_lookup di
      WHERE di.normalized_alias = ANY($1::text[])
        AND (
          $3::int IS NULL
          OR EXISTS (
            -- Observed-season check, not the seed's first/last_year —
            -- those are career ranges, not number-mapping ranges.
            SELECT 1
            FROM core.session_drivers sd2
            JOIN core.sessions s2 ON s2.session_key = sd2.session_key
            WHERE sd2.driver_number = di.driver_number
              AND s2.year = $3
              AND LOWER(sd2.full_name) = LOWER(di.canonical_full_name)
          )
        )
      GROUP BY di.driver_number
    ),
    latest_driver_row AS (
      -- Year-scoped: when the question names a year, the display name
      -- for a car number must come from THAT season or earlier — the
      -- unscoped latest row labels #1 as "Lando NORRIS" (2026) on a
      -- 2025 question where #1 was Verstappen.
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
        AND ($3::int IS NULL OR s.year IS NULL OR s.year <= $3)
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
      COALESCE(ti.canonical_team_name, ld.team_name) AS team_name,
      m.first_year,
      m.last_year
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
    LIMIT $4
    `,
    [aliases, args.sessionKey ?? null, year, limit]
  );
}

// ----------------------------------------------------------------------
// Phase 14-F: pg_trgm fuzzy fallback
//
// When the exact-match `getDriversFromIdentityLookup` /
// `getSessionsFromSearchLookup` return zero rows, callers can run
// these fuzzy variants. They use the GIN trgm indexes added in
// migration 024 (for the seed alias tables and raw.sessions intrinsic
// columns) to deliver sub-30ms p50 lookups.
//
// Match-kind contract:
//   sim >= 0.85 → 'fuzzy_confident'
//   sim >= 0.70 → 'fuzzy_clarify'  (caller may want to disambiguate)
//   sim <  0.70 → not returned
// ----------------------------------------------------------------------

const TRGM_THRESHOLD_DEFAULT = 0.7;

export type FuzzyMatchKind = "fuzzy_confident" | "fuzzy_clarify";

export type FuzzyDriverRow = DriverResolutionRow & {
  similarity: number;
  match_kind: FuzzyMatchKind;
};

export async function fuzzyDriverLookup(args: {
  alias: string;
  sessionKey?: number;
  threshold?: number;
  limit?: number;
}): Promise<FuzzyDriverRow[]> {
  const normalized = normalizeAliasText(args.alias);
  if (normalized.length < 2) return [];
  const threshold = Math.min(1, Math.max(0, args.threshold ?? TRGM_THRESHOLD_DEFAULT));
  const limit = safeLimit(args.limit, 5, 25);
  // Set the per-statement pg_trgm similarity threshold so the GIN
  // index is used by the % operator. set_limit returns the new value.
  return sql<FuzzyDriverRow>(
    `
    WITH _t AS (SELECT set_limit($2::float4) AS t),
    candidates AS (
      SELECT a.driver_number,
             MAX(a.canonical_full_name) AS canonical_full_name,
             MAX(a.first_name)          AS first_name,
             MAX(a.last_name)           AS last_name,
             MAX(a.name_acronym)        AS name_acronym,
             MAX(a.broadcast_name)      AS broadcast_name,
             MAX(similarity(a.normalized_alias, $1)) AS sim
      FROM core.driver_alias_lookup a, _t
      WHERE a.normalized_alias % $1
      GROUP BY a.driver_number
    ),
    latest_session AS (
      SELECT DISTINCT ON (sd.driver_number)
        sd.session_key, sd.driver_number, sd.full_name, sd.broadcast_name, sd.team_name,
        s.year AS season_year
      FROM core.session_drivers sd
      LEFT JOIN core.sessions s ON s.session_key = sd.session_key
      WHERE ($3::bigint IS NULL OR sd.session_key = $3)
      ORDER BY sd.driver_number, COALESCE(s.year, 0) DESC, sd.session_key DESC
    )
    SELECT
      COALESCE(ls.session_key, $3::bigint) AS session_key,
      c.driver_number,
      COALESCE(ls.full_name, c.canonical_full_name) AS full_name,
      c.first_name, c.last_name, c.name_acronym,
      COALESCE(ls.broadcast_name, c.broadcast_name) AS broadcast_name,
      ls.team_name,
      c.sim AS similarity,
      CASE WHEN c.sim >= 0.85 THEN 'fuzzy_confident' ELSE 'fuzzy_clarify' END AS match_kind
    FROM candidates c
    LEFT JOIN latest_session ls ON ls.driver_number = c.driver_number
    WHERE c.sim >= $2
    ORDER BY c.sim DESC, c.driver_number ASC
    LIMIT $4
    `,
    [normalized, threshold, args.sessionKey ?? null, limit]
  );
}

export type FuzzySessionRow = SessionResolutionRow & {
  similarity: number;
  matched_on: string;
  match_kind: FuzzyMatchKind;
};

export async function fuzzySessionLookup(args: {
  alias: string;
  year?: number;
  threshold?: number;
  limit?: number;
}): Promise<FuzzySessionRow[]> {
  const normalized = normalizeAliasText(args.alias);
  if (normalized.length < 2) return [];
  const threshold = Math.min(1, Math.max(0, args.threshold ?? TRGM_THRESHOLD_DEFAULT));
  const limit = safeLimit(args.limit, 10, 50);
  // UNION-ALL across the four indexed intrinsic columns of raw.sessions
  // plus the seed venue alias table (joined back to raw.sessions to
  // emit a real session_key). Each branch hits a dedicated GIN trgm
  // index from migration 024.
  return sql<FuzzySessionRow>(
    `
    WITH _t AS (SELECT set_limit($2::float4) AS t),
    cands AS (
      SELECT 'country_name' AS matched_on, s.session_key,
             similarity(public.f1_unaccent(lower(btrim(s.country_name))), $1) AS sim
      FROM raw.sessions s, _t
      WHERE public.f1_unaccent(lower(btrim(s.country_name))) % $1
      UNION ALL
      SELECT 'location' AS matched_on, s.session_key,
             similarity(public.f1_unaccent(lower(btrim(s.location))), $1) AS sim
      FROM raw.sessions s, _t
      WHERE public.f1_unaccent(lower(btrim(s.location))) % $1
      UNION ALL
      SELECT 'circuit_short_name' AS matched_on, s.session_key,
             similarity(public.f1_unaccent(lower(btrim(s.circuit_short_name))), $1) AS sim
      FROM raw.sessions s, _t
      WHERE public.f1_unaccent(lower(btrim(s.circuit_short_name))) % $1
      UNION ALL
      SELECT 'session_name' AS matched_on, s.session_key,
             similarity(public.f1_unaccent(lower(btrim(s.session_name))), $1) AS sim
      FROM raw.sessions s, _t
      WHERE public.f1_unaccent(lower(btrim(s.session_name))) % $1
      UNION ALL
      SELECT 'venue_alias' AS matched_on, s.session_key,
             similarity(svl.normalized_alias, $1) AS sim
      FROM core.session_venue_alias_lookup svl, _t
      JOIN raw.sessions s
        ON (svl.country_name IS NULL OR public.f1_unaccent(lower(btrim(svl.country_name))) = public.f1_unaccent(lower(btrim(coalesce(s.country_name, '')))))
       AND (svl.location IS NULL OR public.f1_unaccent(lower(btrim(svl.location))) = public.f1_unaccent(lower(btrim(coalesce(s.location, '')))))
       AND (svl.circuit_short_name IS NULL OR public.f1_unaccent(lower(btrim(svl.circuit_short_name))) = public.f1_unaccent(lower(btrim(coalesce(s.circuit_short_name, '')))))
      WHERE svl.normalized_alias % $1
    ),
    agg AS (
      SELECT session_key,
             MAX(sim) AS sim,
             string_agg(DISTINCT matched_on, ',' ORDER BY matched_on) AS matched_on
      FROM cands
      WHERE sim >= $2
      GROUP BY session_key
    )
    SELECT
      a.session_key, s.meeting_key, s.session_name, s.session_type, s.year,
      s.country_name, s.location, s.circuit_short_name, s.meeting_name, s.date_start,
      a.sim AS similarity,
      a.matched_on,
      CASE WHEN a.sim >= 0.85 THEN 'fuzzy_confident' ELSE 'fuzzy_clarify' END AS match_kind
    FROM agg a
    JOIN core.sessions s ON s.session_key = a.session_key
    WHERE ($3::int IS NULL OR s.year = $3)
    ORDER BY a.sim DESC, s.date_start DESC NULLS LAST, s.session_key DESC
    LIMIT $4
    `,
    [normalized, threshold, args.year ?? null, limit]
  );
}
