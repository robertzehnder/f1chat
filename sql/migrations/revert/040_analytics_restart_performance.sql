-- Revert openf1:040_analytics_restart_performance from pg

BEGIN;

DROP VIEW IF EXISTS analytics.restart_performance;
DROP MATERIALIZED VIEW IF EXISTS analytics.restart_performance_data;

COMMIT;
