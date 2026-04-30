---
slice_id: 08-validators-sector-consistency
phase: 8
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T03:01:13Z
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
- `web/scripts/tests/validator-pit-stints.test.mjs` (test-harness precedent)
- `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs` (route-wiring test precedent)

Note: the test-grading baseline file `scripts/loop/state/test_grading_baseline.txt` is intentionally *not* listed above — it lives only in the integration repo (refreshed by `scripts/loop/dispatch_merger.sh` after every merge) and is absent in slice worktrees. The gate wrapper at `scripts/loop/test_grading_gate.sh` handles its absence by falling back to strict-pass mode (lines 61-70 of that script).

Note: Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing".

## Required services / env
None at author time.

## Decisions
- Validator interface is **single-contract**: `(answerText: string, contract: FactContract) → ValidationResult` where `ValidationResult = { ok: boolean; reasons: string[] }`. The live synthesis pipeline (`AnswerSynthesisInput.contract: FactContract` in `web/src/lib/anthropic.ts`, consumed by `buildSynthesisPrompt`) passes exactly one `FactContract`, so the validator follows the same shape. Any multi-contract evolution is explicitly out of scope for this slice.
- Wiring lives in `web/src/app/api/chat/route.ts` (the module that owns synthesis and the `chat_query_trace.jsonl` writer via `appendQueryTrace`), **not** in `web/src/lib/chatRuntime.ts`. The validator runs alongside the existing pit-stints validator at `route.ts:1018-1047`, reusing the same `synthesisContract` capture pattern, and its `ValidationResult` is added to the `appendQueryTrace` payload (e.g. `validators: { pitStints: ..., sectorConsistency: ... }`) so failures land in the trace.
- Failures are non-blocking in this phase: they appear in `chat_query_trace.jsonl` only and do not change the user-facing response payload.
- Validator sources its expected sector values from contract row columns the existing deterministic SQL already produces: `duration_sector_1`/`duration_sector_2`/`duration_sector_3` on lap-grain rows and `best_s1`/`avg_s1`/`best_s2`/`avg_s2`/`best_s3`/`avg_s3` on aggregate sector-summary rows (precedent: `web/src/lib/deterministicSql.ts:685-699,1450-1452`).
- **Claim validation is claim-type-specific, not set-membership.** Each parsed claim is classified by `(kind, sector)` where `kind ∈ {'best', 'avg', 'per_lap', 'fastest'}`, and the asserted value is compared only against the candidate(s) derivable for that kind+sector — never the union across kinds. This prevents the validator from approving a contradictory `average S1` claim that happens to equal `best_s1`, and analogously for S2/S3. A `best`/`fastest` claim that the contract can only support with an `avg_s{i}` column (or vice-versa) must fail with a reason naming the missing derivation.
- **`per_lap` claims must be validated against the named lap specifically.** A `per_lap` claim with `lapNumber: N` is checked only against the contract row whose `lap_number === N`. The validator MUST NOT fall back to any other row's `duration_sector_{i}` for a `per_lap` claim — otherwise `lap N S{i}` claims could be falsely approved by an unrelated lap that happens to share the asserted value. Missing lap-N row, missing `lap_number` field on contract rows, and a matched lap-N row that lacks `duration_sector_{i}` each fail with a distinct lap-specific derivation reason.

## Steps
1. Define the validator interface in `web/src/lib/validators/sectorConsistencyValidator.ts`:
   `validateSectorConsistency(answerText: string, contract: FactContract): ValidationResult` where
   `ValidationResult = { ok: boolean; reasons: string[] }`. Use only type-only imports of `FactContract` from `@/lib/contracts/factContract` so the test transpile path does not require runtime stubs (matches the `chatRuntime-synthesis-payload.test.mjs` precedent and the sibling `pitStintsValidator.ts`).
2. Implement the validator with **claim-type-specific** matching (not flat set-membership). Parse each sector-time claim in `answerText` into a typed claim `{ kind: 'best' | 'avg' | 'per_lap' | 'fastest', sector: 1 | 2 | 3, value: number, lapNumber?: number }` via regexes covering at least: `best S{i}` / `S{i} best` / `fastest sector {i}` (→ `kind: 'best'` or `'fastest'`, treated equivalently), `average S{i}` / `avg S{i}` / `mean S{i}` (→ `kind: 'avg'`), and `S{i} (was|on) lap N` / `lap N S{i}` (→ `kind: 'per_lap'` with `lapNumber: N`). For each parsed claim, derive the **kind-specific** candidate set from `contract.rows` and compare with ±0.05s tolerance:
   - `best`/`fastest` for sector i → `best_s{i}` if any row has it, else `min(duration_sector_{i})` across rows that have it. If neither is present, fail with reason `"no best_s{i} or duration_sector_{i} column to derive best from"`.
   - `avg` for sector i → `avg_s{i}` if any row has it, else `mean(duration_sector_{i})` across rows that have it. If neither is present (e.g. the contract carries only `best_s{i}`), the validator MUST NOT fall back to the best set — it must fail with reason `"no avg_s{i} or duration_sector_{i} column to derive average from"`.
   - `per_lap` for sector i with `lapNumber: N` → the row whose `lap_number === N`'s `duration_sector_{i}`. The validator MUST NOT fall back to any other row's `duration_sector_{i}` for a `per_lap` claim. Specifically: if the contract rows lack a `lap_number` field on every row, fail with reason `"contract rows lack lap_number; cannot validate per-lap claim for S{i}"`; if `lap_number` exists but no row matches `lap_number === N`, fail with reason `"no lap {N} row to derive per-lap S{i} from"`; if the matched lap-N row lacks `duration_sector_{i}`, fail with reason `"lap {N} row has no duration_sector_{i} column"`.
   Mismatch (claim value not within ±0.05s of any candidate in the kind-specific set) → `ok=false` with a reason naming the claim kind, sector index, asserted value, and the derivation it was checked against. If the contract exposes no sector columns at all (no `best_s*`, `avg_s*`, or `duration_sector_*` on any row) and the answer makes any sector claim, return `ok=false` with the umbrella reason `"no sector column to derive from"` (precedent: `pitStintsValidator.ts` "no column to derive" path). Approach otherwise mirrors `pitStintsValidator.ts`.
3. Add unit tests at `web/scripts/tests/validator-sector-consistency.test.mjs` using the live transpile-and-import harness:
   - Use `typescript`'s `ts.transpileModule` (precedent: `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs:39-53`) to transpile `web/src/lib/validators/sectorConsistencyValidator.ts` to a temp `.mjs` and dynamic-import it.
   - Because the validator only has type-only imports of `FactContract`, no `@/lib/*` rewrites are required (TypeScript erases type-only imports during transpile). If any runtime `@/lib/*` import is added later, the test must add explicit stubs for each (precedent: `web/scripts/tests/answer-cache.test.mjs:170-193`).
   - Cover at least: (a) **pass** — answer claims a best S1 of `25.123s` against a contract row with `best_s1: 25.123` → `ok=true`; (b) **fail** — answer claims `S2 was 30.000s` but the contract's `duration_sector_2`/`best_s2` set does not contain a value within tolerance → `ok=false` with a reason naming the asserted value; (c) **fail** — answer makes a sector claim against a contract that exposes no `duration_sector_*` / `best_s*` / `avg_s*` columns → `ok=false` with the "no sector column to derive from" reason; (d) **pass** — answer makes no sector claim at all (e.g. "Verstappen finished P1") against a contract with no sector columns → `ok=true` (validator must not synthesize false positives); (e) **fail (claim-type-specific)** — answer claims `average S1 was 25.123s` against a contract row with `best_s1: 25.123, avg_s1: 26.500` → `ok=false` with a reason naming `kind=avg, sector=1` and the asserted value, proving an `avg` claim is NOT approved by the `best` column; (f) **pass (claim-type-specific)** — answer claims `average S1 was 26.500s` against the same contract row (`best_s1: 25.123, avg_s1: 26.500`) → `ok=true`, proving the `avg` candidate is the `avg_s1` column; (g) **fail (missing avg derivation)** — answer claims `average S2 was 30.000s` against a contract that exposes only `best_s2: 30.000` (no `avg_s2`, no `duration_sector_2`) → `ok=false` with the reason `"no avg_s2 or duration_sector_2 column to derive average from"`, proving the validator does not silently fall back to the best set for an avg claim; (h) **fail (per_lap missing named lap)** — answer claims `S1 on lap 12 was 25.500s` against a contract whose only sector-bearing rows have `lap_number: 10` and `lap_number: 11` (each row carries `duration_sector_1`, but no row matches `lap_number === 12`) → `ok=false` with the reason `"no lap 12 row to derive per-lap S1 from"`, proving a `per_lap` claim does not silently fall back to any other row's `duration_sector_1`.
4. Wire the validator into `web/src/app/api/chat/route.ts` immediately after the existing pit-stints validator invocation (`route.ts:1018-1020`) and before the `appendQueryTrace(...)` call (`route.ts:1021-1048`), reusing the same `synthesisContract` capture: declare `const sectorConsistencyValidation: SectorConsistencyValidationResult | null = synthesisContract ? validateSectorConsistency(answer, synthesisContract) : null;` and extend the trace payload's `validators` field to `validators: { pitStints: pitStintsValidation, sectorConsistency: sectorConsistencyValidation }`. Do not change the user-facing response payload — failures are logged only. Repeat the pattern for any other `appendQueryTrace` call sites that the existing pit-stints validator already covers (in this slice the wiring is limited to the success path that already runs the pit-stints validator at `route.ts:1018-1047`; other trace writers in the file remain untouched, matching the pit-stints precedent).
5. Extend the existing route-harness test pattern to assert wiring: add a new test file `web/scripts/tests/validator-sector-consistency-route-wiring.test.mjs` that reuses the `validator-pit-stints-route-wiring.test.mjs` route-stub scaffolding (precedent: `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs:1-end` and `web/scripts/tests/answer-cache.test.mjs:170-193`) — including stubs for every `@/lib/*` import touched by `route.ts` plus a rewrite of `@/lib/validators/sectorConsistencyValidator` that points at the real transpiled validator module. **Logging is asserted against captured `appendJsonLog` payloads, not a real on-disk file** — the `serverLog.stub.mjs` (precedent: `validator-pit-stints-route-wiring.test.mjs:112-123`) records every `appendJsonLog(filename, payload)` call into an in-memory queue exposed via `__getJsonLogCalls()`; the test filters that queue for `filename === "chat_query_trace.jsonl"` and inspects the recorded `payload` objects directly (precedent: `validator-pit-stints-route-wiring.test.mjs:312-321,365-385`). For a fixture answer that makes a deliberately wrong sector claim against a sector-bearing contract, assert that the latest captured `chat_query_trace.jsonl` payload contains both `validators.pitStints` (preserved from the prior slice) and `validators.sectorConsistency` with `ok=false` and a non-empty `reasons` array. A second test case must assert a happy-path fixture surfaces `validators.sectorConsistency.ok=true` in the same captured payload. The test must also assert that the validator output does NOT leak into the user-facing response payload (matches the pit-stints precedent at `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs:387-397`).

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
- [ ] Validator returns structured pass/fail (`{ ok, reasons }`) on the eight unit-test cases listed in step 3 — including cases (e), (f), (g) which prove claim-type-specific matching (a `best` claim is NOT approved by an `avg` column and vice-versa) and case (h) which proves a `per_lap` claim does not silently fall back to a non-matching lap row (`web/scripts/tests/validator-sector-consistency.test.mjs` exits `0` under `node --test`).
- [ ] `web/src/app/api/chat/route.ts` invokes `validateSectorConsistency` after synthesis and includes the `ValidationResult` in the `appendQueryTrace` payload as `validators.sectorConsistency`. **Logging is proven testable** by `web/scripts/tests/validator-sector-consistency-route-wiring.test.mjs`, which (i) inspects the in-memory `appendJsonLog` capture queue exposed by the test's `serverLog.stub.mjs` via `__getJsonLogCalls()` (precedent: `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs:112-123,312-321`), (ii) filters that queue for entries with `filename === "chat_query_trace.jsonl"` and selects the latest `payload`, and (iii) asserts the payload contains `validators.sectorConsistency.ok === false` with a non-empty `reasons` array on the failure-case fixture and `validators.sectorConsistency.ok === true` on the happy-path fixture (mirrors the pit-stints route-wiring assertion at `web/scripts/tests/validator-pit-stints-route-wiring.test.mjs:365-385,427-433`).
- [ ] No new failures in `bash scripts/loop/test_grading_gate.sh` (the wrapper diffs against the integration baseline file `scripts/loop/state/test_grading_baseline.txt` when present, or falls back to strict-pass mode if absent — see `scripts/loop/test_grading_gate.sh:61-70`).

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
- [x] Replace or remove `scripts/loop/state/test_grading_baseline.txt` from `## Prior context`; the path does not exist in this worktree, so the slice's required-reading block is currently not satisfiable.
- [x] Reconcile Step 5 and the logging acceptance criterion with the cited `validator-pit-stints-route-wiring` precedent: either assert against captured `appendJsonLog` payloads as that harness does, or explicitly plan a file-backed logger stub and direct file reads instead of saying the test reads a real `chat_query_trace.jsonl` line.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T02:34:51Z, so the state context is current.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Tighten Step 2 and the corresponding tests so claim validation is claim-type-specific, not just "value appears somewhere in the sector numeric set": `best S1` / `fastest sector 1` must match `best_s1` (or the min of `duration_sector_1`), `average S1` must match `avg_s1` (or the mean of `duration_sector_1` if that is the intended derivation), and analogous rules must hold for S2/S3; otherwise the validator will falsely approve contradictory best-vs-average sector claims. — Step 2 now parses each claim into a typed `{kind, sector, value}` and derives a kind-specific candidate set (best/fastest → `best_s{i}`/min(`duration_sector_{i}`); avg → `avg_s{i}`/mean(`duration_sector_{i}`); per_lap → matched-row `duration_sector_{i}`); a `best`-only contract MUST fail an `avg` claim with `"no avg_s{i} or duration_sector_{i} column to derive average from"` (no fallback). Step 3 adds tests (e), (f), (g) covering the contradictory-best-vs-average case and the missing-avg-derivation case; acceptance criterion updated to reference seven cases. New Decisions bullet codifies the "claim-type-specific, not set-membership" rule.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T02:34:51Z, so the state context is current.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Revise Step 2 so a `per_lap` sector claim only passes when the contract can validate the named lap specifically: if `lap_number` is absent or no row matches `lap_number === N`, fail with a lap-specific derivation reason instead of falling back to any row's `duration_sector_{i}`; otherwise `lap N S{i}` claims can be falsely approved by unrelated laps ([diagnostic/slices/08-validators-sector-consistency.md](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-sector-consistency/diagnostic/slices/08-validators-sector-consistency.md:47)). — Step 2 `per_lap` rule now requires a `lap_number === N` row match with three distinct failure reasons (no `lap_number` field, no matching lap, matched row missing `duration_sector_{i}`); explicit "MUST NOT fall back" guarantee added. New Decisions bullet codifies the per-lap strictness rule. Step 3 adds test case (h) covering the missing-lap fallback case; acceptance criterion updated to reference eight cases.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T02:34:51Z, so the state context is current.
