import { LRUCache } from "lru-cache";
import {
  getDriversForResolution,
  getDriversFromIdentityLookup,
  getSessionsForResolution,
  getSessionsFromSearchLookup,
  type DriverResolutionRow,
  type SessionResolutionRow
} from "./queries";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX = 1000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const TTL_MS = readPositiveIntEnv("RESOLVER_LRU_TTL_MS", DEFAULT_TTL_MS);
const MAX_ENTRIES = readPositiveIntEnv("RESOLVER_LRU_MAX", DEFAULT_MAX);
const DISABLED = process.env.RESOLVER_LRU_DISABLED === "1";

type CacheEntry<TRow> = {
  value: TRow[];
  expiresAt: number;
};

export type CachedLookup<TArgs, TRow> = ((args: TArgs) => Promise<TRow[]>) & {
  clear: () => void;
};

export type CachedLookupOptions<TArgs, TRow> = {
  loader: (args: TArgs) => Promise<TRow[]>;
  keyFn: (args: TArgs) => string;
  ttlMs?: number;
  max?: number;
  disabled?: boolean;
};

export function createCachedLookup<TArgs, TRow>(
  opts: CachedLookupOptions<TArgs, TRow>
): CachedLookup<TArgs, TRow> {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const max = opts.max ?? MAX_ENTRIES;
  const disabled = opts.disabled ?? DISABLED;
  const cache = new LRUCache<string, CacheEntry<TRow>>({ max });

  const wrapper = (async (args: TArgs): Promise<TRow[]> => {
    if (disabled) {
      return opts.loader(args);
    }
    const key = opts.keyFn(args);
    const entry = cache.get(key);
    const now = Date.now();
    if (entry && entry.expiresAt > now) {
      return entry.value;
    }
    if (entry) {
      cache.delete(key);
    }
    const value = await opts.loader(args);
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }) as CachedLookup<TArgs, TRow>;

  wrapper.clear = () => cache.clear();
  return wrapper;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value ?? null);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    "{" +
    keys
      .map((key) => JSON.stringify(key) + ":" + stableStringify(record[key]))
      .join(",") +
    "}"
  );
}

export function buildResolverCacheKey(
  entityType: string,
  year: number | null | undefined,
  sessionKey: number | null | undefined,
  rest: Record<string, unknown>
): string {
  const yearPart = year == null ? "_no_year" : String(year);
  const sessionPart = sessionKey == null ? "_no_session" : String(sessionKey);
  return `${entityType}|${yearPart}|${sessionPart}|${stableStringify(rest)}`;
}

type SessionsForResolutionArgs = Parameters<typeof getSessionsForResolution>[0];
type DriversForResolutionArgs = Parameters<typeof getDriversForResolution>[0];
type SessionsFromSearchLookupArgs = Parameters<typeof getSessionsFromSearchLookup>[0];
type DriversFromIdentityLookupArgs = Parameters<typeof getDriversFromIdentityLookup>[0];

export const getSessionsForResolutionCached: CachedLookup<
  SessionsForResolutionArgs,
  SessionResolutionRow
> = createCachedLookup<SessionsForResolutionArgs, SessionResolutionRow>({
  loader: (args) => getSessionsForResolution(args ?? {}),
  keyFn: (args) => {
    const a = args ?? {};
    return buildResolverCacheKey("sessions_for_resolution", a.year, null, {
      sessionName: a.sessionName ?? null,
      includeFutureSessions: Boolean(a.includeFutureSessions),
      includePlaceholderSessions: Boolean(a.includePlaceholderSessions),
      limit: a.limit ?? null
    });
  }
});

export const getDriversForResolutionCached: CachedLookup<
  DriversForResolutionArgs,
  DriverResolutionRow
> = createCachedLookup<DriversForResolutionArgs, DriverResolutionRow>({
  loader: (args) => getDriversForResolution(args ?? {}),
  keyFn: (args) => {
    const a = args ?? {};
    return buildResolverCacheKey("drivers_for_resolution", null, a.sessionKey, {
      limit: a.limit ?? null
    });
  }
});

export const getSessionsFromSearchLookupCached: CachedLookup<
  SessionsFromSearchLookupArgs,
  SessionResolutionRow
> = createCachedLookup<SessionsFromSearchLookupArgs, SessionResolutionRow>({
  loader: (args) => getSessionsFromSearchLookup(args),
  keyFn: (args) =>
    buildResolverCacheKey("sessions_from_search_lookup", args.year, null, {
      aliases: [...(args.aliases ?? [])].map((a) => String(a ?? "").toLowerCase().trim()).sort(),
      sessionName: args.sessionName ?? null,
      includeFutureSessions: Boolean(args.includeFutureSessions),
      includePlaceholderSessions: Boolean(args.includePlaceholderSessions),
      limit: args.limit ?? null
    })
});

export const getDriversFromIdentityLookupCached: CachedLookup<
  DriversFromIdentityLookupArgs,
  DriverResolutionRow
> = createCachedLookup<DriversFromIdentityLookupArgs, DriverResolutionRow>({
  loader: (args) => getDriversFromIdentityLookup(args),
  keyFn: (args) =>
    buildResolverCacheKey("drivers_from_identity_lookup", null, args.sessionKey, {
      aliases: [...(args.aliases ?? [])].map((a) => String(a ?? "").toLowerCase().trim()).sort(),
      limit: args.limit ?? null
    })
});

export function clearResolverCaches(): void {
  getSessionsForResolutionCached.clear();
  getDriversForResolutionCached.clear();
  getSessionsFromSearchLookupCached.clear();
  getDriversFromIdentityLookupCached.clear();
}

export const __resolverCacheConfig = {
  ttlMs: TTL_MS,
  max: MAX_ENTRIES,
  disabled: DISABLED
} as const;
