-- Prod data-repair: remove duplicate seed rows that PROD acquired by being
-- built WITHOUT the chain's PRIMARY KEY / UNIQUE constraints (deploy/006 defines
-- core.compound_alias_lookup.raw_compound PRIMARY KEY; prod lost it). The 2×
-- compound_alias_lookup dup fanned every lap ×2 via lap_semantic_bridge's join.
-- Idempotent. Applied to prod 2026-07-02.
BEGIN;
DELETE FROM core.compound_alias_lookup a USING core.compound_alias_lookup b
  WHERE a.raw_compound = b.raw_compound AND a.ctid > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_compound_alias_lookup_raw_compound
  ON core.compound_alias_lookup (raw_compound);
DELETE FROM core.valid_lap_policy a USING core.valid_lap_policy b
  WHERE a.policy_key = b.policy_key AND a.policy_version = b.policy_version AND a.ctid > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_valid_lap_policy_key_version
  ON core.valid_lap_policy (policy_key, policy_version);
COMMIT;
