/**
 * Shared pg client for corpus scripts. Env: NEON_DB_* (web/.env.local,
 * loaded by the caller shell via `set -a && source .env.local`).
 */
import { Client } from "pg";

export async function corpusClient() {
  const client = new Client({
    host: process.env.NEON_DB_HOST,
    port: Number(process.env.NEON_DB_PORT ?? 5432),
    user: process.env.NEON_DB_USER,
    password: process.env.NEON_DB_PASSWORD,
    database: process.env.NEON_DB_NAME,
    ssl: { rejectUnauthorized: false }
  });
  // Neon terminates idle connections (which crashes the process via the
  // Client's unhandled 'error' event if nothing listens). Scripts that do
  // long LLM work must NOT hold a client across calls — use withCorpus for
  // short transactions instead — but the listener keeps an unexpected drop
  // from killing the process outright.
  client.on("error", (e) => console.error(`pg connection error (continuing): ${e.message}`));
  await client.connect();
  return client;
}

/** Open → run → always end. For short reads/writes between long LLM calls. */
export async function withCorpus(fn) {
  const client = await corpusClient();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
