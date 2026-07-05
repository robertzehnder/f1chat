-- Revert openf1:045_analytics_driver_performance_score from pg

BEGIN;

DROP VIEW IF EXISTS analytics.driver_performance_score;
DROP MATERIALIZED VIEW IF EXISTS analytics.driver_performance_score_data;

COMMIT;
