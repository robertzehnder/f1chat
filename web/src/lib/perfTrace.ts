import { mkdir, appendFile } from "fs/promises";
import path from "path";

// Phase 17 (post-deploy diagnostic 2026-05-02): added resolver-inner stages
// so we can see which sub-query inside resolve_db is slow on Neon. The
// dynamic `resolve.coverage.<sessionKey>` and similar names are matched by
// the broader `string & {}` branch while keeping the original well-known
// stage names typed.
export type StageName =
  | "request_intake"
  | "runtime_classify"
  | "resolve_db"
  | "template_match"
  | "sqlgen_llm"
  | "execute_db"
  | "repair_llm"
  | "synthesize_llm"
  | "sanity_check"
  | "total"
  | "resolve.getSessionByKey"
  | "resolve.getSessionsFromSearchLookup"
  | "resolve.getSessionsForResolution"
  | "resolve.getDriversForResolution"
  | "resolve.getDriversFromIdentityLookup"
  | "completeness.globalCounts"
  | "completeness.sessionCounts"
  | (string & {});

export interface SpanRecord {
  name: StageName;
  startedAt: number;
  elapsedMs: number;
}

export interface Span {
  readonly name: StageName;
  readonly startedAt: number;
  end(): SpanRecord;
}

// Phase 17: any string starting with `resolve.` or `completeness.` is also
// accepted as a fine-grained sub-stage so we can attribute time inside
// `resolve_db`. Other names must be one of the well-known stages.
const STAGE_NAMES: ReadonlySet<string> = new Set<string>([
  "request_intake",
  "runtime_classify",
  "resolve_db",
  "template_match",
  "sqlgen_llm",
  "execute_db",
  "repair_llm",
  "synthesize_llm",
  "sanity_check",
  "total"
]);

function isAcceptedStageName(name: string): boolean {
  if (STAGE_NAMES.has(name)) return true;
  return name.startsWith("resolve.") || name.startsWith("completeness.");
}

function getTraceFilePath(): string {
  const baseDir = process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs");
  return path.join(baseDir, "chat_query_trace.jsonl");
}

export function startSpan(name: StageName): Span {
  if (!isAcceptedStageName(name)) {
    throw new Error(`perfTrace: unknown stage name "${name}"`);
  }
  const startedAtMonotonic = performance.now();
  const startedAtWall = Date.now();
  let ended = false;
  let recorded: SpanRecord = { name, startedAt: startedAtWall, elapsedMs: 0 };
  return {
    name,
    startedAt: startedAtWall,
    end(): SpanRecord {
      if (!ended) {
        const elapsedMs = Math.max(0, performance.now() - startedAtMonotonic);
        recorded = { name, startedAt: startedAtWall, elapsedMs };
        ended = true;
      }
      return { ...recorded };
    }
  };
}

// Phase 16-2: production sampling. OPENF1_PERFTRACE_SAMPLE_RATE
// is a 0..1 fraction (default 0 = off). When > 0, each call to
// flushTrace rolls a uniform random and writes only that fraction.
// In dev with OPENF1_CHAT_DEBUG_TRACE=1 every record lands.
function shouldSampleTrace(): boolean {
  if (/^(1|true|yes|on)$/i.test(String(process.env.OPENF1_CHAT_DEBUG_TRACE ?? ""))) return true;
  const rate = Number(process.env.OPENF1_PERFTRACE_SAMPLE_RATE ?? "0");
  if (!Number.isFinite(rate) || rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

// Phase 18-B: per-process LRU of request IDs that have already had a
// successful flushTrace landed. Marked AFTER appendFile resolves so a
// transient FS error leaves the entry unmarked (next call retries). Bound
// at 4096 to prevent unbounded growth on long-running processes.
const FLUSHED_REQUESTS_MAX = 4096;
const flushedRequests: Set<string> = new Set();

export function _resetFlushedRequestsForTests(): void {
  flushedRequests.clear();
}

export type FlushTraceOptions = {
  /**
   * Phase 18-B: when true, bypass the sampling check and always
   * append. Used when the per-request `debug.trace` flag is set so
   * synchronous consumers (smoke script, CI gate, future SDK) get
   * spans whenever they ask for them, regardless of production
   * `OPENF1_PERFTRACE_SAMPLE_RATE`.
   */
  forceFlush?: boolean;
};

/**
 * Phase 18-B: returns true iff the spans line was successfully appended
 * to the trace file. Returns false on sampled-out, on dedupe-suppressed
 * (already flushed for this requestId), or on a caught write error.
 */
export async function flushTrace(
  requestId: string,
  spans: SpanRecord[],
  options: FlushTraceOptions = {}
): Promise<boolean> {
  if (flushedRequests.has(requestId)) return false;
  if (!options.forceFlush && !shouldSampleTrace()) return false;
  const entry = {
    ts: new Date().toISOString(),
    requestId,
    spans: spans.map((s) => ({
      name: s.name,
      startedAt: s.startedAt,
      elapsedMs: s.elapsedMs
    }))
  };
  const line = JSON.stringify(entry);
  try {
    const filePath = getTraceFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${line}\n`, "utf8");
    if (flushedRequests.size >= FLUSHED_REQUESTS_MAX) {
      // Drop the oldest (insertion-ordered) so the Set stays bounded.
      const first = flushedRequests.values().next().value;
      if (first !== undefined) flushedRequests.delete(first);
    }
    flushedRequests.add(requestId);
    return true;
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "ERROR",
        event: "trace_write_failed",
        error: err instanceof Error ? err.message : String(err)
      })
    );
    return false;
  }
}
