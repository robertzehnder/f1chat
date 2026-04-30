---
slice_id: 09-split-queries-execute
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T18:07:34Z
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
1. Identify the target query-execute wrapper symbols in `web/src/lib/queries.ts`. After the prior Phase 9 splits (sessions/resolver/catalog), the residual move-set is small and enumerable. Move exactly these symbols:
   - `runReadOnlySql` (exported async function — the read-only execute path)
   - `safeLimit` (private helper used only by `runReadOnlySql`)
   - `DEFAULT_QUERY_MAX_ROWS`, `DEFAULT_PREVIEW_MAX_ROWS`, `DEFAULT_QUERY_TIMEOUT_MS` (module-private constants consumed by `runReadOnlySql`)

   Do NOT move `getOverviewStats`, `getGlobalTableCounts`, `parseCountValue`, `GLOBAL_TABLE_COUNT_SQL`, or `buildHeuristicSql` — they are not part of the execute wrapper and stay in `queries.ts` (or are handled by separate slices).
2. Move them to `web/src/lib/queries/execute.ts`; re-export `runReadOnlySql` from `web/src/lib/queries.ts` for back-compat. The private helper and constants do not need re-exports.
3. Leave existing consumers importing from `web/src/lib/queries.ts` (the back-compat re-export covers them). Consumer-import migration is out of scope for this slice; defer to a follow-up so the declared file scope matches the work done.
4. Verify no circular import by confirming the new file does not re-enter `queries.ts`. The grep gate (see Gate commands) is the authoritative direct-import guard; the madge gate covers transitive cycles. The `(cd web && npm run build)` / `(cd web && npm run typecheck)` gates do NOT reliably reject import cycles (tsc allows them and Next.js silently accepts them, often surfacing only as undefined-at-init runtime bindings), so the grep + madge pair is required.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/execute.ts`

## Artifact paths
None.

## Gate commands
Run from the repo root. Each `web` gate is wrapped in a subshell so the parent shell's CWD does not drift; the final `grep` is intentionally repo-rooted. The grep alternation covers the direct-import patterns the implementer might accidentally introduce: any depth of relative parents (`../queries`, `../../queries`, `../../lib/queries`, …), with optional `lib/` segment and optional trailing `/index`, plus the `@/lib/queries` alias form. The madge invocation backs the transitive-cycle claim in Step 4.
```bash
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
grep -nE "from ['\"]((\.\./)+(lib/)?queries(/index)?|@/lib/queries(/index)?)['\"]" web/src/lib/queries/execute.ts; test $? -eq 1
(cd web && npx --yes madge --circular --extensions ts,tsx src/lib/queries/execute.ts)
```

## Acceptance criteria
- [ ] `web/src/lib/queries/execute.ts` exists and exports `runReadOnlySql`; the private `safeLimit` helper and the three `DEFAULT_*` constants live in the new file (not re-exported).
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (`runReadOnlySql`, `safeLimit`, the three `DEFAULT_*` constants); a `runReadOnlySql` re-export from `./queries/execute` remains for back-compat.
- [ ] `web/src/lib/queries/execute.ts` contains no import that re-enters `queries.ts` via any depth of relative path or via the `@/lib/queries` alias (verified via the broadened grep gate above; direct-import guard).
- [ ] `madge --circular` reports zero cycles through `web/src/lib/queries/execute.ts` (transitive-cycle guard).
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
- [x] Step 4's claim that `(cd web && npm run build)` and `(cd web && npm run typecheck)` "also fail on a runtime/type-detectable cycle" overstates the guarantees: `tsc --noEmit` does not error on import cycles, and `next build` does not statically reject them either (cycles silently produce undefined-at-init bindings). The grep is therefore the only real cycle guard. Either delete the misleading sentence or add a concrete transitive-cycle gate (e.g., `npx --yes madge --circular web/src/lib/queries/execute.ts` invoked from `web/`) to back the claim.

### Low
- [x] The circular-import grep alternation `(\.\./queries|@/lib/queries)` does not catch deeper relative paths such as `'../../lib/queries'` or trailing `/index` forms; broaden the pattern (e.g., `(\.\./)+(lib/)?queries(/index)?` plus `@/lib/queries`) to harden the direct-import guard against unconventional resolution paths.
- [x] Step 1's "execute-only helpers/constants it depends on" is a discovery instruction; with prior splits already moving sessions/resolver/catalog out, the residual move-set in `queries.ts` is now small and enumerable — naming the expected symbols inline would remove ambiguity for the implementer and the impl auditor.

### Notes (informational only — no action)
- Round-1 High and both Mediums are addressed; Medium #1 was resolved by deferring consumer-import migration in Step 3 (Changed files now matches Steps), which is internally consistent.
- The `grep ...; test $? -eq 1` idiom is fine under the loop's per-line gate runner (matches the convention used by other recently-merged Phase 9 split slices); not flagging.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High

### Medium

### Low

### Notes (informational only — no action)
- Round-2 Medium and both Lows are resolved: Step 4 now correctly identifies grep + madge as the cycle guards (no more tsc/next overclaim), the grep alternation covers any-depth `../`, optional `lib/`, optional `/index`, and the `@/lib/queries` alias, and Step 1 enumerates exactly five symbols with an explicit do-NOT-move list.
- Caveat for codex: `npx --yes madge --circular --extensions ts,tsx src/lib/queries/execute.ts` runs without `--ts-config`, so madge's resolver may drop `@/lib/...` alias imports from the dependency graph and under-report transitive cycles routed through alias paths. The grep gate still guards the direct re-entry from `execute.ts` itself, and for a five-symbol mechanical extraction the residual risk is low; flagging as a note rather than escalating.
- Frontmatter, Steps, Acceptance criteria, Changed files, and Out of scope are internally consistent; gate commands are idempotent.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [ ] Make the transitive-cycle gate alias-aware by passing the project's TypeScript path config to `madge` (or explicitly narrow Step 4 and the acceptance criterion to relative-path cycles only); the current `npx --yes madge --circular --extensions ts,tsx src/lib/queries/execute.ts` invocation can under-report cycles that traverse `@/lib/*` imports.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T17:55:28Z, so no stale-state note applies.
