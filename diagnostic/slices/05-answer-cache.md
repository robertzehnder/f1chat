---
slice_id: 05-answer-cache
phase: 5
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T08:15:00Z
---

## Goal
Add an answer-level cache for deterministic-template requests: identical `(templateKey, sessionKey, sortedDriverNumbers, year)` tuples return the cached answer without re-running the deterministic SQL against Postgres and without invoking any downstream synthesis/LLM call. (`year` is sourced from `runtime`'s extracted year — see `web/src/lib/chatRuntime.ts` `extractedYear`. The discriminator set matches the "Recommended cache-key design" in `diagnostic/notes/05-template-cache-coverage.md`; for the three templates whose inputs are baked into the `templateKey` itself — `canonical_id_lookup_abu_dhabi_2025_race`, `max_leclerc_qualifying_improvement`, `abu_dhabi_weekend_smallest_spread_and_comparison` — the trailing fields collapse to `undefined` and the key is effectively `templateKey` alone, which is the recommended behavior.)

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
1. Build a normalizer that produces a stable cache key from `(templateKey, sessionKey, sortedDriverNumbers, year)` — these are the canonical inputs `buildDeterministicSqlTemplate` already branches on plus the `year` discriminator that the prior-context note's "Recommended cache-key design" calls out (see `diagnostic/notes/05-template-cache-coverage.md`). `templateKey` comes from `deterministic.templateKey` in `route.ts` (~line 403), `sessionKey` from `pinnedSessionKey` (~line 376), `sortedDriverNumbers` from `runtime.resolution.selectedDriverNumbers` (numerically sorted), and `year` from the runtime's extracted year (see `web/src/lib/chatRuntime.ts` `extractedYear`; pass it through to `route.ts` if not already exposed on the runtime object — implementer confirms during Step 3). Non-deterministic paths (no `templateKey`) bypass the cache entirely in this slice. The normalizer must produce a deterministic string regardless of `selectedDriverNumbers` insertion order, and must handle `undefined` for any of `sessionKey`/`sortedDriverNumbers`/`year` (e.g., the three Abu-Dhabi-2025 / canonical-lookup templates whose inputs are baked into `templateKey` — for them the cache key collapses to `templateKey` plus `undefined` placeholders, which is the intended behavior).
2. Use `lru-cache` with TTL=10min, max-size=500. The cache stores **only the deterministic-derived answer subset** that `route.ts` produces from running the deterministic SQL plus synthesis — concretely the answer text, sql preview, rows, `generationSource`, `model`, and `generationNotes`. It does **not** store per-request metadata: `requestId`, `runtime`, timestamps, telemetry IDs, and any other fields that vary by request must be regenerated fresh on each hit and merged with the cached subset before responding. The implementer enumerates the exact field set during Step 3 by inspecting the route response shape, but the rule is: cached subset = deterministic-template + synthesis output that is a pure function of `(templateKey, sessionKey, sortedDriverNumbers, year)`; everything else is regenerated. Only **successful deterministic-template responses** are eligible for caching — see Step 3 for the success-gate definition.
3. Wire the cache into `web/src/app/api/chat/route.ts` such that the lookup/store boundary sits **after** deterministic-template selection (line ~400, where `selectedTemplateKey` and `pinnedSessionKey` are known) and **before** `runReadOnlySql` (line ~461). On a cache hit: emit `cache_hit: true` on the query trace, skip `executeSqlWithTrace` / `runReadOnlySql` entirely, skip any downstream synthesis/LLM step, and **merge** the cached subset (answer text, sql preview, rows, `generationSource`, `model`, `generationNotes`) with **freshly-generated per-request metadata** (`requestId`, `runtime`, timestamps, telemetry IDs, and any other per-request fields) before returning — never replay the first request's metadata. On a miss: emit `cache_hit: false`, run the existing SQL + synthesis path, then **conditionally** store the cached subset only if the **success gate** holds: (a) `runReadOnlySql` returned successfully (no thrown error, no error sentinel), AND (b) the response was produced via the deterministic-template path (i.e. `selectedTemplateKey` was used end-to-end and the request did **not** fall through to the heuristic / non-deterministic fallback). If either condition fails — deterministic SQL throws, returns an error, or control falls through to the heuristic fallback — **no cache write occurs** for that key, so the next identical request still misses and re-runs the deterministic path. The success-gate predicate must be implemented as an explicit, single-purpose check in the wiring (e.g., a boolean `shouldCache` derived from the response branch) so the test in Step 5 can drive it deterministically.
4. Add gateable test seams that let a node-only test assert both side-effects are skipped on a hit AND deterministically force SQL-failure / heuristic-fallback branches to prove the success-gate skips cache writes:
   - The seam **must** support **dependency injection (or an equivalent override hook)** for both `runSql` and `synthesize` — call-count counters alone are insufficient because the failed-deterministic / fallback test in Step 5 needs to substitute a throwing or fallback-returning implementation, not merely observe how many times the real one ran. Concretely: export an injectable `runSql` dependency (default = `runReadOnlySql`) and an injectable `synthesize` dependency (default = the current synthesis call) from the cache wiring module, exposed either as module-level setters / a config object the test can mutate, or as parameters to a factory that the test instantiates with overrides. The override hook must let the test (a) substitute `runSql` with a function that throws to exercise the SQL-failure branch, (b) substitute `synthesize` (or the response-branch decision) to force the heuristic-fallback path, and (c) record per-injection call counts so the same seam still satisfies the spy assertions (SQL executor invoked exactly once across two identical deterministic-success requests, synthesis/LLM invoked at most once across the same pair). Plain monotonic counters with no override hook are explicitly **not** acceptable.
   - Export the answer-cache module's `lru-cache` instance (or a `__resetForTests()` helper) so the test can isolate its state.
5. Tests in `web/scripts/tests/answer-cache.test.mjs` (run by `cd web && npm run test:grading`, which globs `scripts/tests/*.test.mjs` per `web/package.json:10`):
   - Hit/miss + side-effect skip: two identical deterministic requests → first miss, second hit; assert the SQL-executor spy recorded **exactly one** invocation and the synthesis spy recorded **at most one** invocation across both requests. Assert that the second response's **deterministic-derived subset** (answer text, sql preview, rows, `generationSource`, `model`, `generationNotes`) deep-equals the first, and **separately** assert that per-request metadata (`requestId`, plus any timestamp-like field present on the response) **differs** between the two responses (i.e. is regenerated on the hit, not replayed from the miss).
   - Trace assertion: capture emitted query-trace entries and assert the second call emits `cache_hit: true` while the first emits `cache_hit: false`.
   - Key-distinctness: requests with different `(templateKey, sessionKey, sortedDriverNumbers, year)` tuples → both miss; SQL-executor spy records two invocations per pairing. Cover **three** pairings — one pair that differs only in `sessionKey`, one pair that differs only in `sortedDriverNumbers`, and one pair that differs only in `year` — because `year` is part of the declared cache key and the prior-context note (`diagnostic/notes/05-template-cache-coverage.md`) calls it out as a required discriminator.
   - TTL expiry: after advancing fake time past 10min, the same key re-misses; both the SQL-executor spy and (if present) the synthesis spy increment again.
   - Non-deterministic bypass: a request with no deterministic `templateKey` does **not** populate or read the cache (SQL spy increments on every call, no `cache_hit` field is emitted as `true`).
   - **Failed-deterministic / fallback bypass on writes**: simulate a deterministic request whose `runSql` injection throws or whose response branch flips to the heuristic fallback. Assert (a) no cache entry is written for that key (a follow-up identical request still misses, SQL spy increments again, trace re-emits `cache_hit: false`), and (b) once a subsequent identical request **does** complete via the deterministic-success path, the cache then populates and the next identical request hits as normal.

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
- [ ] Two identical deterministic requests in succession: the test spies on the SQL executor (`runReadOnlySql`) and asserts it ran **exactly once** across both requests; the synthesis/LLM spy recorded **at most one** invocation across the pair; the second request's emitted trace contains `cache_hit: true`. The second response's **deterministic-derived subset** (answer text, sql preview, rows, `generationSource`, `model`, `generationNotes`) deep-equals the first, **and** per-request metadata (`requestId`, plus any timestamp-like field present on the response) **differs** between the two — proving metadata is regenerated on the hit rather than replayed.
- [ ] Different `(templateKey, sessionKey, sortedDriverNumbers, year)` tuples never collide on the cache key (both miss; SQL-executor spy increments twice per pairing). Cover **three** pairings: one pair that differs only in `sessionKey`, one pair that differs only in `sortedDriverNumbers`, and one pair that differs only in `year`.
- [ ] TTL expiry: after fake-time advance past 10min, the same key re-misses, the SQL-executor spy increments again, and the trace re-emits `cache_hit: false` then `cache_hit: true` on a follow-up identical call.
- [ ] Non-deterministic requests (no `templateKey`) bypass the cache: SQL-executor spy increments on every call and no entry is written to or read from the cache.
- [ ] **Failed-deterministic / fallback path is not cached**: when the deterministic request fails (SQL throws / errors) or falls through to the heuristic / non-deterministic path, no cache entry is written. A follow-up identical request still misses, SQL spy increments again, and the trace re-emits `cache_hit: false`. Once a subsequent identical request completes via the deterministic-success path, the cache populates and the next identical request hits.

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
- [x] Replace `contracts_hash` in the goal, Steps, and acceptance criteria with the actual canonical deterministic-template discriminator(s) already available in repo code, because `contracts_hash` does not exist outside this slice file and the cited prior-context note instead recommends `(templateKey, sessionKey, sortedDriverNumbers, year)` for most templates.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-28T13:39:03Z, so the loop context is fresh.
- `web/package.json` already depends on `lru-cache`, so no package-manifest changes are implied by this slice.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Restrict cache writes to successful deterministic-template responses only; do not cache the heuristic fallback path reached after deterministic SQL failure, or identical deterministic requests can be pinned to a degraded non-deterministic answer for the full TTL.
- [x] Stop describing the cache value as the entire final response payload returned by `route.ts`, and update the hit-path acceptance criteria accordingly; `requestId`, `runtime`, and other per-request metadata must be regenerated on each hit instead of being replayed from the first request.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-28T13:39:03Z, so the loop context is fresh.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [x] Tighten Step 4 so the test seam must support dependency injection or an equivalent override hook for `runSql` and synthesis; call-count counters alone are insufficient because Step 5 requires deterministically forcing SQL failure / fallback branches to prove the success-gate skips cache writes.

### Medium
- [x] Add a key-distinctness test and matching acceptance coverage for requests that differ only in `year`, because `year` is part of the declared cache key and the prior-context note calls it out as a required discriminator.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-28T13:39:03Z, so the loop context is fresh.

## Plan-audit verdict (round 6)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-6 forced-findings ratchet: not applicable)**

### High

### Medium

### Low

### Notes (informational only — no action)
- All round-5 High/Medium items addressed: DI seams for `runSql`/`synthesize` explicitly required in Step 4; `year`-distinctness coverage required in both Step 5 and Acceptance criteria.
- Confirmed: `lru-cache` already in `web/package.json`; no manifest changes implied.
- Gate ordering (`build` before `typecheck`) is not a blocking bug — TypeScript errors surface at either stage.
- Plan is internally consistent: goal, steps, changed-files list, and acceptance criteria all align on `(templateKey, sessionKey, sortedDriverNumbers, year)` cache key, success gate, metadata regeneration on hit, and injectable test seams.

## Plan-audit verdict (round 7)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-7 forced-findings ratchet: not applicable — no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- No commits on slice/05-answer-cache since the round-6 `[plan-approved]` commit; branch is clean. Re-applied all nine audit principles and found nothing new to flag.

## Plan-audit verdict (round 8)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-8 forced-findings ratchet: not applicable — no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch remains clean since round-7 `[plan-approved]` commit. Re-applied all nine audit principles: no internal contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env requirements, all acceptance criteria are testable, no out-of-scope steps, no index/column collisions (no SQL), and gate commands are idempotent. Nothing to flag.

## Plan-audit verdict (round 9)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-9 forced-findings ratchet: not applicable — no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch clean since round-8 `[plan-approved]` commit. Re-applied all nine audit principles: no contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env, all acceptance criteria testable, no out-of-scope steps, no SQL index collisions, gate commands idempotent. Nothing to flag.

## Plan-audit verdict (round 10)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-10 forced-findings ratchet: not applicable — round 3+ exemption, no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch clean since round-9 `[plan-approved]` commit. Re-verified both prior-context paths exist. Re-applied all nine audit principles: no contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env, all acceptance criteria testable, no out-of-scope steps, no SQL index collisions, gate commands idempotent. Nothing to flag.

## Plan-audit verdict (round 11)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-11 forced-findings ratchet: not applicable — round 3+ exemption, no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch clean since round-10 `[plan-approved]` commit. Re-verified both prior-context paths exist (`diagnostic/_state.md`, `diagnostic/notes/05-template-cache-coverage.md`). Re-applied all nine audit principles: no contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env, all acceptance criteria testable, no out-of-scope steps, no SQL index collisions, gate commands idempotent. Nothing to flag.

## Plan-audit verdict (round 12)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-12 forced-findings ratchet: not applicable — round 3+ exemption, no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch clean since round-11 `[plan-approved]` commit. Re-verified both prior-context paths exist (`diagnostic/_state.md`, `diagnostic/notes/05-template-cache-coverage.md`). Re-applied all nine audit principles: no contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env (lru-cache is in-memory, DI seams avoid real DB), all acceptance criteria concretely testable with specific spy counts and deep-equality assertions, no out-of-scope steps, no SQL index collisions (no migrations), gate commands idempotent. Nothing to flag.

## Plan-audit verdict (round 13)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-13 forced-findings ratchet: not applicable — round 3+ exemption, no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch clean since round-12 `[plan-approved]` commit. Re-verified both prior-context paths exist (`diagnostic/_state.md`, `diagnostic/notes/05-template-cache-coverage.md`). Re-applied all nine audit principles: no contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env (lru-cache is in-memory, DI seams avoid real DB), all acceptance criteria concretely testable with specific spy counts and deep-equality assertions, no out-of-scope steps, no SQL index collisions (no migrations), gate commands idempotent. Nothing to flag.

## Plan-audit verdict (round 14)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-14 forced-findings ratchet: not applicable — round 3+ exemption, no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch clean since round-13 `[plan-approved]` commit. Re-verified both prior-context paths exist (`diagnostic/_state.md`, `diagnostic/notes/05-template-cache-coverage.md`). Re-applied all nine audit principles: no contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env (lru-cache is in-memory, DI seams avoid real DB), all acceptance criteria concretely testable with specific spy counts and deep-equality assertions, no out-of-scope steps, no SQL index collisions (no migrations), gate commands idempotent. Nothing to flag.

## Plan-audit verdict (round 15)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-15 forced-findings ratchet: not applicable — round 3+ exemption, no substantive changes since round 6 approval)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Branch clean since round-14 `[plan-approved]` commit. Re-verified both prior-context paths exist (`diagnostic/_state.md`, `diagnostic/notes/05-template-cache-coverage.md`). Re-applied all nine audit principles: no contradictions, no gate ordering bugs, no missing step dependencies, no scope mismatches, no under-specified env (lru-cache is in-memory, DI seams avoid real DB), all acceptance criteria concretely testable with specific spy counts and deep-equality assertions, no out-of-scope steps, no SQL index collisions (no migrations), gate commands idempotent. Nothing to flag.
