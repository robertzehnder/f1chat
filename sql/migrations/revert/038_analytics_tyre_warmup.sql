-- Revert openf1:038_analytics_tyre_warmup from pg

BEGIN;

DROP VIEW IF EXISTS analytics.tyre_warmup;
DROP MATERIALIZED VIEW IF EXISTS analytics.tyre_warmup_data;

COMMIT;
