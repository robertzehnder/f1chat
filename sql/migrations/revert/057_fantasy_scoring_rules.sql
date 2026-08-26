-- Revert openf1:057_fantasy_scoring_rules from pg

BEGIN;

DROP TABLE IF EXISTS core.fantasy_scoring_rules;

COMMIT;
