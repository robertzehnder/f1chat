-- Deploy openf1:057_fantasy_scoring_rules to pg
-- requires: 056_grid_vs_finish_dsq_honesty
--
-- Fantasy R0 (converged roadmap): the official F1 Fantasy scoring system as
-- VERSIONED DATA, one row per (season, component[, position]). Rules live in
-- a table — never as constants inside a matview — because third-party
-- summaries of the game disagree on several penalties; the ledger (058)
-- reads whatever this table says, and the reconciliation harness corrects
-- the table when official round totals disagree. Numbers below are seeded
-- from the 2025/2026 published guides; rows carry notes where sources
-- conflicted so reconciliation knows where to look first.

BEGIN;

CREATE TABLE IF NOT EXISTS core.fantasy_scoring_rules (
  season     INT      NOT NULL,
  component  TEXT     NOT NULL,
  position   INT,               -- position-indexed tables; NULL for scalars
  points     NUMERIC  NOT NULL,
  computable TEXT     NOT NULL DEFAULT 'exact',  -- exact | proxy | external
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_scoring_rules
  ON core.fantasy_scoring_rules (season, component, COALESCE(position, -1));

-- Idempotent reseed for the two seasons we score.
DELETE FROM core.fantasy_scoring_rules WHERE season IN (2025, 2026);

INSERT INTO core.fantasy_scoring_rules (season, component, position, points, computable, notes)
SELECT s.season, v.component, v.position, v.points, v.computable, v.notes
FROM (VALUES (2025), (2026)) AS s(season)
CROSS JOIN (VALUES
  -- Qualifying (GP qualifying only; Sprint Qualifying is unscored)
  ('quali_position', 1, 10::numeric, 'exact', NULL),
  ('quali_position', 2, 9, 'exact', NULL),
  ('quali_position', 3, 8, 'exact', NULL),
  ('quali_position', 4, 7, 'exact', NULL),
  ('quali_position', 5, 6, 'exact', NULL),
  ('quali_position', 6, 5, 'exact', NULL),
  ('quali_position', 7, 4, 'exact', NULL),
  ('quali_position', 8, 3, 'exact', NULL),
  ('quali_position', 9, 2, 'exact', NULL),
  ('quali_position', 10, 1, 'exact', NULL),
  ('quali_no_time', NULL, -5, 'exact', 'no time set / not classified in qualifying'),
  ('quali_dsq', NULL, -15, 'exact', 'CONFLICT: one source says flat -5 for all quali non-classification; verify vs official in reconciliation'),
  -- Grand Prix
  ('race_position', 1, 25, 'exact', NULL),
  ('race_position', 2, 18, 'exact', NULL),
  ('race_position', 3, 15, 'exact', NULL),
  ('race_position', 4, 12, 'exact', NULL),
  ('race_position', 5, 10, 'exact', NULL),
  ('race_position', 6, 8, 'exact', NULL),
  ('race_position', 7, 6, 'exact', NULL),
  ('race_position', 8, 4, 'exact', NULL),
  ('race_position', 9, 2, 'exact', NULL),
  ('race_position', 10, 1, 'exact', NULL),
  ('race_position_delta_per_place', NULL, 1, 'exact', 'grid (official starting grid) -> flag, +/-1 per place'),
  ('race_overtake', NULL, 1, 'proxy', 'fantasy counts LEGAL on-track passes; warehouse infers from position feed'),
  ('race_fastest_lap', NULL, 10, 'proxy', 'proxied by fastest valid race lap'),
  ('driver_of_the_day', NULL, 10, 'external', 'fan vote; not in warehouse'),
  ('race_not_classified', NULL, -20, 'exact', 'DNF / DNS / not classified'),
  ('race_dsq_constructor', NULL, -25, 'exact', 'DSQ penalty charged to constructor since 2025; CONFLICT: one source says -20; reconcile'),
  -- Sprint
  ('sprint_position', 1, 8, 'exact', NULL),
  ('sprint_position', 2, 7, 'exact', NULL),
  ('sprint_position', 3, 6, 'exact', NULL),
  ('sprint_position', 4, 5, 'exact', NULL),
  ('sprint_position', 5, 4, 'exact', NULL),
  ('sprint_position', 6, 3, 'exact', NULL),
  ('sprint_position', 7, 2, 'exact', NULL),
  ('sprint_position', 8, 1, 'exact', NULL),
  ('sprint_position_delta_per_place', NULL, 1, 'exact', NULL),
  ('sprint_delta_loss_cap', NULL, -10, 'exact', 'max total deduction from sprint positions lost'),
  ('sprint_fastest_lap', NULL, 5, 'proxy', NULL),
  -- Constructor extras
  ('constructor_q2_none', NULL, -1, 'proxy', 'Q2/Q3 progression proxied from final quali classification (P<=15 / P<=10)'),
  ('constructor_q2_one', NULL, 1, 'proxy', NULL),
  ('constructor_q2_both', NULL, 3, 'proxy', NULL),
  ('constructor_q3_one', NULL, 5, 'proxy', NULL),
  ('constructor_q3_both', NULL, 10, 'proxy', NULL),
  ('pit_tier_sub_200', NULL, 20, 'external', 'stationary-time tiers; warehouse pit feed is pit-LANE time — tiers not computable'),
  ('pit_tier_200_219', NULL, 10, 'external', NULL),
  ('pit_tier_220_249', NULL, 5, 'external', NULL),
  ('pit_tier_250_299', NULL, 2, 'external', NULL),
  ('pit_fastest_of_race', NULL, 5, 'proxy', 'rank by lane time within a race approximates stationary rank'),
  ('pit_world_record', NULL, 15, 'external', NULL)
) AS v(component, position, points, computable, notes);

-- Season-specific overrides: sprint non-classification softened for 2026.
INSERT INTO core.fantasy_scoring_rules (season, component, position, points, computable, notes) VALUES
  (2025, 'sprint_not_classified', NULL, -20, 'exact', NULL),
  (2026, 'sprint_not_classified', NULL, -10, 'exact', '2026 rule change: sprint DNF reduced from -20');

COMMIT;
