-- Revert openf1:027_user_feedback from pg

BEGIN;

DROP INDEX IF EXISTS core.idx_user_feedback_thumb;
DROP INDEX IF EXISTS core.idx_user_feedback_ingested_at;
DROP INDEX IF EXISTS core.idx_user_feedback_request_id;
DROP TABLE IF EXISTS core.user_feedback;

COMMIT;
