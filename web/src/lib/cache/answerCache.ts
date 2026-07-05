import { LRUCache } from "lru-cache";
import { runReadOnlySql } from "../queries";
import { synthesizeAnswerWithAnthropic } from "../anthropic";

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

// Cache-version prefix (golden-set audit 2026-07-02, critic follow-up): the
// key is (template, session, drivers, year) — NOT the answer content — so
// when a template's SQL or an insight builder's output changes, previously
// cached answers would keep serving verbatim (a fixed P0 "not in dataset"
// answer could shadow the corrected one on a long-running server). Bump
// this string whenever deterministic-card behavior changes to invalidate
// every entry at once. v2 = Waves 1–4 (fallback/perf/data/visual fixes).
const CACHE_VERSION = "v2-2026-07-02";

export type AnswerCacheSubset = {
  answer: string;
  answerReasoning?: string;
  adequacyGrade: string;
  adequacyReason: string;
  responseGrade: string;
  gradeReason: string;
  generationSource: string;
  model?: string;
  generationNotes: string;
  sql: string;
  /** Structured insight (title/metrics/verdict/takeaways) for deterministic
   *  cards. Cached so a cache hit renders the SAME rich card as the first
   *  run — without it the hit degrades to body+chart only (question-as-title,
   *  no metric tiles). */
  insight?: import("@/lib/chatTypes").InsightFields | null;
  result: {
    sql: string;
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
  };
};

type CacheEntry = {
  value: AnswerCacheSubset;
  expiresAt: number;
};

const answerCache = new LRUCache<string, CacheEntry>({ max: MAX_ENTRIES });

export function buildAnswerCacheKey(args: {
  templateKey?: string | null;
  sessionKey?: number | null;
  sortedDriverNumbers?: number[] | null;
  year?: number | null;
}): string | null {
  if (!args.templateKey) {
    return null;
  }
  const sessionPart =
    args.sessionKey == null || !Number.isFinite(Number(args.sessionKey))
      ? "_no_session"
      : String(Math.trunc(Number(args.sessionKey)));
  const drivers = args.sortedDriverNumbers ?? [];
  const driversPart =
    drivers.length === 0
      ? "_no_drivers"
      : [...drivers]
          .filter((n) => Number.isFinite(n))
          .map((n) => Math.trunc(n))
          .sort((a, b) => a - b)
          .join(",");
  const yearPart =
    args.year == null || !Number.isFinite(Number(args.year))
      ? "_no_year"
      : String(Math.trunc(Number(args.year)));
  return `${CACHE_VERSION}|${args.templateKey}|${sessionPart}|${driversPart}|${yearPart}`;
}

export function getAnswerCacheEntry(key: string): AnswerCacheSubset | undefined {
  const entry = answerCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt > Date.now()) {
    return entry.value;
  }
  answerCache.delete(key);
  return undefined;
}

export function setAnswerCacheEntry(key: string, value: AnswerCacheSubset): void {
  answerCache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

type RunSqlFn = typeof runReadOnlySql;
type SynthesizeFn = typeof synthesizeAnswerWithAnthropic;

type AnswerCacheTestHooks = {
  runSql?: RunSqlFn;
  synthesize?: SynthesizeFn;
  runSqlCallCount: number;
  synthesizeCallCount: number;
};

const di: AnswerCacheTestHooks = {
  runSql: undefined,
  synthesize: undefined,
  runSqlCallCount: 0,
  synthesizeCallCount: 0
};

export const __answerCacheTestHooks = di;

export const cachedRunSql: RunSqlFn = (sql, options) => {
  di.runSqlCallCount += 1;
  const fn = di.runSql ?? runReadOnlySql;
  return fn(sql, options);
};

export const cachedSynthesize: SynthesizeFn = (input) => {
  di.synthesizeCallCount += 1;
  const fn = di.synthesize ?? synthesizeAnswerWithAnthropic;
  return fn(input);
};

export type RunDeterministicAnswerArgs = {
  cacheKey: string | null;
  compute: () => Promise<{ subset: AnswerCacheSubset; shouldCache: boolean }>;
};

export type RunDeterministicAnswerResult = {
  subset: AnswerCacheSubset;
  cacheHit: boolean;
};

export async function runDeterministicAnswerWithCache(
  args: RunDeterministicAnswerArgs
): Promise<RunDeterministicAnswerResult> {
  const { cacheKey, compute } = args;
  if (cacheKey) {
    const cached = getAnswerCacheEntry(cacheKey);
    if (cached) {
      return { subset: cached, cacheHit: true };
    }
  }
  const { subset, shouldCache } = await compute();
  if (cacheKey && shouldCache) {
    setAnswerCacheEntry(cacheKey, subset);
  }
  return { subset, cacheHit: false };
}

export function __resetAnswerCacheForTests(): void {
  answerCache.clear();
  di.runSql = undefined;
  di.synthesize = undefined;
  di.runSqlCallCount = 0;
  di.synthesizeCallCount = 0;
}

export const __answerCacheConfig = {
  ttlMs: TTL_MS,
  max: MAX_ENTRIES
} as const;
