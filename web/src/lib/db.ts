import { Pool, QueryResultRow } from "pg";

type PoolGlobal = {
  __openf1Pool?: Pool;
};

const globalForPool = globalThis as unknown as PoolGlobal;

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createPool(): Pool {
  return new Pool({
    host: env("DB_HOST", "127.0.0.1"),
    port: Number(env("DB_PORT", "5432")),
    database: env("DB_NAME", "openf1"),
    user: env("DB_USER", "openf1"),
    password: env("DB_PASSWORD", "openf1_local_dev"),
    max: 10,
    idleTimeoutMillis: 30_000,
    statement_timeout: Number(process.env.OPENF1_QUERY_TIMEOUT_MS ?? "15000"),
    application_name: "openf1_web_app"
  });
}

export const pool = globalForPool.__openf1Pool ?? createPool();
if (!globalForPool.__openf1Pool) {
  globalForPool.__openf1Pool = pool;
}

export async function sql<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}
