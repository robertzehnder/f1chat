---
slice_id: 07-zero-llm-path-tighten
phase: 7
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Audit and tighten the deterministic-only path: questions that resolve fully via templates + matviews must NOT call any LLM. Add assertions that fail in dev if a deterministic-eligible template falls through to the LLM.

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/templates/`

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify deterministic-eligible templates (per Phase 5 audit).
2. Add a runtime assertion that throws in dev when a deterministic-eligible template invokes the LLM path.
3. Update tests to exercise both deterministic and LLM-required questions; verify zero LLM calls on the deterministic ones.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/scripts/tests/zero-llm-path.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Deterministic test cases produce zero LLM API calls (assert via mock/spy).
- [ ] Existing LLM-required cases still work.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
