---
slice_id: 09-split-answerSanity-count-list
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T20:55:00Z
---

## Goal
Extract count-vs-list sanity checks from answerSanity.ts into answerSanity/countList.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/countList.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts`.
2. Move them to `web/src/lib/answerSanity/countList.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/countList.ts`
- `web/src/app/api/chat/orchestration.ts` (only direct external import of `buildStructuredSummaryFromRows`; updated to import from `@/lib/answerSanity/countList` per Step 3)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/countList.ts` exists and exports the moved symbols.
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
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh`; raw `test:grading` is not an acceptable repo-wide gate because it ignores the loop baseline protocol from `diagnostic/_state.md`.

### Medium
- [x] Expand `Changed files expected` to cover the direct-import call sites named in Step 3; the current file list omits the codebase files the plan explicitly says it will edit.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T19:34:04Z, so no stale-state note is required.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: applied)**

### High
- [ ] None.

### Medium
- [ ] State explicitly that after the move, `answerSanity.ts` will both import-and-re-export `looksLikeStructuredRowDump` and `buildStructuredSummaryFromRows` from `./answerSanity/countList`, because the in-file caller `applyAnswerSanityGuards` (current lines 325–326) invokes both and a bare `export { … } from "./countList"` does not create the local bindings those calls need; without this clarification a literal implementer can ship a typecheck failure.
- [ ] Enumerate the exact symbol set Step 1/Step 2 must move so the diff is unambiguous: public `buildStructuredSummaryFromRows`; internal helpers `summarizeComparisonRows`, `summarizeRankedRows`, `summarizeGenericRows`, `looksLikeStructuredRowDump`, `formatScalarForNarrative`, `prettyMetricName`, `formatMetricValue`, `metricFromRows`; and any of the shared utilities (`asNumber`, `asString`, `driverLabel`, `hasAnyKey`) that no longer have a remaining caller in `answerSanity.ts` after the split (per the prior-slice convention of duplicating these tiny helpers per submodule rather than centralizing them).

### Low
- [ ] Step 3 currently reads "Update direct imports of these symbols across the codebase to point at the new file"; once the symbol enumeration above is added, also clarify that the ONLY external direct import is `web/src/app/api/chat/orchestration.ts:11` (already named in `Changed files expected`) so the implementer does not chase ghosts. The `web/scripts/tests/*.test.mjs` stubs that re-declare `buildStructuredSummaryFromRows` are local copies, not imports of the module under test, and are therefore out of scope.

### Notes (informational only — no action)
- Round-1 High and Medium items both verified resolved on the live slice body: gate now invokes `bash scripts/loop/test_grading_gate.sh`, and `Changed files expected` lists `orchestration.ts` with the rationale.
- Round-2 forced-findings ratchet: applied — without escalating the symbol-enumeration item from Low to Medium I would have approved on the strength of the round-1 fixes alone, but per the role prompt rounds 1–2 must produce concrete guidance for the reviser.
