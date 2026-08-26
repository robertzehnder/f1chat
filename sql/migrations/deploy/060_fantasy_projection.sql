-- Deploy openf1:060_fantasy_projection to pg
-- requires: 059_fantasy_feed_snapshots
--
-- Fantasy R3/R6: stored projections for upcoming gamedays, one row per
-- (season, gameday, entity, model). Written by
-- web/scripts/health/fantasy_project.mjs before each round; kept
-- append-only per generated_at so the calibration scorecard can compare
-- what WAS projected against what happened (leakage-proof by
-- construction — projections are timestamped before the round).

BEGIN;

CREATE TABLE IF NOT EXISTS analytics.fantasy_projection (
  season          INT NOT NULL,
  gameday         INT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_name     TEXT NOT NULL,
  model           TEXT NOT NULL,
  expected_points NUMERIC NOT NULL,
  price           NUMERIC,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, gameday, entity_type, entity_name, model)
);

COMMIT;
