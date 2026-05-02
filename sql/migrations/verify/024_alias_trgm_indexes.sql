-- Verify openf1:024_alias_trgm_indexes on pg

BEGIN;

DO $$
DECLARE
  expected_extensions TEXT[] := ARRAY['pg_trgm', 'unaccent'];
  expected_indexes TEXT[] := ARRAY[
    'idx_driver_alias_lookup_alias_trgm',
    'idx_team_alias_lookup_alias_trgm',
    'idx_session_venue_alias_lookup_alias_trgm',
    'idx_raw_sessions_country_name_norm_trgm',
    'idx_raw_sessions_location_norm_trgm',
    'idx_raw_sessions_circuit_short_norm_trgm',
    'idx_raw_sessions_session_name_norm_trgm'
  ];
  ext TEXT;
  ix TEXT;
  missing_ext TEXT[];
  missing_ix TEXT[];
BEGIN
  FOREACH ext IN ARRAY expected_extensions LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = ext) THEN
      missing_ext := COALESCE(missing_ext, ARRAY[]::TEXT[]) || ext;
    END IF;
  END LOOP;
  IF array_length(missing_ext, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'missing required extensions: %', missing_ext;
  END IF;

  FOREACH ix IN ARRAY expected_indexes LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname IN ('core', 'raw')
        AND indexname = ix
    ) THEN
      missing_ix := COALESCE(missing_ix, ARRAY[]::TEXT[]) || ix;
    END IF;
  END LOOP;
  IF array_length(missing_ix, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'missing required GIN indexes: %', missing_ix;
  END IF;

  -- Smoke: similarity() works end-to-end
  IF NOT (similarity('verstapen', 'verstappen') >= 0.5) THEN
    RAISE EXCEPTION 'pg_trgm similarity smoke failed: verstapen ~ verstappen scored too low';
  END IF;
  IF NOT (public.f1_unaccent('Pérez') = 'Perez') THEN
    RAISE EXCEPTION 'f1_unaccent smoke failed: Pérez did not normalize to Perez';
  END IF;
  IF NOT (public.f1_unaccent('São Paulo') = 'Sao Paulo') THEN
    RAISE EXCEPTION 'f1_unaccent smoke failed: São Paulo did not normalize to Sao Paulo';
  END IF;
END $$;

ROLLBACK;
