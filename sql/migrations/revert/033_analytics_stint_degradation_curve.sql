-- Revert openf1:033_analytics_stint_degradation_curve from pg

BEGIN;

DROP VIEW IF EXISTS analytics.stint_degradation_curve;
DROP MATERIALIZED VIEW IF EXISTS analytics.stint_degradation_curve_data;

COMMIT;
