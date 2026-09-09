-- Revert openf1:063_reporting_sources from pg

BEGIN;

DELETE FROM raw.analyst_sources WHERE source_key IN ('x_reporters', 'bluesky_reporters', 'fia_documents');

UPDATE raw.analyst_sources
   SET approved_uses = array_remove(approved_uses, 'reporting')
 WHERE 'reporting' = ANY (approved_uses);

ALTER TABLE raw.analyst_sources DROP CONSTRAINT IF EXISTS analyst_sources_approved_uses_check;
ALTER TABLE raw.analyst_sources
  ADD CONSTRAINT analyst_sources_approved_uses_check
  CHECK (approved_uses <@ ARRAY['style_research','eval_reference','question_mining','format_study']::text[]);

ALTER TABLE raw.analyst_sources DROP CONSTRAINT IF EXISTS analyst_sources_kind_check;
ALTER TABLE raw.analyst_sources
  ADD CONSTRAINT analyst_sources_kind_check
  CHECK (kind IN ('rss','html','youtube','manual'));

COMMIT;
