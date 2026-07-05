-- Deploy openf1:031_intervals_parser to pg
-- requires: 030_track_segments_corners
--
-- Phase 20-C (slice 20-intervals-parser): pure-SQL helper
-- core.parse_interval(text) returning (seconds_or_null, laps_down_or_null).
-- Used by every battle-related Phase 21 matview that needs to compare
-- intervals from raw.intervals (which is reported as a string like
-- "+1.234" or "+1L" by the timing feed).
--
-- Contract:
--   - Input "1.234" or "+1.234" or "1.234s" → (1.234, NULL).
--   - Input "+1L" or "1 LAP" or "+2 laps" → (NULL, 1) or (NULL, 2).
--   - Input "" or NULL → (NULL, NULL).
--   - Input "DNF" / "DSQ" / non-numeric → (NULL, NULL).
--
-- The function is IMMUTABLE PARALLEL SAFE so it can be inlined in
-- generated SQL without query-planner complaints. No PL/pgSQL —
-- pure SQL via regexp_match.

BEGIN;

CREATE SCHEMA IF NOT EXISTS core;

DROP FUNCTION IF EXISTS core.parse_interval(text);

CREATE OR REPLACE FUNCTION core.parse_interval(input text)
RETURNS TABLE (seconds DOUBLE PRECISION, laps_down INTEGER)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    -- Seconds: match an optional sign, digits, optional decimal,
    -- optional 's' suffix. Reject if a 'L' / 'LAP' is present (laps
    -- form takes precedence below).
    CASE
      WHEN input IS NULL THEN NULL::DOUBLE PRECISION
      WHEN input ~* '\y\d+\s*(LAPS|LAP|L)' THEN NULL::DOUBLE PRECISION
      WHEN input ~* '^[+\-]?\d+(\.\d+)?\s*s?$' THEN
        REGEXP_REPLACE(input, '[^0-9.-]', '', 'g')::DOUBLE PRECISION
      ELSE NULL::DOUBLE PRECISION
    END AS seconds,
    -- Laps-down: match a leading optional sign, digits, then 'L' or
    -- 'LAP[S]'. Returns the integer laps. Reject if a decimal seconds
    -- form is present. NOTE: Postgres ARE uses \y for word boundary
    -- (\b is backspace here); \d/\s are digit/whitespace. Single
    -- backslashes — these are standard-conforming string literals, so
    -- doubling them (\\d) matches a literal backslash and never fires.
    CASE
      WHEN input IS NULL THEN NULL::INTEGER
      WHEN input ~* '\.\d+' THEN NULL::INTEGER
      WHEN input ~* '\y\d+\s*(LAPS|LAP|L)' THEN
        -- SUBSTRING(... FROM pattern) is case-SENSITIVE (unlike ~*), so
        -- upper-case the input first or lowercase 'laps' would not extract.
        SUBSTRING(UPPER(input) FROM '\y(\d+)\s*(LAPS|LAP|L)')::INTEGER
      ELSE NULL::INTEGER
    END AS laps_down
$$;

COMMENT ON FUNCTION core.parse_interval(text) IS
  'Phase 20-C: parse raw.intervals string into (seconds, laps_down). Returns NULL/NULL for non-numeric inputs (DNF/DSQ).';

COMMIT;
