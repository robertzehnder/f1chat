---
slice_id: 08-fact-contract-shape
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Define the canonical `FactContract` TS shape that each semantic contract serializes into for the synthesis prompt. Single source of truth replacing per-contract ad-hoc shapes.

## Inputs
- `web/src/lib/contracts/` (new module location)
- `web/src/lib/anthropic.ts` (current `AnswerSynthesisInput` — reference shape, NOT modified by this slice)

## Prior context
- `diagnostic/_state.md`
- `web/src/lib/anthropic.ts` — current synthesis input shape (`AnswerSynthesisInput` at L32–L43): question + sql + rows[] + rowCount + runtime. The new `FactContract` is the per-contract object that downstream slices compose into that payload; this slice only defines the type and a serializer helper.
- `diagnostic/slices/08-synthesis-payload-cutover.md` — companion slice that consumes `FactContract` and removes direct contract-class imports from synthesis. This slice deliberately stops at type definition + helpers + unit tests so the cutover is auditable in isolation.

## Decisions
- **Scope is type definition only.** Synthesis wiring, validator wiring, and any `chat_query_trace.jsonl` side effects are out of scope and live in `08-synthesis-payload-cutover` and the `08-validators-*` slices. Acceptance criteria therefore do not assert any synthesis-path or trace behavior.
- **No imports from `chatRuntime.ts`/`anthropic.ts` are added in this slice**, so `Changed files expected` lists only the new module and its tests.

## Required services / env
None at author time.

## Steps
1. Create `web/src/lib/contracts/factContract.ts` and export the canonical `FactContract` type with these fields:
   - `contractName: string` — the semantic contract identifier (e.g., `"core.laps_enriched"`, `"core.strategy_summary"`).
   - `grain: FactContractGrain` where `FactContractGrain = "session" | "lap" | "stint" | "driver" | "meeting" | "other"`.
   - `keys: Record<string, string | number | null>` — resolved IDs that bind the rows to a runtime context (e.g., `session_key`, `driver_number`).
   - `rows: ReadonlyArray<Record<string, unknown>>` — serialized rows from this contract (already JSON-safe).
   - `rowCount: number` — must equal `rows.length`.
   - `coverage?: { warnings: ReadonlyArray<string> }` — optional completeness warnings carried alongside rows.
   Export both `FactContract` and `FactContractGrain`.
2. In the same file, export a `SemanticContractSerializer<TInput>` interface: `(input: TInput) => FactContract`. Keep the file dependency-free of `chatRuntime.ts` and `anthropic.ts` so either side can import without circular deps.
3. Implement and export `serializeRowsToFactContract(input: { contractName: string; grain: FactContractGrain; keys: Record<string, string | number | null>; rows: ReadonlyArray<Record<string, unknown>>; coverage?: { warnings: ReadonlyArray<string> } }): FactContract`. The helper sets `rowCount = input.rows.length` and returns the result via `Object.freeze` (shallow) so callers cannot mutate the canonical shape.
4. Add `web/scripts/tests/fact-contract-shape.test.mjs` covering: (a) `serializeRowsToFactContract` returns `rowCount === 0` for empty rows; (b) `rowCount === rows.length` for non-empty rows; (c) the returned object is frozen at the top level (`Object.isFrozen` is true); (d) `coverage` is omitted when not provided and present when provided; (e) `grain` only accepts the declared union (the test asserts that a known-good value compiles via the runner's existing TS-aware path, OR — if the test runner is plain `.mjs` — checks the value is one of the documented strings at runtime). The test file follows the discovery convention used by sibling `web/scripts/tests/*.test.mjs` files so `npm run test:grading` picks it up.
5. Do NOT wire into synthesis or validators here. The cutover lives in `08-synthesis-payload-cutover`; validator wiring lives in `08-validators-*`. Any cross-module import of `factContract.ts` outside its own test file is out of scope for this slice.

## Changed files expected
- `web/src/lib/contracts/factContract.ts` (new — `FactContract` type, `FactContractGrain` union, `SemanticContractSerializer` interface, `serializeRowsToFactContract` helper)
- `web/scripts/tests/fact-contract-shape.test.mjs` (new — unit tests for the helper and shape invariants)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `FactContract` type and `FactContractGrain` union are exported from `web/src/lib/contracts/factContract.ts`.
- [ ] `serializeRowsToFactContract` returns an object whose `rowCount` equals `rows.length` for both empty and non-empty inputs, and the returned top-level object is frozen.
- [ ] `cd web && npm run test:grading` discovers and passes `fact-contract-shape.test.mjs`.
- [ ] `cd web && npm run typecheck` passes with no new errors introduced by the new module.
- [ ] No imports of `factContract.ts` are added to `web/src/lib/chatRuntime.ts` or `web/src/lib/anthropic.ts` in this slice (cutover is deferred to `08-synthesis-payload-cutover`).

## Out of scope
- Synthesis prompt construction, payload cutover, or removal of any per-contract import (handled by `08-synthesis-payload-cutover`).
- Validator implementation or `chat_query_trace.jsonl` side effects (handled by `08-validators-*`).
- Any change to existing semantic contract modules under `web/src/lib/contracts/` other than adding the new `factContract.ts` file.

## Risk / rollback
New, additive module with no callers. Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Rewrite the Steps and Acceptance criteria so they implement the stated goal of defining and adopting a canonical `FactContract` serialization shape; the current plan instead specifies an answer validator workflow and never names the contract fields, serialization boundary, or adoption path for existing per-contract shapes.

### Medium
- [x] Expand `Changed files expected` to include the synthesis wiring and test files the plan already requires, or narrow the Steps so they only touch `web/src/lib/contracts/factContract.ts`. (Resolved by narrowing Steps to type-definition + tests; cutover/wiring deferred to `08-synthesis-payload-cutover`. `Changed files expected` now lists `factContract.ts` and `fact-contract-shape.test.mjs`.)
- [x] Replace the `Prior context` note about a validator-only bar with context that matches this slice’s declared goal, or change the goal if this slice is intentionally about validation rather than `FactContract` shape definition. (Resolved by replacing the validator-bar bullet with `anthropic.ts`/cutover-slice references.)

### Low
- [x] Specify where validation logs are emitted and how the gate suite or tests will assert the `chat_query_trace.jsonl` side effect, since the current acceptance item is observable but not yet test-shaped. (Resolved by removing the trace acceptance criterion: with the High-item rewrite this slice no longer touches synthesis or `chat_query_trace.jsonl`; that surface is owned by `08-validators-*`.)

### Notes (informational only — no action)
- `diagnostic/_state.md` is current enough to use; no stale-state note needed.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] Amend Step 3 and the matching acceptance text so the immutability contract is accurate: either deep-freeze `keys`/`rows`/`coverage.warnings` as well, or explicitly limit the guarantee to top-level property reassignment instead of saying callers cannot mutate the canonical shape.

### Medium
- [ ] Replace the Step 4 “TS-aware path OR runtime string-membership check” fork with one deterministic type-level gate that proves `FactContractGrain` is the exported union, because the current runtime fallback can pass even if the TypeScript type is widened or removed.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T21:27:37Z, so no stale-state note is needed.
- `diagnostic/slices/08-synthesis-payload-cutover.md` still contains stale validator-oriented plan text; this slice can still be audited, but that companion slice likely needs its own plan rewrite before implementation.
