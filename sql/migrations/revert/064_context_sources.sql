-- Revert openf1:064_context_sources from pg

BEGIN;

DELETE FROM raw.analyst_sources WHERE source_key = 'jolpica';

COMMIT;
