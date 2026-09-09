-- Verify openf1:064_context_sources on pg

BEGIN;

SELECT 1/COUNT(*) FROM raw.analyst_sources WHERE source_key = 'jolpica' AND kind = 'api' AND 'reporting' = ANY (approved_uses);

ROLLBACK;
