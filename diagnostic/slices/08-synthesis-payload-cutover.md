---
slice_id: 08-synthesis-payload-cutover
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T22:40:00Z
---

## Goal
Cut over synthesis prompt construction in `web/src/lib/chatRuntime.ts` to consume only `FactContract`-shaped payloads. Remove any direct contract-class imports (or class-instance call sites) from the synthesis path so that the prompt builder reads only fields defined by the `FactContract` type from `web/src/lib/contracts/factContract.ts`.

## Inputs
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/contracts/factContract.ts`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- `diagnostic/slices/08-fact-contract-shape.md`

## Required services / env
None at author time.

## Steps
1. Inventory pass: in `web/src/lib/chatRuntime.ts`, identify every site that builds the synthesis prompt (the function(s) that assemble the LLM input string / messages for the answer-synthesis call). Record each input field used and where it sources from. Capture the inventory inline in this slice's `Decisions` subsection (added during implementation) so the audit trail is in-tree.
2. Identify every import in `chatRuntime.ts` that resolves to a contract class or class-instance helper from `web/src/lib/contracts/` (anything that is not the `FactContract` type from `factContract.ts`). If none exist at the synthesis path, record that finding in `Decisions` and skip step 4.
3. For each synthesis-prompt input that currently reads from a contract-class field, replace the access with the equivalent `FactContract` field (per `web/src/lib/contracts/factContract.ts`). The synthesis path must end up reading only from values typed as `FactContract` (or arrays thereof).
4. Remove the now-unused contract-class imports from `chatRuntime.ts`. Do not modify `web/src/lib/contracts/` itself in this slice — the FactContract shape is fixed by the previous slice (`08-fact-contract-shape`).
5. Add (or extend) a `*.test.mjs` test under `web/scripts/tests/` (the directory `npm run test:grading` actually executes) that invokes the synthesis prompt-construction path with a hand-built `FactContract` fixture and asserts the rendered prompt contains the expected fields. The test must run under the existing `test:grading` runner — do not introduce a new test framework or place the test under `web/src/lib/__tests__/` (that path is not covered by the gate).

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- A chatRuntime synthesis test under `web/scripts/tests/` named `*.test.mjs` (e.g. `web/scripts/tests/chatRuntime-synthesis-payload.test.mjs`) so it is picked up by `npm run test:grading`. Implementer records the exact filename in the implementation-audit handoff.

## Artifact paths
None.

## Gate commands
```bash
# Build first: web/tsconfig.json includes .next/types/**/*.ts, which tsc
# --noEmit will fail to resolve on a clean worktree until next build emits
# them. So build precedes typecheck.
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
# Drift gate: chatRuntime.ts must import nothing from lib/contracts/
# except factContract. Implementation: list every contracts/ import line
# in the file, filter out factContract lines; if anything remains, fail.
# Uses POSIX ERE (no negative lookahead) so it runs in the repo shell.
# The leading `!` negates the pipeline exit so the gate exits 0 only when
# zero offending lines remain.
cd web && ! grep -nE "from ['\"][^'\"]*lib/contracts/" src/lib/chatRuntime.ts | grep -vE "lib/contracts/factContract"
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime.ts` imports nothing from `web/src/lib/contracts/` except the `FactContract` type (or related types) from `factContract.ts`. The drift-gate pipeline above exits 0.
- [ ] The synthesis prompt-construction function in `chatRuntime.ts` accepts `FactContract`-typed payloads and reads only fields defined by that type; this is enforced by the new/updated `web/scripts/tests/*.test.mjs` test.
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
- [ ] Specify a runnable `web/scripts/tests/*.test.mjs` harness for exercising the synthesis prompt path from `chatRuntime.ts`: either extract the prompt builder into a dependency-light module that the grading runner can import directly, or document every required transpile/path-alias rewrite and stub so the Node test does not fail on `@/lib/*` or other non-Node-resolvable dependencies.

### Medium
- [ ] Add a deterministic acceptance proof that the synthesis path is typed against `FactContract` rather than only rendering a prompt from one fixture, such as a `tsc`-checked type assertion or type-test covering the prompt-builder input surface.
- [ ] Add `diagnostic/slices/08-synthesis-payload-cutover.md` to `Changed files expected`, because Step 1 requires the implementer to record the synthesis-field inventory inline in this slice's `Decisions` subsection.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.
