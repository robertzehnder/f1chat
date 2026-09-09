-- Deploy openf1:063_reporting_sources to pg
-- requires: 062_racing_state_and_incident_honesty
--
-- Reporting layer for the analyst articles (owner decisions 2026-09-09):
-- new source kinds/purpose and the registry rows for the X pay-per-use lean
-- list, Bluesky public API and official FIA event documents. Rights stay
-- fail-closed: every fetcher still calls assertAcquireAllowed/assertUseAllowed.

BEGIN;

ALTER TABLE raw.analyst_sources DROP CONSTRAINT IF EXISTS analyst_sources_kind_check;
ALTER TABLE raw.analyst_sources
  ADD CONSTRAINT analyst_sources_kind_check
  CHECK (kind IN ('rss','html','youtube','manual','api'));

ALTER TABLE raw.analyst_sources DROP CONSTRAINT IF EXISTS analyst_sources_approved_uses_check;
ALTER TABLE raw.analyst_sources
  ADD CONSTRAINT analyst_sources_approved_uses_check
  CHECK (approved_uses <@ ARRAY['style_research','eval_reference','question_mining','format_study','reporting']::text[]);

INSERT INTO raw.analyst_sources
  (source_key, kind, config, enabled, rights_state, approved_uses, allowed_methods,
   may_store_full_text, may_llm_process, retention_days, deletion_required, rights_basis, reviewed_at)
VALUES
  ('x_reporters', 'api',
   '{"plan":"pay-per-use","windows":["Qualifying","Sprint Qualifying","Sprint","Race"],"list":"web/config/reporting/x_accounts.json"}'::jsonb,
   TRUE, 'approved_private', ARRAY['reporting'], ARRAY['x_api_v2','x_oembed'],
   TRUE, TRUE, 90, TRUE,
   'X API v2 pay-per-use developer terms (no model training; attribution + link when displayed; honour deletions) and the public oEmbed endpoint for hand-picked posts. Article use: paraphrase attributed by name with the post link; verbatim <= 4 words. Owner decision 2026-09-09.',
   now()),
  ('bluesky_reporters', 'api',
   '{"list":"web/config/reporting/bluesky_accounts.json"}'::jsonb,
   TRUE, 'approved_private', ARRAY['reporting'], ARRAY['bsky_public_api'],
   TRUE, TRUE, 90, TRUE,
   'Bluesky public AT Protocol API on public posts (no auth). Article use: paraphrase attributed by name with the post link; verbatim <= 4 words. Owner decision 2026-09-09.',
   now()),
  ('fia_documents', 'html',
   '{"championship":"fia-formula-one-world-championship-14"}'::jsonb,
   TRUE, 'approved_private', ARRAY['reporting','eval_reference'], ARRAY['html','pdf'],
   TRUE, TRUE, NULL, FALSE,
   'Official FIA event documents published for public download on fia.com (stewards decisions, infringements, classifications, event notes). Cited by title with link; short excerpts only in committed files.',
   now())
ON CONFLICT (source_key) DO NOTHING;

-- Outlets already approved for private research may also be cited (paraphrase + link) as reporting.
UPDATE raw.analyst_sources
   SET approved_uses = array_append(approved_uses, 'reporting')
 WHERE source_key IN ('f1com', 'the_race', 'substack:f1debrief')
   AND NOT ('reporting' = ANY (approved_uses));

COMMIT;
