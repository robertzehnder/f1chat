-- Verify openf1:060_fantasy_projection on pg

BEGIN;

SELECT season, gameday, entity_type, entity_name, model, expected_points, price
FROM analytics.fantasy_projection
WHERE FALSE;

ROLLBACK;
