-- Revert openf1:034_analytics_race_control_incidents from pg

BEGIN;

DROP VIEW IF EXISTS analytics.race_control_incidents;
DROP MATERIALIZED VIEW IF EXISTS analytics.race_control_incidents_data;

COMMIT;
