-- Revert openf1:053_chat_persistence from pg

BEGIN;

DROP TABLE IF EXISTS core.chat_message;
DROP TABLE IF EXISTS core.chat_conversation;

COMMIT;
