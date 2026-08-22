-- Deploy openf1:053_chat_persistence to pg
-- requires: 052_analytics_year_unlock
--
-- Chat conversation persistence: users can leave and return to prior
-- chats. Two tables in core (same convention as core.user_feedback /
-- core.saved_analysis):
--
--   core.chat_conversation — one row per conversation. user_id is TEXT
--     ('guest' until real auth lands) so the schema survives an auth
--     migration without a rewrite.
--   core.chat_message — ordered turns. role 'user' rows carry the
--     question in content; role 'assistant' rows carry the answer text
--     in content plus the full ChatApiResponse in payload (JSONB) so
--     the client can replay the exact insight card on restore.
--
-- seq is per-conversation and unique so restore ordering never depends
-- on insert timing. ON DELETE CASCADE keeps deletes one-statement.

BEGIN;

CREATE TABLE IF NOT EXISTS core.chat_conversation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL DEFAULT 'guest',
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversation_user_updated
  ON core.chat_conversation (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS core.chat_message (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES core.chat_conversation(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  payload         JSONB,
  request_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_chat_message_conversation_seq UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_conversation
  ON core.chat_message (conversation_id, seq);

COMMIT;
