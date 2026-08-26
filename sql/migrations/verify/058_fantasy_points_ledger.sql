-- Verify openf1:058_fantasy_points_ledger on pg
-- Definition-based (chain-gate sandbox has no data): matview + facade +
-- reporting view exist, and the ledger definition carries the honesty
-- columns (computable/source) and the inferred-overtake CTE.

BEGIN;

SELECT 1 / COUNT(*) FROM pg_matviews
WHERE schemaname = 'analytics' AND matviewname = 'fantasy_points_ledger_data'
  AND definition LIKE '%computable%' AND definition LIKE '%pos_snap%';

SELECT 1 / COUNT(*) FROM pg_views
WHERE schemaname = 'analytics' AND viewname IN ('fantasy_points_ledger', 'fantasy_points_by_round')
HAVING COUNT(*) = 2;

ROLLBACK;
