---
slice_id: 07-skip-repair-on-deterministic
phase: 7
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Make the new skip-repair assertions observable through a named gate by stating which `npm run test:grading` test target or harness path executes `web/scripts/tests/skip-repair.test.mjs`; otherwise the plan can pass its listed gates without proving either acceptance criterion.

### Medium
- [ ] Rewrite the acceptance criteria so each one names the concrete test/assertion outcome the implementer must add, rather than only the runtime behavior (“zero repair calls” / “repair still runs”).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T17:02:57Z, so the auditor context is current.
