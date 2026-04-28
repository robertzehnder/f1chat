---
slice_id: 05-resolver-lru
phase: 5
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Specify how the cache is scoped and invalidated so entries cannot leak across seasons or sessions when the same `(entity_type, query_key)` appears in different contexts.

### Medium
- [ ] Align `Changed files expected` with the stated work by including every file Step 2 and the `web/src/lib/chatRuntime.ts` integration path will require, plus any package manifest updates if `lru-cache` is not already available.
- [ ] Make the acceptance criteria testable from the listed gates by requiring the new resolver LRU test command to assert hit, miss, and eviction behavior directly instead of relying on a prose hit-ratio target.

### Low
- [ ] Name the env knobs introduced in Step 2 and where they are read so the implementer does not need to invent the configuration surface.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T12:53:01Z, so no stale-state note is required.
