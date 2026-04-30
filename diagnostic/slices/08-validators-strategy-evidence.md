---
slice_id: 08-validators-strategy-evidence
phase: 8
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T04:00:00Z
---

## Goal
Validator: every strategy-decision claim must reference an event in `strategy_evidence_summary`.

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/contracts/`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md`
- Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing"

## Required services / env
None at author time.

## Steps
1. Define the validator interface: `(answerText, attachedContracts) → ValidationResult`.
2. Implement the validator.
3. Add unit tests covering pass + fail cases.
4. Wire into the synthesis post-step in `web/src/lib/chatRuntime.ts` (after answer comes back, before returning to user). Validation failures get logged into `chat_query_trace.jsonl` but don't reject the answer in this phase.
5. Add a route-wiring test (mirroring `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` and `validator-pit-stints-route-wiring.test.mjs`) that asserts a failing strategy-evidence answer surfaces in `chat_query_trace.jsonl`.

## Changed files expected
- `web/src/lib/validators/strategyEvidenceValidator.ts`
- `web/src/lib/chatRuntime.ts`
- `web/scripts/tests/validator-strategy-evidence.test.mjs`
- `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs`

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
- [ ] Synthesis post-step in `web/src/lib/chatRuntime.ts` runs the validator; the route-wiring test asserts that failures appear in `chat_query_trace.jsonl`.

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
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required grading wrapper baseline instead of treating known shared failures as slice regressions.

### Medium
- [x] Add `web/src/lib/chatRuntime.ts` to `Changed files expected`, because Step 4 explicitly wires the validator into the synthesis post-step there.
- [x] Add a concrete test or gate for the Step 4 wiring so the acceptance criterion about surfacing failures in `chat_query_trace.jsonl` is verifiable rather than relying only on unit tests for pass/fail cases.

### Low
- [x] Replace `Latest healthcheck artifact under diagnostic/artifacts/healthcheck/` in `Prior context` with the specific artifact path the auditor should read so the slice remains deterministic as new healthcheck files land.

### Notes (informational only — no action)
- `diagnostic/_state.md` is current; no stale-state note required.
- The latest healthcheck still shows strategy-question semantic misses (`fact_table_used` / `semantic_contract_missed`), so the slice goal is aligned with an active regression area.
