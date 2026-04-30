---
slice_id: 09-split-chatRuntime-planTrace
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T15:25:57Z
---

## Goal
Extract plan-trace recording from chatRuntime.ts into chatRuntime/planTrace.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/planTrace.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts` (e.g., plan-trace recording helpers/types such as `recordPlanTrace`, `appendPlanTrace`, `PlanTraceEntry`, or whatever the plan-trace logic is named in the current file — the implementer enumerates the actual symbols during Step 1 and records them in the Slice-completion note).
2. Move them to `web/src/lib/chatRuntime/planTrace.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Run `rg "<moved symbol names>" web/src` to enumerate every direct import site of the moved symbols. If any external file imports them, update the import to `@/lib/chatRuntime/planTrace` and add that file to `Changed files expected` before committing. If `rg` returns only `web/src/lib/chatRuntime.ts` (i.e., the symbols are internal-only today), record that finding in the Slice-completion note and skip external import edits — the back-compat re-export keeps any future external caller working.
4. Verify no circular imports: the new `web/src/lib/chatRuntime/planTrace.ts` must not import from `web/src/lib/chatRuntime.ts`. Confirm `cd web && npm run build` and `cd web && npm run typecheck` succeed (both fail loudly on circular ESM resolution); these are the proof-of-record for this requirement.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/planTrace.ts`
- Any additional `web/src/**` files surfaced by the Step 3 ripgrep that directly import the moved symbols (expected to be zero based on a pre-plan scan, but the implementer must extend this list if Step 3 finds external import sites).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/planTrace.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] Step 3 ripgrep is recorded in the Slice-completion note; any external `web/src/**` import sites it surfaces resolve from `web/src/lib/chatRuntime/planTrace.ts` (or, if none exist, the note states that explicitly).
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` both exit 0, proving no circular import was introduced between `web/src/lib/chatRuntime.ts` and `web/src/lib/chatRuntime/planTrace.ts`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh` so the grading gate honors the repo baseline wrapper required by audit policy.

### Medium
- [x] Expand `## Changed files expected` to cover the direct-import rewrites from Step 3, or narrow Step 3 if only `chatRuntime.ts` and `chatRuntime/planTrace.ts` should change.
- [x] Add an explicit gate or acceptance check for Step 4's circular-import verification so the plan tests that requirement instead of leaving it implicit.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:22:22Z, so no staleness note applies.
