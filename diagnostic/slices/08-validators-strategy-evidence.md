---
slice_id: 08-validators-strategy-evidence
phase: 8
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T09:27:08-04:00
---

## Goal
Validator: every strategy-decision claim in the synthesized answer must reference a backing row in the synthesis `FactContract` (built at `web/src/app/api/chat/route.ts:69` from `runtime.queryPlan.primary_tables[0]`). The validator is contract-source-agnostic — for strategy questions today the primary table is `core.strategy_summary` (per `web/src/lib/chatRuntime.ts:939`/`968`), and `core.strategy_evidence_summary` may or may not be present; the validator must work against whichever contract the route builds, mirroring how `validateGridFinish` operates on `grid_position` / `finish_position` columns regardless of which table populated them. Reordering `primary_tables[0]` to prefer `strategy_evidence_summary` is explicitly out of scope.

## Inputs
- `web/src/app/api/chat/route.ts` (synthesis post-step where peer validators already run)
- `web/src/lib/validators/gridFinishValidator.ts` (peer-pattern reference)
- `web/src/lib/validators/pitStintsValidator.ts` (peer-pattern reference)
- `web/src/lib/contracts/`
- `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` (route-wiring harness reference)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md`
- Phase 11 redo will re-baseline; this slice's bar is just "validator runs and asserts the obvious thing"

## Required services / env
None at author time.

## Steps
1. Define the validator interface in `web/src/lib/validators/strategyEvidenceValidator.ts` matching the peer signature used by `validateGridFinish` / `validatePitStints` / `validateSectorConsistency`: `(answerText: string, contract: FactContract) → StrategyEvidenceValidationResult` where `StrategyEvidenceValidationResult = { ok: boolean; reasons: string[] }` (identical shape to `GridFinishValidationResult` in `web/src/lib/validators/gridFinishValidator.ts`). The validator never receives a "contract absent" case — that is handled at the route layer in Step 4 by passing `null` into the trace, mirroring how peers handle a missing `synthesisContract`.
2. Implement the validator. The contract input is the synthesis `FactContract` already built at `web/src/app/api/chat/route.ts` and passed to peer validators — its `contractName` is whatever `runtime.queryPlan.primary_tables[0]` was for the question (for strategy questions today: `core.strategy_summary`; the validator does not require `core.strategy_evidence_summary` specifically). Each parsed claim carries a `driverToken` (a capitalized name extracted from the answer text, the same pattern peers use). Resolve every strategy-decision claim against the **specific contract row whose driver name matches the claim's `driverToken`**, mirroring the peer pattern at `web/src/lib/validators/gridFinishValidator.ts:93` (`findRowByDriverToken`): port that helper (matching on `driver_name` / `full_name` / `name` columns and tolerating last-name-only tokens by splitting the contract row's name on whitespace/`-`/`'`) into the strategy validator and use it before any column lookup. If no row in `contract.rows` matches the claim's `driverToken`, push a reason like `kind=<claim_kind>, driver=<token>: no contract row matches this driver` and treat the claim as unsupported — never silently fall back to "any row in the contract." Recognize the following columns as strategy-evidence-bearing, mapping each to the claim categories it can back, and check them on the resolved driver's row only:
   - From `core.strategy_summary` (per `sql/007_semantic_summary_contracts.sql:206-236`, where each row is driver-grained via `driver_number` / `driver_name` / `team_name` at lines 214-216): `pit_laps` (an array of pit-stop lap numbers — backs lap-level pit claims and per-pit-event claims), `pit_stop_count` (backs total-stop-count and "X-stop" claims), `strategy_type` (backs strategy-name claims like "one-stop"/"two-stop"/"no-stop"), `compounds_used` (backs tyre-compound claims), `total_pit_duration_seconds` (backs aggregate pit-time claims).
   - From `core.strategy_evidence_summary` when present: `lap_number`, `event_type`, `decision_kind`, `pit_lap` (per-event row columns — back per-event claims). When this contract is row-per-event rather than row-per-driver, restrict the candidate rows for a given claim to those whose `driver_number` / `driver_name` matches the claim's `driverToken` before checking any evidence columns.
   For each parsed strategy-decision claim in the answer text, after resolving the matching driver's row, look up at least one column from the recognized set above on that row that supports the claim (e.g. a "Verstappen stopped on lap 18" claim is backed only when Verstappen's row has `pit_laps` containing `18`; a "Verstappen ran a two-stop strategy" claim is backed only when Verstappen's row has `strategy_type === 'Two-stop strategy'` or `pit_stop_count === 2`). Another driver's row carrying matching evidence MUST NOT back the claim. Return `{ ok: false, reasons: [...] }` naming each unsupported claim (including the claim's `driverToken` in each reason), otherwise `{ ok: true, reasons: [] }`. When the answer contains no strategy-decision claims, return `{ ok: true, reasons: [] }` (vacuously ok, matching peer behavior on questions outside their pattern). When the contract has no rows or none of its columns appear in the recognized evidence-bearing set above, treat *every* parsed strategy-decision claim as unsupported and return `{ ok: false, reasons: [...] }` listing them — the validator must not silently pass on a missing-evidence contract. (For today's `core.strategy_summary` primary table this branch will rarely fire because the recognized set above covers its main columns; the branch primarily protects against future contracts that lack any evidence columns.)
3. Add unit tests in `web/scripts/tests/validator-strategy-evidence.test.mjs` covering: (a) `{ ok: true, reasons: [] }` for an answer with no strategy-decision claims, (b) `{ ok: true, reasons: [] }` for an answer whose strategy claims are all backed by the matching driver's contract row — concretely, supply a `core.strategy_summary`-shaped contract with a single Verstappen row carrying `driver_name: 'Max Verstappen'`, `pit_laps: [18, 41]`, `pit_stop_count: 2`, `strategy_type: 'Two-stop strategy'` and assert that answers like "Verstappen ran a two-stop strategy, pitting on laps 18 and 41" return `ok: true` (this anchors the recognition list from Step 2 against the realistic primary-table shape), (c) `{ ok: false, reasons: [...non-empty] }` for an answer with at least one unsupported strategy claim against the same `core.strategy_summary`-shaped contract (e.g. asserts a pit on lap 25 not present in `pit_laps`, or a "three-stop strategy" against a `strategy_type` of `'Two-stop strategy'`), (d) `{ ok: false, reasons: [...non-empty] }` for an answer with strategy-decision claims against a contract whose rows lack ALL recognized evidence-bearing columns — i.e. a contract that carries only non-strategy columns (e.g. `driver_number`, `team_name`, `total_stints`) and none of `pit_laps` / `pit_stop_count` / `strategy_type` / `compounds_used` / `total_pit_duration_seconds` / `lap_number` / `event_type` / `decision_kind` / `pit_lap`, and (e) **driver-binding test**: `{ ok: false, reasons: [...non-empty] }` for a multi-row `core.strategy_summary`-shaped contract carrying TWO driver rows — Verstappen with `pit_laps: [18, 41]`, `pit_stop_count: 2`, `strategy_type: 'Two-stop strategy'` and Hamilton with `pit_laps: [22]`, `pit_stop_count: 1`, `strategy_type: 'One-stop strategy'` — against an answer that says "Hamilton ran a two-stop strategy, pitting on laps 18 and 41". The validator must FAIL this case (Hamilton's claim cannot be backed by Verstappen's row) and the returned `reasons` must include the `Hamilton` driverToken (e.g. a substring match against `'Hamilton'` in at least one reason); also assert that swapping the answer's claim to "Verstappen ran a one-stop strategy, pitting on lap 22" still fails for the same reason (Verstappen's row contradicts; Hamilton's row must not back it). Test (d) protects the missing-evidence branch from Step 2; it does NOT use a real `core.strategy_summary` shape because that shape always carries `pit_laps` / `pit_stop_count` / `strategy_type` and would be exercised by tests (b)/(c) instead. Test (e) protects the driver-row binding requirement from Step 2: without per-driver row resolution, a naïve "any row that has matching evidence backs the claim" implementation would pass this case. The "contract absent" case (`synthesisContract === null`) is exercised by the route-wiring test in Step 5 (which adds an explicit null-contract pass through the route), not by this unit suite, because the validator's signature requires `contract: FactContract`.
4. Wire the validator into the **route-layer synthesis post-step** at `web/src/app/api/chat/route.ts` near lines 1026–1062, alongside the existing `validatePitStints` / `validateSectorConsistency` / `validateGridFinish` invocations using the same null-guard pattern (`synthesisContract ? validateStrategyEvidence(answer, synthesisContract) : null`). Add a `strategyEvidence` field to the `validators` payload of the `appendQueryTrace({...})` call so failures surface in `chat_query_trace.jsonl`. Validation failures must remain **non-blocking**: the route still returns `status: 200` with the unchanged synthesized `answer` / `answerReasoning`, and the validator payload appears only in the trace — the user-facing response body must not gain a `validators` / `strategyEvidence` field. (The validator does not run inside `buildChatRuntime` — that returns planning metadata only and never sees the synthesized answer text.)
5. Add `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs` mirroring the structure of `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` (and the analogous pit-stints / sector-consistency harnesses): import `route.ts`, replace `@/lib/chatRuntime` with the existing `chatRuntime.stub.mjs` and inject a fake runtime whose `questionType` triggers the strategy-evidence validator, transpile-and-import the real `strategyEvidenceValidator.ts` (do **not** stub it), drive a synthesized answer with an unsupported strategy claim through the route, and assert all of the following on that fail-case request:
   - the captured `chat_query_trace.jsonl` payload's `validators.strategyEvidence` field has `ok: false` and a non-empty `reasons` array;
   - the HTTP response status is `200` (validator failure is non-blocking);
   - the user-facing response body's `answer` matches the synthesized text verbatim (validator failure does not rewrite the answer);
   - the user-facing response body has no `validators` and no `strategyEvidence` keys at any level (the validator payload stays in the trace only).
   Then add a parallel pass-case request and assert the trace payload's `validators.strategyEvidence` field is `{ ok: true, reasons: [] }`. Then add a third **null-contract case**: drive a request whose injected fake runtime returns `synthesisContract: null` (or omits it) so the route's `synthesisContract ? validateStrategyEvidence(...) : null` guard short-circuits, and assert that the captured trace payload's `validators.strategyEvidence` field is `null` (matching the null-guard's output) and that the route still returns HTTP 200 with the unchanged synthesized `answer`. Add a fourth **driver-binding mismatch case**: drive a request whose fake runtime returns a `core.strategy_summary`-shaped `synthesisContract` with TWO driver rows (Verstappen with `pit_laps: [18, 41]`, `pit_stop_count: 2`, `strategy_type: 'Two-stop strategy'` and Hamilton with `pit_laps: [22]`, `pit_stop_count: 1`, `strategy_type: 'One-stop strategy'`) and a synthesized `answer` of "Hamilton ran a two-stop strategy, pitting on laps 18 and 41", and assert that the captured trace payload's `validators.strategyEvidence.ok === false`, that at least one entry in `reasons` mentions `Hamilton` (substring match), that HTTP status is `200`, and that the response body's `answer` is unchanged. This case proves the route-layer wiring carries the per-driver binding through (not just the unit suite). The harness must therefore exercise the route-layer wiring added in Step 4 — not just the validator function in isolation — across all four branches (fail, pass, null-contract, driver-binding-mismatch).

## Changed files expected
- `web/src/lib/validators/strategyEvidenceValidator.ts` (new)
- `web/src/app/api/chat/route.ts` (import validator, invoke alongside peers near line 1026, add `strategyEvidence` field to `appendQueryTrace`'s `validators` payload near line 1061)
- `web/scripts/tests/validator-strategy-evidence.test.mjs` (new)
- `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs` (new)
- `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` and the pit-stints / sector-consistency route-wiring harnesses are NOT modified — Step 5 mirrors their structure but does not edit them.

## Artifact paths
None.

## Gate commands
```bash
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
```
Each `web` command runs inside its own subshell so the parent shell stays at repo root, ensuring the final `bash scripts/loop/test_grading_gate.sh` invocation resolves against the repo-root path.

## Acceptance criteria
- [ ] Validator returns `{ ok: boolean; reasons: string[] }` (matching the peer `GridFinishValidationResult` / `PitStintsValidationResult` / `SectorConsistencyValidationResult` shape) on all five unit-test cases in `web/scripts/tests/validator-strategy-evidence.test.mjs`: (a) vacuously-ok (no strategy claims), (b) supported-claims against a single-row `core.strategy_summary`-shaped contract carrying `driver_name` / `pit_laps` / `pit_stop_count` / `strategy_type`, (c) unsupported-claim against the same `core.strategy_summary`-shaped contract, (d) all-claims-unsupported against a contract whose rows lack every recognized evidence-bearing column (`pit_laps` / `pit_stop_count` / `strategy_type` / `compounds_used` / `total_pit_duration_seconds` / `lap_number` / `event_type` / `decision_kind` / `pit_lap`), and (e) **driver-binding fail**: a multi-row `core.strategy_summary`-shaped contract (Verstappen + Hamilton with distinct strategies) where an answer attributes one driver's evidence to the other driver — the validator must return `ok: false` with at least one `reasons` entry naming the mis-attributed driverToken, even though the contract contains a row whose evidence would superficially match the claim.
- [ ] The route-layer synthesis post-step in `web/src/app/api/chat/route.ts` invokes `validateStrategyEvidence` alongside the peer validators using the same `synthesisContract ? ... : null` guard, and emits a `validators.strategyEvidence` entry in the `chat_query_trace.jsonl` payload.
- [ ] `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs` drives a request through the real `route.ts` (with `chatRuntime` stubbed via the existing `chatRuntime.stub.mjs` pattern and the real `strategyEvidenceValidator.ts` transpiled), and asserts that an unsupported strategy claim surfaces as `validators.strategyEvidence.ok === false` with a non-empty `reasons` array in the captured trace entry.
- [ ] The same route-wiring test asserts that on validator failure the route stays non-blocking: HTTP status `200`, the response body's `answer` is unchanged from the synthesized text, and the response body contains no `validators` or `strategyEvidence` keys at any level (validator output is trace-only).
- [ ] The route-wiring test also covers the null-contract branch: a request whose fake runtime returns `synthesisContract: null` causes the captured trace's `validators.strategyEvidence` to be `null` (the route's guard short-circuits) and the route still returns HTTP 200 with unchanged synthesized `answer`.
- [ ] The route-wiring test also covers the **driver-binding mismatch branch**: a request whose fake runtime returns a multi-row `core.strategy_summary`-shaped contract (Verstappen + Hamilton with distinct strategies) and a synthesized `answer` attributing one driver's evidence to the other surfaces `validators.strategyEvidence.ok === false` in the captured trace, with at least one `reasons` entry containing the mis-attributed driver's token (substring match against e.g. `'Hamilton'`); HTTP status remains `200` and the response body's `answer` is unchanged.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/08-validators-strategy-evidence`
**Implementation commit:** `09549b2` (`slice 08-validators-strategy-evidence: validator + route wiring + tests`)

### Changed files (matches "Changed files expected")
- `web/src/lib/validators/strategyEvidenceValidator.ts` (new — 319 lines)
- `web/src/app/api/chat/route.ts` (+9 / -1; import added near peer validators, invocation added at line 1035 alongside `validateGridFinish`, `strategyEvidence` field added to `appendQueryTrace`'s `validators` payload at line 1064)
- `web/scripts/tests/validator-strategy-evidence.test.mjs` (new — 5 unit-test cases)
- `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs` (new — 4 route-wiring cases)

### Decisions
- **Validator signature**: `(answerText: string, contract: FactContract) => StrategyEvidenceValidationResult` where the result shape `{ ok: boolean; reasons: string[] }` matches `GridFinishValidationResult` / `PitStintsValidationResult` / `SectorConsistencyValidationResult`. The validator never receives a "contract absent" case — that is handled at the route layer by passing `null` into the trace via the same `synthesisContract ? validateStrategyEvidence(...) : null` guard the peer validators already use.
- **Driver-row binding**: ported the `findRowByDriverToken` pattern from `gridFinishValidator.ts:93` (matches on `full_name` / `driver_name` / `name`, splits on whitespace / `-` / `'` to tolerate last-name-only tokens) and resolve every claim against the matching driver's row first; an unmatched-driver claim emits a `no contract row matches this driver` reason rather than silently falling back to "any row in the contract."
- **Recognized evidence-bearing columns**: `pit_laps`, `pit_stop_count`, `strategy_type`, `compounds_used`, `total_pit_duration_seconds` (from `core.strategy_summary` per `sql/007_semantic_summary_contracts.sql:206-236`) plus `lap_number`, `event_type`, `decision_kind`, `pit_lap` (from a future `core.strategy_evidence_summary` per-event contract). When *no* recognized column appears anywhere in the contract rows, every parsed strategy claim is treated as unsupported (rather than silently passing).
- **Claim taxonomy**: parses three claim kinds: `strategy_name` (e.g. "Verstappen ran a two-stop strategy" → backed by `strategy_type` or `pit_stop_count`), `pit_lap` (e.g. "pitting on laps 18 and 41" → backed by `pit_laps` array entries or by `pit_lap` / `lap_number` on a per-event row), and `stop_count` (e.g. "made 2 pit stops" → backed by `pit_stop_count`). Driver token resolution uses the `nearestPriorDriverToken` lookback pattern from `gridFinishValidator.ts:131-142` so multi-clause sentences like "Hamilton ran a two-stop strategy, pitting on laps 18 and 41" attribute every clause to the same driver subject.
- **Non-blocking failures**: validator output is appended to `chat_query_trace.jsonl` only via `appendQueryTrace`'s `validators.strategyEvidence` field. The user-facing response body is unchanged on validator failure (HTTP 200, original synthesized `answer`, no `validators` or `strategyEvidence` keys). Route-wiring tests (a) and (d) explicitly assert this.
- **Null-contract route-reachable test (deferred Medium from round 9)**: chose option (b) per the deferral note — the route-wiring test exercises the synthesis-bypass zero-row path. When `runSql` returns `rowCount: 0`, the route skips the LLM-synthesis block entirely (where `synthesisContract` would be assigned at `route.ts:918`) and produces a hardcoded "No rows matched..." answer; the trace's `validators.strategyEvidence` is then `null` via the route's `synthesisContract ? ... : null` guard. Test 3 in `validator-strategy-evidence-route-wiring.test.mjs` drives this path through the real `route.ts` — no direct validator call, no synthetic `null` injection.

### Self-checks
- Unit tests `validator-strategy-evidence.test.mjs`: **5/5 pass** (cases (a) vacuously-ok, (b) supported claims against single-row `strategy_summary`-shaped contract, (c) unsupported-claim contradiction, (d) all-claims-unsupported on missing-evidence contract, (e) driver-binding both directions).
- Route-wiring tests `validator-strategy-evidence-route-wiring.test.mjs`: **4/4 pass** (failure-case trace + non-blocking response, pass-case trace, null-contract zero-row branch, driver-binding mismatch).
- All four expected files modified; no other files touched (`git diff --cached --stat` confirms exactly the four expected paths).

### Gate command exit codes
- `(cd web && npm run build)` → exit `0`
- `(cd web && npm run typecheck)` → exit `0`
- `bash scripts/loop/test_grading_gate.sh` → exit `0` (PASS, `slice_fails=28 baseline_fails=28 baseline_failures_fixed=0`)

## Audit verdict
**Status: PASS**

- Gate 1 `(cd web && npm run build)` -> exit `0`
- Gate 2 `(cd web && npm run typecheck)` -> exit `0`
- Gate 3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope-diff -> PASS. `git diff --name-only integration/perf-roadmap...HEAD` stays within declared scope plus the implicit allow-list: `diagnostic/slices/08-validators-strategy-evidence.md`, `web/src/lib/validators/strategyEvidenceValidator.ts`, `web/src/app/api/chat/route.ts`, `web/scripts/tests/validator-strategy-evidence.test.mjs`, `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs`.
- Acceptance 1 [web/src/lib/validators/strategyEvidenceValidator.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/lib/validators/strategyEvidenceValidator.ts:3), [web/scripts/tests/validator-strategy-evidence.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/scripts/tests/validator-strategy-evidence.test.mjs:53), `cd web && node --test scripts/tests/validator-strategy-evidence.test.mjs` -> PASS, exit `0`
- Acceptance 2 [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:41), [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:1039) -> PASS
- Acceptance 3 [web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs:409), `cd web && node --test scripts/tests/validator-strategy-evidence-route-wiring.test.mjs` -> PASS, exit `0`
- Acceptance 4 [web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs:446) -> PASS
- Acceptance 5 [web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs:488) -> PASS
- Acceptance 6 [web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs:552) -> PASS
- Decision -> PASS
- Rationale -> Ordered gates pass, scope stays within the declared file set, and direct execution of the new unit and route-wiring suites verifies the validator shape, route trace wiring, non-blocking behavior, null-contract branch, and driver-binding mismatch handling.

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

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Rewrite Step 4 so the validator runs where the synthesized answer and `chat_query_trace.jsonl` append actually exist today, or explicitly expand scope to carry validator output through that boundary; `buildChatRuntime` returns only planning metadata in [web/src/lib/chatRuntime.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/lib/chatRuntime.ts:99), while the current post-synthesis validator and trace logging live in [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:1026).

### Medium
- [x] Rewrite Step 5 so the route-wiring test exercises the moved wiring path instead of mirroring harnesses that stub `@/lib/chatRuntime`; the existing pattern replaces that import with `chatRuntime.stub.mjs` in [web/scripts/tests/validator-grid-finish-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/scripts/tests/validator-grid-finish-route-wiring.test.mjs:205) and injects fake runtime output at [web/scripts/tests/validator-grid-finish-route-wiring.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/scripts/tests/validator-grid-finish-route-wiring.test.mjs:354), which would bypass any new validator logic moved into `chatRuntime.ts`.
- [x] Align `Changed files expected` with the chosen integration point; if the plan keeps validator invocation or trace attachment in the route-layer boundary exposed by [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:1035), include that file explicitly instead of implying a `chatRuntime.ts`-only change.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High

### Medium
- [x] Resolve the `skipped` contract-absent contradiction by either widening the validator/route contract to emit a structured skipped result when `strategy_evidence_summary` is absent, or by removing the “contract absent” skipped case from Steps 2-4 and Step 3’s test scope; the current Step 1 signature requires `contract: FactContract` while Step 4 still only invokes validators when `synthesisContract` exists.
- [x] Add an explicit failure-case assertion to Step 5 and the acceptance criteria that `validateStrategyEvidence` failures remain non-blocking at the route layer (for example, HTTP 200, unchanged answer text, and no validator payload leak into the user-facing response), because Step 4 makes that a required behavior but the current test description only checks the trace payload.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Reconcile the validator goal with the real synthesis-contract source: either expand the slice so strategy-decision validation is guaranteed to receive `core.strategy_evidence_summary` rows at runtime, or narrow the goal/acceptance text away from “must reference an event in `strategy_evidence_summary`”, because the current route builds the contract from `runtime.queryPlan.primary_tables[0]` in [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:72) while real strategy table ordering still puts `core.strategy_summary` / `core.stint_summary` ahead of `core.strategy_evidence_summary` in [web/src/lib/chatRuntime.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/lib/chatRuntime.ts:939) and [web/src/lib/chatRuntime.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/lib/chatRuntime.ts:968).

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [x] Rewrite the `Gate commands` block so each `web` command runs in its own subshell from repo root (for example `(cd web && npm run build)` / `(cd web && npm run typecheck)`), because the current sequential `cd web && ...` lines leave the shell in `web/` after the first command and make the second `cd web` plus the repo-root `bash scripts/loop/test_grading_gate.sh` invocation fail.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High
- [x] Reconcile Steps 2-3 with the real `core.strategy_summary` contract: it already exposes strategy evidence columns such as `pit_laps`, `pit_stop_count`, and `strategy_type` in [sql/007_semantic_summary_contracts.sql](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/sql/007_semantic_summary_contracts.sql:159), so the plan must either treat those as valid backing evidence for the matching pit/stop/strategy claims or explicitly narrow the validator away from those claim types instead of describing today’s `core.strategy_summary` path as “no recognized evidence-bearing columns.”

### Medium
- [x] Remove or fulfill the Step 3 claim that the route-wiring test exercises the `synthesisContract === null` guard: Step 5 currently specifies only fail-case and pass-case requests against a real contract, so add a concrete null-contract assertion there or stop claiming that coverage exists.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.

## Plan-audit verdict (round 7)

**Status: REVISE**

### High
- [x] Require strategy-claim validation to bind evidence to the claimed driver row, not just any row in the contract: `core.strategy_summary` is driver-grained (`driver_number`, `driver_name`, `team_name`) in `sql/007_semantic_summary_contracts.sql:214-216`, and the peer validator pattern already resolves claims against the matching driver row via `findRowByDriverToken` in `web/src/lib/validators/gridFinishValidator.ts:93`; add a concrete multi-row test in Step 3 (and corresponding route-harness coverage in Step 5 if driver names appear there) that fails when one driver's unsupported pit/strategy claim would otherwise be "backed" by another driver's row.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.

## Plan-revise unblock note (2026-04-30T00:35 EDT)

Mechanical escalation reverted: the iteration-cap trip at round 7 was not a stuck-on-same-item pathology — codex's round-7 finding (driver-row binding via `findRowByDriverToken` per peer pattern in `gridFinishValidator.ts:93`) is a substantive, novel item with concrete file:line references, not a recurrence of a prior round. Bumping `LOOP_MAX_PLAN_ITERATIONS` from 6 to 8 gives one more revise + audit cycle to address this finding. If codex's round-8 audit lands a NEW substantive finding (rather than a repeat of round 7), the slice will re-escalate at iteration 9 and require user judgment on whether to split or continue.

## Plan-audit verdict (round 8)

**Status: REVISE**

### High

### Medium
- [ ] Rewrite Step 5 and the matching acceptance bullet for the null-contract branch so they use a route-reachable setup instead of “fake runtime returns `synthesisContract: null` (or omits it)”: in the real route, `synthesisContract` is built locally from `result.rows` plus `runtime.queryPlan.primary_tables[0]` in [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:72) and assigned only inside the synthesis path at [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:918), so a `chatRuntime.stub.mjs` fake cannot directly inject `null` there.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.

## Plan-audit verdict (round 9, manual PASS-WITH-DEFERRED)

**Status: PASS-WITH-DEFERRED**
**Auditor: user (manual override after round-8 mechanical iter-cap re-escalation)**

### High
_None._

### Medium (deferred to implementation)
- [ ] (deferred) Rewrite Step 5 and the matching acceptance bullet for the null-contract branch so they use a route-reachable setup instead of "fake runtime returns `synthesisContract: null` (or omits it)". The implementer chooses one of: (a) call the validator directly with a constructed null-contract path test rather than through the route; (b) drive the route via a synthesis-bypass path (clarification, deterministic-template-only, or zero-row) where `synthesisContract` legitimately stays null/unassigned and the trace records the validator entry as null. Either is acceptable; document the chosen approach in the implementation Decisions section.

### Low
_None._

### Notes (informational only — no action)
- Round 7 (driver-row binding via `findRowByDriverToken`) was substantively addressed by the round-8 plan-revise. Round 8's Medium is a tactical test-design decision, not a code-correctness gap; deferring it to impl is a lower-cost path than continuing the plan-audit cycle (the slice has spent 7 codex rounds + 8 claude revises already).
- Loop iteration cap raised to 10 going forward (`dispatch_plan_revise.sh` default + runner env) to give other slices more headroom; this slice is exempt from further plan-audit cycles via this manual PASS-WITH-DEFERRED.
