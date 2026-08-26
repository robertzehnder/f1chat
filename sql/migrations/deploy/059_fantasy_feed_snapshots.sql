-- Deploy openf1:059_fantasy_feed_snapshots to pg
-- requires: 058_fantasy_points_ledger
--
-- Fantasy R1: raw store for the official game's per-gameday driver/
-- constructor feed (fantasy.formula1.com/feeds/drivers/<gameday>_en.json).
-- One row per (season, gameday, player). Carries the three things the
-- roadmap needs from outside the warehouse: PRICES as-of each round,
-- OWNERSHIP (selected %), and the game's OWN official points per gameday —
-- the reconciliation target for the reconstructed ledger (058) and the
-- definitive totals for training. Full payload kept as jsonb so later
-- phases can mine fields without re-fetching.

BEGIN;

CREATE TABLE IF NOT EXISTS raw.fantasy_feed_snapshots (
  season          INT NOT NULL,
  gameday         INT NOT NULL,
  player_id       TEXT NOT NULL,
  entity_type     TEXT NOT NULL,          -- 'driver' | 'constructor'
  full_name       TEXT,
  driver_tla      TEXT,
  team_name       TEXT,
  price           NUMERIC,                -- Value ($M) as of this gameday feed
  gameday_points  NUMERIC,                -- official fantasy points this round
  overall_points  NUMERIC,                -- official season cumulative
  quali_points    NUMERIC,
  race_points     NUMERIC,
  sprint_points   NUMERIC,
  selected_pct    NUMERIC,
  captain_pct     NUMERIC,
  is_active       BOOLEAN,
  payload         JSONB,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, gameday, player_id)
);

COMMIT;
