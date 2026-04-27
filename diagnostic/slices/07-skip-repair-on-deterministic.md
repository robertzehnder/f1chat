---
slice_id: 07-skip-repair-on-deterministic
phase: 7
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Skip the LLM-based JSON-repair pass when the upstream output is already valid JSON (parsed cleanly). Avoids a wasteful repair call for the common case.

## Inputs
- `web/src/lib/chatRuntime.ts` (repair logic)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Wrap the repair-call site with a `JSON.parse` try/catch; on success, skip repair.
2. Add tests covering: (a) valid JSON skips repair; (b) malformed JSON still triggers repair.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/scripts/tests/skip-repair.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Valid JSON path: zero repair calls.
- [ ] Malformed JSON path: repair still runs.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
