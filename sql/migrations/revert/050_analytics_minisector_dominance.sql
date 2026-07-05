-- Revert openf1:050_analytics_minisector_dominance from pg

BEGIN;

DROP VIEW IF EXISTS analytics.minisector_dominance;
DROP MATERIALIZED VIEW IF EXISTS analytics.minisector_dominance_data;

COMMIT;
