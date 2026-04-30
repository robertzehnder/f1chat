---
slice_id: 08-validators-strategy-evidence
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Validator: every strategy-decision claim must reference an event in `strategy_evidence_summary`.

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
- `web/src/lib/validators/strategyEvidenceValidator.ts`
- `web/scripts/tests/validator-strategy-evidence.test.mjs`

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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required grading wrapper baseline instead of treating known shared failures as slice regressions.

### Medium
- [ ] Add `web/src/lib/chatRuntime.ts` to `Changed files expected`, because Step 4 explicitly wires the validator into the synthesis post-step there.
- [ ] Add a concrete test or gate for the Step 4 wiring so the acceptance criterion about surfacing failures in `chat_query_trace.jsonl` is verifiable rather than relying only on unit tests for pass/fail cases.

### Low
- [ ] Replace `Latest healthcheck artifact under diagnostic/artifacts/healthcheck/` in `Prior context` with the specific artifact path the auditor should read so the slice remains deterministic as new healthcheck files land.

### Notes (informational only — no action)
- `diagnostic/_state.md` is current; no stale-state note required.
- The latest healthcheck still shows strategy-question semantic misses (`fact_table_used` / `semantic_contract_missed`), so the slice goal is aligned with an active regression area.
