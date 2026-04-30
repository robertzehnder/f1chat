---
slice_id: 08-validators-sector-consistency
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T02:41:55Z
---

## Goal
Add a synthesis-output validator: every claim about sector times in the answer must be consistent with the `FactContract` attached to the synthesis prompt (the live single-contract path; multi-contract payloads are out of scope).

## Inputs
- `web/src/app/api/chat/route.ts` (synthesis call sites at `buildSynthesisContract()` / `cachedSynthesize()` / `synthesizeAnswerStream()` and the `appendQueryTrace` `chat_query_trace.jsonl` writer; precedent for sibling validator wiring at `route.ts:1018-1047`)
- `web/src/lib/anthropic.ts` (`AnswerSynthesisInput.contract: FactContract` — the single-contract shape this slice targets)
- `web/src/lib/synthesis/buildSynthesisPrompt.ts`
- `web/src/lib/contracts/factContract.ts` (`FactContract` type definition the validator consumes via type-only import)
- `web/src/lib/validators/pitStintsValidator.ts` (precedent validator from sibling slice `08-validators-pit-stints`)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- `scripts/loop/test_grading_gate.sh`
- `scripts/loop/state/test_grading_baseline.txt`
- `web/scripts/tests/validator-pit-stints.test.mjs` (test-harness precedent)
- `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs` (route-wiring test precedent)

Note: Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing".

## Required services / env
None at author time.

## Decisions
- Validator interface is **single-contract**: `(answerText: string, contract: FactContract) → ValidationResult` where `ValidationResult = { ok: boolean; reasons: string[] }`. The live synthesis pipeline (`AnswerSynthesisInput.contract: FactContract` in `web/src/lib/anthropic.ts`, consumed by `buildSynthesisPrompt`) passes exactly one `FactContract`, so the validator follows the same shape. Any multi-contract evolution is explicitly out of scope for this slice.
- Wiring lives in `web/src/app/api/chat/route.ts` (the module that owns synthesis and the `chat_query_trace.jsonl` writer via `appendQueryTrace`), **not** in `web/src/lib/chatRuntime.ts`. The validator runs alongside the existing pit-stints validator at `route.ts:1018-1047`, reusing the same `synthesisContract` capture pattern, and its `ValidationResult` is added to the `appendQueryTrace` payload (e.g. `validators: { pitStints: ..., sectorConsistency: ... }`) so failures land in the trace.
- Failures are non-blocking in this phase: they appear in `chat_query_trace.jsonl` only and do not change the user-facing response payload.
- Validator sources its expected sector values from contract row columns the existing deterministic SQL already produces: `duration_sector_1`/`duration_sector_2`/`duration_sector_3` on lap-grain rows and `best_s1`/`avg_s1`/`best_s2`/`avg_s2`/`best_s3`/`avg_s3` on aggregate sector-summary rows (precedent: `web/src/lib/deterministicSql.ts:685-699,1450-1452`).

## Steps
1. Define the validator interface in `web/src/lib/validators/sectorConsistencyValidator.ts`:
   `validateSectorConsistency(answerText: string, contract: FactContract): ValidationResult` where
   `ValidationResult = { ok: boolean; reasons: string[] }`. Use only type-only imports of `FactContract` from `@/lib/contracts/factContract` so the test transpile path does not require runtime stubs (matches the `chatRuntime-synthesis-payload.test.mjs` precedent and the sibling `pitStintsValidator.ts`).
2. Implement the validator: detect sector-time claims in `answerText` (best/average sector value, "S1/S2/S3 was X.XXXs", "fastest sector N", per-lap sector durations) and assert each numeric claim is derivable from the contract's per-lap (`duration_sector_1/2/3`) or aggregate (`best_s1`/`avg_s1`/etc.) columns. Approach mirrors `pitStintsValidator.ts`: collect the derivable numeric set per sector from `contract.rows` (with reasonable rounding tolerance, e.g. ±0.05s to absorb display-formatting), and flag any asserted sector value that is not in that set. If the contract exposes no sector columns at all, the validator must return a "no sector column to derive from" reason instead of silently approving (precedent: `pitStintsValidator.ts` "no column to derive" path).
3. Add unit tests at `web/scripts/tests/validator-sector-consistency.test.mjs` using the live transpile-and-import harness:
   - Use `typescript`'s `ts.transpileModule` (precedent: `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs:39-53`) to transpile `web/src/lib/validators/sectorConsistencyValidator.ts` to a temp `.mjs` and dynamic-import it.
   - Because the validator only has type-only imports of `FactContract`, no `@/lib/*` rewrites are required (TypeScript erases type-only imports during transpile). If any runtime `@/lib/*` import is added later, the test must add explicit stubs for each (precedent: `web/scripts/tests/answer-cache.test.mjs:170-193`).
   - Cover at least: (a) **pass** — answer claims a best S1 of `25.123s` against a contract row with `best_s1: 25.123` → `ok=true`; (b) **fail** — answer claims `S2 was 30.000s` but the contract's `duration_sector_2`/`best_s2` set does not contain a value within tolerance → `ok=false` with a reason naming the asserted value; (c) **fail** — answer makes a sector claim against a contract that exposes no `duration_sector_*` / `best_s*` / `avg_s*` columns → `ok=false` with the "no sector column to derive from" reason; (d) **pass** — answer makes no sector claim at all (e.g. "Verstappen finished P1") against a contract with no sector columns → `ok=true` (validator must not synthesize false positives).
4. Wire the validator into `web/src/app/api/chat/route.ts` immediately after the existing pit-stints validator invocation (`route.ts:1018-1020`) and before the `appendQueryTrace(...)` call (`route.ts:1021-1048`), reusing the same `synthesisContract` capture: declare `const sectorConsistencyValidation: SectorConsistencyValidationResult | null = synthesisContract ? validateSectorConsistency(answer, synthesisContract) : null;` and extend the trace payload's `validators` field to `validators: { pitStints: pitStintsValidation, sectorConsistency: sectorConsistencyValidation }`. Do not change the user-facing response payload — failures are logged only. Repeat the pattern for any other `appendQueryTrace` call sites that the existing pit-stints validator already covers (in this slice the wiring is limited to the success path that already runs the pit-stints validator at `route.ts:1018-1047`; other trace writers in the file remain untouched, matching the pit-stints precedent).
5. Extend the existing route-harness test pattern to assert wiring: add a new test file `web/scripts/tests/validator-sector-consistency-route-wiring.test.mjs` that reuses the `validator-pit-stints-route-wiring.test.mjs` route-stub scaffolding (precedent: `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs:1-end` and `web/scripts/tests/answer-cache.test.mjs:170-193`) — including stubs for every `@/lib/*` import touched by `route.ts` plus a rewrite of `@/lib/validators/sectorConsistencyValidator` that points at the real transpiled validator module. The test must assert, for a fixture answer that makes a deliberately wrong sector claim against a sector-bearing contract, that the resulting `chat_query_trace.jsonl` line contains both `validators.pitStints` (preserved from the prior slice) and `validators.sectorConsistency` with `ok=false` and a non-empty `reasons` array. A second test case must assert a happy-path fixture surfaces `validators.sectorConsistency.ok=true`. The test must also assert that the validator output does NOT leak into the user-facing response payload (matches the pit-stints precedent at `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs`).

## Changed files expected
- `web/src/lib/validators/sectorConsistencyValidator.ts` (new validator module)
- `web/src/app/api/chat/route.ts` (add `validateSectorConsistency` invocation after the pit-stints validator and extend the `appendQueryTrace` `validators` payload)
- `web/scripts/tests/validator-sector-consistency.test.mjs` (validator unit tests, transpile-and-import harness)
- `web/scripts/tests/validator-sector-consistency-route-wiring.test.mjs` (route-harness test asserting validator runs and surfaces in `chat_query_trace.jsonl`; extends the `validator-pit-stints-route-wiring.test.mjs` stub pattern)

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
- [ ] Validator returns structured pass/fail (`{ ok, reasons }`) on the four unit-test cases listed in step 3 (`web/scripts/tests/validator-sector-consistency.test.mjs` exits `0` under `node --test`).
- [ ] `web/src/app/api/chat/route.ts` invokes `validateSectorConsistency` after synthesis and includes the `ValidationResult` in the `appendQueryTrace` payload as `validators.sectorConsistency`. **Logging is proven testable** by `web/scripts/tests/validator-sector-consistency-route-wiring.test.mjs`, which (i) reads the trace file written by the route-harness invocation, (ii) parses the last `chat_query_trace.jsonl` line, and (iii) asserts the parsed object contains `validators.sectorConsistency.ok === false` with a non-empty `reasons` array on the failure-case fixture and `validators.sectorConsistency.ok === true` on the happy-path fixture (mirrors the pit-stints route-wiring assertion at `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs:318-366`).
- [ ] No new failures in `bash scripts/loop/test_grading_gate.sh` relative to the baseline at `scripts/loop/state/test_grading_baseline.txt`.

## Out of scope
- Multi-contract validator payloads (the live synthesis path is single-contract per `web/src/lib/anthropic.ts:35-38`).
- Rejecting answers based on validation failures (this phase logs only).
- Validators for any contract other than sector-time claims (pit-stints validator already exists from sibling slice).
- Sharing a `ValidationResult` type across validators (the pit-stints validator defines its own local type; this slice follows the same per-validator-local-type pattern; see `Low`/Decisions).

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
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the plan uses the required baseline-aware grading gate wrapper.
- [x] Add `web/src/lib/chatRuntime.ts` to `Changed files expected`; Step 4 explicitly wires the validator into the synthesis post-step there. — Re-scoped per pit-stints precedent: the synthesis post-step + `chat_query_trace.jsonl` writer live in `web/src/app/api/chat/route.ts`, not `web/src/lib/chatRuntime.ts`. Step 4 and `Changed files expected` now name `web/src/app/api/chat/route.ts` and document this choice in `## Decisions`.
- [x] Rewrite `## Prior context` so every bullet is a concrete artifact path; `Latest healthcheck artifact under diagnostic/artifacts/healthcheck/` and `Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing"` are not concrete paths an auditor can read.
- [x] Make the logging acceptance criterion testable by naming the concrete test or gate assertion that proves validator failures surface in `chat_query_trace.jsonl`, not just that the post-step runs.

### Low
- [x] Consider broadening `Changed files expected` to mention any contract/type module under `web/src/lib/contracts/` if the validator interface or attached contract shape must be shared rather than kept local. — Decision: keep `ValidationResult` local to the validator file (matches the pit-stints precedent's `PitStintsValidationResult` declared in `web/src/lib/validators/pitStintsValidator.ts`); no new module under `web/src/lib/contracts/` is required because the validator imports `FactContract` type-only and re-uses the already-merged contract type. Out-of-scope item added to make this explicit.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T02:34:51Z, so the state context is current.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [ ] Replace or remove `scripts/loop/state/test_grading_baseline.txt` from `## Prior context`; the path does not exist in this worktree, so the slice's required-reading block is currently not satisfiable.
- [ ] Reconcile Step 5 and the logging acceptance criterion with the cited `validator-pit-stints-route-wiring` precedent: either assert against captured `appendJsonLog` payloads as that harness does, or explicitly plan a file-backed logger stub and direct file reads instead of saying the test reads a real `chat_query_trace.jsonl` line.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T02:34:51Z, so the state context is current.
