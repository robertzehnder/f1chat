-- Revert openf1:030_track_segments_corners from pg

BEGIN;

DELETE FROM f1.track_segments WHERE segment_kind = 'corner';

COMMIT;
