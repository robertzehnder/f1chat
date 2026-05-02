-- Revert openf1:024_alias_trgm_indexes from pg
--
-- Drop the seven GIN indexes added by the deploy. Extensions
-- (pg_trgm, unaccent) are NOT dropped — other migrations / queries
-- may depend on them, and DROP EXTENSION cascades to functions in
-- ways that are surprising. The deploy is idempotent (CREATE
-- EXTENSION IF NOT EXISTS), so leaving them installed is fine.

BEGIN;

DROP INDEX IF EXISTS core.idx_driver_alias_lookup_alias_trgm;
DROP INDEX IF EXISTS core.idx_team_alias_lookup_alias_trgm;
DROP INDEX IF EXISTS core.idx_session_venue_alias_lookup_alias_trgm;

DROP INDEX IF EXISTS raw.idx_raw_sessions_country_name_norm_trgm;
DROP INDEX IF EXISTS raw.idx_raw_sessions_location_norm_trgm;
DROP INDEX IF EXISTS raw.idx_raw_sessions_circuit_short_norm_trgm;
DROP INDEX IF EXISTS raw.idx_raw_sessions_session_name_norm_trgm;

DROP FUNCTION IF EXISTS public.f1_unaccent(text);

COMMIT;
