-- Revert openf1:037_analytics_pit_loss_per_circuit from pg

BEGIN;

DROP VIEW IF EXISTS analytics.pit_loss_per_circuit;
DROP MATERIALIZED VIEW IF EXISTS analytics.pit_loss_per_circuit_data;

COMMIT;
