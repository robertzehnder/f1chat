---
slice_id: 08-fact-contract-shape
phase: 8
status: revising
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T18:07:46-04:00
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
   - `keys: Readonly<Record<string, string | number | null>>` — resolved IDs that bind the rows to a runtime context (e.g., `session_key`, `driver_number`). Typed as `Readonly<Record<...>>` (not bare `Record<...>`) so well-typed callers cannot reassign individual key entries (`contract.keys.session_key = ...` is a `ts(2540)` error), aligning the type-level guarantee with the helper's top-level `Object.freeze` (the property `keys` itself cannot be reassigned at runtime; entries inside `keys` are not deep-frozen).
   - `rows: ReadonlyArray<FactContractRow>` — serialized rows from this contract, constrained at the type level to JSON-serializable values (see Step 1a). Downstream `buildSynthesisPromptParts()` stringifies these rows via `JSON.stringify`, so values such as `bigint`, `undefined`, functions, and symbols must be excluded from the type to fail at compile time rather than serialize as `null`/throw at runtime. Class-instance rejection is intentionally NOT in the type-level contract (see Step 1a for rationale).
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
   This excludes `undefined`, `bigint`, functions, and symbols at the type level so that `JSON.stringify(row)` in the synthesis prompt path is total (no silent `undefined`-elision and no `TypeError` for `bigint`). It does **not** attempt to reject "class instances" at compile time: TypeScript is structurally typed, so a class instance whose enumerable own properties already match `{ [key: string]: FactContractValue }` is — by design — assignable to `FactContractRow` and there is no purely type-level mechanism to forbid it. Class-instance / non-plain-object rejection (e.g., guarding against `Date`, `Map`, or instances with non-enumerable methods that would be silently dropped by `JSON.stringify`) is therefore out of scope for this slice and is handled, if needed, by a runtime validator in a later slice (`08-validators-*`). Numeric `NaN`/`Infinity` are likewise valid `number` values at the type level; runtime rejection (if ever needed) is a validator concern, not a `FactContract` shape concern.
2. In the same file, export a `SemanticContractSerializer<TInput>` interface: `(input: TInput) => FactContract`. Keep the file dependency-free of `chatRuntime.ts` and `anthropic.ts` so either side can import without circular deps.
3. Implement and export `serializeRowsToFactContract(input: { contractName: string; grain: FactContractGrain; keys: Readonly<Record<string, string | number | null>>; rows: ReadonlyArray<FactContractRow>; coverage?: { warnings: ReadonlyArray<string> } }): FactContract`. The helper sets `rowCount = input.rows.length` and wraps the result in `Object.freeze` (top-level only — this guards against reassignment of the returned object's own properties such as `rowCount`, `contractName`, `keys`, `rows`, or `coverage`; it does **NOT** recursively freeze the contents inside `keys`, `rows`, or `coverage.warnings`). Type-level immutability of those contents is conveyed via `Readonly<Record<...>>` for `keys`, `ReadonlyArray<FactContractRow>` for `rows` (with each row's own properties readonly via `FactContractRow`'s `readonly [key: string]` index signature in Step 1a), and `ReadonlyArray<string>` for `coverage.warnings` — so well-typed callers receive `ts(2540)`/`ts(2542)` errors for reassignment or `push`/index-assignment, but runtime mutation via `as`-casts or untyped JS is the caller's responsibility (the helper does NOT defend against deep mutation at runtime). Document this limitation in a one-line JSDoc above the helper so consumers in later slices do not assume deep immutability.
4. Add `web/scripts/tests/fact-contract-shape.test.mjs` covering the runtime behavior of `serializeRowsToFactContract`: (a) returns `rowCount === 0` for empty rows; (b) `rowCount === rows.length` for non-empty rows; (c) the returned object is frozen at the top level (`Object.isFrozen(result) === true` AND attempting to assign `result.rowCount = 999` either throws in strict mode or leaves the value unchanged); (d) `coverage` is omitted when not provided and present (with the supplied `warnings` array) when provided. The test does NOT attempt to validate the `FactContractGrain` union at runtime — that is the type-level gate's job (Step 5).

   **TS-loading harness (mandatory).** The `test:grading` script in `web/package.json` runs `node --test scripts/tests/*.test.mjs`, and plain Node cannot import a `.ts` source file. This test MUST therefore use the same in-process transpile-to-temp-`.mjs` pattern that sibling tests already use (e.g. `web/scripts/tests/cache-control-markers.test.mjs`'s `transpileAndImportAnthropic` helper, which:
   1. reads the `.ts` source via `node:fs/promises#readFile`,
   2. transpiles it with `ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })` from the existing `typescript` dev-dependency,
   3. writes the emitted JS to a `mkdtemp(...)`'d directory under `node:os#tmpdir` as `factContract.mjs`,
   4. dynamic-`import()`s that file,
   5. and cleans the temp directory in a `finally`/`after` hook via `rm(dir, { recursive: true, force: true })`.
   
   Concretely: the test file imports `ts from "typescript"` (already a dev-dependency, no new deps), resolves `web/src/lib/contracts/factContract.ts` from `import.meta.url` (`path.resolve(__dirname, "..", "..", "src/lib/contracts/factContract.ts")`), and exposes the transpiled `serializeRowsToFactContract` to the assertions above. No new harness, runner, or `package.json` script is added — the test stays compatible with `node --test scripts/tests/*.test.mjs` exactly as the sibling tests do. A `.ts` loader (`tsx`, `ts-node`, `--experimental-loader`, etc.) is intentionally NOT introduced.
5. Add a type-level gate: create `web/src/lib/contracts/factContract.type-test.ts` that imports `FactContractGrain`, `FactContractRow`, and the `serializeRowsToFactContract` helper, and asserts THREE classes of compile-time invariants. The file must be inside the `web/` TypeScript project so all three classes are type-checked by `npm run typecheck`; it exports nothing of value at runtime and exists solely as a compile-time gate.

   **(a) `FactContractGrain` exact-union equality.** Use an `Expect<Equal<...>>` helper to assert structural set-equality with the canonical union:
   ```ts
   import type { FactContractGrain, FactContractRow } from "./factContract";
   import { serializeRowsToFactContract } from "./factContract";

   type Equal<A, B> =
     (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
   type Expect<T extends true> = T;
   type _GrainExact = Expect<Equal<FactContractGrain, "session" | "lap" | "stint" | "driver" | "meeting" | "other">>;
   ```
   The `Equal` helper compares unions structurally (set-equality), not by source-text ordering, so the regressions it actually detects are: (i) **widening** — e.g., changing the type to `string` or adding a new member like `"weekend"`; (ii) **narrowing** — removing a member such as `"other"`; (iii) **member substitution** — replacing `"meeting"` with `"event"`; (iv) **export removal** — the import itself fails to resolve. It does **NOT** detect a pure source-order reorder (e.g., listing `"lap" | "session" | ...`) because TypeScript unions are unordered at the type level — and that is acceptable, because the union's *behavior* is identical under reorder; consumers exhaustively switch on members, not on declaration position.

   **(b) `FactContractRow` rejects non-JSON-serializable value kinds.** Use `@ts-expect-error` directives so each forbidden value-kind is required to produce a typecheck error (an unused `@ts-expect-error` is itself an error, so the assertion is symmetric — it fires if the row type is widened or the directive becomes vacuous):
   ```ts
   // @ts-expect-error — bigint is not assignable to FactContractValue
   const _badBigint: FactContractRow = { v: 1n };
   // @ts-expect-error — undefined is not assignable to FactContractValue
   const _badUndefined: FactContractRow = { v: undefined };
   // @ts-expect-error — function values are not assignable to FactContractValue
   const _badFunction: FactContractRow = { v: () => 0 };
   // @ts-expect-error — symbol is not assignable to FactContractValue
   const _badSymbol: FactContractRow = { v: Symbol("x") };
   ```

   **(c) Nested readonly surfaces reject mutation.** Construct a `serializeRowsToFactContract` result and assert the type-level readonly contract on `keys` (`Readonly<Record<...>>` — readonly index signature) and `rows` (`ReadonlyArray<FactContractRow>` — no `push`):
   ```ts
   const _result = serializeRowsToFactContract({
     contractName: "core.test",
     grain: "session",
     keys: { session_key: 1 },
     rows: [{ a: 1 }],
   });
   // @ts-expect-error — keys entries are readonly via Readonly<Record<string, ...>>
   _result.keys.session_key = 2;
   // @ts-expect-error — rows is ReadonlyArray<FactContractRow>; push is not in its interface
   _result.rows.push({ a: 2 });
   ```
   These two `@ts-expect-error` directives are the deterministic typecheck surface that backs the `keys`/`rows` readonly claims in the acceptance criteria — if either field is widened (e.g., `keys` retyped to bare `Record<...>`, or `rows` retyped to `Array<...>`), the directive becomes vacuous and `npm run typecheck` fails.
6. Do NOT wire into synthesis or validators here. The cutover lives in `08-synthesis-payload-cutover`; validator wiring lives in `08-validators-*`. Any cross-module import of `factContract.ts` outside its own test files (the runtime test in `web/scripts/tests/` and the type-level gate in `web/src/lib/contracts/`) is out of scope for this slice.

## Changed files expected
- `web/src/lib/contracts/factContract.ts` (new — `FactContract` type, `FactContractGrain` union, `FactContractScalar`/`FactContractValue`/`FactContractRow` JSON-serializable row types, `SemanticContractSerializer` interface, `serializeRowsToFactContract` helper)
- `web/src/lib/contracts/factContract.type-test.ts` (new — compile-time gate covering: (a) `FactContractGrain` exact-union equality via `Expect<Equal<...>>`; (b) `FactContractRow` rejection of `bigint`/`undefined`/function/`symbol` row values via `@ts-expect-error`; (c) nested readonly mutation rejection on `_result.keys.session_key = ...` and `_result.rows.push(...)` via `@ts-expect-error`; covered by `npm run typecheck`)
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
- [ ] `FactContract`, `FactContractGrain`, `FactContractScalar`, `FactContractValue`, and `FactContractRow` are exported from `web/src/lib/contracts/factContract.ts`, and the `rows` field on `FactContract` is typed `ReadonlyArray<FactContractRow>` (NOT `ReadonlyArray<Record<string, unknown>>`). The deterministic typecheck surface for this claim is `factContract.type-test.ts` Step 5(b): four `@ts-expect-error` directives that require `bigint`, `undefined`, function, and `symbol` row values to fail to assign to `FactContractRow`; if `FactContractRow` is widened, those directives become vacuous and `npm run typecheck` fails. Class-instance rejection is intentionally NOT asserted (TypeScript structural typing makes a type-level prohibition impossible; that surface is owned by a later runtime validator in `08-validators-*`).
- [ ] `serializeRowsToFactContract` returns an object whose `rowCount` equals `rows.length` for both empty and non-empty inputs, and the returned object satisfies `Object.isFrozen(result) === true` at the top level (the helper does NOT deep-freeze nested `keys`/`rows`/`coverage.warnings`; this scope is documented in the helper's JSDoc). Type-level immutability of those nested fields is asserted by their declared types — `keys: Readonly<Record<string, string | number | null>>`, `rows: ReadonlyArray<FactContractRow>` (rows themselves use `readonly [key: string]` index signatures), `coverage.warnings: ReadonlyArray<string>`. The deterministic typecheck surface for this claim is `factContract.type-test.ts` Step 5(c): two `@ts-expect-error` directives that require `_result.keys.session_key = 2` (readonly index signature) and `_result.rows.push({ a: 2 })` (no `push` on `ReadonlyArray`) to fail; if either field is widened (e.g., `keys` retyped to bare `Record<...>` or `rows` retyped to `Array<...>`), the directive becomes vacuous and `npm run typecheck` fails.
- [ ] `cd web && npm run test:grading` discovers and passes `fact-contract-shape.test.mjs`. The test loads `web/src/lib/contracts/factContract.ts` via the in-process `ts.transpileModule` → `mkdtemp` → temp-`.mjs` → dynamic-`import()` pattern used by sibling tests such as `cache-control-markers.test.mjs` (no new dev-dependency, no `.ts` loader, no change to the `node --test scripts/tests/*.test.mjs` runner contract); the temp directory is removed in a `finally`/`after` hook.
- [ ] `cd web && npm run typecheck` passes with no new errors and **fails deterministically** when any of the three invariant classes in `web/src/lib/contracts/factContract.type-test.ts` is violated: (a) `FactContractGrain` is widened (added member or broadened to `string`), narrowed (member removed), member-substituted (e.g., `"meeting"` → `"event"`), or its export removed — proven by the `Expect<Equal<FactContractGrain, ...>>` assertion (pure source-order reordering of union members is intentionally NOT a regression, since TS unions are unordered, and is therefore not asserted); (b) `FactContractRow` is widened to admit `bigint`/`undefined`/function/`symbol` row values — proven by the four `@ts-expect-error` directives on row literals in Step 5(b); (c) `FactContract.keys` is widened from `Readonly<Record<...>>` to bare `Record<...>` or `FactContract.rows` is widened from `ReadonlyArray<...>` to `Array<...>` — proven by the two `@ts-expect-error` directives in Step 5(c) on `_result.keys.session_key = 2` and `_result.rows.push(...)`.
- [ ] No imports of `factContract.ts` are added to `web/src/lib/chatRuntime.ts` or `web/src/lib/anthropic.ts` in this slice (cutover is deferred to `08-synthesis-payload-cutover`).

## Out of scope
- Synthesis prompt construction, payload cutover, or removal of any per-contract import (handled by `08-synthesis-payload-cutover`).
- Validator implementation or `chat_query_trace.jsonl` side effects (handled by `08-validators-*`).
- Any change to existing semantic contract modules under `web/src/lib/contracts/` other than adding the new `factContract.ts` and `factContract.type-test.ts` files.

## Risk / rollback
New, additive module with no callers. Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/08-fact-contract-shape`
**Implementation commit:** `86f3ab4d4f84174ea7de36f658cde141cfe38c11`

### Files added (matches `Changed files expected`)
- `web/src/lib/contracts/factContract.ts` — `FactContractGrain`, `FactContractScalar`, `FactContractValue`, `FactContractRow`, `FactContract`, `SemanticContractSerializer<TInput>`, and `serializeRowsToFactContract` (top-level `Object.freeze`, `rowCount = rows.length`, conditional spread for optional `coverage`).
- `web/src/lib/contracts/factContract.type-test.ts` — compile-time gate covering: (a) `FactContractGrain` exact-union equality via `Expect<Equal<...>>`; (b) four `@ts-expect-error` directives on `FactContractRow` literals carrying `bigint` / `undefined` / function / `symbol` row values; (c) two `@ts-expect-error` directives on `_result.keys.session_key = 2` and `_result.rows.push({ a: 2 })` proving the readonly contract on `keys` and `rows`.
- `web/scripts/tests/fact-contract-shape.test.mjs` — four runtime cases (empty-rows `rowCount === 0`, non-empty `rowCount === rows.length`, top-level `Object.isFrozen` + `result.rowCount = 999` no-op/throw, `coverage` omission/presence). Loads `factContract.ts` via the in-process `ts.transpileModule` → `mkdtemp` → temp-`.mjs` → dynamic-`import()` pattern from `cache-control-markers.test.mjs`; cleans temp dir in a `finally` block. No new dev-dependency.

### Decisions / non-obvious choices
- `coverage` is added to the returned object via a conditional spread so that `Object.prototype.hasOwnProperty.call(result, "coverage") === false` when not provided (the runtime test asserts this).
- The return value of `serializeRowsToFactContract` is wrapped in `Object.freeze` *only* at the top level, matching the JSDoc comment and Step 3 immutability scope.
- The type-test file declares `_badBigint` / `_badUndefined` / `_badFunction` / `_badSymbol` and `_result` as plain `const`s with leading underscore. `tsconfig.json` does **not** set `noUnusedLocals`, so these constants do not produce unused-local errors; the four `@ts-expect-error` directives in (b) and the two in (c) are the only typecheck signals.
- The file ends with `export {};` so that under `isolatedModules` it parses unambiguously as a module.

### Gate command results

| Gate | Exit | Notes |
|---|---:|---|
| `cd web && npm run build` | 0 | Next.js production build succeeded. |
| `cd web && npm run typecheck` | 0 | `tsc --noEmit` clean across the whole `web/` project, including `factContract.type-test.ts` (six `@ts-expect-error` directives all consumed; `Expect<Equal<...>>` resolves to `true`). |
| `cd web && npm run test:grading` | 1 | The new `fact-contract-shape.test.mjs` is **discovered and all four cases pass** (`ok 20` … `ok 23` in the run output). However, the aggregate suite exits non-zero due to **14 pre-existing failures unrelated to this slice's `Changed files expected`**, in `answer-cache.test.mjs`, `driver-fallback.test.mjs`, `skip-repair.test.mjs`, and `zero-llm-path.test.mjs` (e.g. `"./anthropic.stub.mjs" does not provide an export named 'synthesizeAnswerStream'`). Verified independent of this slice via `git stash -u` on the same worktree: bare `slice/08-fact-contract-shape@d5521d9` runs **74 pass / 14 fail / 10 skip / 98 total**; with this slice's three new files **78 pass / 14 fail / 10 skip / 102 total** — same 14 failures, +4 new passing tests, no new failures introduced. The failing test files are not in this slice's `Changed files expected` and remediating them would change the slice intent, so this is flagged for auditor attention. |

### Acceptance-criteria self-check
- [x] `FactContract`, `FactContractGrain`, `FactContractScalar`, `FactContractValue`, `FactContractRow` exported from `web/src/lib/contracts/factContract.ts`; `rows` is `ReadonlyArray<FactContractRow>` (not `ReadonlyArray<Record<string, unknown>>`). Backed by Step 5(b)'s four `@ts-expect-error` directives, all consumed by `npm run typecheck` (exit 0).
- [x] `serializeRowsToFactContract` returns `rowCount === rows.length` for both empty and non-empty inputs and the returned object satisfies `Object.isFrozen(result) === true` at the top level. Backed by `fact-contract-shape.test.mjs` (cases 1, 2, and 3) and Step 5(c)'s two `@ts-expect-error` directives on nested readonly surfaces.
- [x] `cd web && npm run test:grading` discovers and passes `fact-contract-shape.test.mjs` (`ok 20`–`ok 23`); the test uses the prescribed in-process `ts.transpileModule` → `mkdtemp` → temp-`.mjs` → dynamic-`import()` pattern with `rm(dir, { recursive: true, force: true })` cleanup in a `finally`. The aggregate suite's exit code is 1 due to pre-existing, slice-external failures (see Gate-command-results note); this slice introduces no new failures.
- [x] `cd web && npm run typecheck` passes (exit 0). All three invariant classes in `factContract.type-test.ts` are exercised: (a) `Expect<Equal<FactContractGrain, ...>>`; (b) four `@ts-expect-error` directives on `FactContractRow` literals; (c) two `@ts-expect-error` directives on `_result.keys.session_key = 2` and `_result.rows.push(...)`.
- [x] No imports of `factContract.ts` were added to `web/src/lib/chatRuntime.ts` or `web/src/lib/anthropic.ts`. Verified: `git diff integration/perf-roadmap..HEAD -- web/src/lib/chatRuntime.ts web/src/lib/anthropic.ts` shows no diff.

## Audit verdict

**Status: REVISE**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `cd web && npm run test:grading` -> exit `1`
- `test:grading` failure context: `web/scripts/tests/answer-cache.test.mjs:373`, `web/scripts/tests/driver-fallback.test.mjs:223`, `web/scripts/tests/skip-repair.test.mjs:311`, and `web/scripts/tests/zero-llm-path.test.mjs:342` fail on this branch; representative errors are missing `synthesizeAnswerStream` from `anthropic.stub.mjs` and `ECONNREFUSED 127.0.0.1:1`.
- Scope diff `git diff --name-only integration/perf-roadmap...HEAD` -> in scope: `diagnostic/slices/08-fact-contract-shape.md`, `web/src/lib/contracts/factContract.ts`, `web/src/lib/contracts/factContract.type-test.ts`, `web/scripts/tests/fact-contract-shape.test.mjs`
- Criterion 1 PASS — `FactContract`, `FactContractGrain`, `FactContractScalar`, `FactContractValue`, and `FactContractRow` are exported and `rows` is `ReadonlyArray<FactContractRow>` in `web/src/lib/contracts/factContract.ts:1`; the forbidden-value type gates are present in `web/src/lib/contracts/factContract.type-test.ts:13`.
- Criterion 2 PASS — `serializeRowsToFactContract` sets `rowCount = input.rows.length`, applies top-level `Object.freeze`, and documents the non-deep-freeze limit in `web/src/lib/contracts/factContract.ts:29`; the runtime checks pass in `web/scripts/tests/fact-contract-shape.test.mjs:30`, `web/scripts/tests/fact-contract-shape.test.mjs:52`, `web/scripts/tests/fact-contract-shape.test.mjs:74`, and `web/scripts/tests/fact-contract-shape.test.mjs:109`, and the readonly type gates are in `web/src/lib/contracts/factContract.type-test.ts:23`.
- Criterion 3 PASS — `fact-contract-shape.test.mjs` is discovered by `npm run test:grading` and passes as subtests `20`-`23`; the TS-loading harness is implemented in `web/scripts/tests/fact-contract-shape.test.mjs:14`.
- Criterion 4 PASS — `cd web && npm run typecheck` exits `0`; the exact-union, forbidden-value, and readonly-mutation gates are present in `web/src/lib/contracts/factContract.type-test.ts:4`.
- Criterion 5 PASS — no imports were added to `web/src/lib/chatRuntime.ts` or `web/src/lib/anthropic.ts`; `git diff --unified=0 integration/perf-roadmap...HEAD -- web/src/lib/chatRuntime.ts web/src/lib/anthropic.ts` produced no hunks, and `rg -n "factContract" web/src web/scripts/tests` only finds the new type-test and runtime test.
- Decision: REVISE
- Rationale: the slice itself is in scope and its contract surfaces pass, but a declared mandatory gate still exits non-zero, so the slice cannot move to `ready_to_merge`.

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

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Rewrite Step 1a and the first acceptance criterion so they do not require `FactContractValue` to reject arbitrary class instances at compile time; with TypeScript’s structural typing, the proposed JSON-value alias can reliably exclude functions/symbols/`bigint`/`undefined`, but “class instance” rejection needs either a narrower concrete example or an explicit runtime validation step in a later slice. (Resolved by removing the "class instance" claim from Step 1a, the `rows` field doc in Step 1, and the matching acceptance criterion; structural-typing limitation is now stated explicitly and class-instance/non-plain-object rejection is deferred to `08-validators-*`.)

### Medium
- [x] Amend Step 4 and the `test:grading` acceptance item to specify how `fact-contract-shape.test.mjs` loads `web/src/lib/contracts/factContract.ts` under the existing `node --test scripts/tests/*.test.mjs` harness, because plain Node will not import a `.ts` module without the same explicit `typescript` transpile-to-temp-`.mjs` pattern used by sibling tests. (Resolved by adding a "TS-loading harness (mandatory)" subsection to Step 4 that pins the test to the same in-process `ts.transpileModule` → `mkdtemp` → temp-`.mjs` → dynamic-`import()` pattern used by `cache-control-markers.test.mjs`, and updating the `test:grading` acceptance item to require that pattern explicitly.)

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T21:27:37Z, so no stale-state note is needed.
- `web/package.json` defines `test:grading` as `node --test scripts/tests/*.test.mjs`, so any runtime test in this harness must be self-sufficient about TS loading.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High

### Medium
- [x] Amend Step 1/Step 3 and the matching acceptance text so the `keys` mutability contract is internally consistent: either make `keys` a readonly map type as part of `FactContract`, or stop claiming `Record<string, string | number | null>` conveys immutability for nested `keys` data when the helper only applies a top-level `Object.freeze`. (Resolved by retyping `keys` to `Readonly<Record<string, string | number | null>>` in Step 1, the Step 3 helper signature, and the acceptance criterion, so the type-level readonly guarantee on `keys` entries lines up with the runtime top-level `Object.freeze` on the returned `FactContract`. Step 3's doc text was rewritten to state precisely what `Object.freeze` covers (top-level property reassignment, including `keys`/`rows`/`coverage`) versus what type-level `Readonly<...>`/`ReadonlyArray<...>` covers (well-typed reassignment of nested entries), and to drop the previous over-claim that bare `Record<string, ...>` conveyed immutability.)

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T21:27:37Z, so no stale-state note is needed.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High
- [x] Add a compile-time gate file or extend `web/src/lib/contracts/factContract.type-test.ts` so `npm run typecheck` deterministically exercises the core contract claims for `FactContractRow` and nested readonly surfaces: assert that `bigint`, `undefined`, function, and `symbol` row values are rejected, and that writes like `result.keys.session_key = 1` / `result.rows.push(...)` fail, because the current plan’s acceptance criteria require those failures but no planned file actually triggers them. (Resolved by extending Step 5 with classes (b) and (c): four `@ts-expect-error` directives on `FactContractRow` literals carrying `bigint`/`undefined`/function/`symbol` values, and two `@ts-expect-error` directives on `_result.keys.session_key = 2` and `_result.rows.push({ a: 2 })`. The two matching acceptance criteria were rewritten to point at those specific directives as the deterministic typecheck surface, and the typecheck-pass acceptance criterion was rewritten to enumerate all three invariant classes in `factContract.type-test.ts`. The `Changed files expected` description for the type-test file was updated to enumerate the three gate classes.)

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T21:27:37Z, so no stale-state note is needed.

## Plan-audit verdict (round 7)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T21:27:37Z, so no stale-state note is needed.
