-- Verify openf1:025_alias_view_diacritic_alignment on pg

BEGIN;

DO $$
DECLARE
  view_def TEXT;
BEGIN
  SELECT pg_get_viewdef('core.session_search_lookup'::regclass) INTO view_def;
  IF view_def NOT LIKE '%f1_unaccent%' THEN
    RAISE EXCEPTION 'core.session_search_lookup not updated to use f1_unaccent';
  END IF;

  SELECT pg_get_viewdef('core.driver_identity_lookup'::regclass) INTO view_def;
  IF view_def NOT LIKE '%f1_unaccent%' THEN
    RAISE EXCEPTION 'core.driver_identity_lookup not updated to use f1_unaccent';
  END IF;

  SELECT pg_get_viewdef('core.team_identity_lookup'::regclass) INTO view_def;
  IF view_def NOT LIKE '%f1_unaccent%' THEN
    RAISE EXCEPTION 'core.team_identity_lookup not updated to use f1_unaccent';
  END IF;

  IF NOT (public.f1_unaccent(LOWER(BTRIM('São Paulo'))) = public.f1_unaccent(LOWER(BTRIM('Sao Paulo')))) THEN
    RAISE EXCEPTION 'f1_unaccent does not collapse São Paulo / Sao Paulo';
  END IF;
END $$;

ROLLBACK;
