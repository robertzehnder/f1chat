-- Revert openf1:059_fantasy_feed_snapshots from pg

BEGIN;

DROP TABLE IF EXISTS raw.fantasy_feed_snapshots;

COMMIT;
