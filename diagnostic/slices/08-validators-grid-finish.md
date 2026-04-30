---
slice_id: 08-validators-grid-finish
phase: 8
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T23:35:35-04:00
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

**Branch:** `slice/08-validators-grid-finish`
**Commit:** `8bec432c059e380a1352a5fb08a58bd763f744a2` (single slice commit on this branch).

### What changed
- New file `web/src/lib/validators/gridFinishValidator.ts` exports `validateGridFinish(answerText, contract): GridFinishValidationResult` covering all three claim shapes called for in Step 2:
  - (a) explicit grid/finish position statements (e.g. "started P5", "finished P3", "from grid 7 to P2"),
  - (b) position-change claims derivable from `grid_vs_finish` (e.g. "gained 4 places", "lost 2 positions", "moved up/down N spots", "climbed/dropped N places"),
  - (c) comparative claims between two named drivers (e.g. "Verstappen gained more positions than Leclerc", "Leclerc lost fewer places than Hamilton", "X moved up more spots than Y").
  Driver attribution is sentence-scoped: a phrase like `gained 4 places` is attached to the nearest preceding capitalized name in the same sentence, so a single subject can chain claims (e.g. "Verstappen started P5 and finished P3").
- `web/src/app/api/chat/route.ts` imports `validateGridFinish` (alongside the existing `validatePitStints` and `validateSectorConsistency`), invokes it on the synthesis post-step against `synthesisContract`, and adds a `gridFinish` field to the `validators` object passed to `appendQueryTrace` (line ~1056). Failures only log to `chat_query_trace.jsonl`; the user-facing response payload is unchanged in shape.
- New unit-test file `web/scripts/tests/validator-grid-finish.test.mjs` (13 tests, all pass) covers pass+fail cases for all three claim shapes plus a "no claims" pass case, a "no grid/finish columns" failure case, and a `moved up N spots` happy-path case.
- New route-wiring test file `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` (2 tests, all pass) asserts (a) the trace event written to `chat_query_trace.jsonl` includes `validators.gridFinish` (alongside the preserved `pitStints` and `sectorConsistency` fields), AND (b) when `validateGridFinish` returns `ok: false` for the synthesized answer, the user-facing route response (HTTP status, `body.answer` text, absence of a `validators` key) is identical in shape to the pass case.

### Decisions / scope
- The validator interface (`GridFinishValidationResult`) is co-located in `gridFinishValidator.ts` (per the slice's `## Decisions`), matching the precedent set by `sectorConsistencyValidator.ts` and `pitStintsValidator.ts`. No new shared contract/type file added.
- Wiring lives in `web/src/app/api/chat/route.ts`, NOT `web/src/lib/chatRuntime.ts` — the route is where `validatePitStints` / `validateSectorConsistency` are actually invoked and where their results are surfaced via `appendQueryTrace`. The slice's `## Decisions` block already documents this correction to the original Inputs reference.
- All regex name-capture patterns are case-sensitive (no `i` flag) and require an actual uppercase first letter; this avoids parsing English connective words ("and", "from", "to") as driver tokens. Case-insensitive parts of keywords (`P` vs `p`, `Grid` vs `grid`) are spelled with explicit character classes (`[Pp]`, `[Gg]rid`).

### Gate command results
- `cd web && npm run build` → exit 0
- `cd web && npm run typecheck` → exit 0
- `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=26 baseline_fails=26 baseline_failures_fixed=0`)

### Self-checks against acceptance criteria
- [x] Validator returns structured pass/fail with reason on test cases for all three shapes (a/b/c) — see `validator-grid-finish.test.mjs` cases (a1)/(a2), (b1)–(b4), (c1)–(c4) all green.
- [x] Synthesis post-step runs validators; failures surface in `chat_query_trace.jsonl` under `validators.gridFinish` — verified by `validator-grid-finish-route-wiring.test.mjs` test #1 (assert `lastTrace.validators.gridFinish.ok === false` plus non-empty reasons).
- [x] When `validateGridFinish` returns `ok: false`, user-facing response payload (HTTP status + answer text) is unchanged versus the pass case — verified by `validator-grid-finish-route-wiring.test.mjs` test #2 (asserts pass/fail HTTP status equality, exact answer-text equality to the synthesized text in both cases, and identical `validators`-key presence on `body`).

## Audit verdict
**PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS; `git diff --name-only integration/perf-roadmap...HEAD` is limited to declared paths plus this slice file.
- Criterion 1 -> PASS. [web/src/lib/validators/gridFinishValidator.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/src/lib/validators/gridFinishValidator.ts:3) defines structured `{ ok, reasons }`; claim parsing and validation cover explicit positions, signed position deltas, and comparative ordering at [web/src/lib/validators/gridFinishValidator.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/src/lib/validators/gridFinishValidator.ts:144) and [web/src/lib/validators/gridFinishValidator.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/src/lib/validators/gridFinishValidator.ts:281). `node --test web/scripts/tests/validator-grid-finish.test.mjs` -> exit `0` (13/13 passing).
- Criterion 2 -> PASS. [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/src/app/api/chat/route.ts:37) imports `validateGridFinish`; [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/src/app/api/chat/route.ts:1032) invokes it; [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/src/app/api/chat/route.ts:1061) records `validators.gridFinish`. `node --test web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` -> exit `0`.
- Criterion 3 -> PASS. [web/scripts/tests/validator-grid-finish-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/scripts/tests/validator-grid-finish-route-wiring.test.mjs:434) and [web/scripts/tests/validator-grid-finish-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-grid-finish/web/scripts/tests/validator-grid-finish-route-wiring.test.mjs:445) assert failed `gridFinish` validation leaves HTTP status and `body.answer` unchanged and does not leak validator output into the user response; test exits `0`.
- Decision -> PASS. Slice meets acceptance criteria and is safe to merge.

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
