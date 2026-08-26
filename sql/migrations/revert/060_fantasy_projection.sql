-- Revert openf1:060_fantasy_projection from pg

BEGIN;

DROP TABLE IF EXISTS analytics.fantasy_projection;

COMMIT;
