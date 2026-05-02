-- Verify openf1:026_alias_seed_expand_phase14 on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.driver_alias_lookup WHERE alias_text = 'checo') THEN
    RAISE EXCEPTION 'expected driver alias ''checo'' not present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.team_alias_lookup WHERE alias_text = 'maranello') THEN
    RAISE EXCEPTION 'expected team alias ''maranello'' not present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.session_venue_alias_lookup WHERE alias_text = 'the ardennes') THEN
    RAISE EXCEPTION 'expected venue alias ''the ardennes'' not present';
  END IF;
  -- Sao Paulo / São Paulo collide via the f1_unaccent normalization
  IF NOT EXISTS (
    SELECT 1
    FROM core.session_venue_alias_lookup
    WHERE alias_text = 'sao paulo'
      AND normalized_alias = public.f1_unaccent(LOWER(BTRIM('sao paulo')))
  ) THEN
    RAISE EXCEPTION 'sao paulo seed row missing or normalized_alias incorrect';
  END IF;
END $$;

ROLLBACK;
