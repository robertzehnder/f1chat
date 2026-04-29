import { Pool, QueryResultRow } from "pg";
import path from "node:path";
import { readFile } from "node:fs/promises";

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

export const pool: Pool = globalForPool.__openf1Pool ?? createPool();
if (!globalForPool.__openf1Pool) {
  globalForPool.__openf1Pool = pool;
}

type PGliteLike = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  exec(query: string): Promise<unknown>;
  transaction<T>(callback: (tx: PGliteTx) => Promise<T>): Promise<T>;
};

type PGliteTx = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

export type Driver =
  | { kind: "neon"; pool: Pool }
  | { kind: "pglite"; db: PGliteLike };

export async function bootPglite(snapshotPath: string): Promise<PGliteLike> {
  const { PGlite } = (await import("@electric-sql/pglite")) as {
    PGlite: new () => PGliteLike;
  };
  const db = new PGlite();
  const sqlText = await readFile(snapshotPath, "utf8");
  await db.exec(sqlText);
  return db;
}

function resolveSnapshotPath(): string {
  const raw = process.env.OPENF1_LOCAL_SNAPSHOT_PATH?.trim();
  const fallbackBase = path.resolve(process.cwd(), "data/local-fallback-snapshot.sql");
  if (!raw) {
    return fallbackBase;
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(process.cwd(), raw);
}

let driverPromise: Promise<Driver> | null = null;

export function chooseDriver(): Promise<Driver> {
  if (driverPromise) {
    return driverPromise;
  }
  driverPromise = resolveDriver();
  return driverPromise;
}

function probeNeon(target: Pool): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("probe exceeded 2000ms budget"));
    }, 2_000);
  });
  const probe = target.query("SELECT 1");
  return Promise.race([probe, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function acquireNeonClient(target: Pool) {
  return target.connect();
}

async function resolveDriver(): Promise<Driver> {
  if (process.env.NODE_ENV === "production") {
    return { kind: "neon", pool };
  }
  if (process.env.OPENF1_LOCAL_FALLBACK !== "1") {
    return { kind: "neon", pool };
  }
  try {
    await probeNeon(pool);
    return { kind: "neon", pool };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[db] using local PGlite fallback (reason=probe-failed): ${message}`
    );
    const db = await bootPglite(resolveSnapshotPath());
    return { kind: "pglite", db };
  }
}

export async function sql<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const driver = await chooseDriver();
  if (driver.kind === "neon") {
    const result = await driver.pool.query<T>(text, values);
    return result.rows;
  }
  const result = await driver.db.query<T>(text, values);
  return result.rows;
}

export type TxClient = {
  query: <R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: R[] }>;
};

export async function withTransaction<T>(
  fn: (tx: TxClient) => Promise<T>
): Promise<T> {
  const driver = await chooseDriver();
  if (driver.kind === "neon") {
    const client = await acquireNeonClient(driver.pool);
    try {
      await client.query("BEGIN");
      const tx: TxClient = {
        query: async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: unknown[]
        ) => {
          const result = await client.query<R>(text, values);
          return { rows: result.rows };
        }
      };
      const value = await fn(tx);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // swallow rollback errors so the original failure surfaces
      }
      throw error;
    } finally {
      client.release();
    }
  }
  return driver.db.transaction(async (pgTx) => {
    const tx: TxClient = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[]
      ) => {
        const result = await pgTx.query<R>(text, values);
        return { rows: result.rows };
      }
    };
    return fn(tx);
  });
}
