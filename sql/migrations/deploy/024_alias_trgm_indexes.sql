-- Deploy openf1:024_alias_trgm_indexes to pg
-- requires: 023_starting_grid_derivation
--
-- Phase 14 slice A — pg_trgm + unaccent extensions plus GIN expression
-- indexes that the resolver's fuzzy-fallback path will use. Per the
-- alias_resolver_plan_2026-05-01.md rev4 spec, indexes go on:
--   - the three seed alias tables (driver_alias_lookup,
--     team_alias_lookup, session_venue_alias_lookup) on the
--     populated normalized_alias column
--   - the four intrinsic-alias source columns of core.sessions, which
--     is a VIEW so the indexes target the underlying base table
--     raw.sessions; expression matches the unaccent(lower(btrim(<col>)))
--     normalization that 14-F's fuzzy queries use
--
-- All CREATE EXTENSION / CREATE INDEX statements are IF NOT EXISTS so
-- re-deploys are safe.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE wrapper around unaccent. The bare unaccent(text) is STABLE
-- (depends on the active dictionary config), which Postgres rejects in
-- expression indexes. The two-argument form unaccent('unaccent', text)
-- is IMMUTABLE because the dictionary is named explicitly. Wrap it in
-- our own f1_unaccent() so resolver code and indexes can call a single
-- canonical function. Phase 14 slice E (resolver normalization) will
-- update the runtime resolver to call this wrapper.
CREATE OR REPLACE FUNCTION public.f1_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Seed alias tables — populated normalized_alias column already exists
CREATE INDEX IF NOT EXISTS idx_driver_alias_lookup_alias_trgm
  ON core.driver_alias_lookup
  USING gin (normalized_alias gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_team_alias_lookup_alias_trgm
  ON core.team_alias_lookup
  USING gin (normalized_alias gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_session_venue_alias_lookup_alias_trgm
  ON core.session_venue_alias_lookup
  USING gin (normalized_alias gin_trgm_ops);

-- raw.sessions intrinsic columns — the four UNION branches in
-- core.session_search_lookup (sql/005_helper_tables.sql:185-225)
-- compute normalized_alias inline from these. Index expressions match
-- the unaccent(lower(btrim(...))) form used by the resolver fuzzy
-- queries; immutable functions (lower, btrim, unaccent) make this
-- safe.
CREATE INDEX IF NOT EXISTS idx_raw_sessions_country_name_norm_trgm
  ON raw.sessions
  USING gin (public.f1_unaccent(lower(btrim(country_name))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_raw_sessions_location_norm_trgm
  ON raw.sessions
  USING gin (public.f1_unaccent(lower(btrim(location))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_raw_sessions_circuit_short_norm_trgm
  ON raw.sessions
  USING gin (public.f1_unaccent(lower(btrim(circuit_short_name))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_raw_sessions_session_name_norm_trgm
  ON raw.sessions
  USING gin (public.f1_unaccent(lower(btrim(session_name))) gin_trgm_ops);

COMMIT;
