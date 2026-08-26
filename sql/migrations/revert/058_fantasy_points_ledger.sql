-- Revert openf1:058_fantasy_points_ledger from pg

BEGIN;

DROP VIEW IF EXISTS analytics.fantasy_points_by_round;
DROP VIEW IF EXISTS analytics.fantasy_points_ledger;
DROP MATERIALIZED VIEW IF EXISTS analytics.fantasy_points_ledger_data;

COMMIT;
