---
slice_id: 08-synthesis-payload-cutover
phase: 8
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T22:22:58Z
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
5. Update or extend the existing chatRuntime synthesis tests so the prompt-construction call signature accepts and asserts a `FactContract`-typed payload. If a synthesis-prompt test does not yet exist, add a focused unit test that invokes the prompt-construction function with a hand-built `FactContract` fixture and asserts the rendered prompt contains the expected fields.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- A chatRuntime synthesis test file under `web/src/lib/__tests__/` (or the existing colocated test, if one exists — implementer picks the path matching the current test layout and records it in the implementation-audit handoff).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run typecheck
cd web && npm run build
cd web && npm run test:grading
# Drift gate: assert no contract-class imports remain in the synthesis path.
# The grep must exit 0 only when zero matches are found; non-FactContract
# imports from web/src/lib/contracts/ in chatRuntime.ts fail the gate.
cd web && ! grep -nE "from ['\"](\.\.?/)+lib/contracts/(?!factContract)" src/lib/chatRuntime.ts
cd web && ! grep -nE "from ['\"]@/lib/contracts/(?!factContract)" src/lib/chatRuntime.ts
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime.ts` imports nothing from `web/src/lib/contracts/` except the `FactContract` type (or related types) from `factContract.ts`. The two grep gates above both exit 0.
- [ ] The synthesis prompt-construction function in `chatRuntime.ts` accepts `FactContract`-typed payloads and reads only fields defined by that type; this is enforced by the updated/new unit test.
- [ ] `npm run typecheck` and `npm run build` are green.
- [ ] `npm run test:grading` is green for this slice's added/changed tests, and the repo-wide run does not regress (per `_state.md` Notes for auditors entry on `08-fact-contract-shape`: hold REVISE on any non-zero exit from the shared `test:grading` gate).

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
- [ ] Rewrite the two grep drift gates to use syntax the repo shell can execute; `grep -E` does not support the negative-lookahead expressions currently written, so the acceptance proof for "no non-`factContract` contract imports remain" is not runnable as specified.
- [ ] Reorder the web gates to run `cd web && npm run build` before `cd web && npm run typecheck`, because `web/tsconfig.json` includes `.next/types/**/*.ts` and a clean worktree can fail `tsc --noEmit` before the build generates those files.

### Medium
- [ ] Narrow `Changed files expected` and Step 5 to a test path that `cd web && npm run test:grading` actually executes, or add a separate gate for the declared test location; `test:grading` only runs `web/scripts/tests/*.test.mjs`, so a new test under `web/src/lib/__tests__/` would not prove the acceptance criteria.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-29T22:17:25Z, so no staleness note applies.
- Prior-context paths `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` and `diagnostic/slices/08-fact-contract-shape.md` both exist.
