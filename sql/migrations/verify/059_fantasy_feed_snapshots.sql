-- Verify openf1:059_fantasy_feed_snapshots on pg

BEGIN;

SELECT season, gameday, player_id, entity_type, price, gameday_points,
       selected_pct, payload
FROM raw.fantasy_feed_snapshots
WHERE FALSE;

ROLLBACK;
