export type PerfSpan = { name: string; elapsedMs: number };
export type PerfTraceRecord = { spans: PerfSpan[] };
export type StageStats = { count: number; p50_ms: number; p95_ms: number; max_ms: number };
export type PerfSummary = {
  window: { requested: number; returned: number };
  stages: Record<string, StageStats>;
};

export function aggregatePerfTraces(records: PerfTraceRecord[], n: number): PerfSummary;
export function parseN(rawValue: unknown): number;
export function handlePerfSummaryRequest(args: {
  env: string | undefined;
  traceFilePath: string;
  n: number;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
}): Promise<{ status: 200; body: PerfSummary } | { status: 404; body: string }>;
