import { Pool, QueryResultRow } from "pg";

type PoolGlobal = {
  __openf1Pool?: Pool;
  __openf1PoolKeepalive?: NodeJS.Timeout;
  __openf1PoolWarmed?: boolean;
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

const ALLOWED_LOCAL_DB_HOSTS = ["127.0.0.1", "localhost", "::1", "db", "postgres"] as const;

export function assertLocalDockerDb(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production") {
    return;
  }
  if (env.NEON_DATABASE_URL?.trim()) {
    return;
  }
  if (env.DATABASE_URL?.trim()) {
    return;
  }
  if (env.NEON_DB_HOST?.trim()) {
    return;
  }
  const host = (env.DB_HOST ?? "127.0.0.1").trim();
  if (!ALLOWED_LOCAL_DB_HOSTS.includes(host as (typeof ALLOWED_LOCAL_DB_HOSTS)[number])) {
    throw new Error(
      `Local Docker Postgres required when no Neon URL/host is set: got DB_HOST='${host}'. ` +
        `Allowed hosts: ${ALLOWED_LOCAL_DB_HOSTS.join(", ")}.`
    );
  }
}

export function assertPooledDatabaseUrl(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  // Next.js sets NODE_ENV=production during `next build` (so compile-time
  // optimizations like tree-shaking and dead-code elimination kick in),
  // even on dev machines that don't have a real prod pooler URL set.
  // NEXT_PHASE='phase-production-build' is the unambiguous build-time
  // marker; any production runtime (server start, edge function, route
  // handler) has NEXT_PHASE='phase-production-server' or undefined, so
  // the assertion still fires when it actually matters — when the app
  // is about to serve real traffic. Skipping during build is required
  // so this slice doesn't break local `next build` for any contributor
  // who hasn't exported a Neon pooler URL.
  if (env.NEXT_PHASE === "phase-production-build") {
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
  // Phase 17-B: connections survive 5 min between requests (was 30 s) so the
  // next chat request after a brief idle period doesn't pay a fresh-handshake
  // cold-start tax. Paired with the keepalive heartbeat below.
  // connectionTimeoutMillis: pg default is 0 (no timeout), which hangs
  // indefinitely if the host is unreachable (e.g. stale local Docker config).
  // 10s is enough for Neon cold-starts and turns hangs into surfaced errors.
  const base = {
    max: 10,
    idleTimeoutMillis: 300_000,
    connectionTimeoutMillis: 10_000,
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

assertPooledDatabaseUrl(process.env);
assertLocalDockerDb(process.env);

export const pool = globalForPool.__openf1Pool ?? createPool();
if (!globalForPool.__openf1Pool) {
  globalForPool.__openf1Pool = pool;
}

// Phase 17-B: keepalive heartbeat. Fires a trivial query every minute so the
// idle-eviction timer doesn't reap the pool's connections between user
// requests; that eviction was the root of the 5-min cold-pool cost observed
// during the 2026-05-02 incident. Disabled in test env so test suites don't
// leak timers.
function keepaliveEnabled(): boolean {
  const flag = process.env.OPENF1_DB_KEEPALIVE_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return process.env.NODE_ENV !== "test";
}

if (keepaliveEnabled() && !globalForPool.__openf1PoolKeepalive) {
  const interval = setInterval(() => {
    pool.query("SELECT 1").catch(() => {
      // Heartbeat failures are non-fatal; the next user query will surface
      // any real connectivity issue with a meaningful error.
    });
  }, 60_000);
  // Don't keep the process alive solely for the heartbeat (Next.js dev server,
  // tests, scripts). Lambda/edge runtimes ignore unref so this is safe there.
  if (typeof interval.unref === "function") {
    interval.unref();
  }
  globalForPool.__openf1PoolKeepalive = interval;
}

/**
 * Phase 17-B: warm the pool on first call per process so the first chat
 * request doesn't pay a cold-start handshake. Idempotent and safe to call
 * from anywhere in the request path.
 */
export async function warmPool(): Promise<void> {
  if (globalForPool.__openf1PoolWarmed) return;
  globalForPool.__openf1PoolWarmed = true;
  try {
    await pool.query("SELECT 1");
  } catch {
    globalForPool.__openf1PoolWarmed = false;
  }
}

export async function sql<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>({ text, values, name: undefined });
  return result.rows;
}
