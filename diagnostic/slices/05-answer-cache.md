---
slice_id: 05-answer-cache
phase: 5
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T18:00:00Z
---

## Goal
Add an answer-level cache: identical (template, normalized inputs) tuples return the cached answer without hitting the LLM.

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/cache/` (if exists)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/notes/05-template-cache-coverage.md`

## Required services / env
None at author time.

## Steps
1. Build a normalizer that produces a stable cache key from `(template_id, normalized_question_inputs, contracts_hash)`.
2. Use `lru-cache` with TTL=10min, max-size=500.
3. Wire into the synthesis path so a cache hit returns the stored answer without invoking the LLM/synthesis call. Emit a structured `cache_hit: true | false` trace field on every synthesis-path invocation (hit short-circuits before the LLM call; miss logs `cache_hit: false`, runs synthesis, then stores).
4. Add a test seam to the synthesis module: export a counter (or injectable `synthesize` dependency) that the answer-cache test can spy on to assert the underlying LLM/synthesis function executed exactly once across two identical requests.
5. Tests in `web/scripts/tests/answer-cache.test.mjs`:
   - Hit/miss: two identical `(template, inputs, contracts_hash)` calls → first miss, second hit; assert the spy/counter from Step 4 records exactly **one** synthesis invocation and the second response equals the first.
   - Trace assertion: capture emitted log/trace entries and assert the second call emits `cache_hit: true` (the first emits `cache_hit: false`).
   - Hash-collision-safety: different inputs → different keys, both miss, spy/counter records two synthesis invocations.
   - TTL expiry: after advancing fake time past 10min the same key re-misses and the spy/counter increments.

## Changed files expected
- `web/src/lib/cache/answerCache.ts`
- `web/src/lib/chatRuntime.ts` (or whichever module owns the synthesis call site — implementer confirms during Step 3; both the cache wiring and the test seam from Step 4 live here unless a smaller module is extracted)
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
- [ ] Two identical questions in succession: the test spies on the synthesis/LLM call and asserts it ran **exactly once** across both requests; the second request's emitted trace contains `cache_hit: true` and returns the same payload as the first.
- [ ] Different questions never collide on the cache key (both miss; synthesis spy increments twice).
- [ ] TTL expiry: after fake-time advance past 10min, the same key re-misses and synthesis is invoked again (spy/counter increments).

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
- [ ] Move the cache lookup/store boundary ahead of `runReadOnlySql` for deterministic-template requests, and add a gateable assertion that the second identical request skips both SQL execution and synthesis; the current “synthesis-path” wording would still allow the database work to run on every hit and misses the answer-cache goal described in the prior-context audit.

### Medium
- [ ] Update `## Inputs` and `## Changed files expected` to include `web/src/app/api/chat/route.ts` (or explicitly name the extracted module that owns the synthesis/answer-cache boundary), because the live synthesis call site is not in `web/src/lib/chatRuntime.ts`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-28T13:39:03Z, so the loop context is fresh.
- `web/package.json:10` confirms `npm run test:grading` executes `scripts/tests/*.test.mjs`, so the proposed test file is covered by the existing gate command.
