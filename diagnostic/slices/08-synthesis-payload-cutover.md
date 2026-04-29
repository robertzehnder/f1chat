---
slice_id: 08-synthesis-payload-cutover
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Cut over synthesis prompt construction to consume only `FactContract`-shaped payloads. Remove direct contract-class imports from the synthesis path.

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/contracts/`

## Prior context
- `diagnostic/_state.md`
- Latest healthcheck artifact under `diagnostic/artifacts/healthcheck/`
- Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing"

## Required services / env
None at author time.

## Steps
1. Define the validator interface: `(answerText, attachedContracts) → ValidationResult`.
2. Implement the validator.
3. Add unit tests covering pass + fail cases.
4. Wire into synthesis post-step (after answer comes back, before returning to user). Validation failures get logged but don't reject the answer in this phase.

## Changed files expected
- `web/src/lib/chatRuntime.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Validator returns structured pass/fail with reason on test cases.
- [ ] Synthesis post-step runs validators; failures surface in `chat_query_trace.jsonl`.

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
- [ ] Rewrite the Steps and Acceptance criteria to implement the stated goal: cut synthesis prompt construction over to `FactContract`-shaped payloads and remove direct contract-class imports from the synthesis path, rather than adding a post-answer validator.

### Medium
- [ ] Fix the `## Prior context` block so every bullet is an actual artifact path; move the prose note about Phase 11 re-baselining out of that section or replace it with a concrete file path.
- [ ] Expand `## Changed files expected` to include the validator/test/logging files the plan's own Steps require, or narrow the Steps so they match the declared file scope.
- [ ] Add a gate or explicit test step that proves the `chat_query_trace.jsonl` logging behavior in Acceptance criteria, or remove that criterion if this slice is only supposed to assert the validator behavior.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
