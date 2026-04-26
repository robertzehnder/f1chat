import { mkdir, appendFile } from "fs/promises";
import path from "path";

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
  | "total";

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

const STAGE_NAMES: ReadonlySet<StageName> = new Set<StageName>([
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

function getTraceFilePath(): string {
  const baseDir = process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs");
  return path.join(baseDir, "chat_query_trace.jsonl");
}

export function startSpan(name: StageName): Span {
  if (!STAGE_NAMES.has(name)) {
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

export async function flushTrace(requestId: string, spans: SpanRecord[]): Promise<void> {
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
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "ERROR",
        event: "trace_write_failed",
        error: err instanceof Error ? err.message : String(err)
      })
    );
  }
}
