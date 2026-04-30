---
slice_id: 08-validators-pit-stints
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Add a synthesis-output validator: every claim about pit stops must be derivable from the `pit_cycle_summary` contract attached to the prompt.

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
- `web/src/lib/validators/pitStintsValidator.ts`
- `web/scripts/tests/validator-pit-stints.test.mjs`

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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace `cd web && npm run test:grading` in the gate block with `bash scripts/loop/test_grading_gate.sh`, because the current loop note makes the wrapper the contractual grading gate and raw `test:grading` can fail on pre-existing baseline breakage instead of slice regressions (`diagnostic/slices/08-validators-pit-stints.md:39-44`; `diagnostic/_state.md:41-52`; `scripts/loop/test_grading_gate.sh:1-84`).
- [ ] Re-scope the wiring step, inputs, and changed-files list around the module that actually owns synthesis and trace logging: answer synthesis runs in `web/src/app/api/chat/route.ts` via `buildSynthesisContract()` / `cachedSynthesize()` and `chat_query_trace.jsonl` is appended there, not in `web/src/lib/chatRuntime.ts`, so the current plan cannot satisfy acceptance without either touching `route.ts` or changing the stated acceptance (`diagnostic/slices/08-validators-pit-stints.md:14-16,26-34,46-48`; `web/src/app/api/chat/route.ts:57-65`; `web/src/app/api/chat/route.ts:351-355`; `web/src/app/api/chat/route.ts:907-932`; `web/src/app/api/chat/route.ts:1000-1026`).

### Medium
- [ ] Resolve the contract-shape contradiction in step 1: the plan proposes a validator interface over `attachedContracts`, but the live synthesis pipeline still passes a single `contract: FactContract` through `AnswerSynthesisInput` and `buildSynthesisPrompt`, so the slice must either plan a concrete multi-contract payload change or explicitly scope the validator to the existing single-contract path (`diagnostic/slices/08-validators-pit-stints.md:12,27-30`; `web/src/lib/anthropic.ts:35-38`; `web/src/lib/synthesis/buildSynthesisPrompt.ts:3-6`).
- [ ] Specify the unit-test harness for importing the new TypeScript validator and any route wiring under `web/scripts/tests/*.test.mjs`; the current plan names a Node `.mjs` test only, but repo precedent requires explicit `typescript` transpilation plus `@/lib/*` rewrites/stubs when runtime imports are involved (`diagnostic/slices/08-validators-pit-stints.md:29,33-34`; `diagnostic/_state.md:36-49`; `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs:1-54`; `web/scripts/tests/answer-cache.test.mjs:170-193`).

### Low
- [ ] Replace the prose item in `## Prior context` with an actual artifact/path or move it into a note, so the section remains machine-auditable as "paths to consult" rather than mixed path + commentary (`diagnostic/slices/08-validators-pit-stints.md:18-21`).

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T02:05:24Z`, so no stale-state note is required for this round.
