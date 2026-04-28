---
slice_id: 05-answer-cache
phase: 5
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T20:45:00Z
---

## Goal
Add an answer-level cache for deterministic-template requests: identical `(templateKey, sessionKey, sortedDriverNumbers, contracts_hash)` tuples return the cached answer without re-running the deterministic SQL against Postgres and without invoking any downstream synthesis/LLM call.

## Inputs
- `web/src/app/api/chat/route.ts` (live deterministic-template + `runReadOnlySql` call site, lines ~390–461; the cache boundary lives here)
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/cache/` (if exists)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/notes/05-template-cache-coverage.md`

## Required services / env
None at author time.

## Steps
1. Build a normalizer that produces a stable cache key from `(templateKey, sessionKey, sortedDriverNumbers, contracts_hash)` — these are the canonical inputs `buildDeterministicSqlTemplate` already branches on (see `diagnostic/notes/05-template-cache-coverage.md` "Recommended cache-key design"). Non-deterministic paths (no `templateKey`) bypass the cache entirely in this slice.
2. Use `lru-cache` with TTL=10min, max-size=500. The cache stores the **final response payload** that `route.ts` would otherwise return (answer text, sql preview, generationSource, model, generationNotes, etc.) so a hit can be served without re-running SQL or synthesis.
3. Wire the cache into `web/src/app/api/chat/route.ts` such that the lookup/store boundary sits **after** deterministic-template selection (line ~400, where `selectedTemplateKey` and `pinnedSessionKey` are known) and **before** `runReadOnlySql` (line ~461). On a cache hit: emit `cache_hit: true` on the query trace, skip `executeSqlWithTrace` / `runReadOnlySql` entirely, skip any downstream synthesis/LLM step, and return the stored payload directly. On a miss: emit `cache_hit: false`, run the existing SQL + synthesis path, then store the final payload under the cache key before returning.
4. Add gateable test seams that let a node-only test assert both side-effects are skipped on a hit:
   - Export an injectable `runSql` dependency (default = `runReadOnlySql`) and an injectable `synthesize` dependency (default = the current synthesis call) from the cache wiring module, **or** export monotonically-increasing call-count counters for both, so the test can spy on each. The seam must allow asserting: SQL executor invoked exactly once across two identical deterministic requests, and synthesis/LLM invoked at most once across the same pair.
   - Export the answer-cache module's `lru-cache` instance (or a `__resetForTests()` helper) so the test can isolate its state.
5. Tests in `web/scripts/tests/answer-cache.test.mjs` (run by `cd web && npm run test:grading`, which globs `scripts/tests/*.test.mjs` per `web/package.json:10`):
   - Hit/miss + side-effect skip: two identical deterministic requests → first miss, second hit; assert the SQL-executor spy recorded **exactly one** invocation and the synthesis spy recorded **at most one** invocation across both requests, and the second response payload deep-equals the first.
   - Trace assertion: capture emitted query-trace entries and assert the second call emits `cache_hit: true` while the first emits `cache_hit: false`.
   - Hash-collision-safety: two requests with different `(templateKey, sessionKey, sortedDriverNumbers, contracts_hash)` → both miss; SQL-executor spy records two invocations.
   - TTL expiry: after advancing fake time past 10min, the same key re-misses; both the SQL-executor spy and (if present) the synthesis spy increment again.
   - Non-deterministic bypass: a request with no deterministic `templateKey` does **not** populate or read the cache (SQL spy increments on every call, no `cache_hit` field is emitted as `true`).

## Changed files expected
- `web/src/lib/cache/answerCache.ts` (new — normalizer, lru-cache instance, `__resetForTests`)
- `web/src/app/api/chat/route.ts` (cache lookup/store boundary inserted between deterministic-template selection and `runReadOnlySql`; injectable `runSql` / `synthesize` seams or counter exports added here)
- `web/src/lib/chatRuntime.ts` (only if the cache boundary is extracted into a helper that lives here; otherwise unchanged — implementer confirms during Step 3)
- `web/scripts/tests/answer-cache.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Two identical deterministic requests in succession: the test spies on the SQL executor (`runReadOnlySql`) and asserts it ran **exactly once** across both requests; the synthesis/LLM spy recorded **at most one** invocation across the pair; the second request's emitted trace contains `cache_hit: true` and returns a payload that deep-equals the first.
- [ ] Different `(templateKey, sessionKey, sortedDriverNumbers, contracts_hash)` tuples never collide on the cache key (both miss; SQL-executor spy increments twice).
- [ ] TTL expiry: after fake-time advance past 10min, the same key re-misses, the SQL-executor spy increments again, and the trace re-emits `cache_hit: false` then `cache_hit: true` on a follow-up identical call.
- [ ] Non-deterministic requests (no `templateKey`) bypass the cache: SQL-executor spy increments on every call and no entry is written to or read from the cache.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Add a gateable test seam and acceptance criterion that prove the second identical request does not invoke the synthesis/LLM path again; a `cache_hit: true` log line alone does not verify the slice goal.

### Medium
- [x] Align the Steps with the acceptance criteria by explicitly calling out the required cache-hit instrumentation or trace emission if the plan will keep asserting on `cache_hit: true`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-28T13:39:03Z, so the loop context is fresh.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Move the cache lookup/store boundary ahead of `runReadOnlySql` for deterministic-template requests, and add a gateable assertion that the second identical request skips both SQL execution and synthesis; the current “synthesis-path” wording would still allow the database work to run on every hit and misses the answer-cache goal described in the prior-context audit.

### Medium
- [x] Update `## Inputs` and `## Changed files expected` to include `web/src/app/api/chat/route.ts` (or explicitly name the extracted module that owns the synthesis/answer-cache boundary), because the live synthesis call site is not in `web/src/lib/chatRuntime.ts`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-28T13:39:03Z, so the loop context is fresh.
- `web/package.json:10` confirms `npm run test:grading` executes `scripts/tests/*.test.mjs`, so the proposed test file is covered by the existing gate command.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] Replace `contracts_hash` in the goal, Steps, and acceptance criteria with the actual canonical deterministic-template discriminator(s) already available in repo code, because `contracts_hash` does not exist outside this slice file and the cited prior-context note instead recommends `(templateKey, sessionKey, sortedDriverNumbers, year)` for most templates.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-28T13:39:03Z, so the loop context is fresh.
- `web/package.json` already depends on `lru-cache`, so no package-manifest changes are implied by this slice.
