import { pool } from "../db";
import { assertReadOnlySql, clampInt } from "../querySafety";
import type { QueryRunResult } from "../types";

const DEFAULT_QUERY_MAX_ROWS = Number(process.env.OPENF1_QUERY_MAX_ROWS ?? "2000");
const DEFAULT_PREVIEW_MAX_ROWS = Number(process.env.OPENF1_PREVIEW_MAX_ROWS ?? "200");
const DEFAULT_QUERY_TIMEOUT_MS = Number(process.env.OPENF1_QUERY_TIMEOUT_MS ?? "15000");

function safeLimit(value: number | undefined, fallback: number, max: number): number {
  return clampInt(value ?? fallback, 1, max);
}

export async function runReadOnlySql(
  inputSql: string,
  options: { maxRows?: number; timeoutMs?: number; preview?: boolean } = {}
): Promise<QueryRunResult> {
  const cleanedSql = assertReadOnlySql(inputSql);
  const maxRows = safeLimit(
    options.maxRows,
    options.preview ? DEFAULT_PREVIEW_MAX_ROWS : DEFAULT_QUERY_MAX_ROWS,
    10_000
  );
  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, 1000, 120_000);
  const wrappedSql = `SELECT * FROM (${cleanedSql}) AS q LIMIT $1`;
  const startedAt = Date.now();

  // Inline transaction via pool.connect() so SET LOCAL statement_timeout
  // takes effect for this query only. Inlined (rather than using
  // db/driver.ts withTransaction) to avoid touching db.ts or queries.ts
  // imports in a way that breaks the existing driver-fallback /
  // pooled-url-assertion test sandboxes (both transpile db.ts into a
  // tmp dir without the db/ subdirectory). Neon-only by design — this
  // slice scope does not include local-PGlite transaction behavior.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await client.query<Record<string, unknown>>(wrappedSql, [maxRows + 1]);
    await client.query("COMMIT");
    const truncated = result.rows.length > maxRows;
    const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;
    return {
      sql: cleanedSql,
      rowCount: rows.length,
      elapsedMs: Date.now() - startedAt,
      truncated,
      rows: rows as Record<string, unknown>[]
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* surface original error */ }
    throw error;
  } finally {
    client.release();
  }
}
