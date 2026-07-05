-- Revert openf1:043_analytics_undercut_overcut_history from pg

BEGIN;

DROP VIEW IF EXISTS analytics.undercut_overcut_history;
DROP MATERIALIZED VIEW IF EXISTS analytics.undercut_overcut_history_data;

COMMIT;
