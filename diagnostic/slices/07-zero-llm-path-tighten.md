---
slice_id: 07-zero-llm-path-tighten
phase: 7
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [ ] Add the Phase 5 audit artifact or prior slice path that defines the deterministic-eligible template set to `## Prior context`; Step 1 currently depends on an external source that is not cited in the slice ([diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:18)).
- [ ] Add an acceptance criterion and corresponding test expectation for the new dev-only assertion path so the stated goal in `## Goal` and Step 2 is directly verifiable, not just the zero-call happy path ([diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:11), [diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:26), [diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:43)).
- [ ] Broaden `## Changed files expected` to include the template definition file(s) under `web/src/lib/templates/` if deterministic eligibility is encoded there, or narrow the steps to make clear the slice is runtime/test-only; the current scope leaves the plan internally ambiguous about where eligibility is sourced ([diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:14), [diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:29)).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T14:33:39Z, so no stale-state note is required.
- `npm run test:grading` covers `scripts/tests/*.test.mjs` (`web/package.json:8`), so the named test file pattern is compatible with the current gate.
