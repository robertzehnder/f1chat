---
slice_id: 05-answer-cache
phase: 5
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
3. Wire into the synthesis path: cache hit returns immediately; cache miss runs synthesis and stores.
4. Tests: hit/miss, hash-collision-safety (different inputs → different keys), TTL expiry.

## Changed files expected
- `web/src/lib/cache/answerCache.ts`
- `web/src/lib/chatRuntime.ts`
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
- [ ] Two identical questions in succession: second is a cache hit (test asserts `cache_hit: true` log line).
- [ ] Different questions never collide on the cache key.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
