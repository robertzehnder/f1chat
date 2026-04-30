---
slice_id: 08-validators-sector-consistency
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Validator: every sector-time claim must be consistent with the `lap_context_summary` contract.

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
- `web/src/lib/validators/sectorConsistencyValidator.ts`
- `web/scripts/tests/validator-sector.test.mjs`

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
- [ ] None.

### Medium
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the plan uses the required baseline-aware grading gate wrapper.
- [ ] Add `web/src/lib/chatRuntime.ts` to `Changed files expected`; Step 4 explicitly wires the validator into the synthesis post-step there.
- [ ] Rewrite `## Prior context` so every bullet is a concrete artifact path; `Latest healthcheck artifact under diagnostic/artifacts/healthcheck/` and `Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing"` are not concrete paths an auditor can read.
- [ ] Make the logging acceptance criterion testable by naming the concrete test or gate assertion that proves validator failures surface in `chat_query_trace.jsonl`, not just that the post-step runs.

### Low
- [ ] Consider broadening `Changed files expected` to mention any contract/type module under `web/src/lib/contracts/` if the validator interface or attached contract shape must be shared rather than kept local.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T02:34:51Z, so the state context is current.
