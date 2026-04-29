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

function firstUrl(...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) {
      return v;
    }
  }
  return undefined;
}

export function assertPooledDatabaseUrl(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const candidate = (env.NEON_DATABASE_URL ?? env.DATABASE_URL)?.trim();
  if (!candidate) {
    return;
  }
  let host: string;
  let port: string;
  try {
    const parsed = new URL(candidate);
    host = parsed.hostname;
    port = parsed.port || "5432";
  } catch {
    throw new Error(
      `Neon pooler URL required in production: could not parse DATABASE_URL/NEON_DATABASE_URL as a URL. ` +
        `Switch to the Neon pooler URL (host suffix '-pooler', port 6543).`
    );
  }
  const hostOk = host.includes("-pooler");
  const portOk = port === "6543";
  if (!hostOk || !portOk) {
    throw new Error(
      `Neon pooler URL required in production: got host='${host}' port='${port}'. ` +
        `Switch to the Neon pooler URL (host must contain '-pooler' and port must be 6543).`
    );
  }
}

function sslForHost(host: string): { rejectUnauthorized: boolean } | undefined {
  if (process.env.DB_SSL === "false" || process.env.NEON_SSL === "false") {
    return undefined;
  }
  if (process.env.DB_SSL === "true" || process.env.NEON_SSL === "true") {
    return { rejectUnauthorized: true };
  }
  if (/neon\.tech/i.test(host)) {
    return { rejectUnauthorized: true };
  }
  return undefined;
}

function createPool(): Pool {
  const statementTimeout = Number(process.env.OPENF1_QUERY_TIMEOUT_MS ?? "15000");
  const base = {
    max: 10,
    idleTimeoutMillis: 30_000,
    statement_timeout: statementTimeout,
    application_name: "openf1_web_app"
  };

  // Neon-prefixed vars win so local DB_* can stay in the same file.
  const databaseUrl = firstUrl("NEON_DATABASE_URL", "DATABASE_URL");
  if (databaseUrl) {
    return new Pool({
      connectionString: databaseUrl,
      ...base
    });
  }

  const neonHost = process.env.NEON_DB_HOST?.trim();
  if (neonHost) {
    const user = process.env.NEON_DB_USER?.trim();
    const password = process.env.NEON_DB_PASSWORD ?? "";
    if (!user) {
      throw new Error("NEON_DB_USER is required when NEON_DB_HOST is set");
    }
    return new Pool({
      host: neonHost,
      port: Number(process.env.NEON_DB_PORT ?? "5432"),
      database: process.env.NEON_DB_NAME?.trim() || "neondb",
      user,
      password,
      ssl: sslForHost(neonHost),
      ...base
    });
  }

  const host = env("DB_HOST", "127.0.0.1");
  return new Pool({
    host,
    port: Number(env("DB_PORT", "5432")),
    database: env("DB_NAME", "openf1"),
    user: env("DB_USER", "openf1"),
    password: env("DB_PASSWORD", "openf1_local_dev"),
    ssl: sslForHost(host),
    ...base
  });
}

// Next.js sets NEXT_PHASE='phase-production-build' during `next build`, where
// NODE_ENV is also forced to 'production' for static analysis. Skip the
// startup assertion during that phase so the build does not consume the
// developer's local DATABASE_URL; the assertion still fires when db.ts is
// imported at production runtime (next start, scripts/verify-pooled-url.mjs).
if (process.env.NEXT_PHASE !== "phase-production-build") {
  assertPooledDatabaseUrl(process.env);
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
