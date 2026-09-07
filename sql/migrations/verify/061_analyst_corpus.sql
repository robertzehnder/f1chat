-- Verify openf1:061_analyst_corpus on pg

BEGIN;

SELECT source_key, kind, enabled, rights_state, approved_uses, allowed_methods,
       may_store_full_text, may_llm_process, retention_days, deletion_required,
       rights_basis, reviewed_at
FROM raw.analyst_sources
WHERE FALSE;

SELECT doc_id, source_key, source_id, url, author, title, published_at, doc_type,
       session_scope, meeting_key, session_key, link_confidence, link_reason,
       linker_version, link_status, corpus_split
FROM raw.analyst_documents
WHERE FALSE;

SELECT fetch_id, doc_id, fetched_at, http_status, etag, last_modified, mime_type,
       raw_sha256, artifact_path, artifact_status
FROM raw.analyst_fetches
WHERE FALSE;

SELECT derivation_id, fetch_id, parent_derivation_id, kind, tool_version,
       input_sha256, output_sha256, output_text, created_at, status
FROM raw.analyst_derivations
WHERE FALSE;

SELECT source_key, source_id, meeting_key, session_key, decided_by, decided_at, note
FROM raw.analyst_link_overrides
WHERE FALSE;

SELECT deletion_id, target_kind, target_id, artifact_sha256, reason, deleted_at
FROM raw.analyst_deletions
WHERE FALSE;

-- The six registry rows must exist with the signed rights states.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM raw.analyst_sources) < 6 THEN
    RAISE EXCEPTION 'analyst_sources registry not seeded';
  END IF;
  IF (SELECT rights_state FROM raw.analyst_sources WHERE source_key = 'reddit') <> 'prohibited' THEN
    RAISE EXCEPTION 'reddit must be prohibited';
  END IF;
END $$;

ROLLBACK;
