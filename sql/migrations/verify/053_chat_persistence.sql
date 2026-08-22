-- Verify openf1:053_chat_persistence on pg

BEGIN;

DO $$
DECLARE
  n int;
  missing text;
  conv_cols text[] := ARRAY['id', 'user_id', 'title', 'created_at', 'updated_at'];
  msg_cols  text[] := ARRAY['id', 'conversation_id', 'seq', 'role', 'content', 'payload', 'request_id', 'created_at'];
BEGIN
  SELECT COUNT(*) INTO n FROM information_schema.tables
  WHERE table_schema = 'core' AND table_name = 'chat_conversation';
  IF n = 0 THEN RAISE EXCEPTION 'core.chat_conversation missing'; END IF;

  SELECT COUNT(*) INTO n FROM information_schema.tables
  WHERE table_schema = 'core' AND table_name = 'chat_message';
  IF n = 0 THEN RAISE EXCEPTION 'core.chat_message missing'; END IF;

  FOR missing IN
    SELECT unnest(conv_cols) EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'chat_conversation'
  LOOP RAISE EXCEPTION 'core.chat_conversation missing column: %', missing; END LOOP;

  FOR missing IN
    SELECT unnest(msg_cols) EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'chat_message'
  LOOP RAISE EXCEPTION 'core.chat_message missing column: %', missing; END LOOP;

  SELECT COUNT(*) INTO n FROM pg_constraint
  WHERE conname = 'uq_chat_message_conversation_seq';
  IF n = 0 THEN RAISE EXCEPTION 'uq_chat_message_conversation_seq missing'; END IF;
END $$;

ROLLBACK;
