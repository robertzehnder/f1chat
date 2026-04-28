---
slice_id: 05-resolver-lru
phase: 5
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T09:11:17-04:00
---

## Goal
Add an LRU cache around the entity-resolver lookup functions in `web/src/lib/queries.ts` (driver/session resolution + identity-lookup queries) so repeated lookups — both within and across chat turns — avoid duplicate database round-trips. Cross-turn reuse is intentional; the cache is keyed so cross-context collisions cannot occur (see Decisions § Cache scoping), and turn-boundary invalidation is explicitly out of scope.

## Inputs
- `web/src/lib/queries.ts` — owns the four lookup functions to be wrapped: `getSessionsForResolution` (line 348), `getDriversForResolution` (line 392), `getSessionsFromSearchLookup` (line 508), `getDriversFromIdentityLookup` (line 585).
- `web/src/lib/chatRuntime.ts` — call sites that currently invoke those functions directly (imports at lines 2-8; calls at lines 1617, 1624, 1732, 1735).

## Prior context
- `diagnostic/_state.md`

## Required services / env
- `RESOLVER_LRU_TTL_MS` — TTL in ms for cache entries (default `300000` = 5 min). Read once at module init in `web/src/lib/resolverCache.ts`.
- `RESOLVER_LRU_MAX` — max entries per resolver-type cache (default `1000`). Read once at module init in `web/src/lib/resolverCache.ts`.
- `RESOLVER_LRU_DISABLED` — when set to `"1"`, bypasses the cache entirely (escape hatch). Read once at module init.

## Decisions
- **Module placement.** The new wrapper lives at `web/src/lib/resolverCache.ts` as a single file. There is no `web/src/lib/resolver/` directory in this repo, and creating one for one file would be premature scaffolding. The wrapper imports the four uncached functions from `./queries` and exports cached counterparts (`getSessionsForResolutionCached`, `getDriversForResolutionCached`, `getSessionsFromSearchLookupCached`, `getDriversFromIdentityLookupCached`).
- **Cache scoping (key shape).** The cache key is composed of `(entity_type, year, sessionKey | "_no_session", query_key)`. `year` and `sessionKey` are derived from each call's existing argument shape (e.g., `getSessionsForResolution` already takes `year`; `getDriversForResolution`/`getDriversFromIdentityLookup` already take `sessionKey`) and are part of the key, so identical `query_key`s in different seasons or sessions cannot collide. When a call has no season or session pin, the literal sentinels `"_no_year"` / `"_no_session"` are used so unscoped lookups remain deterministic and never share a slot with scoped ones. `query_key` is a stable JSON serialization of the remaining arguments (e.g., `aliases`, `sessionName`, `includeFutureSessions`, `includePlaceholderSessions`, `limit`).
- **Invalidation.** Entries expire by TTL (`RESOLVER_LRU_TTL_MS`) and by LRU eviction at `RESOLVER_LRU_MAX`. Cross-turn reuse is the design intent: the cache is process-scoped, not turn-scoped, and `chatRuntime` deliberately does NOT clear it on turn boundaries. The wrapper exposes a `clear()` method solely for test isolation (resetting state between unit-test cases) and as a manual escape hatch; it is not invoked from production code. Cross-context safety comes from the key shape, not from invalidation: same `query_key` under different `(year, sessionKey)` tuples occupies distinct slots. No write-through invalidation is needed because the resolver only reads from immutable upstream IDs within a season.

## Steps
- [x] 1. Add a new module at `web/src/lib/resolverCache.ts` that imports `getSessionsForResolution`, `getDriversForResolution`, `getSessionsFromSearchLookup`, `getDriversFromIdentityLookup` from `./queries` and exports cached wrappers for each, backed by per-entity-type `lru-cache` instances keyed by `(entity_type, year, sessionKey | "_no_session", query_key)` per the Decisions section. Each wrapper preserves the original function signature so call sites are a drop-in swap.
- [x] 2. Configure TTL and max-size via the env knobs declared in `Required services / env` (`RESOLVER_LRU_TTL_MS`, `RESOLVER_LRU_MAX`, `RESOLVER_LRU_DISABLED`), read once at module init in `web/src/lib/resolverCache.ts` with the defaults documented above.
- [x] 3. Update `web/src/lib/chatRuntime.ts` to import the cached wrappers from `./resolverCache` instead of importing the originals from `./queries` (imports at lines 2-8), and replace the direct calls at lines 1617, 1624, 1732, 1735 with the cached wrappers. No other call sites in `chatRuntime.ts` invoke these four functions, so the swap is local to those four calls plus their import statements.
- [x] 4. Add unit tests for hit, miss, eviction-by-max, TTL expiry, `clear()` as a test-isolation utility (post-clear lookup is a miss), cross-context isolation (same `query_key` in two different `(year, sessionKey)` contexts must not share a cache slot), and the `RESOLVER_LRU_DISABLED="1"` escape hatch (when the env knob is set, every cached-wrapper call must invoke the underlying resolver — i.e., two back-to-back calls with the same key produce two underlying invocations and no entry is retained). Tests do NOT assert any turn-boundary invalidation, since cross-turn reuse is intentional. Tests run under `web/scripts/tests/resolver-lru.test.mjs` and are wired into a dedicated `npm run test:resolver-lru` script in `web/package.json` so the gate can invoke them directly.

## Changed files expected
- `web/src/lib/resolverCache.ts` (new)
- `web/src/lib/chatRuntime.ts` (modified — switch the four lookup imports/calls at lines 2-8, 1617, 1624, 1732, 1735 to the cached wrappers)
- `web/scripts/tests/resolver-lru.test.mjs` (new)
- `web/package.json` (add `lru-cache` dependency — not currently present — and a `test:resolver-lru` script)
- `web/package-lock.json` (regenerated by `npm install`)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm install
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:resolver-lru
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `npm run test:resolver-lru` passes and includes explicit assertions for: a hit (second call with same key returns cached value without invoking the underlying resolver), a miss (cold key invokes the underlying resolver exactly once), eviction (insertion past `RESOLVER_LRU_MAX` evicts the oldest key), TTL expiry (entry returns a fresh resolver call after `RESOLVER_LRU_TTL_MS` elapses, simulated via fake timers), `clear()` as a test-isolation utility (post-clear lookup is a miss), cross-context isolation (same `query_key` under two distinct `(year, sessionKey)` tuples does not share a cache slot), and the `RESOLVER_LRU_DISABLED="1"` escape hatch (with the env knob set, two consecutive cached-wrapper calls for the same key both invoke the underlying resolver and nothing is retained). Tests must not assert turn-boundary clearing — cross-turn reuse is the intended behavior.
- [ ] `npm run build`, `npm run typecheck`, and `npm run test:grading` all pass.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/05-resolver-lru`

**Commits:**
- `7d3773c` — slice 05-resolver-lru: add LRU cache around entity-resolver lookups

**Files changed (matches `Changed files expected`):**
- `web/src/lib/resolverCache.ts` (new, 174 lines)
- `web/src/lib/chatRuntime.ts` (modified — split the resolver imports out to `@/lib/resolverCache`; swapped the four call sites at the lines listed in `Inputs` to the `*Cached` wrappers; non-resolver imports — `getGlobalTableCounts`, `getSessionByKey`, `getSessionTableCounts`, and the row types — remain on `@/lib/queries`)
- `web/scripts/tests/resolver-lru.test.mjs` (new, 11 subtests)
- `web/package.json` (added `lru-cache@^11.0.2` dependency and a `test:resolver-lru` script)
- `web/package-lock.json` (regenerated by `npm install`)

**Decisions executed (per `## Decisions`):**
- Module placement is the single file `web/src/lib/resolverCache.ts`; no `web/src/lib/resolver/` directory was introduced.
- The cache key is built by `buildResolverCacheKey(entity_type, year, sessionKey, rest)` and uses the literal sentinels `_no_year` / `_no_session` when a call has no season or session pin (verified by the cross-context test asserting six distinct keys for six tuples). `query_key` is a stable JSON serialization (`stableStringify`) of the remaining arguments with sorted object keys; `aliases` is normalized (lower-case + trim + sort) so equivalent alias inputs collapse onto the same slot.
- Invalidation is TTL + LRU-by-max only. `chatRuntime.ts` does NOT clear the caches on turn boundaries; `clear()` / `clearResolverCaches()` exist solely as test-isolation / manual escape hatches and are not invoked from production code.
- The env knobs are read once at module init: `RESOLVER_LRU_TTL_MS` (default 300_000), `RESOLVER_LRU_MAX` (default 1000), `RESOLVER_LRU_DISABLED` (`"1"` ⇒ bypass). All three are surfaced via the `__resolverCacheConfig` snapshot for test verification.
- Implementation note: the wrappers track expiry via `Date.now()`-based `expiresAt` rather than `lru-cache`'s built-in `ttl` (which uses `performance.now()`). This keeps TTL deterministically mockable through `node:test`'s `t.mock.timers.enable({ apis: ['Date'] })` while still using `lru-cache` for the LRU ordering and `max` enforcement.

**Gate command results (run from `web/`, in slice order):**
| # | Command | Exit code |
|---|---|---:|
| 1 | `npm install` | 0 |
| 2 | `npm run build` | 0 |
| 3 | `npm run typecheck` | 0 |
| 4 | `npm run test:resolver-lru` | 0 — 11 pass, 0 fail |
| 5 | `npm run test:grading` | 0 — 32 pass, 10 skip (integration tests gated on `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`, pre-existing), 0 fail |

**Self-check against acceptance criteria:**
- [x] `npm run test:resolver-lru` passes and asserts hit (warm-hit subtest), miss (cold-miss subtest + distinct-keys subtest), eviction (LRU-by-max subtest with `max=2`), TTL expiry (fake-timer subtest using `t.mock.timers.tick`), `clear()` as a test-isolation utility (post-clear miss subtest), cross-context isolation (`buildResolverCacheKey` six-tuple uniqueness subtest plus an end-to-end wrapper subtest using two distinct `sessionKey`s with the same `query_key`), and the `RESOLVER_LRU_DISABLED="1"` escape hatch (subtest reloads the module with the env var set, asserts `__resolverCacheConfig.disabled === true`, and verifies that two consecutive calls for the same key both invoke the loader). No subtest asserts turn-boundary clearing.
- [x] `npm run build`, `npm run typecheck`, and `npm run test:grading` all pass.

**Scope check:**
- Only the five files declared under `Changed files expected` were modified or added.
- Frontmatter set to `status=awaiting_audit, owner=codex, updated=2026-04-28T09:11:17-04:00` per loop instructions.

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Specify how the cache is scoped and invalidated so entries cannot leak across seasons or sessions when the same `(entity_type, query_key)` appears in different contexts.

### Medium
- [x] Align `Changed files expected` with the stated work by including every file Step 2 and the `web/src/lib/chatRuntime.ts` integration path will require, plus any package manifest updates if `lru-cache` is not already available.
- [x] Make the acceptance criteria testable from the listed gates by requiring the new resolver LRU test command to assert hit, miss, and eviction behavior directly instead of relying on a prose hit-ratio target.

### Low
- [x] Name the env knobs introduced in Step 2 and where they are read so the implementer does not need to invent the configuration surface.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T12:53:01Z, so no stale-state note is required.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Rewrite the plan around the real resolver integration surface in this repo: `web/src/lib/resolver/` and `web/src/lib/resolver/index.ts` do not exist, while the lookup calls the cache must wrap currently come from `web/src/lib/queries.ts` into `web/src/lib/chatRuntime.ts`.

### Medium
- [x] Update `Inputs`, Steps 1-3, and `Changed files expected` so every referenced path exists in this worktree, including the actual module that will own the cache wrapper and the actual lookup/resolver call sites it will intercept.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T12:53:01Z, so no stale-state note is required.
- Repository check: `web/package.json` already has `test:grading`, but neither `lru-cache` nor `test:resolver-lru` exists yet.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High

### Medium
- [x] Resolve the turn-scope contradiction between `## Goal`, `## Decisions` invalidation, and Steps 1-4 by either adding the concrete `chatRuntime` turn-boundary `clear()` integration the plan currently claims may happen or removing the per-turn/no-leakage requirement from the plan and tests if cross-turn reuse is intentional.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T12:53:01Z, so no stale-state note is required.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [x] Add an explicit `RESOLVER_LRU_DISABLED="1"` acceptance-test case to `npm run test:resolver-lru` so the documented bypass/escape-hatch behavior from `Required services / env` and Step 2 is verified by the gates.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T12:53:01Z, so no stale-state note is required.

## Plan-audit verdict (round 5)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T12:53:01Z, so no stale-state note is required.
