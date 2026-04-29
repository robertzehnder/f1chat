---
slice_id: 08-fact-contract-shape
phase: 8
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T21:50:00Z
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
   - `rows: ReadonlyArray<FactContractRow>` — serialized rows from this contract, constrained at the type level to JSON-serializable values (see Step 1a). Downstream `buildSynthesisPromptParts()` stringifies these rows via `JSON.stringify`, so values such as `bigint`, `undefined`, functions, or class instances must be excluded from the type to fail at compile time rather than serialize as `null`/throw at runtime.
   - `rowCount: number` — must equal `rows.length`.
   - `coverage?: { warnings: ReadonlyArray<string> }` — optional completeness warnings carried alongside rows.
   Export `FactContract`, `FactContractGrain`, `FactContractRow`, and `FactContractValue`.
1a. In the same file, define and export a JSON-serializable value type to back the row shape:
   ```ts
   export type FactContractScalar = string | number | boolean | null;
   export type FactContractValue =
     | FactContractScalar
     | { readonly [key: string]: FactContractValue }
     | ReadonlyArray<FactContractValue>;
   export type FactContractRow = { readonly [key: string]: FactContractValue };
   ```
   This deliberately excludes `undefined`, `bigint`, functions, symbols, and class instances so that `JSON.stringify(row)` in the synthesis prompt path is total (no silent `undefined`-elision and no `TypeError` for `bigint`). Numeric `NaN`/`Infinity` are not excluded at the type level — they are valid `number` values; if a future slice needs them rejected, that is a runtime validator concern, not a `FactContract` shape concern.
2. In the same file, export a `SemanticContractSerializer<TInput>` interface: `(input: TInput) => FactContract`. Keep the file dependency-free of `chatRuntime.ts` and `anthropic.ts` so either side can import without circular deps.
3. Implement and export `serializeRowsToFactContract(input: { contractName: string; grain: FactContractGrain; keys: Record<string, string | number | null>; rows: ReadonlyArray<FactContractRow>; coverage?: { warnings: ReadonlyArray<string> } }): FactContract`. The helper sets `rowCount = input.rows.length` and wraps the result in `Object.freeze` (top-level only — this guards against reassignment of the returned object's own properties such as `rowCount` or `contractName`; it does **NOT** recursively freeze `keys`, `rows`, or `coverage.warnings`, whose immutability is conveyed at the type level via `ReadonlyArray<...>` and `Record<string, ...>` and is the caller's responsibility at runtime). Document this limitation in a one-line JSDoc above the helper so consumers in later slices do not assume deep immutability.
4. Add `web/scripts/tests/fact-contract-shape.test.mjs` covering the runtime behavior of `serializeRowsToFactContract`: (a) returns `rowCount === 0` for empty rows; (b) `rowCount === rows.length` for non-empty rows; (c) the returned object is frozen at the top level (`Object.isFrozen(result) === true` AND attempting to assign `result.rowCount = 999` either throws in strict mode or leaves the value unchanged); (d) `coverage` is omitted when not provided and present (with the supplied `warnings` array) when provided. The test file follows the discovery convention used by sibling `web/scripts/tests/*.test.mjs` files so `npm run test:grading` picks it up. The test does NOT attempt to validate the `FactContractGrain` union at runtime — that is the type-level gate's job (Step 5).
5. Add a type-level gate: create `web/src/lib/contracts/factContract.type-test.ts` that imports `FactContractGrain` and asserts it is structurally equal to the exact union `"session" | "lap" | "stint" | "driver" | "meeting" | "other"` using an equality helper, e.g.:
   ```ts
   import type { FactContractGrain } from "./factContract";
   type Equal<A, B> =
     (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
   type Expect<T extends true> = T;
   type _GrainExact = Expect<Equal<FactContractGrain, "session" | "lap" | "stint" | "driver" | "meeting" | "other">>;
   ```
   This file must be inside the `web/` TypeScript project so it is type-checked by `npm run typecheck`. The `Equal` helper compares unions structurally (set-equality), not by source-text ordering, so the regressions it actually detects are: (a) **widening** — e.g., changing the type to `string` or adding a new member like `"weekend"`; (b) **narrowing** — removing a member such as `"other"`; (c) **member substitution** — replacing `"meeting"` with `"event"`; (d) **export removal** — the import itself fails to resolve. It does **NOT** detect a pure source-order reorder (e.g., listing `"lap" | "session" | ...`) because TypeScript unions are unordered at the type level — and that is acceptable, because the union's *behavior* is identical under reorder; consumers exhaustively switch on members, not on declaration position. The file exports nothing of value at runtime; it exists solely as a compile-time gate.
6. Do NOT wire into synthesis or validators here. The cutover lives in `08-synthesis-payload-cutover`; validator wiring lives in `08-validators-*`. Any cross-module import of `factContract.ts` outside its own test files (the runtime test in `web/scripts/tests/` and the type-level gate in `web/src/lib/contracts/`) is out of scope for this slice.

## Changed files expected
- `web/src/lib/contracts/factContract.ts` (new — `FactContract` type, `FactContractGrain` union, `FactContractScalar`/`FactContractValue`/`FactContractRow` JSON-serializable row types, `SemanticContractSerializer` interface, `serializeRowsToFactContract` helper)
- `web/src/lib/contracts/factContract.type-test.ts` (new — compile-time type-equality gate for `FactContractGrain`; covered by `npm run typecheck`)
- `web/scripts/tests/fact-contract-shape.test.mjs` (new — runtime unit tests for the helper and top-level-freeze invariant)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `FactContract`, `FactContractGrain`, `FactContractScalar`, `FactContractValue`, and `FactContractRow` are exported from `web/src/lib/contracts/factContract.ts`, and the `rows` field on `FactContract` is typed `ReadonlyArray<FactContractRow>` (NOT `ReadonlyArray<Record<string, unknown>>`), so a row containing a `bigint`, `undefined`, function, symbol, or class instance fails `npm run typecheck`.
- [ ] `serializeRowsToFactContract` returns an object whose `rowCount` equals `rows.length` for both empty and non-empty inputs, and the returned object satisfies `Object.isFrozen(result) === true` at the top level (the helper does NOT deep-freeze nested `keys`/`rows`/`coverage.warnings`; this scope is documented in the helper's JSDoc).
- [ ] `cd web && npm run test:grading` discovers and passes `fact-contract-shape.test.mjs`.
- [ ] `cd web && npm run typecheck` passes with no new errors and **fails deterministically** if `FactContractGrain` is widened (added member or broadened to `string`), narrowed (member removed), member-substituted (e.g., `"meeting"` → `"event"`), or its export removed — proven by the `Expect<Equal<FactContractGrain, ...>>` assertion in `web/src/lib/contracts/factContract.type-test.ts`. Pure source-order reordering of the union members is intentionally NOT a regression (TypeScript unions are unordered at the type level; behavior is identical) and is therefore not asserted.
- [ ] No imports of `factContract.ts` are added to `web/src/lib/chatRuntime.ts` or `web/src/lib/anthropic.ts` in this slice (cutover is deferred to `08-synthesis-payload-cutover`).

## Out of scope
- Synthesis prompt construction, payload cutover, or removal of any per-contract import (handled by `08-synthesis-payload-cutover`).
- Validator implementation or `chat_query_trace.jsonl` side effects (handled by `08-validators-*`).
- Any change to existing semantic contract modules under `web/src/lib/contracts/` other than adding the new `factContract.ts` and `factContract.type-test.ts` files.

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
- [x] Amend Step 3 and the matching acceptance text so the immutability contract is accurate: either deep-freeze `keys`/`rows`/`coverage.warnings` as well, or explicitly limit the guarantee to top-level property reassignment instead of saying callers cannot mutate the canonical shape. (Resolved by limiting `Object.freeze` to top-level only and documenting the scope explicitly in Step 3, the helper's JSDoc, and the acceptance criterion.)

### Medium
- [x] Replace the Step 4 “TS-aware path OR runtime string-membership check” fork with one deterministic type-level gate that proves `FactContractGrain` is the exported union, because the current runtime fallback can pass even if the TypeScript type is widened or removed. (Resolved by removing the runtime/grain assertion from Step 4 and adding a new Step 5 type-level gate `web/src/lib/contracts/factContract.type-test.ts` that uses an `Expect<Equal<...>>` helper checked by `npm run typecheck`.)

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T21:27:37Z, so no stale-state note is needed.
- `diagnostic/slices/08-synthesis-payload-cutover.md` still contains stale validator-oriented plan text; this slice can still be audited, but that companion slice likely needs its own plan rewrite before implementation.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Replace `Record<string, unknown>` in the `rows` shape and serializer signature with an explicit JSON-serializable object/value type, because `buildSynthesisPromptParts()` stringifies these rows and the current type admits runtime-unsafe values such as `bigint`. (Resolved by introducing `FactContractScalar`/`FactContractValue`/`FactContractRow` in Step 1a, retyping `rows` to `ReadonlyArray<FactContractRow>` on both `FactContract` and the serializer signature, and adding an acceptance criterion that requires a `bigint`/`undefined`/function/symbol/class-instance row to fail `npm run typecheck`.)

### Medium
- [x] Correct Step 5 and the matching acceptance criterion so they do not claim the `Expect<Equal<...>>` gate fails on a reordered union, or replace that wording with the exact regressions the assertion actually detects. (Resolved by rewriting Step 5 to enumerate what `Equal<A,B>` actually catches — widening, narrowing, member substitution, export removal — and explicitly noting that pure source-order reorder is not a regression because TS unions are unordered. The matching acceptance criterion was rewritten to mirror this list and to call out that reorder is intentionally not asserted.)

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T21:27:37Z, so no stale-state note is needed.
