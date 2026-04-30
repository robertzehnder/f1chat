---
slice_id: 08-validators-pit-stints
phase: 8
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T22:27:40-04:00
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

**Branch:** `slice/08-validators-pit-stints`

**Commits (this slice, ahead of `integration/perf-roadmap`):**
- `0b2af6b` — feat(validators): wire pit-stints synthesis validator into chat route
- `99cf632` — slice 08-validators-pit-stints: completion note + awaiting_audit
- `42e17e8` — slice 08-validators-pit-stints: include completion-note commit hash
- `d0fe51d` — audit: revise
- `efd5a4e` — fix(validators): verify claimed pit-stop counts match contract values (audit revision)

**Changed files (matches the slice's "Changed files expected" exactly):**
- `web/src/lib/validators/pitStintsValidator.ts` (new + revision)
- `web/src/app/api/chat/route.ts` (modified)
- `web/scripts/tests/validator-pit-stints.test.mjs` (new + new test case for audit probe)
- `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs` (new)

**Decisions enacted:**
- Single-contract validator interface as specified: `validatePitStints(answerText: string, contract: FactContract): { ok: boolean; reasons: string[] }`. Type-only import of `FactContract` from `@/lib/contracts/factContract`, so `ts.transpileModule` erases it during the test transpile step (no runtime stubs required for the validator alone).
- Wiring lives in `web/src/app/api/chat/route.ts` (the synthesis + `appendQueryTrace` call site), not in `web/src/lib/chatRuntime.ts`. The `buildSynthesisContract({ runtime, rows: result.rows })` call was hoisted from the two inner sse/non-sse branches to a single declaration just inside the LLM-synthesis `try`, with a reference captured into an outer-scoped `let synthesisContract: FactContract | null = null` so the validator (running after sanity-check, before `appendQueryTrace`) can reuse the exact same contract object that was sent to the model. The validator only runs when `synthesisContract` is non-null (i.e. the LLM-synthesis branch fired); the deterministic-template path emits `validators.pitStints = null`, since that path performs no LLM claim that needs validating.
- Failures are non-blocking: the user-facing JSON payload is unchanged; the `ValidationResult` is added to the `appendQueryTrace` payload as `validators: { pitStints: result }` so failures surface in `chat_query_trace.jsonl` only.
- Test harness matches the existing precedents: `web/scripts/tests/validator-pit-stints.test.mjs` uses `ts.transpileModule` + dynamic import (precedent: `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs:39-53`); `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs` reuses the answer-cache route-stub scaffolding (precedent: `web/scripts/tests/answer-cache.test.mjs:170-193`), with one new `from "@/lib/validators/pitStintsValidator"` rewrite that points at the real transpiled validator module (no runtime stubs needed for the validator).
- **Audit revision (round 1 → 2):** the prior validator only confirmed that pit-stop/stint *columns* existed; it did not check that the claimed numeric value was actually derivable from contract values. Per the audit's Criterion-1 probe (`validatePitStints("Verstappen made 5 pit stops in this race.", { rows: [{ stints: 2, pit_stops: 1 }] })` returned `ok=true`), the validator now collects the numeric set of derivable pit-stop counts (any `pit_stops`/`pit_count`/`n_pit_stops`/`num_pit_stops` value, plus `stints - 1` for any positive `stints`/`stint_count`/`n_stints`/`num_stints` value) and flags the claim when the asserted number is not in that set. The same shape is applied to claimed stint counts (derivable = any stints value, plus `pit_stops + 1`). Both checks only fire when the contract actually exposes one of those columns; if not, the existing "no column to derive the count" reason is used instead, so the validator never silently approves a numeric claim against a contract that has no supporting column.

**Acceptance-criteria self-check:**
- [x] Validator returns structured pass/fail (`{ ok, reasons }`) on the unit-test cases listed in step 3 — `web/scripts/tests/validator-pit-stints.test.mjs` now covers five cases: (a) consistent stint/pit-stop counts → ok=true, (b) undercut claim with no position-change rows → ok=false, (c) pit_stops count not matching stints-1 → ok=false, (d) **NEW (audit revision)** claimed pit-stop count not in the contract's derivable set ("5 pit stops" against `{stints: 2, pit_stops: 1}`) → ok=false with a reason that names the asserted count and notes it is not derivable, (e) undercut claim with grid/finish columns → ok=true.
- [x] `web/src/app/api/chat/route.ts` invokes the validator after synthesis and includes the `ValidationResult` in the `appendQueryTrace` payload (asserted by `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs`, which checks both a failure case and a happy path; the test also asserts the validator output does NOT leak into the user-facing response payload).
- [x] No new failures in `bash scripts/loop/test_grading_gate.sh` relative to the baseline at `scripts/loop/state/test_grading_baseline.txt` — wrapper reports `PASS (no new failures vs integration baseline) slice_fails=3 baseline_fails=3 baseline_failures_fixed=0` (exit 0).

**Gate commands (run from repo root, in the order listed in the slice file):**
| # | Command | Exit code |
|---|---|---:|
| 1 | `(cd web && npm run build)` | 0 |
| 2 | `(cd web && npm run typecheck)` | 0 |
| 3 | `bash scripts/loop/test_grading_gate.sh` | 0 |

**Slice-local test runs (sanity, not part of the gate set):**
- `node --test scripts/tests/validator-pit-stints.test.mjs` — 5 pass / 0 fail (was 4 before; the new audit-probe test makes it 5).
- `node --test scripts/tests/validator-pit-stints-route-wiring.test.mjs` — 2 pass / 0 fail.

**Out-of-scope items deliberately not touched:** multi-contract validator payloads (the live synthesis path is single-contract per `web/src/lib/anthropic.ts:35-38`); rejecting answers based on validation failures (this phase logs only); validators for any contract other than pit-stop claims.

## Audit verdict

**Status: REVISE**

- Gate #1 `(cd web && npm run build)` -> exit `0`
- Gate #2 `(cd web && npm run typecheck)` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS; `git diff --name-only integration/perf-roadmap...HEAD` is limited to `diagnostic/slices/08-validators-pit-stints.md`, `web/src/lib/validators/pitStintsValidator.ts`, `web/src/app/api/chat/route.ts`, `web/scripts/tests/validator-pit-stints.test.mjs`, and `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs`.
- Criterion 1 -> FAIL; `validatePitStints` does not verify that a claimed pit-stop count matches contract values, only that related columns exist (`web/src/lib/validators/pitStintsValidator.ts:92`). Audit probe: `validatePitStints("Verstappen made 5 pit stops in this race.", { rows: [{ stints: 2, pit_stops: 1 }] ... })` returned `{"ok":true,"reasons":[]}`.
- Criterion 2 -> PASS; route wiring invokes the validator after synthesis and logs `validators.pitStints` in the trace payload (`web/src/app/api/chat/route.ts:909`, `web/src/app/api/chat/route.ts:1018`, `web/src/app/api/chat/route.ts:1047`), and `node --test web/scripts/tests/validator-pit-stints-route-wiring.test.mjs` exits `0`.
- Criterion 3 -> PASS; `bash scripts/loop/test_grading_gate.sh` exits `0` with no new failures vs `scripts/loop/state/test_grading_baseline.txt`.
- Decision -> REVISE
- Rationale -> The slice goal says every pit-stop claim must be derivable from the attached `FactContract`; unsupported numeric claims currently pass validation.

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
