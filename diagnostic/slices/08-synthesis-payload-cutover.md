---
slice_id: 08-synthesis-payload-cutover
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T22:36:39Z
---

## Goal
Cut over synthesis prompt construction in `web/src/lib/chatRuntime.ts` to consume only `FactContract`-shaped payloads. Remove any direct contract-class imports (or class-instance call sites) from the synthesis path so that the prompt builder reads only fields defined by the `FactContract` type from `web/src/lib/contracts/factContract.ts`.

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
5. Test-harness extraction (addresses round-3 High): create a new dependency-light module at `web/src/lib/synthesis/buildSynthesisPrompt.ts` that exports the synthesis prompt-builder. This new module **must import nothing other than the `FactContract` type from `web/src/lib/contracts/factContract.ts`** — specifically, no imports of `@/lib/queries`, `@/lib/resolverCache`, `@/lib/perfTrace`, `@/lib/anthropic`, the `@anthropic-ai/sdk` package, or any other `@/lib/*` module. The exported function's signature must be `buildSynthesisPrompt(input: FactContract): { staticPrefix: string; dynamicSuffix: string }` (or `(input: readonly FactContract[])` if the inventory shows multi-contract synthesis). Rewire the existing call sites — `buildSynthesisPromptParts`/`buildSynthesisRequestParams` in `anthropic.ts` and the synthesis call in `route.ts` — to consume the new module. Then add `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs` that mirrors the pattern of `web/scripts/tests/fact-contract-shape.test.mjs`: read `web/src/lib/synthesis/buildSynthesisPrompt.ts`, run `ts.transpileModule` with `{ module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }`, write the output to a `mkdtemp` tmp `.mjs` file, dynamic-import it, then call `buildSynthesisPrompt` with a hand-built `FactContract` fixture and assert that the rendered prompt contains the expected fields (e.g. `contractName`, `grain`, `keys`, sample rows). The test must NOT attempt to transpile or import `chatRuntime.ts`, `anthropic.ts`, or `route.ts` directly — those have unresolvable `@/lib/*` and SDK dependencies that the grading runner cannot satisfy. The test must run under the existing `test:grading` runner — do not introduce a new test framework or place the test under `web/src/lib/__tests__/` (that path is not covered by the gate).
6. Type-signature proof (addresses round-3 Medium #1): because Step 5 declares the new module's exported signature as `(input: FactContract) => …`, every call site rewired in Step 5 must pass a `FactContract`-typed value. `cd web && npm run typecheck` will fail compilation if any caller still passes the legacy `{ rows, rowCount, runtime }` shape (which is structurally incompatible with `FactContract`). This is the deterministic, tsc-checked acceptance proof that the cutover is complete — no runtime fixture is sufficient on its own.

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
- [ ] `web/src/lib/chatRuntime.ts` and `web/src/lib/anthropic.ts` each import nothing from `web/src/lib/contracts/` except the `FactContract` type (or related types) from `factContract.ts`. Both drift-gate pipelines above exit 0.
- [ ] `web/src/lib/synthesis/buildSynthesisPrompt.ts` exists and exports a synthesis prompt-builder whose input parameter is typed exactly as `FactContract` (or `readonly FactContract[]` if the inventory shows multi-contract synthesis). The new module imports only the `FactContract` type from `web/src/lib/contracts/factContract.ts` and no other `@/lib/*` modules; both the contracts drift gate and the dep-light gate above exit 0.
- [ ] Because the new module's exported function is typed `(input: FactContract) => …` and every synthesis call site is rewired through it, `cd web && npm run typecheck` proves at compile time that no caller still passes the legacy `{ rows, rowCount, runtime }` payload — this is the deterministic, tsc-checked proof that the cutover is complete.
- [ ] The new `web/scripts/tests/*.test.mjs` test transpiles ONLY `web/src/lib/synthesis/buildSynthesisPrompt.ts` via `ts.transpileModule`, dynamic-imports it, and asserts the rendered prompt for a hand-built `FactContract` fixture contains the expected fields.
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
- [ ] Reconcile Step 5 / Step 6 / Acceptance with the current synthesis prompt surface: `web/src/lib/anthropic.ts:32` and `web/src/lib/anthropic.ts:119` still require `question` and `sql`, but `web/src/lib/contracts/factContract.ts:18` does not define either field, so `buildSynthesisPrompt(input: FactContract)` cannot replace `buildSynthesisPromptParts(input: AnswerSynthesisInput)` as written unless the slice explicitly preserves `question`/`sql` in a wrapper or intentionally changes the prompt contents.

### Medium
- [ ] Specify where the first `FactContract` value on the synthesis path is constructed and how `contractName`, `grain`, `keys`, and optional `coverage` are sourced, because the current route call site at `web/src/app/api/chat/route.ts:882` still passes `{ question, sql, rows, rowCount, runtime }` and the repo has no existing synthesis-path caller of `serializeRowsToFactContract` from `web/src/lib/contracts/factContract.ts:30`.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.
- `rg -n "from ['\\\"][^'\\\"]*lib/contracts/|import type .*factContract|serializeRowsToFactContract" web/src/lib/chatRuntime.ts web/src/lib/anthropic.ts` exited `1`; the current repo state shows no existing `lib/contracts` imports on those two files, so the slice’s proof needs to focus on the payload-producing cutover, not only import removal.
