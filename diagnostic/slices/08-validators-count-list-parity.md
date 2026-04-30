---
slice_id: 08-validators-count-list-parity
phase: 8
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Validator: every numerical count claim must match the count derived from the listed items in the same answer (e.g. "3 pit stops" + listed pit stops must have len=3).

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/contracts/`
- `web/src/app/api/chat/route.ts`

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
4. Wire into the synthesis post-step in `web/src/app/api/chat/route.ts` (after answer comes back, before returning to user). Validation failures get logged to `chat_query_trace.jsonl` under `validators.countListParity` but don't reject the answer in this phase; the user-facing response is unchanged.
5. Add a route-wiring test that drives the chat route and asserts `validators.countListParity` is appended to `chat_query_trace.jsonl` on both pass and fail cases without altering the user-facing response.

## Changed files expected
- `web/src/lib/validators/countListParityValidator.ts`
- `web/src/app/api/chat/route.ts`
- `web/scripts/tests/validator-count-list.test.mjs`
- `web/scripts/tests/validator-count-list-route-wiring.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] Validator returns structured pass/fail with reason on test cases.
- [ ] Synthesis post-step runs validators; failures surface in `chat_query_trace.jsonl`.
- [ ] Route-wiring test drives `web/src/app/api/chat/route.ts` and asserts `validators.countListParity` is appended to `chat_query_trace.jsonl` on both pass and fail cases, and that the user-facing response is unchanged in both cases.

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
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in `Gate commands`; Phase 8 slice plans must use the wrapper so baseline grading failures outside this slice do not invalidate the gate.
- [x] Update `Inputs` and `Changed files expected` to include `web/src/app/api/chat/route.ts`; Step 4 wires validators in the chat route, not `web/src/lib/chatRuntime.ts`.
- [x] Add a route-wiring test file to `Changed files expected`, `Steps`, and `Acceptance criteria` that asserts `validators.countListParity` is appended to `chat_query_trace.jsonl` on pass and fail without changing the user-facing response; the current unit-test-only plan does not verify Step 4.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T13:28:23Z`).
