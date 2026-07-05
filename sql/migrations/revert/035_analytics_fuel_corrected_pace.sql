-- Revert openf1:035_analytics_fuel_corrected_pace from pg

BEGIN;

DROP VIEW IF EXISTS analytics.fuel_corrected_pace;
DROP MATERIALIZED VIEW IF EXISTS analytics.fuel_corrected_pace_data;

COMMIT;
