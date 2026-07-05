-- Revert openf1:042_analytics_overtake_events from pg

BEGIN;

DROP VIEW IF EXISTS analytics.overtake_events;
DROP MATERIALIZED VIEW IF EXISTS analytics.overtake_events_data;

COMMIT;
