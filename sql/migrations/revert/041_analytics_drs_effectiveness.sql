-- Revert openf1:041_analytics_drs_effectiveness from pg

BEGIN;

DROP VIEW IF EXISTS analytics.drs_effectiveness;
DROP MATERIALIZED VIEW IF EXISTS analytics.drs_effectiveness_data;

COMMIT;
