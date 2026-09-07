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
  await client.connect();
  return client;
}
