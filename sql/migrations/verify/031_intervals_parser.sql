-- Verify openf1:031_intervals_parser on pg

BEGIN;

DO $$
DECLARE
  s DOUBLE PRECISION;
  l INTEGER;
BEGIN
  -- Seconds form
  SELECT seconds, laps_down INTO s, l FROM core.parse_interval('+1.234');
  IF s IS DISTINCT FROM 1.234 OR l IS NOT NULL THEN
    RAISE EXCEPTION 'parse_interval("+1.234") wrong: seconds=% laps=%', s, l;
  END IF;

  SELECT seconds, laps_down INTO s, l FROM core.parse_interval('2.5s');
  IF s IS DISTINCT FROM 2.5 OR l IS NOT NULL THEN
    RAISE EXCEPTION 'parse_interval("2.5s") wrong: seconds=% laps=%', s, l;
  END IF;

  -- Laps form
  SELECT seconds, laps_down INTO s, l FROM core.parse_interval('+1L');
  IF s IS NOT NULL OR l IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'parse_interval("+1L") wrong: seconds=% laps=%', s, l;
  END IF;

  SELECT seconds, laps_down INTO s, l FROM core.parse_interval('2 laps');
  IF s IS NOT NULL OR l IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'parse_interval("2 laps") wrong: seconds=% laps=%', s, l;
  END IF;

  -- DNF / DSQ → NULL/NULL
  SELECT seconds, laps_down INTO s, l FROM core.parse_interval('DNF');
  IF s IS NOT NULL OR l IS NOT NULL THEN
    RAISE EXCEPTION 'parse_interval("DNF") should be NULL/NULL';
  END IF;

  -- NULL passthrough
  SELECT seconds, laps_down INTO s, l FROM core.parse_interval(NULL);
  IF s IS NOT NULL OR l IS NOT NULL THEN
    RAISE EXCEPTION 'parse_interval(NULL) should be NULL/NULL';
  END IF;
END $$;

ROLLBACK;
