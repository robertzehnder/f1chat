-- Revert openf1:039_analytics_traffic_adjusted_pace from pg

BEGIN;

DROP VIEW IF EXISTS analytics.traffic_adjusted_pace;
DROP MATERIALIZED VIEW IF EXISTS analytics.traffic_adjusted_pace_data;

COMMIT;
