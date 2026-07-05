-- Revert openf1:051_analytics_traction_braking from pg

BEGIN;

DROP VIEW IF EXISTS analytics.braking_performance;
DROP VIEW IF EXISTS analytics.traction_analysis;
DROP MATERIALIZED VIEW IF EXISTS analytics.braking_performance_data;
DROP MATERIALIZED VIEW IF EXISTS analytics.traction_analysis_data;

COMMIT;
