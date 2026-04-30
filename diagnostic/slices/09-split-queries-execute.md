---
slice_id: 09-split-queries-execute
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T19:30:00Z
---

## Goal
Extract the query-execute wrapper from queries.ts into queries/execute.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/execute.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target query-execute wrapper symbols in `web/src/lib/queries.ts` (the `runReadOnlySql` execute path plus any execute-only helpers/constants it depends on).
2. Move them to `web/src/lib/queries/execute.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Leave existing consumers importing from `web/src/lib/queries.ts` (the back-compat re-exports cover them). Consumer-import migration is out of scope for this slice; defer to a follow-up so the declared file scope matches the work done.
4. Verify no circular import by confirming the new file does not re-enter `queries.ts`: `grep -nE "from ['\"](\\.\\./queries|@/lib/queries)['\"]" web/src/lib/queries/execute.ts` must return zero matches. The `(cd web && npm run build)` and `(cd web && npm run typecheck)` gates also fail on a runtime/type-detectable cycle.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/execute.ts`

## Artifact paths
None.

## Gate commands
Run from the repo root. Each `web` gate is wrapped in a subshell so the parent shell's CWD does not drift; the final `grep` is intentionally repo-rooted.
```bash
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
grep -nE "from ['\"](\.\./queries|@/lib/queries)['\"]" web/src/lib/queries/execute.ts; test $? -eq 1
```

## Acceptance criteria
- [ ] `web/src/lib/queries/execute.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] `web/src/lib/queries/execute.ts` contains no import from `'../queries'` or `'@/lib/queries'` (verified via the grep gate above; circular-import guard).
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
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is evaluated through the loop baseline wrapper required by current audit policy.

### Medium
- [x] Expand `Changed files expected` to include the direct-import call sites from Step 3, because the plan currently scopes edits to only two files while explicitly requiring repo-wide import updates.
- [x] Add a concrete gate or acceptance check for Step 4's circular-import requirement; "Verify no circular imports" is currently untestable from the listed commands and criteria.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current on 2026-04-30, so no stale-state note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied)**

### High

### Medium
- [ ] Step 4's claim that `(cd web && npm run build)` and `(cd web && npm run typecheck)` "also fail on a runtime/type-detectable cycle" overstates the guarantees: `tsc --noEmit` does not error on import cycles, and `next build` does not statically reject them either (cycles silently produce undefined-at-init bindings). The grep is therefore the only real cycle guard. Either delete the misleading sentence or add a concrete transitive-cycle gate (e.g., `npx --yes madge --circular web/src/lib/queries/execute.ts` invoked from `web/`) to back the claim.

### Low
- [ ] The circular-import grep alternation `(\.\./queries|@/lib/queries)` does not catch deeper relative paths such as `'../../lib/queries'` or trailing `/index` forms; broaden the pattern (e.g., `(\.\./)+(lib/)?queries(/index)?` plus `@/lib/queries`) to harden the direct-import guard against unconventional resolution paths.
- [ ] Step 1's "execute-only helpers/constants it depends on" is a discovery instruction; with prior splits already moving sessions/resolver/catalog out, the residual move-set in `queries.ts` is now small and enumerable — naming the expected symbols inline would remove ambiguity for the implementer and the impl auditor.

### Notes (informational only — no action)
- Round-1 High and both Mediums are addressed; Medium #1 was resolved by deferring consumer-import migration in Step 3 (Changed files now matches Steps), which is internally consistent.
- The `grep ...; test $? -eq 1` idiom is fine under the loop's per-line gate runner (matches the convention used by other recently-merged Phase 9 split slices); not flagging.
