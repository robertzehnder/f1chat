-- Revert openf1:032_analytics_sector_dominance from pg

BEGIN;

DROP VIEW IF EXISTS analytics.sector_dominance;
DROP MATERIALIZED VIEW IF EXISTS analytics.sector_dominance_data;

COMMIT;
