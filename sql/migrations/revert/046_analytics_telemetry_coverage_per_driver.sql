-- Revert openf1:046_analytics_telemetry_coverage_per_driver from pg

BEGIN;

DROP VIEW IF EXISTS analytics.telemetry_coverage_per_driver;
DROP MATERIALIZED VIEW IF EXISTS analytics.telemetry_coverage_per_driver_data;

COMMIT;
