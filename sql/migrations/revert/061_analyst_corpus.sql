-- Revert openf1:061_analyst_corpus from pg

BEGIN;

DROP TABLE IF EXISTS raw.analyst_deletions;
DROP TABLE IF EXISTS raw.analyst_link_overrides;
DROP TABLE IF EXISTS raw.analyst_derivations;
DROP TABLE IF EXISTS raw.analyst_fetches;
DROP TABLE IF EXISTS raw.analyst_documents;
DROP TABLE IF EXISTS raw.analyst_sources;

COMMIT;
