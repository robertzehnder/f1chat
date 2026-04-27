---
slice_id: 05-resolver-lru
phase: 5
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Add an LRU cache around the entity-resolver (driver/team/session ID lookups) so repeated lookups within a session avoid round-trips.

## Inputs
- `web/src/lib/resolver/`
- `web/src/lib/chatRuntime.ts`

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Wrap each resolver call with an `lru-cache` instance keyed by `(entity_type, query_key)`.
2. Configure TTL (5 min) and max-size (1000 entries) via env knobs with sane defaults.
3. Add unit tests for hit / miss / eviction.

## Changed files expected
- `web/src/lib/resolver/lruWrapper.ts`
- `web/scripts/tests/resolver-lru.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Cache hit ratio > 80% in the resolver-lru test (10 unique IDs, 100 lookups).
- [ ] Tests pass.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
