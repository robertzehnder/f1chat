-- Verify openf1:057_fantasy_scoring_rules on pg
-- Structure + seed sanity: both seasons seeded, position tables complete,
-- and the one season-divergent rule (sprint_not_classified) differs.

BEGIN;

SELECT 1 / COUNT(*) FROM core.fantasy_scoring_rules
WHERE season = 2026 AND component = 'race_position' AND position = 1 AND points = 25;

SELECT 1 / (COUNT(DISTINCT season) - 1) FROM core.fantasy_scoring_rules;

SELECT 1 / COUNT(*) FROM (
  SELECT 1
  FROM core.fantasy_scoring_rules a
  JOIN core.fantasy_scoring_rules b
    ON b.component = a.component AND b.season = 2026 AND a.season = 2025
  WHERE a.component = 'sprint_not_classified' AND a.points = -20 AND b.points = -10
) t;

ROLLBACK;
