-- Verify openf1:056_grid_vs_finish_dsq_honesty on pg
-- Definition-based (the chain-gate sandbox has no data): the view must
-- carry the session-scoped official-finish gate. Divides by zero
-- otherwise.

BEGIN;

SELECT 1 / COUNT(*)
FROM pg_views
WHERE schemaname = 'core'
  AND viewname = 'grid_vs_finish'
  AND definition LIKE '%finish_official_sessions%'
  AND definition LIKE '%raw.session_result:unclassified%';

ROLLBACK;
