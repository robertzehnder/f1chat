---
slice_id: 08-validators-pit-stints
phase: 8
status: in_progress
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T22:16:31-04:00
---

## Goal
Add a synthesis-output validator: every claim about pit stops must be derivable from the single `FactContract` attached to the synthesis prompt (the live single-contract path; multi-contract payloads are out of scope).

## Inputs
- `web/src/app/api/chat/route.ts` (synthesis call sites at `buildSynthesisContract()` / `cachedSynthesize()` / `synthesizeAnswerStream()` and the `appendQueryTrace` `chat_query_trace.jsonl` writer)
- `web/src/lib/anthropic.ts` (`AnswerSynthesisInput.contract: FactContract` — the single-contract shape this slice targets)
- `web/src/lib/synthesis/buildSynthesisPrompt.ts`
- `web/src/lib/contracts/factContract.ts`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- `scripts/loop/test_grading_gate.sh`

Note: Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing".

## Required services / env
None at author time.

## Decisions
- Validator interface is **single-contract**: `(answerText: string, contract: FactContract) → ValidationResult`. The live synthesis pipeline (`AnswerSynthesisInput.contract: FactContract` in `web/src/lib/anthropic.ts`, consumed by `buildSynthesisPrompt`) passes exactly one `FactContract`, so the validator follows the same shape. Any multi-contract evolution is explicitly out of scope for this slice.
- Wiring lives in `web/src/app/api/chat/route.ts` (the module that owns synthesis and the `chat_query_trace.jsonl` writer via `appendQueryTrace`), not in `web/src/lib/chatRuntime.ts`. The validator is invoked after `cachedSynthesize()` / `synthesizeAnswerStream()` returns and the resulting `ValidationResult` is added to the `appendQueryTrace` call so failures land in the trace.
- Failures are non-blocking in this phase: they appear in `chat_query_trace.jsonl` only and do not change the response payload.

## Steps
1. Define the validator interface in `web/src/lib/validators/pitStintsValidator.ts`:
   `validatePitStints(answerText: string, contract: FactContract): ValidationResult` where
   `ValidationResult = { ok: boolean; reasons: string[] }`. Use only type-only imports of `FactContract` from `@/lib/contracts/factContract` so the test transpile path does not require runtime stubs (matches the `chatRuntime-synthesis-payload.test.mjs` precedent).
2. Implement the validator: detect pit-stop claims in `answerText` (number-of-stops, undercut/overcut, stint-count consistency) and assert each claim is derivable from `contract.rows` / `contract.keys` / `contract.coverage`. Return `{ ok: false, reasons: [...] }` when a claim is unsupported.
3. Add unit tests at `web/scripts/tests/validator-pit-stints.test.mjs` using the live transpile-and-import harness:
   - Use `typescript`'s `ts.transpileModule` (precedent: `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs:39-53`) to transpile `web/src/lib/validators/pitStintsValidator.ts` to a temp `.mjs` and dynamic-import it.
   - Because the validator only has type-only imports of `FactContract`, no `@/lib/*` rewrites are required (TypeScript erases type-only imports during transpile). If any runtime `@/lib/*` import is added later, the test must add explicit stubs for each (precedent: `web/scripts/tests/answer-cache.test.mjs:170-193`).
   - Cover at least: (a) pass case with consistent stint/pit-stop counts; (b) fail case where the answer claims an undercut without position-change rows; (c) fail case with `pit_stops` count not matching `stints - 1`.
4. Wire the validator into `web/src/app/api/chat/route.ts` immediately after the existing synthesis call site (`cachedSynthesize` / `synthesizeAnswerStream`, around `route.ts:907-932`) and before `appendQueryTrace(...)` is invoked (`route.ts:1013-...`). Pass the existing `contract` already built by `buildSynthesisContract({ runtime, rows: result.rows })`. Add the `ValidationResult` to the trace payload (e.g. `validators: { pitStints: result }`) so failures land in `chat_query_trace.jsonl`. Do not change the user-facing response payload — failures are logged only.
5. Extend the existing route-harness test pattern to assert wiring: add a test that reuses the `answer-cache.test.mjs` route-stub scaffolding (precedent: `web/scripts/tests/answer-cache.test.mjs:170-193`) — including stubs for every `@/lib/*` import touched by `route.ts` — and asserts that for a fixture with a pit-stops question the validator runs and the trace JSON contains the `validators.pitStints` field. The test must rewrite `@/lib/contracts/factContract` and any newly added `@/lib/validators/pitStintsValidator` import to local stubs/the real transpiled module, matching the existing stub policy.

## Changed files expected
- `web/src/lib/validators/pitStintsValidator.ts` (new validator module)
- `web/src/app/api/chat/route.ts` (wire validator after synthesis, include result in `appendQueryTrace` payload)
- `web/scripts/tests/validator-pit-stints.test.mjs` (validator unit tests, transpile-and-import harness)
- `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs` (route-harness test asserting validator runs and surfaces in `chat_query_trace.jsonl`; extends the `answer-cache.test.mjs` stub pattern)

## Artifact paths
None.

## Gate commands
Run from the repo root. Each `web` command is wrapped in its own subshell so the parent shell stays in the repo root and the final `bash scripts/loop/test_grading_gate.sh` resolves correctly.
```bash
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] Validator returns structured pass/fail (`{ ok, reasons }`) on the unit-test cases listed in step 3.
- [ ] `web/src/app/api/chat/route.ts` invokes the validator after synthesis and includes the `ValidationResult` in the `appendQueryTrace` payload, so failures surface in `chat_query_trace.jsonl` (asserted by the route-wiring test in step 5).
- [ ] No new failures in `bash scripts/loop/test_grading_gate.sh` relative to the baseline at `scripts/loop/state/test_grading_baseline.txt`.

## Out of scope
- Multi-contract validator payloads (the live synthesis path is single-contract per `web/src/lib/anthropic.ts:35-38`).
- Rejecting answers based on validation failures (this phase logs only).
- Validators for any contract other than pit-stop claims.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` in the gate block with `bash scripts/loop/test_grading_gate.sh`, because the current loop note makes the wrapper the contractual grading gate and raw `test:grading` can fail on pre-existing baseline breakage instead of slice regressions (`diagnostic/slices/08-validators-pit-stints.md:39-44`; `diagnostic/_state.md:41-52`; `scripts/loop/test_grading_gate.sh:1-84`).
- [x] Re-scope the wiring step, inputs, and changed-files list around the module that actually owns synthesis and trace logging: answer synthesis runs in `web/src/app/api/chat/route.ts` via `buildSynthesisContract()` / `cachedSynthesize()` and `chat_query_trace.jsonl` is appended there, not in `web/src/lib/chatRuntime.ts`, so the current plan cannot satisfy acceptance without either touching `route.ts` or changing the stated acceptance (`diagnostic/slices/08-validators-pit-stints.md:14-16,26-34,46-48`; `web/src/app/api/chat/route.ts:57-65`; `web/src/app/api/chat/route.ts:351-355`; `web/src/app/api/chat/route.ts:907-932`; `web/src/app/api/chat/route.ts:1000-1026`).

### Medium
- [x] Resolve the contract-shape contradiction in step 1: the plan proposes a validator interface over `attachedContracts`, but the live synthesis pipeline still passes a single `contract: FactContract` through `AnswerSynthesisInput` and `buildSynthesisPrompt`, so the slice must either plan a concrete multi-contract payload change or explicitly scope the validator to the existing single-contract path (`diagnostic/slices/08-validators-pit-stints.md:12,27-30`; `web/src/lib/anthropic.ts:35-38`; `web/src/lib/synthesis/buildSynthesisPrompt.ts:3-6`).
- [x] Specify the unit-test harness for importing the new TypeScript validator and any route wiring under `web/scripts/tests/*.test.mjs`; the current plan names a Node `.mjs` test only, but repo precedent requires explicit `typescript` transpilation plus `@/lib/*` rewrites/stubs when runtime imports are involved (`diagnostic/slices/08-validators-pit-stints.md:29,33-34`; `diagnostic/_state.md:36-49`; `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs:1-54`; `web/scripts/tests/answer-cache.test.mjs:170-193`).

### Low
- [x] Replace the prose item in `## Prior context` with an actual artifact/path or move it into a note, so the section remains machine-auditable as "paths to consult" rather than mixed path + commentary (`diagnostic/slices/08-validators-pit-stints.md:18-21`).

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T02:05:24Z`, so no stale-state note is required for this round.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Rewrite the gate block so each `web` command runs from repo root in an isolated subshell (for example `(cd web && npm run build)` / `(cd web && npm run typecheck)`), because the current sequential `cd web && ...` lines leave the shell in `web/` after the first command and make the next `cd web` and repo-root `bash scripts/loop/test_grading_gate.sh` invocation fail.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T02:05:24Z`, so no stale-state note is required for this round.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T02:05:24Z`, so no stale-state note is required for this round.
