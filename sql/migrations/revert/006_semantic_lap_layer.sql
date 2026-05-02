-- Revert openf1:006_semantic_lap_layer from pg

BEGIN;

DROP VIEW IF EXISTS core.replay_lap_frames;
DROP VIEW IF EXISTS core.laps_enriched;
DROP VIEW IF EXISTS core.lap_semantic_bridge;

DROP INDEX IF EXISTS core.uq_replay_contract_default;
DROP INDEX IF EXISTS core.uq_valid_lap_policy_default;

DROP TABLE IF EXISTS core.replay_contract_registry;
DROP TABLE IF EXISTS core.metric_registry;
DROP TABLE IF EXISTS core.valid_lap_policy;
DROP TABLE IF EXISTS core.compound_alias_lookup;

COMMIT;
