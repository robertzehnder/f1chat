-- Deploy openf1:064_context_sources to pg
-- requires: 063_reporting_sources
--
-- Historical-context source for the analyst articles: the Jolpica API
-- (Ergast-compatible, F1 results 1950–present). Facts such as "first Italian
-- winner at Monza since 1966" are COMPUTED from its rows by
-- web/scripts/reporting/context_facts.mjs, never recalled by a model.

BEGIN;

INSERT INTO raw.analyst_sources
  (source_key, kind, config, enabled, rights_state, approved_uses, allowed_methods,
   may_store_full_text, may_llm_process, retention_days, deletion_required, rights_basis, reviewed_at)
VALUES
  ('jolpica', 'api',
   '{"base":"https://api.jolpi.ca/ergast/f1","page_limit":100,"note":"cache responses under corpus-artifacts/jolpica/"}'::jsonb,
   TRUE, 'approved_private', ARRAY['reporting','eval_reference'], ARRAY['api'],
   TRUE, TRUE, NULL, FALSE,
   'Jolpica F1 API (open Ergast-compatible results database) used for private research; facts are derived from result rows and cited with the query URL. Re-review the data licence before any commercial use.',
   now())
ON CONFLICT (source_key) DO NOTHING;

COMMIT;
