---
slice_id: 08-fact-contract-shape
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Define the canonical `FactContract` TS shape that each semantic contract serializes into for the synthesis prompt. Single source of truth replacing per-contract ad-hoc shapes.

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
- `web/src/lib/contracts/factContract.ts`

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
- [ ] Rewrite the Steps and Acceptance criteria so they implement the stated goal of defining and adopting a canonical `FactContract` serialization shape; the current plan instead specifies an answer validator workflow and never names the contract fields, serialization boundary, or adoption path for existing per-contract shapes.

### Medium
- [ ] Expand `Changed files expected` to include the synthesis wiring and test files the plan already requires, or narrow the Steps so they only touch `web/src/lib/contracts/factContract.ts`.
- [ ] Replace the `Prior context` note about a validator-only bar with context that matches this slice’s declared goal, or change the goal if this slice is intentionally about validation rather than `FactContract` shape definition.

### Low
- [ ] Specify where validation logs are emitted and how the gate suite or tests will assert the `chat_query_trace.jsonl` side effect, since the current acceptance item is observable but not yet test-shaped.

### Notes (informational only — no action)
- `diagnostic/_state.md` is current enough to use; no stale-state note needed.
