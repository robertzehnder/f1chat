---
slice_id: 09-split-queries-sessions
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract session-related queries from queries.ts into queries/sessions.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/sessions.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`.
2. Move them to `web/src/lib/queries/sessions.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Leave existing consumers importing from `web/src/lib/queries.ts` (the back-compat re-exports cover them). Consumer-import migration is out of scope for this slice; defer to a follow-up so the declared file scope matches the work done.
4. Verify no circular import by confirming the new file does not re-enter `queries.ts`: `grep -nE "from ['\"](\\.\\./queries|@/lib/queries)['\"]" web/src/lib/queries/sessions.ts` must return zero matches. The `cd web && npm run build` and `cd web && npm run typecheck` gates also fail on a runtime/type-detectable cycle.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/sessions.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
grep -nE "from ['\"](\.\./queries|@/lib/queries)['\"]" web/src/lib/queries/sessions.ts; test $? -eq 1
```

## Acceptance criteria
- [ ] `web/src/lib/queries/sessions.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] `web/src/lib/queries/sessions.ts` contains no import from `'../queries'` or `'@/lib/queries'` (verified via the grep gate above; circular-import guard).
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
- [ ] None.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the repo-required grading wrapper rather than the raw repo-wide gate.
- [x] Expand `Changed files expected` to include the direct-import consumer files Step 3 will modify, or narrow Step 3 so the declared file scope matches the work.
- [x] Make Step 4 and the acceptance criteria name a concrete circular-import verification method or gate; "Verify no circular imports" is not currently testable from this slice.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T17:38:27Z, so no staleness note is needed.
