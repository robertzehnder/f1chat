/**
 * conversationStore — server-side persistence for chat conversations.
 *
 * Backing tables: core.chat_conversation + core.chat_message
 * (migration 053). All writes are parameterized; the payload column
 * stores the final ChatApiResponse so the client can replay the exact
 * insight card on restore (same fold pipeline as live streaming).
 *
 * Persistence is best-effort by design: a failed save must never break
 * answering, so callers wrap these in try/catch and log.
 */
import { pool, sql } from "@/lib/db";

export type ConversationSummary = {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  message_count: number;
};

export type StoredMessage = {
  seq: number;
  role: "user" | "assistant";
  content: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Title = first question, squashed to one line, word-trimmed to ~60 chars. */
export function deriveTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 60) {
    return oneLine || "New chat";
  }
  const cut = oneLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 30 ? lastSpace : 60)}…`;
}

export async function listConversations(
  userId: string,
  limit = 50
): Promise<ConversationSummary[]> {
  return sql<ConversationSummary>(
    `SELECT c.id, c.title, c.updated_at,
            COALESCE(m.message_count, 0)::int AS message_count,
            COALESCE(m.preview, '') AS preview
     FROM core.chat_conversation c
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS message_count,
              (SELECT content FROM core.chat_message
               WHERE conversation_id = c.id AND role = 'user'
               ORDER BY seq DESC LIMIT 1) AS preview
       FROM core.chat_message WHERE conversation_id = c.id
     ) m ON TRUE
     WHERE c.user_id = $1
     ORDER BY c.updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );
}

export async function getConversationMessages(
  conversationId: string
): Promise<{ id: string; title: string; messages: StoredMessage[] } | null> {
  const convo = await sql<{ id: string; title: string }>(
    "SELECT id, title FROM core.chat_conversation WHERE id = $1",
    [conversationId]
  );
  if (convo.length === 0) {
    return null;
  }
  const messages = await sql<StoredMessage>(
    `SELECT seq, role, content, payload, created_at
     FROM core.chat_message WHERE conversation_id = $1 ORDER BY seq`,
    [conversationId]
  );
  return { id: convo[0].id, title: convo[0].title, messages };
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  const rows = await sql<{ id: string }>(
    "DELETE FROM core.chat_conversation WHERE id = $1 RETURNING id",
    [conversationId]
  );
  return rows.length > 0;
}

export async function renameConversation(
  conversationId: string,
  title: string
): Promise<boolean> {
  const rows = await sql<{ id: string }>(
    "UPDATE core.chat_conversation SET title = $2, updated_at = NOW() WHERE id = $1 RETURNING id",
    [conversationId, title]
  );
  return rows.length > 0;
}

/** Rows above this count are dropped from the stored payload — the UI
 *  table preview never shows more, and full-fidelity row storage would
 *  bloat chat_message for zero replay value. */
const MAX_STORED_ROWS = 50;

function compactPayloadForStorage(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const result = payload.result as
    | { rows?: unknown[]; rowCount?: number; truncated?: boolean }
    | undefined;
  if (!result?.rows || result.rows.length <= MAX_STORED_ROWS) {
    return payload;
  }
  return {
    ...payload,
    result: {
      ...result,
      rows: result.rows.slice(0, MAX_STORED_ROWS),
      truncated: true
    }
  };
}

/**
 * Append one completed turn (user question + assistant response).
 * Creates the conversation when conversationId is null. Returns the
 * conversation identity so the route can hand it back to the client.
 */
export async function appendTurn(args: {
  conversationId: string | null;
  userId: string;
  question: string;
  answerText: string;
  payload: Record<string, unknown>;
  requestId?: string;
}): Promise<{ id: string; title: string; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let id = args.conversationId;
    let title: string;
    let created = false;
    if (id) {
      const existing = await client.query<{ title: string }>(
        "SELECT title FROM core.chat_conversation WHERE id = $1 FOR UPDATE",
        [id]
      );
      if (existing.rows.length === 0) {
        // Conversation vanished (deleted in another tab) — recreate under
        // the same id so the client's thread keeps working.
        title = deriveTitle(args.question);
        await client.query(
          "INSERT INTO core.chat_conversation (id, user_id, title) VALUES ($1, $2, $3)",
          [id, args.userId, title]
        );
        created = true;
      } else {
        title = existing.rows[0].title;
      }
    } else {
      title = deriveTitle(args.question);
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO core.chat_conversation (user_id, title) VALUES ($1, $2) RETURNING id",
        [args.userId, title]
      );
      id = inserted.rows[0].id;
      created = true;
    }

    const seqRow = await client.query<{ next_seq: number }>(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM core.chat_message WHERE conversation_id = $1",
      [id]
    );
    const seq = seqRow.rows[0].next_seq;

    await client.query(
      `INSERT INTO core.chat_message (conversation_id, seq, role, content, request_id)
       VALUES ($1, $2, 'user', $3, $4)`,
      [id, seq, args.question, args.requestId ?? null]
    );
    await client.query(
      `INSERT INTO core.chat_message (conversation_id, seq, role, content, payload, request_id)
       VALUES ($1, $2, 'assistant', $3, $4::jsonb, $5)`,
      [
        id,
        seq + 1,
        args.answerText,
        JSON.stringify(compactPayloadForStorage(args.payload)),
        args.requestId ?? null
      ]
    );
    await client.query(
      "UPDATE core.chat_conversation SET updated_at = NOW() WHERE id = $1",
      [id]
    );

    await client.query("COMMIT");
    return { id: id as string, title, created };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // surface the original error, not the rollback failure
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The session the conversation most recently resolved — fed to the
 * resolver as a WEAK fallback (context.priorSessionKey) so scope-less
 * follow-ups ("in that same session?") inherit it. Read from the newest
 * assistant payload that carries a resolved session.
 */
export async function loadPriorSessionKey(
  conversationId: string
): Promise<number | null> {
  // Filter to non-null in SQL: intervening clarification turns must not
  // shadow the last successfully-resolved session, no matter how many
  // stack up. Clarification/failure turns are excluded EXPLICITLY too —
  // a close-tie clarification stores its (arbitrary) top candidate as
  // selectedSession, and trusting it would let one bad turn poison the
  // conversation's scope for every following turn.
  const rows = await sql<{ session_key: string | number | null }>(
    `SELECT payload #>> '{runtime,resolution,selectedSession,sessionKey}' AS session_key
     FROM core.chat_message
     WHERE conversation_id = $1 AND role = 'assistant'
       AND payload #>> '{runtime,resolution,selectedSession,sessionKey}' IS NOT NULL
       AND COALESCE(payload ->> 'generationSource', '') NOT IN
         ('runtime_clarification', 'sql_generation_failed', 'runtime_transient_db_unavailable')
     ORDER BY seq DESC
     LIMIT 1`,
    [conversationId]
  );
  const key = Number(rows[0]?.session_key);
  return Number.isFinite(key) && key > 0 ? Math.trunc(key) : null;
}

/** Compaction budget for the history block fed back into the LLM. */
const HISTORY_MAX_TURNS = 6;
const HISTORY_MAX_ANSWER_CHARS = 280;
const HISTORY_MAX_TOTAL_CHARS = 2400;

/**
 * "Compact" step: the last few turns as a small labeled transcript, with
 * answers truncated. This is what lets follow-ups ("what about Hamilton?",
 * "same but for Monza") resolve without replaying full row payloads —
 * bounded so long conversations can't blow up the prompt or the prompt
 * cache hit rate (it rides in the dynamic prompt section only).
 */
export async function loadCompactHistory(
  conversationId: string
): Promise<string | null> {
  const rows = await sql<{ role: string; content: string }>(
    `SELECT role, content FROM core.chat_message
     WHERE conversation_id = $1
     ORDER BY seq DESC
     LIMIT $2`,
    [conversationId, HISTORY_MAX_TURNS * 2]
  );
  if (rows.length === 0) {
    return null;
  }
  const lines: string[] = [];
  let total = 0;
  // rows arrive newest-first; build oldest-first.
  for (const row of rows.reverse()) {
    const label = row.role === "user" ? "User asked" : "Assistant answered";
    const text =
      row.role === "assistant" && row.content.length > HISTORY_MAX_ANSWER_CHARS
        ? `${row.content.slice(0, HISTORY_MAX_ANSWER_CHARS)}…`
        : row.content;
    const line = `${label}: ${text.replace(/\s+/g, " ").trim()}`;
    total += line.length;
    if (total > HISTORY_MAX_TOTAL_CHARS) {
      break;
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
