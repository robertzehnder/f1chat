---
slice_id: 08-synthesis-payload-cutover
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T22:48:09Z
---

## Goal
Cut over the *row payload* the synthesis prompt builder consumes from the legacy `{ rows, rowCount, runtime }` shape to a `FactContract`-shaped value (per `web/src/lib/contracts/factContract.ts`). The orchestration-level fields `question` and `sql` (which are the user prompt and the generated SQL, not part of the row payload) remain inputs to the synthesis prompt builder unchanged — the row-payload cutover does not change the `Question:`, `SQL:`, `Row count:`, or `Rows (sample):` blocks of the prompt.

The `Runtime:` block of the prompt text **does change** as part of this cutover: today it serializes `JSON.stringify(input.runtime ?? {})` over the legacy `{ questionType, grain, resolvedEntities, completenessWarnings }` runtime object (see `web/src/lib/anthropic.ts:119` and the call site at `web/src/app/api/chat/route.ts:858`); after this slice it serializes the FactContract-derived `{ contractName, grain, keys, coverage }` summary in its place. This prompt-text drift is intentional and in-scope: the whole point of switching the row-payload field from a runtime metadata object to a FactContract is that downstream consumers see the contract-shaped names. It is the only prompt-text change introduced by this slice, and it is asserted explicitly by the new grading test (Step 5) and by Acceptance criterion #5.

After this slice, the synthesis prompt builder reads its row payload only via fields defined by the `FactContract` type, no contract-class imports remain on the synthesis path, and a deterministic, tsc-checked signature proves the cutover.

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/anthropic.ts` (the synthesis prompt builder — `AnswerSynthesisInput`, `buildSynthesisPromptParts`, `buildSynthesisRequestParams` — actually lives here today; Step 1 inventory must confirm before editing)
- `web/src/app/api/chat/route.ts` (synthesis call site that currently passes `{ rows, rowCount, runtime }` to the synthesizer)
- `web/src/lib/contracts/factContract.ts`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- `diagnostic/slices/08-fact-contract-shape.md`

## Required services / env
None at author time.

## Steps
1. Inventory pass: identify every site that builds the synthesis prompt (the function(s) that assemble the LLM input string / messages for the answer-synthesis call). Cover both `web/src/lib/chatRuntime.ts` and `web/src/lib/anthropic.ts` (the latter currently owns `buildSynthesisPromptParts`/`buildSynthesisRequestParams`/`AnswerSynthesisInput`), plus the call site in `web/src/app/api/chat/route.ts` (~lines 850–895) that passes `{ rows, rowCount, runtime }` into those builders. Record each input field used and where it sources from. Capture the inventory inline in this slice's `Decisions` subsection (added during implementation) so the audit trail is in-tree.
2. Identify every import in `chatRuntime.ts` AND `anthropic.ts` (and any other file the inventory surfaces on the synthesis path) that resolves to a contract class or class-instance helper from `web/src/lib/contracts/` (anything that is not the `FactContract` type from `factContract.ts`). If none exist at the synthesis path, record that finding in `Decisions` and skip step 4.
3. For each synthesis-prompt input that currently reads from a contract-class field, replace the access with the equivalent `FactContract` field (per `web/src/lib/contracts/factContract.ts`). The synthesis path must end up reading only from values typed as `FactContract` (or arrays thereof).
4. Remove the now-unused contract-class imports from the affected files (`chatRuntime.ts` and/or `anthropic.ts`). Do not modify `web/src/lib/contracts/` itself in this slice — the FactContract shape is fixed by the previous slice (`08-fact-contract-shape`).
5. Test-harness extraction (addresses round-3 High): create a new dependency-light module at `web/src/lib/synthesis/buildSynthesisPrompt.ts` that exports the synthesis prompt-builder. This new module **must import nothing other than the `FactContract` type from `web/src/lib/contracts/factContract.ts`** — specifically, no imports of `@/lib/queries`, `@/lib/resolverCache`, `@/lib/perfTrace`, `@/lib/anthropic`, the `@anthropic-ai/sdk` package, or any other `@/lib/*` module. The exported function's signature must be exactly:
   ```ts
   buildSynthesisPrompt(input: {
     question: string;
     sql: string;
     contract: FactContract;
   }): { staticPrefix: string; dynamicSuffix: string }
   ```
   Rationale (addresses round-4 High): the existing prompt at `web/src/lib/anthropic.ts:124-141` interpolates `question` and `sql` directly, and `FactContract` (per `web/src/lib/contracts/factContract.ts:18-25`) intentionally does not carry those fields — they are orchestration inputs, not row payload. Wrapping them as siblings of a `contract: FactContract` field preserves the existing prompt text verbatim while making the row payload the only `FactContract`-shaped input. If a future slice consolidates `question`/`sql` into `FactContract`, that is out-of-scope here.
   Rewire the existing call sites — `buildSynthesisPromptParts`/`buildSynthesisRequestParams` in `anthropic.ts` and the synthesis call site(s) in `route.ts` — to consume the new module. The `dynamicSuffix` body must continue to render `Question:`, `SQL:`, `Row count:`, `Rows (sample):`, and `Runtime:` blocks. Sourcing inside the new module is:
   - `Question:` block ← `input.question` (unchanged from legacy)
   - `SQL:` block ← `input.sql` (unchanged from legacy)
   - `Row count:` block ← `input.contract.rowCount` (was `input.rowCount`; same numeric value, no text drift)
   - `Rows (sample):` block ← `JSON.stringify(input.contract.rows.slice(0, 25), null, 2)` (was `input.rows.slice(0, 25)`; same array content, no text drift)
   - `Runtime:` block ← `JSON.stringify({ contractName: input.contract.contractName, grain: input.contract.grain, keys: input.contract.keys, coverage: input.contract.coverage ?? null })` — this **replaces** the legacy `JSON.stringify(input.runtime ?? {})` over `{ questionType, grain, resolvedEntities, completenessWarnings }`. The four-key object literal (`contractName`, `grain`, `keys`, `coverage`) is the canonical Runtime-block payload going forward; key order is fixed for stable rendering. See Goal for why this prompt-text drift in the Runtime block is intentional and the only prompt-text change in this slice.

   Then add `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs` that mirrors the pattern of `web/scripts/tests/fact-contract-shape.test.mjs`: read `web/src/lib/synthesis/buildSynthesisPrompt.ts`, run `ts.transpileModule` with `{ module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }`, write the output to a `mkdtemp` tmp `.mjs` file, dynamic-import it, then call `buildSynthesisPrompt` with a hand-built `{ question, sql, contract: <FactContract fixture> }` argument and assert:
   1. The rendered prompt contains the expected `Question:`, `SQL:`, `Row count:`, and `Rows (sample):` blocks sourced from the fixture's `question`, `sql`, `contract.rowCount`, and `contract.rows` values.
   2. The rendered prompt contains a `Runtime:` block whose body is **exactly** `JSON.stringify({ contractName, grain, keys, coverage })` for the fixture's FactContract values (assert via substring match on the four keys in fixed order, e.g. `"contractName":"…","grain":"…","keys":{…},"coverage":…`). This locks in the intentional Runtime-block prompt-text change.
   3. The rendered prompt **does NOT** contain the legacy runtime keys `questionType`, `resolvedEntities`, or `completenessWarnings` anywhere in the Runtime block — proving the legacy serialized text is gone. (Grep-style negative assertions on those three substrings within the rendered Runtime block.)
   The test must NOT attempt to transpile or import `chatRuntime.ts`, `anthropic.ts`, or `route.ts` directly — those have unresolvable `@/lib/*` and SDK dependencies that the grading runner cannot satisfy. The test must run under the existing `test:grading` runner — do not introduce a new test framework or place the test under `web/src/lib/__tests__/` (that path is not covered by the gate).
6. Type-signature proof (addresses round-3 Medium #1 and round-4 High): because Step 5 declares the new module's exported signature as `(input: { question: string; sql: string; contract: FactContract }) => …`, every rewired call site must pass a value whose `contract` field is structurally typed as `FactContract`. `cd web && npm run typecheck` will fail compilation if any caller still passes the legacy `{ rows, rowCount, runtime }` shape under `contract` (or omits `contract` entirely), which is structurally incompatible with `FactContract`. This is the deterministic, tsc-checked acceptance proof that the row-payload cutover is complete — no runtime fixture is sufficient on its own.
7. FactContract construction site (addresses round-4 Medium): rewire `web/src/app/api/chat/route.ts` (the synthesis call sites at ~lines 858–869 for `synthesizeAnswerStream` and ~lines 882–893 for `cachedSynthesize`) so the FactContract value is produced at the call site and passed into the new builder under `contract`. Concretely, before the synthesis call, import `serializeRowsToFactContract` (and the `FactContractGrain` type if needed for the mapping) from `@/lib/contracts/factContract`, then construct:
   ```ts
   const contract = serializeRowsToFactContract({
     contractName: runtime.questionType ?? "synthesis_payload",
     grain: mapToFactContractGrain(runtime.grain.grain), // map to one of "session"|"lap"|"stint"|"driver"|"meeting"|"other", default "other"
     keys: filterScalarKeys(runtime.queryPlan.resolved_entities), // narrow to Record<string, string|number|null>
     rows: result.rows,
     ...(runtime.completeness.warnings.length > 0
       ? { coverage: { warnings: runtime.completeness.warnings } }
       : {}),
   });
   ```
   Pass `{ question: message, sql: result.sql, contract }` into the synthesis path (via the rewired `synthesizeAnswerStream`/`cachedSynthesize` signatures, which now accept the wrapper input from Step 5). The two helpers `mapToFactContractGrain` and `filterScalarKeys` may be inlined in `route.ts` as local functions (they are mapping/narrowing helpers — keep them tiny and untyped beyond their inputs). Sourcing summary, in-tree-traceable: `contractName` ← `runtime.questionType` (string, fallback `"synthesis_payload"`); `grain` ← `runtime.grain.grain` mapped to the `FactContractGrain` union; `keys` ← `runtime.queryPlan.resolved_entities` filtered to scalar (string | number | null) values; `rows` ← `result.rows`; `coverage.warnings` ← `runtime.completeness.warnings` (only when non-empty). The implementer should record the exact derived names and any narrowing decisions inline in this slice's `Decisions` subsection (added during implementation) per Step 1's audit-trail requirement.

## Changed files expected
- `diagnostic/slices/08-synthesis-payload-cutover.md` (Step 1 requires the implementer to record the synthesis-field inventory inline in this slice's `Decisions` subsection — that edit is in-scope for this slice's commit)
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/anthropic.ts` (the existing `AnswerSynthesisInput` / `buildSynthesisPromptParts` / `buildSynthesisRequestParams` are rewired through the new dep-light module per Step 5; if the inventory finds the prompt construction lives only here and not in `chatRuntime.ts`, that is the expected discovery and Steps 2–4 act on this file)
- `web/src/app/api/chat/route.ts` (the synthesis call site at ~lines 850–895 is updated to pass a `FactContract`-shaped payload into the new module)
- `web/src/lib/synthesis/buildSynthesisPrompt.ts` (new dependency-light module; imports only the `FactContract` type from `web/src/lib/contracts/factContract.ts`)
- A chatRuntime synthesis test under `web/scripts/tests/` named `*.test.mjs` (e.g. `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs`) so it is picked up by `npm run test:grading`. Implementer records the exact filename in the implementation-audit handoff.

## Artifact paths
None.

## Gate commands
```bash
# Build first: web/tsconfig.json includes .next/types/**/*.ts, which tsc
# --noEmit will fail to resolve on a clean worktree until next build emits
# them. So build precedes typecheck.
cd web && npm run build
# typecheck doubles as the deterministic FactContract-typing proof per
# Step 6: with buildSynthesisPrompt's input typed `FactContract`, any
# legacy `{ rows, rowCount, runtime }` caller fails compilation here.
cd web && npm run typecheck
cd web && npm run test:grading
# Drift gate (chatRuntime.ts): must import nothing from lib/contracts/
# except factContract. Implementation: list every contracts/ import line
# in the file, filter out factContract lines; if anything remains, fail.
# Uses POSIX ERE (no negative lookahead) so it runs in the repo shell.
# The leading `!` negates the pipeline exit so the gate exits 0 only when
# zero offending lines remain.
cd web && ! grep -nE "from ['\"][^'\"]*lib/contracts/" src/lib/chatRuntime.ts | grep -vE "lib/contracts/factContract"
# Drift gate (anthropic.ts): same rule for the synthesis prompt builder
# location, since it also touches the synthesis path.
cd web && ! grep -nE "from ['\"][^'\"]*lib/contracts/" src/lib/anthropic.ts | grep -vE "lib/contracts/factContract"
# Drift gate (new prompt-builder module): must import nothing from
# lib/contracts/ except factContract.
cd web && ! grep -nE "from ['\"][^'\"]*lib/contracts/" src/lib/synthesis/buildSynthesisPrompt.ts | grep -vE "lib/contracts/factContract"
# Dep-light gate (new prompt-builder module): must NOT import any
# project-internal `@/lib/*` module other than `@/lib/contracts/factContract`.
# This guarantees `ts.transpileModule` + dynamic-import in the grading
# test can run the file standalone without resolving Next.js path aliases
# or other `@/lib/*` deps.
cd web && ! grep -nE "from ['\"]@/lib/" src/lib/synthesis/buildSynthesisPrompt.ts | grep -vE "@/lib/contracts/factContract"
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime.ts` and `web/src/lib/anthropic.ts` each import nothing from `web/src/lib/contracts/` except the `FactContract` type (or related types) from `factContract.ts`. Both drift-gate pipelines above exit 0. (Per round-4 Notes, the current repo state already has zero `lib/contracts/` imports on those two files; the drift gates lock that state in for this slice and any future regressions.)
- [ ] `web/src/lib/synthesis/buildSynthesisPrompt.ts` exists and exports a synthesis prompt-builder whose input parameter is typed exactly as `{ question: string; sql: string; contract: FactContract }`, with the `contract` field's static type being `FactContract` (sourced from `factContract.ts`). The new module imports only the `FactContract` type from `web/src/lib/contracts/factContract.ts` and no other `@/lib/*` modules; both the contracts drift gate and the dep-light gate above exit 0.
- [ ] `web/src/app/api/chat/route.ts` constructs a `FactContract` value via `serializeRowsToFactContract` (imported from `@/lib/contracts/factContract`) at each synthesis call site (~lines 858–869 and ~lines 882–893) and passes it as the `contract` field of the wrapper input — no synthesis call site passes the legacy `{ rows, rowCount, runtime }` shape into the prompt builder.
- [ ] Because the new module's exported function is typed `(input: { question: string; sql: string; contract: FactContract }) => …` and every synthesis call site is rewired through it, `cd web && npm run typecheck` proves at compile time that no caller still passes the legacy `{ rows, rowCount, runtime }` payload as the row-payload field — this is the deterministic, tsc-checked proof that the row-payload cutover is complete.
- [ ] The new `web/scripts/tests/*.test.mjs` test transpiles ONLY `web/src/lib/synthesis/buildSynthesisPrompt.ts` via `ts.transpileModule`, dynamic-imports it, and asserts the rendered prompt for a hand-built `{ question, sql, contract: <FactContract fixture> }` argument contains the expected `Question:`, `SQL:`, `Row count:`, and `Rows (sample):` blocks. The test additionally asserts the `Runtime:` block body is exactly `JSON.stringify({ contractName, grain, keys, coverage })` for the fixture's FactContract values (positive substring match on the four keys in fixed order) **and** that the legacy runtime keys `questionType`, `resolvedEntities`, and `completenessWarnings` are absent from the Runtime block (negative substring match) — locking in the intentional Runtime-block prompt-text change called out in the Goal.
- [ ] `npm run build` (run first) and `npm run typecheck` are both green.
- [ ] `npm run test:grading` is green for this slice's added/changed test, and the repo-wide run does not regress (per `_state.md` Notes for auditors entry on `08-fact-contract-shape`: hold REVISE on any non-zero exit from the shared `test:grading` gate).

## Out of scope
- Modifying the `FactContract` shape or anything under `web/src/lib/contracts/`.
- Adding a post-answer validator (that work belongs to a separate, later slice; this slice is the payload-shape cutover only).
- Logging or trace changes (e.g., `chat_query_trace.jsonl`).

## Risk / rollback
Rollback: `git revert <commit>`. The grep drift gates make accidental re-introduction of contract-class imports detectable in any future slice.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Rewrite the Steps and Acceptance criteria to implement the stated goal: cut synthesis prompt construction over to `FactContract`-shaped payloads and remove direct contract-class imports from the synthesis path, rather than adding a post-answer validator.

### Medium
- [x] Fix the `## Prior context` block so every bullet is an actual artifact path; move the prose note about Phase 11 re-baselining out of that section or replace it with a concrete file path.
- [x] Expand `## Changed files expected` to include the validator/test/logging files the plan's own Steps require, or narrow the Steps so they match the declared file scope.
- [x] Add a gate or explicit test step that proves the `chat_query_trace.jsonl` logging behavior in Acceptance criteria, or remove that criterion if this slice is only supposed to assert the validator behavior.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Rewrite the two grep drift gates to use syntax the repo shell can execute; `grep -E` does not support the negative-lookahead expressions currently written, so the acceptance proof for "no non-`factContract` contract imports remain" is not runnable as specified.
- [x] Reorder the web gates to run `cd web && npm run build` before `cd web && npm run typecheck`, because `web/tsconfig.json` includes `.next/types/**/*.ts` and a clean worktree can fail `tsc --noEmit` before the build generates those files.

### Medium
- [x] Narrow `Changed files expected` and Step 5 to a test path that `cd web && npm run test:grading` actually executes, or add a separate gate for the declared test location; `test:grading` only runs `web/scripts/tests/*.test.mjs`, so a new test under `web/src/lib/__tests__/` would not prove the acceptance criteria.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Specify a runnable `web/scripts/tests/*.test.mjs` harness for exercising the synthesis prompt path from `chatRuntime.ts`: either extract the prompt builder into a dependency-light module that the grading runner can import directly, or document every required transpile/path-alias rewrite and stub so the Node test does not fail on `@/lib/*` or other non-Node-resolvable dependencies.

### Medium
- [x] Add a deterministic acceptance proof that the synthesis path is typed against `FactContract` rather than only rendering a prompt from one fixture, such as a `tsc`-checked type assertion or type-test covering the prompt-builder input surface.
- [x] Add `diagnostic/slices/08-synthesis-payload-cutover.md` to `Changed files expected`, because Step 1 requires the implementer to record the synthesis-field inventory inline in this slice's `Decisions` subsection.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Reconcile Step 5 / Step 6 / Acceptance with the current synthesis prompt surface: `web/src/lib/anthropic.ts:32` and `web/src/lib/anthropic.ts:119` still require `question` and `sql`, but `web/src/lib/contracts/factContract.ts:18` does not define either field, so `buildSynthesisPrompt(input: FactContract)` cannot replace `buildSynthesisPromptParts(input: AnswerSynthesisInput)` as written unless the slice explicitly preserves `question`/`sql` in a wrapper or intentionally changes the prompt contents.

### Medium
- [x] Specify where the first `FactContract` value on the synthesis path is constructed and how `contractName`, `grain`, `keys`, and optional `coverage` are sourced, because the current route call site at `web/src/app/api/chat/route.ts:882` still passes `{ question, sql, rows, rowCount, runtime }` and the repo has no existing synthesis-path caller of `serializeRowsToFactContract` from `web/src/lib/contracts/factContract.ts:30`.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.
- `rg -n "from ['\\\"][^'\\\"]*lib/contracts/|import type .*factContract|serializeRowsToFactContract" web/src/lib/chatRuntime.ts web/src/lib/anthropic.ts` exited `1`; the current repo state shows no existing `lib/contracts` imports on those two files, so the slice’s proof needs to focus on the payload-producing cutover, not only import removal.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [x] Reconcile Step 5 and the Acceptance criteria with the current synthesis prompt text in [web/src/lib/anthropic.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-synthesis-payload-cutover/web/src/lib/anthropic.ts:119): the live `Runtime:` block is `JSON.stringify(input.runtime ?? {})` over `{ questionType, grain, resolvedEntities, completenessWarnings }` from [route.ts](/Users/robertzehnder/.openf1-loop-worktrees/08-synthesis-payload-cutover/web/src/app/api/chat/route.ts:858), but the slice now allows replacing it with a derived `{ contractName, grain, keys, coverage }` summary while still claiming the prompt’s textual contents do not change; either narrow the goal/acceptance to permit that prompt-content change or specify an exact compatibility mapping and test assertion that preserves the existing serialized runtime text.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High
- [ ] Fix Step 7 and Acceptance criterion #3 so `contractName` is sourced from an actual semantic contract/table identifier on the synthesis path, not `runtime.questionType`; `FactContract.contractName` was defined in `diagnostic/slices/08-fact-contract-shape.md` as the contract identifier (for example `core.laps_enriched`), and using values like `aggregate_analysis` would break the stated contract-shaped Runtime payload.

### Medium
- [ ] Reconcile Step 5 with the Goal and Acceptance criterion #5 by preserving the existing `Rows (sample):` prompt text exactly or explicitly allowing that drift; the current live prompt in `web/src/lib/anthropic.ts:122-134` uses `JSON.stringify(input.rows.slice(0, 25))`, but the plan now specifies `JSON.stringify(input.contract.rows.slice(0, 25), null, 2)`, which changes the prompt text outside the Runtime block.
- [ ] Add an acceptance proof for the “only prompt-text change is the Runtime block” claim: require the extracted builder to keep the existing synthesis instructions/static prefix and non-Runtime dynamic blocks byte-for-byte compatible with the current prompt, or narrow the Goal to permit additional prompt drift.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.
