-- Deploy openf1:027_user_feedback to pg
-- requires: 026_alias_seed_expand_phase14
--
-- Phase 16-3: thumbs up/down feedback on chat answers. Persistent
-- (not just perfTrace JSONL) so a weekly aggregator can roll up by
-- question category, generationSource, time window. Schema designed
-- to be tolerant of high-volume writes — no FKs (request_id is
-- already a UUID logged in the chat path), one row per feedback
-- event.

BEGIN;

CREATE TABLE IF NOT EXISTS core.user_feedback (
  id              BIGSERIAL PRIMARY KEY,
  request_id      TEXT NOT NULL,
  thumb           SMALLINT NOT NULL,         -- +1 = up, -1 = down
  reason          TEXT,                       -- optional free text
  question_text   TEXT,                       -- captured at submit time for context
  category        TEXT,                       -- chat-health-check.questions category if known
  generation_source TEXT,                     -- echoed from perfTrace
  client_ts       TIMESTAMPTZ,                -- client-side timestamp
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_request_id ON core.user_feedback(request_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_ingested_at ON core.user_feedback(ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_thumb ON core.user_feedback(thumb, ingested_at DESC);

COMMIT;
