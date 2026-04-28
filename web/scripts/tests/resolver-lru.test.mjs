import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const resolverCacheSourcePath = path.resolve(webRoot, "src/lib/resolverCache.ts");

// Stub queries module — the resolverCache wrappers under test never exercise
// the real DB-bound resolvers; we only need the imports to resolve so the
// transpiled module loads cleanly.
const QUERIES_STUB = `
export async function getSessionsForResolution() { return []; }
export async function getDriversForResolution() { return []; }
export async function getSessionsFromSearchLookup() { return []; }
export async function getDriversFromIdentityLookup() { return []; }
`;

async function loadResolverCacheModule(envOverrides = {}) {
  const sourceText = await readFile(resolverCacheSourcePath, "utf8");
  // Redirect the './queries' import to a local stub so the test does not
  // pull in db.ts and its Pool() side effect.
  const stubbedSource = sourceText.replace(
    /from\s+["']\.\/queries["']/g,
    `from "./queries.stub.mjs"`
  );
  const transpiled = ts.transpileModule(stubbedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  // Place the temp dir under web/scripts/tests/ so node's module resolver
  // walks up to web/node_modules/ and finds lru-cache.
  const dir = await mkdtemp(path.join(__dirname, ".tmp-resolver-cache-"));
  await writeFile(path.join(dir, "queries.stub.mjs"), QUERIES_STUB, "utf8");
  const outFile = path.join(dir, "resolverCache.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");

  const previousEnv = {};
  for (const key of Object.keys(envOverrides)) {
    previousEnv[key] = process.env[key];
    if (envOverrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envOverrides[key];
    }
  }
  try {
    const mod = await import(outFile);
    return { mod, dir };
  } finally {
    for (const key of Object.keys(previousEnv)) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  }
}

async function withResolverCacheModule(envOverrides, run) {
  const loaded = await loadResolverCacheModule(envOverrides);
  try {
    await run(loaded.mod);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

test("createCachedLookup: cold miss invokes the underlying loader exactly once", async () => {
  await withResolverCacheModule({}, async (mod) => {
    let calls = 0;
    const wrapped = mod.createCachedLookup({
      loader: async () => {
        calls += 1;
        return [{ id: 1 }];
      },
      keyFn: () => "k1",
      ttlMs: 60_000,
      max: 10
    });
    const result = await wrapped({});
    assert.equal(calls, 1, "loader must be called once on cold miss");
    assert.deepEqual(result, [{ id: 1 }]);
  });
});

test("createCachedLookup: warm hit returns cached value without re-invoking the loader", async () => {
  await withResolverCacheModule({}, async (mod) => {
    let calls = 0;
    const wrapped = mod.createCachedLookup({
      loader: async () => {
        calls += 1;
        return [{ id: calls }];
      },
      keyFn: () => "same-key",
      ttlMs: 60_000,
      max: 10
    });
    const first = await wrapped({});
    const second = await wrapped({});
    assert.equal(calls, 1, "second call must hit cache, not re-invoke loader");
    assert.deepEqual(first, [{ id: 1 }]);
    assert.deepEqual(second, [{ id: 1 }]);
  });
});

test("createCachedLookup: distinct keys produce distinct loader invocations", async () => {
  await withResolverCacheModule({}, async (mod) => {
    let calls = 0;
    const wrapped = mod.createCachedLookup({
      loader: async (args) => {
        calls += 1;
        return [{ key: args.key }];
      },
      keyFn: (args) => args.key,
      ttlMs: 60_000,
      max: 10
    });
    await wrapped({ key: "a" });
    await wrapped({ key: "b" });
    await wrapped({ key: "a" });
    await wrapped({ key: "b" });
    assert.equal(calls, 2, "two unique keys yield two loader invocations regardless of order");
  });
});

test("createCachedLookup: insertion past max evicts the oldest (LRU) key", async () => {
  await withResolverCacheModule({}, async (mod) => {
    const calls = [];
    const wrapped = mod.createCachedLookup({
      loader: async (args) => {
        calls.push(args.key);
        return [{ key: args.key }];
      },
      keyFn: (args) => args.key,
      ttlMs: 60_000,
      max: 2
    });
    await wrapped({ key: "a" }); // miss → cache: [a]
    await wrapped({ key: "b" }); // miss → cache: [a, b]
    await wrapped({ key: "c" }); // miss; max exceeded → evict a → cache: [b, c]
    assert.deepEqual(calls, ["a", "b", "c"], "first three keys all miss");
    await wrapped({ key: "c" }); // hit
    await wrapped({ key: "b" }); // hit
    assert.deepEqual(
      calls,
      ["a", "b", "c"],
      "the two most-recently-inserted keys must still hit after one eviction"
    );
    await wrapped({ key: "a" }); // miss — a was evicted at insertion of c
    assert.deepEqual(
      calls,
      ["a", "b", "c", "a"],
      "the evicted (oldest) key must miss on re-lookup"
    );
  });
});

test("createCachedLookup: TTL expiry triggers a fresh loader call (fake timers)", async (t) => {
  await withResolverCacheModule({}, async (mod) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
    try {
      let calls = 0;
      const wrapped = mod.createCachedLookup({
        loader: async () => {
          calls += 1;
          return [{ tick: calls }];
        },
        keyFn: () => "ttl-key",
        ttlMs: 1_000,
        max: 10
      });
      const first = await wrapped({});
      assert.equal(calls, 1);
      assert.deepEqual(first, [{ tick: 1 }]);
      // Within TTL — still cached.
      t.mock.timers.tick(500);
      const stillWarm = await wrapped({});
      assert.equal(calls, 1, "lookup within TTL must not re-invoke loader");
      assert.deepEqual(stillWarm, [{ tick: 1 }]);
      // Past TTL — must re-invoke.
      t.mock.timers.tick(600);
      const refreshed = await wrapped({});
      assert.equal(calls, 2, "lookup after TTL elapsed must re-invoke loader");
      assert.deepEqual(refreshed, [{ tick: 2 }]);
    } finally {
      t.mock.timers.reset();
    }
  });
});

test("createCachedLookup: clear() invalidates entries so the next lookup misses", async () => {
  await withResolverCacheModule({}, async (mod) => {
    let calls = 0;
    const wrapped = mod.createCachedLookup({
      loader: async () => {
        calls += 1;
        return [{ id: calls }];
      },
      keyFn: () => "k",
      ttlMs: 60_000,
      max: 10
    });
    await wrapped({});
    await wrapped({});
    assert.equal(calls, 1, "second call hits cache");
    wrapped.clear();
    await wrapped({});
    assert.equal(calls, 2, "post-clear call must miss and re-invoke loader");
  });
});

test("buildResolverCacheKey: same query_key under different (year, sessionKey) tuples does not collide", async () => {
  await withResolverCacheModule({}, async (mod) => {
    const sameRest = { aliases: ["max"], limit: 10 };
    const k1 = mod.buildResolverCacheKey("drivers_from_identity_lookup", null, 9001, sameRest);
    const k2 = mod.buildResolverCacheKey("drivers_from_identity_lookup", null, 9002, sameRest);
    const k3 = mod.buildResolverCacheKey("drivers_from_identity_lookup", null, null, sameRest);
    const k4 = mod.buildResolverCacheKey("sessions_for_resolution", 2024, null, sameRest);
    const k5 = mod.buildResolverCacheKey("sessions_for_resolution", 2025, null, sameRest);
    const k6 = mod.buildResolverCacheKey("sessions_for_resolution", null, null, sameRest);
    const allKeys = new Set([k1, k2, k3, k4, k5, k6]);
    assert.equal(allKeys.size, 6, "every (entity_type, year, sessionKey) tuple must produce a distinct key");
    assert.match(k3, /\|_no_session\|/);
    assert.match(k6, /\|_no_year\|/);
  });
});

test("createCachedLookup: cross-context isolation via wrappers using buildResolverCacheKey", async () => {
  await withResolverCacheModule({}, async (mod) => {
    const calls = [];
    const wrapped = mod.createCachedLookup({
      loader: async (args) => {
        calls.push(args);
        return [{ context: args.sessionKey }];
      },
      keyFn: (args) =>
        mod.buildResolverCacheKey("drivers_from_identity_lookup", null, args.sessionKey, {
          aliases: args.aliases
        }),
      ttlMs: 60_000,
      max: 10
    });
    const aliases = ["max"];
    const r1 = await wrapped({ sessionKey: 9001, aliases });
    const r2 = await wrapped({ sessionKey: 9002, aliases });
    const r3 = await wrapped({ sessionKey: 9001, aliases });
    const r4 = await wrapped({ sessionKey: 9002, aliases });
    assert.equal(
      calls.length,
      2,
      "same query_key under different sessionKeys must occupy distinct cache slots"
    );
    assert.deepEqual(r1, [{ context: 9001 }]);
    assert.deepEqual(r2, [{ context: 9002 }]);
    assert.deepEqual(r3, [{ context: 9001 }]);
    assert.deepEqual(r4, [{ context: 9002 }]);
  });
});

test("RESOLVER_LRU_DISABLED=\"1\": every cached-wrapper call invokes the loader and nothing is retained", async () => {
  await withResolverCacheModule({ RESOLVER_LRU_DISABLED: "1" }, async (mod) => {
    assert.equal(
      mod.__resolverCacheConfig.disabled,
      true,
      "disabled flag must be true when env knob is set at module init"
    );
    let calls = 0;
    const wrapped = mod.createCachedLookup({
      loader: async () => {
        calls += 1;
        return [{ tick: calls }];
      },
      keyFn: () => "constant"
    });
    const first = await wrapped({});
    const second = await wrapped({});
    assert.equal(calls, 2, "two consecutive calls must both invoke the loader when disabled");
    assert.deepEqual(first, [{ tick: 1 }]);
    assert.deepEqual(second, [{ tick: 2 }]);
  });
});

test("RESOLVER_LRU_DISABLED unset: cache is enabled by default", async () => {
  await withResolverCacheModule({ RESOLVER_LRU_DISABLED: undefined }, async (mod) => {
    assert.equal(mod.__resolverCacheConfig.disabled, false);
    let calls = 0;
    const wrapped = mod.createCachedLookup({
      loader: async () => {
        calls += 1;
        return [{ tick: calls }];
      },
      keyFn: () => "k"
    });
    await wrapped({});
    await wrapped({});
    assert.equal(calls, 1, "default behavior caches and the second call hits");
  });
});

test("env knobs: RESOLVER_LRU_TTL_MS and RESOLVER_LRU_MAX are read at module init", async () => {
  await withResolverCacheModule(
    { RESOLVER_LRU_TTL_MS: "1234", RESOLVER_LRU_MAX: "7" },
    async (mod) => {
      assert.equal(mod.__resolverCacheConfig.ttlMs, 1234);
      assert.equal(mod.__resolverCacheConfig.max, 7);
    }
  );
});
