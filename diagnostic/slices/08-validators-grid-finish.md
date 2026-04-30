---
slice_id: 08-validators-grid-finish
phase: 8
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Validator: every grid/finish claim must be consistent with `grid_vs_finish`.

## Inputs
- `web/src/app/api/chat/route.ts` (synthesis post-step where validators are invoked alongside `validatePitStints` / `validateSectorConsistency`)
- `web/src/lib/contracts/factContract.ts`
- `web/src/lib/validators/sectorConsistencyValidator.ts` (reference implementation pattern)
- `web/src/lib/validators/pitStintsValidator.ts` (reference implementation pattern)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md`
- `web/scripts/tests/validator-sector-consistency.test.mjs` (existing per-validator unit-test pattern)
- `web/scripts/tests/validator-sector-consistency-route-wiring.test.mjs` (existing route-wiring test pattern)

## Required services / env
None at author time.

## Decisions
- Step 4 wires the validator into the synthesis post-step in `web/src/app/api/chat/route.ts` (where `validatePitStints` and `validateSectorConsistency` are invoked at lines ~1022–1027 and surfaced in `appendQueryTrace`'s `validators` field at ~line 1054), not in `web/src/lib/chatRuntime.ts`. The original Inputs reference to `chatRuntime.ts` was incorrect; corrected here. Plan-audit round 1 Medium item asked for `chatRuntime.ts` in Changed files; we list the actually-modified file (`route.ts`) instead.
- The validator interface (e.g. `GridFinishValidationResult`) is co-located in the new validator module file rather than in a separate shared contract/type file, matching the precedent set by `sectorConsistencyValidator.ts` and `pitStintsValidator.ts` (each defines and exports its own `*ValidationResult` type). No new shared contract file is added.

## Steps
1. Define the validator interface in `web/src/lib/validators/gridFinishValidator.ts`: `(answerText: string, contract: FactContract) → GridFinishValidationResult` with shape `{ ok: boolean; reasons: string[] }`, matching the precedent in `sectorConsistencyValidator.ts`.
2. Implement the validator: parse grid/finish claims from `answerText` — covering (a) explicit grid-position / finish-position statements (e.g. "started P5", "finished P3", "from grid 7 to P2"), (b) position-change claims derivable from `grid_vs_finish` (e.g. "gained 4 places", "lost 2 positions", "moved up/down N spots", "climbed/dropped N places", and equivalent wording), AND (c) comparative claims between two named drivers derivable from `grid_vs_finish` (e.g. "Verstappen gained more positions than Leclerc", "Leclerc lost fewer places than Hamilton", "X moved up more spots than Y", and equivalent winner/ordering wording) — and assert consistency against the `grid_vs_finish` rows in the attached `FactContract`. Position-change claims are validated by computing `grid_position - finish_position` for the named driver from the contract row and comparing against the parsed claim's signed magnitude. Comparative claims are validated by computing the signed delta for each named driver from their contract rows and asserting the claimed ordering (e.g. `delta_A > delta_B`, `|loss_A| < |loss_B|`) holds.
3. Add unit tests at `web/scripts/tests/validator-grid-finish.test.mjs` covering pass + fail cases for ALL three claim shapes: (a) explicit grid/finish position statements, (b) position-change claims (e.g. "gained 4 places" pass, "gained 4 places" fail when actual delta differs, "lost 2 positions" pass/fail), AND (c) comparative claims (e.g. "Verstappen gained more positions than Leclerc" pass when Verstappen's delta exceeds Leclerc's, fail when Leclerc's delta is actually greater; "Leclerc lost fewer places than Hamilton" pass/fail) (mirror the structure of `validator-sector-consistency.test.mjs`).
4. Wire into the synthesis post-step in `web/src/app/api/chat/route.ts` alongside the existing pit-stints and sector-consistency validators (after answer comes back, before returning to user): call `validateGridFinish(answer, synthesisContract)` and add a `gridFinish` field to the `validators` object passed to `appendQueryTrace` (line ~1054). Validation failures get logged in `chat_query_trace.jsonl` but don't reject the answer in this phase.
5. Add a route-wiring test at `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` (mirror `validator-sector-consistency-route-wiring.test.mjs`) asserting (a) the trace event written to `chat_query_trace.jsonl` includes the `validators.gridFinish` field, AND (b) when `validateGridFinish` returns `ok: false` for the synthesized answer, the user-facing route response is unchanged/unblocked — i.e., the HTTP response status and answer-text payload are identical to the pass case (validation failure logs to the trace but does not reject, alter, or strip the response), matching the non-blocking behavior already exercised by the sector-consistency route-wiring test.

## Changed files expected
- `web/src/lib/validators/gridFinishValidator.ts` (new)
- `web/scripts/tests/validator-grid-finish.test.mjs` (new)
- `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` (new)
- `web/src/app/api/chat/route.ts` (import + invoke `validateGridFinish`; add `gridFinish` to `validators` field in `appendQueryTrace` payload)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] Validator returns structured pass/fail with reason on test cases for ALL three shapes: (a) explicit grid/finish position statements, (b) position-change claims (e.g. "gained/lost N places", "moved up/down N positions"), and (c) comparative claims between two named drivers (e.g. "X gained more positions than Y", "X lost fewer places than Y").
- [ ] Synthesis post-step runs validators; failures surface in `chat_query_trace.jsonl` under the `validators.gridFinish` field.
- [ ] Route-wiring test asserts that when `validateGridFinish` returns `ok: false`, the user-facing response payload (HTTP status and answer text) is unchanged versus the pass case — failing validation is non-blocking in this phase.

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
- [x] Replace the ambiguous/non-path `## Prior context` entries at [diagnostic/slices/08-validators-grid-finish.md](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/diagnostic/slices/08-validators-grid-finish.md:20) and [diagnostic/slices/08-validators-grid-finish.md](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/diagnostic/slices/08-validators-grid-finish.md:21) with concrete existing artifact path(s), because plan-audit requires every listed prior-context path to be directly readable.
- [x] Replace the raw `cd web && npm run test:grading` gate at [diagnostic/slices/08-validators-grid-finish.md](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/diagnostic/slices/08-validators-grid-finish.md:43) with `bash scripts/loop/test_grading_gate.sh` per the standing auditor note in `diagnostic/_state.md`.
- [x] Add `web/src/lib/chatRuntime.ts` to `## Changed files expected` at [diagnostic/slices/08-validators-grid-finish.md](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/diagnostic/slices/08-validators-grid-finish.md:32), because Step 4 explicitly wires the validator into the synthesis post-step there. (Addressed via `web/src/app/api/chat/route.ts` — see Decisions; that is the actual file where pit-stints/sector validators are wired, not `chatRuntime.ts`.)

### Low
- [x] Clarify whether the validator interface from [diagnostic/slices/08-validators-grid-finish.md](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/diagnostic/slices/08-validators-grid-finish.md:27) lives in a new shared contract/type file, and if so add that path under `## Changed files expected`. (Addressed in Decisions: validator type is co-located in the validator module, no new shared file.)

### Notes (informational only — no action)
- `diagnostic/_state.md` was readable and its timestamp did not block this audit.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Tighten Step 2, Step 3, and the Acceptance criteria to explicitly cover position-change claims derivable from `grid_vs_finish` (for example "gained/lost N places" and equivalent wording), not only explicit grid-position / finish-position statements, because the slice goal says every grid/finish claim must be validated and the benchmark prior context includes that claim shape.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was readable on 2026-04-29; its advisory timestamp (`2026-04-30T03:18:23Z`) did not block this audit.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Tighten Step 5 and the Acceptance criteria to require a route-wiring assertion that a failing `gridFinish` validation still leaves the user-facing response payload unchanged/unblocked, because Step 4 explicitly says failures only log to `chat_query_trace.jsonl` in this phase and the existing validator route-wiring pattern checks that non-blocking behavior.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was readable on 2026-04-29; its advisory timestamp (`2026-04-30T03:18:23Z`) did not block this audit.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Expand Step 2, Step 3, and the Acceptance criteria to cover comparative grid/finish claims derivable from `grid_vs_finish` (for example "Verstappen gained more positions than Leclerc", "Leclerc lost fewer places", or equivalent winner/ordering wording), because the slice goal says every grid/finish claim must be consistent with `grid_vs_finish` and the prior-context benchmark includes that claim shape.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was readable on 2026-04-29; its advisory timestamp (`2026-04-30T03:18:23Z`) did not block this audit.

## Plan-audit verdict (round 5)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was readable on 2026-04-30; its advisory timestamp (`2026-04-30T03:18:23Z`) did not block this audit.
