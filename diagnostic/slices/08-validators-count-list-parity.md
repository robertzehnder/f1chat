---
slice_id: 08-validators-count-list-parity
phase: 8
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T13:41:02Z
---

## Goal
Validator: every numerical count claim must match the count derived from the listed items in the same answer (e.g. "3 pit stops" + listed pit stops must have len=3).

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/contracts/`
- `web/src/app/api/chat/route.ts`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- `web/src/lib/validators/pitStintsValidator.ts`
- `web/src/lib/validators/sectorConsistencyValidator.ts`
- `web/src/lib/validators/gridFinishValidator.ts`
- `web/src/lib/validators/strategyEvidenceValidator.ts`

## Required services / env
None at author time.

## Steps
1. Define the validator interface as `validateCountListParity(answerText: string, contract: FactContract) → CountListParityValidationResult` (shape: `{ ok: boolean; reasons: string[] }`), matching the single-`FactContract` pattern used by the existing four validators (`pitStintsValidator`, `sectorConsistencyValidator`, `gridFinishValidator`, `strategyEvidenceValidator`) so it slots into the same call site in `web/src/app/api/chat/route.ts` without introducing a multi-contract plumbing layer.
2. Implement the validator in `web/src/lib/validators/countListParityValidator.ts`.
3. Add unit tests covering pass + fail cases, plus a no-claim case that returns `ok: true` with empty `reasons`.
4. Wire into the synthesis post-step in `web/src/app/api/chat/route.ts` alongside the existing four validators (the block that builds `pitStintsValidation`, `sectorConsistencyValidation`, `gridFinishValidation`, `strategyEvidenceValidation`). Add `countListParityValidation` computed via the same `synthesisContract ? validateCountListParity(answer, synthesisContract) : null` ternary, and extend the `validators` object passed to `appendQueryTrace` to include `countListParity` **without removing or renaming** the existing four keys (`pitStints`, `sectorConsistency`, `gridFinish`, `strategyEvidence`). Validation failures are logged to `chat_query_trace.jsonl` under `validators.countListParity` but don't reject the answer in this phase; the user-facing response is unchanged. When `synthesisContract` is `null` (zero-row branch and `deterministic_template` branch), `validators.countListParity` MUST be the literal `null` (matching the existing four validators' behavior on that branch).
5. Add a route-wiring test (`web/scripts/tests/validator-count-list-route-wiring.test.mjs`) that drives `web/src/app/api/chat/route.ts` for both a pass case and a fail case and asserts:
   - `trace.validators.countListParity` is appended to `chat_query_trace.jsonl` and reflects the pass/fail outcome.
   - `trace.validators` simultaneously still contains `pitStints`, `sectorConsistency`, `gridFinish`, and `strategyEvidence` keys (i.e. the new key is added, not substituted) on both the pass and fail traces.
   - The user-facing response payload is unchanged in both cases (answer text, status, top-level fields).
   - On a synthesis-contract-absent branch (e.g. zero-row result), `trace.validators.countListParity` is the literal `null`, matching the existing four validators on that branch.

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
- [ ] `validateCountListParity(answerText, contract)` returns `{ ok: boolean; reasons: string[] }` for pass, fail, and no-claim test cases (single `FactContract` argument — matches the existing validator interface; no multi-contract plumbing introduced).
- [ ] Synthesis post-step in `web/src/app/api/chat/route.ts` computes `countListParityValidation` via `synthesisContract ? validateCountListParity(answer, synthesisContract) : null`, and the `validators` object on the success-path `appendQueryTrace` call now contains exactly the keys `pitStints`, `sectorConsistency`, `gridFinish`, `strategyEvidence`, and `countListParity` (no existing key removed or renamed).
- [ ] Route-wiring test drives `web/src/app/api/chat/route.ts` and, on both a pass and a fail case, asserts (a) `trace.validators.countListParity` reflects the validator outcome, (b) `trace.validators.pitStints`, `trace.validators.sectorConsistency`, `trace.validators.gridFinish`, and `trace.validators.strategyEvidence` are all still present on the same trace record, and (c) the user-facing response payload is unchanged.
- [ ] Route-wiring test additionally asserts that on a synthesis-contract-absent branch (zero-row or deterministic_template) `trace.validators.countListParity === null`, matching the existing four validators' null behavior on that branch.

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

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Require the route-wiring test and acceptance criteria to assert that `trace.validators` still preserves the existing `pitStints`, `sectorConsistency`, `gridFinish`, and `strategyEvidence` keys when `countListParity` is added; the current “appended” wording permits replacing the whole validators object with only the new key.
- [x] Resolve the validator interface mismatch by either scoping Step 1 to the existing single-`FactContract` validator pattern used in `web/src/app/api/chat/route.ts` or explicitly adding any new multi-contract plumbing/files to `Inputs`, `Steps`, and `Changed files expected`; `(answerText, attachedContracts) -> ValidationResult` does not match the single `synthesisContract` currently available in-route.
- [x] Define the expected `validators.countListParity` value for the no-synthesis-contract / zero-row branch and cover it in acceptance criteria plus route-wiring tests; existing validators in `web/src/app/api/chat/route.ts` log `null` on that branch, but the current pass/fail-only plan leaves the new trace shape ambiguous.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T13:28:23Z`).

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace the non-path `Prior context` bullets with concrete existing artifact paths; `Latest healthcheck artifact under diagnostic/artifacts/healthcheck/` and `Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing"` are not readable paths, so the audit protocol cannot satisfy the required prior-context read step from this slice alone.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T13:28:23Z`).
