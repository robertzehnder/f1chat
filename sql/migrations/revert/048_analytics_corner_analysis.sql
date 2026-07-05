-- Revert openf1:048_analytics_corner_analysis from pg

BEGIN;

DROP VIEW IF EXISTS analytics.corner_analysis;
DROP MATERIALIZED VIEW IF EXISTS analytics.corner_analysis_data;

COMMIT;
