-- Revert openf1:044_analytics_straight_line_dominance from pg

BEGIN;

DROP VIEW IF EXISTS analytics.straight_line_dominance;
DROP MATERIALIZED VIEW IF EXISTS analytics.straight_line_dominance_data;

COMMIT;
