---
slice_id: 09-split-answerSanity-strategy-evidence
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract strategy-evidence sanity checks from answerSanity.ts into answerSanity/strategyEvidence.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/strategyEvidence.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts` (strategy/evidence sanity branches and their helpers — e.g. the strategy/one-stop/two-stop, pit-cycle-evidence, undercut/overcut-evidence guard branches and any strategy-evidence-only helpers they depend on).
2. Move them to `web/src/lib/answerSanity/strategyEvidence.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Audit direct imports of the moved symbols across `web/src` and `web/tests` with `grep -rn "<symbol>" web/src web/tests`. Update any direct importer to point at the new file (the back-compat re-export from `web/src/lib/answerSanity.ts` is the fallback path for indirect importers). At plan time the only known importer is `web/src/lib/answerSanity.ts` itself; if implementation finds additional direct importers, list them in the slice-completion note.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/strategyEvidence.ts`
- Any `web/src/**` or `web/tests/**` files that the Step 3 grep surfaces as direct importers of the moved symbols (none expected at plan time; `web/src/lib/answerSanity.ts` covers the only known importer).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

The build and typecheck gates serve as the proof-of-no-circular-imports
check (a circular import between `answerSanity.ts` and
`answerSanity/strategyEvidence.ts` would surface as a TypeScript module
resolution error or a runtime ReferenceError during `next build`'s
SSR/RSC analysis). No separate gate is added.

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/strategyEvidence.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/answerSanity.ts` no longer contains the moved bodies (only re-exports if needed).
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
- [x] Replace `cd web && npm run test:grading` with `cd web && bash ../scripts/loop/test_grading_gate.sh` so the grading gate is evaluated against the shared failure baseline rather than raw repo-wide failures.

### Medium
- [x] Expand `Changed files expected` to include the direct-import call sites Step 3 says will be updated; the current scope only lists the source and destination modules.
- [x] Make Step 4 testable by naming the concrete proof for “Verify no circular imports” in gates or acceptance criteria, or remove that step if the existing build/typecheck gates are the intended check.

### Low

### Notes (informational only — no action)
- None.
