-- Revert openf1:036_analytics_weather_impact from pg

BEGIN;

DROP VIEW IF EXISTS analytics.weather_impact;
DROP MATERIALIZED VIEW IF EXISTS analytics.weather_impact_data;

COMMIT;
