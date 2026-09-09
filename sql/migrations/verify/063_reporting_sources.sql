-- Verify openf1:063_reporting_sources on pg

BEGIN;

SELECT 1/COUNT(*) FROM raw.analyst_sources WHERE source_key = 'x_reporters' AND kind = 'api' AND 'reporting' = ANY (approved_uses);
SELECT 1/COUNT(*) FROM raw.analyst_sources WHERE source_key = 'bluesky_reporters' AND kind = 'api';
SELECT 1/COUNT(*) FROM raw.analyst_sources WHERE source_key = 'fia_documents' AND 'pdf' = ANY (allowed_methods);
SELECT 1/COUNT(*) FROM pg_constraint
 WHERE conrelid = 'raw.analyst_sources'::regclass
   AND conname = 'analyst_sources_approved_uses_check'
   AND pg_get_constraintdef(oid) LIKE '%reporting%';

ROLLBACK;
