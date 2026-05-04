-- Revert openf1:029_track_segments_auto from pg

BEGIN;

DROP TABLE IF EXISTS f1.track_segments;
-- Don't drop the f1 schema; later Phase 20 slices add to it.

COMMIT;
