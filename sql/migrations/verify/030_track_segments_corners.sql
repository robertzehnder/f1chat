-- Verify openf1:030_track_segments_corners on pg

BEGIN;

DO $$
DECLARE
  corner_count int;
  silverstone_corner_count int;
BEGIN
  SELECT COUNT(*) INTO corner_count
  FROM f1.track_segments
  WHERE segment_kind = 'corner';
  IF corner_count < 30 THEN
    RAISE EXCEPTION 'expected at least 30 FIA corner rows, got %', corner_count;
  END IF;

  -- Spot-check Silverstone has Copse + Maggotts + Becketts.
  SELECT COUNT(*) INTO silverstone_corner_count
  FROM f1.track_segments
  WHERE segment_kind = 'corner'
    AND circuit_short_name = 'Silverstone'
    AND segment_label IN ('Turn 9 (Copse)', 'Turn 10 (Maggotts)', 'Turn 11 (Becketts)');
  IF silverstone_corner_count <> 3 THEN
    RAISE EXCEPTION 'expected Silverstone Copse/Maggotts/Becketts triple, got %', silverstone_corner_count;
  END IF;
END $$;

ROLLBACK;
