---
slice_id: 08-validators-strategy-evidence
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T04:08:19Z
---

## Goal
Validator: every strategy-decision claim must reference an event in `strategy_evidence_summary`.

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
2. Implement the validator. The contract input is the synthesis `FactContract` already built at `web/src/app/api/chat/route.ts` and passed to peer validators; assert that every claim in the answer text referencing a strategy decision (e.g. lap, pit, undercut, overcut events) maps to at least one row in the contract — otherwise return `{ ok: false, reasons: [...] }` naming the unsupported claim. When the answer contains no strategy-decision claims, return `{ ok: true, reasons: [] }` (vacuously ok, matching peer behavior on questions outside their pattern).
3. Add unit tests in `web/scripts/tests/validator-strategy-evidence.test.mjs` covering: (a) `{ ok: true, reasons: [] }` for an answer with no strategy-decision claims, (b) `{ ok: true, reasons: [] }` for an answer whose strategy claims are all backed by contract rows, and (c) `{ ok: false, reasons: [...non-empty] }` for an answer with at least one unsupported strategy claim. The "contract absent" case is exercised by the route-wiring test in Step 5 (which verifies the route's null-guard), not by this unit suite, because the validator's signature requires `contract: FactContract`.
4. Wire the validator into the **route-layer synthesis post-step** at `web/src/app/api/chat/route.ts` near lines 1026–1062, alongside the existing `validatePitStints` / `validateSectorConsistency` / `validateGridFinish` invocations using the same null-guard pattern (`synthesisContract ? validateStrategyEvidence(answer, synthesisContract) : null`). Add a `strategyEvidence` field to the `validators` payload of the `appendQueryTrace({...})` call so failures surface in `chat_query_trace.jsonl`. Validation failures must remain **non-blocking**: the route still returns `status: 200` with the unchanged synthesized `answer` / `answerReasoning`, and the validator payload appears only in the trace — the user-facing response body must not gain a `validators` / `strategyEvidence` field. (The validator does not run inside `buildChatRuntime` — that returns planning metadata only and never sees the synthesized answer text.)
5. Add `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs` mirroring the structure of `web/scripts/tests/validator-grid-finish-route-wiring.test.mjs` (and the analogous pit-stints / sector-consistency harnesses): import `route.ts`, replace `@/lib/chatRuntime` with the existing `chatRuntime.stub.mjs` and inject a fake runtime whose `questionType` triggers the strategy-evidence validator, transpile-and-import the real `strategyEvidenceValidator.ts` (do **not** stub it), drive a synthesized answer with an unsupported strategy claim through the route, and assert all of the following on that fail-case request:
   - the captured `chat_query_trace.jsonl` payload's `validators.strategyEvidence` field has `ok: false` and a non-empty `reasons` array;
   - the HTTP response status is `200` (validator failure is non-blocking);
   - the user-facing response body's `answer` matches the synthesized text verbatim (validator failure does not rewrite the answer);
   - the user-facing response body has no `validators` and no `strategyEvidence` keys at any level (the validator payload stays in the trace only).
   Then add a parallel pass-case assertion that the trace payload's `validators.strategyEvidence` field is `{ ok: true, reasons: [] }`. The harness must therefore exercise the route-layer wiring added in Step 4 — not just the validator function in isolation.

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
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] Validator returns `{ ok: boolean; reasons: string[] }` (matching the peer `GridFinishValidationResult` / `PitStintsValidationResult` / `SectorConsistencyValidationResult` shape) on the unit-test cases in `web/scripts/tests/validator-strategy-evidence.test.mjs` (vacuously-ok / supported-claims / unsupported-claim).
- [ ] The route-layer synthesis post-step in `web/src/app/api/chat/route.ts` invokes `validateStrategyEvidence` alongside the peer validators using the same `synthesisContract ? ... : null` guard, and emits a `validators.strategyEvidence` entry in the `chat_query_trace.jsonl` payload.
- [ ] `web/scripts/tests/validator-strategy-evidence-route-wiring.test.mjs` drives a request through the real `route.ts` (with `chatRuntime` stubbed via the existing `chatRuntime.stub.mjs` pattern and the real `strategyEvidenceValidator.ts` transpiled), and asserts that an unsupported strategy claim surfaces as `validators.strategyEvidence.ok === false` with a non-empty `reasons` array in the captured trace entry.
- [ ] The same route-wiring test asserts that on validator failure the route stays non-blocking: HTTP status `200`, the response body's `answer` is unchanged from the synthesized text, and the response body contains no `validators` or `strategyEvidence` keys at any level (validator output is trace-only).

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
- [ ] Reconcile the validator goal with the real synthesis-contract source: either expand the slice so strategy-decision validation is guaranteed to receive `core.strategy_evidence_summary` rows at runtime, or narrow the goal/acceptance text away from “must reference an event in `strategy_evidence_summary`”, because the current route builds the contract from `runtime.queryPlan.primary_tables[0]` in [web/src/app/api/chat/route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/app/api/chat/route.ts:72) while real strategy table ordering still puts `core.strategy_summary` / `core.stint_summary` ahead of `core.strategy_evidence_summary` in [web/src/lib/chatRuntime.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/lib/chatRuntime.ts:939) and [web/src/lib/chatRuntime.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-validators-strategy-evidence/web/src/lib/chatRuntime.ts:968).

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current as of 2026-04-30T03:50:46Z; no stale-state note required.
- Prior-context artifact `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` exists and still shows strategy-question semantic misses in the active benchmark set.
