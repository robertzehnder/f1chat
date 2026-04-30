---
slice_id: 09-split-answerSanity-count-list
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T21:45:00Z
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

## Symbols to move (exact set)

Per the convention established by sibling slices (sector / pitStints / gridFinish / strategyEvidence — confirmed by inspection: each duplicates the small helpers locally rather than centralizing), Step 1/Step 2 must move the following exact set of symbols from `web/src/lib/answerSanity.ts` to `web/src/lib/answerSanity/countList.ts`:

- **Public exports (relocated, then re-exported from `answerSanity.ts`):**
  - `buildStructuredSummaryFromRows` (currently at `answerSanity.ts:212`)
- **Internal helpers (relocated; called only by count/list code):**
  - `summarizeComparisonRows` (`answerSanity.ts:114`)
  - `summarizeRankedRows` (`answerSanity.ts:143`)
  - `summarizeGenericRows` (`answerSanity.ts:172`)
  - `looksLikeStructuredRowDump` (`answerSanity.ts:198`)
  - `formatScalarForNarrative` (`answerSanity.ts:185`)
  - `prettyMetricName` (`answerSanity.ts:77`)
  - `formatMetricValue` (`answerSanity.ts:85`)
  - `metricFromRows` (`answerSanity.ts:100`)
- **Shared utilities to relocate (per per-submodule duplication convention):** `asNumber` (`answerSanity.ts:50`), `asString` (`answerSanity.ts:61`), `driverLabel` (`answerSanity.ts:69`), `hasAnyKey` (`answerSanity.ts:96`). Verified by grep that after the count/list functions move, none of these four utilities have any remaining caller inside `answerSanity.ts` — every current call site sits inside one of the moved functions above. Therefore relocate them rather than leave dead code; do not centralize into a shared module (sibling slices already keep their own copies).

## Re-export shape in `answerSanity.ts` after the move

After the symbol relocation, `web/src/lib/answerSanity.ts` must:

1. **Import** `looksLikeStructuredRowDump` and `buildStructuredSummaryFromRows` from `./answerSanity/countList` so the in-file caller `applyAnswerSanityGuards` (current lines 325–326) keeps its local bindings — a bare `export { … } from "./answerSanity/countList"` does NOT create the local bindings those calls need and would cause a typecheck failure.
2. **Re-export** `buildStructuredSummaryFromRows` (public API consumed by `web/src/app/api/chat/orchestration.ts`).
3. `looksLikeStructuredRowDump` does not need to be re-exported (no external caller); the import alone satisfies the in-file usage.

Concrete example of the required top-of-file shape:
```ts
import { buildStructuredSummaryFromRows, looksLikeStructuredRowDump } from "./answerSanity/countList";
// ...other existing imports...

export { buildStructuredSummaryFromRows } from "./answerSanity/countList";
// ...other existing re-exports...
```

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts` per the **Symbols to move** section above.
2. Move them to `web/src/lib/answerSanity/countList.ts`. In `web/src/lib/answerSanity.ts`, both **import** (for the in-file caller `applyAnswerSanityGuards`) and **re-export** (for back-compat) per the **Re-export shape** section above.
3. Update direct imports of these symbols across the codebase to point at the new file. The ONLY external direct import is `web/src/app/api/chat/orchestration.ts:11` (`import { applyAnswerSanityGuards, buildStructuredSummaryFromRows } from "@/lib/answerSanity";`) — split into two imports so `buildStructuredSummaryFromRows` comes from `@/lib/answerSanity/countList` while `applyAnswerSanityGuards` continues to come from `@/lib/answerSanity`. The `web/scripts/tests/*.test.mjs` files that contain `export function buildStructuredSummaryFromRows(args) { … }` are local stubs/re-declarations inside test fixtures, not imports of the module under test, and are therefore out of scope.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/answerSanity.ts` (relocate symbols; add import + re-export of `buildStructuredSummaryFromRows`; add import of `looksLikeStructuredRowDump`)
- `web/src/lib/answerSanity/countList.ts` (new file containing the moved symbols listed above)
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
- [ ] `web/src/lib/answerSanity.ts` no longer contains the moved bodies (only imports + re-exports as specified).
- [ ] `applyAnswerSanityGuards` in `web/src/lib/answerSanity.ts` still typechecks — its calls to `looksLikeStructuredRowDump` and `buildStructuredSummaryFromRows` resolve to the imports from `./answerSanity/countList`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.
- Test-fixture stub files in `web/scripts/tests/*.test.mjs` that re-declare `buildStructuredSummaryFromRows` locally (not imports of the module under test).

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
- [x] State explicitly that after the move, `answerSanity.ts` will both import-and-re-export `looksLikeStructuredRowDump` and `buildStructuredSummaryFromRows` from `./answerSanity/countList`, because the in-file caller `applyAnswerSanityGuards` (current lines 325–326) invokes both and a bare `export { … } from "./countList"` does not create the local bindings those calls need; without this clarification a literal implementer can ship a typecheck failure.
- [x] Enumerate the exact symbol set Step 1/Step 2 must move so the diff is unambiguous: public `buildStructuredSummaryFromRows`; internal helpers `summarizeComparisonRows`, `summarizeRankedRows`, `summarizeGenericRows`, `looksLikeStructuredRowDump`, `formatScalarForNarrative`, `prettyMetricName`, `formatMetricValue`, `metricFromRows`; and any of the shared utilities (`asNumber`, `asString`, `driverLabel`, `hasAnyKey`) that no longer have a remaining caller in `answerSanity.ts` after the split (per the prior-slice convention of duplicating these tiny helpers per submodule rather than centralizing them).

### Low
- [x] Step 3 currently reads "Update direct imports of these symbols across the codebase to point at the new file"; once the symbol enumeration above is added, also clarify that the ONLY external direct import is `web/src/app/api/chat/orchestration.ts:11` (already named in `Changed files expected`) so the implementer does not chase ghosts. The `web/scripts/tests/*.test.mjs` stubs that re-declare `buildStructuredSummaryFromRows` are local copies, not imports of the module under test, and are therefore out of scope.

### Notes (informational only — no action)
- Round-1 High and Medium items both verified resolved on the live slice body: gate now invokes `bash scripts/loop/test_grading_gate.sh`, and `Changed files expected` lists `orchestration.ts` with the rationale.
- Round-2 forced-findings ratchet: applied — without escalating the symbol-enumeration item from Low to Medium I would have approved on the strength of the round-1 fixes alone, but per the role prompt rounds 1–2 must produce concrete guidance for the reviser.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- Round-2 Mediums verified resolved on the live slice body: the new `## Re-export shape in answerSanity.ts after the move` section explicitly distinguishes import-for-local-binding (both symbols) from re-export-for-public-API (only `buildStructuredSummaryFromRows`, since `looksLikeStructuredRowDump` has no external caller), and the new `## Symbols to move (exact set)` section enumerates every public/internal/shared symbol with line numbers and a grep-verified rationale for relocating the four shared utilities.
- Round-2 Low verified resolved: Step 3 now names `web/src/app/api/chat/orchestration.ts:11` as the ONLY external direct import and disambiguates the `web/scripts/tests/*.test.mjs` stubs as out-of-scope local re-declarations.
- Defensive observation (no action): once Step 3 splits the orchestration.ts import to pull `buildStructuredSummaryFromRows` from `@/lib/answerSanity/countList`, the `answerSanity.ts` re-export of that symbol becomes unused-but-harmless back-compat scaffolding; preserving it is a reasonable hedge for any future caller that imports from the parent path and matches the convention of sibling slices.
- Handing off to codex final plan audit per role-prompt verdict semantics; no remaining substantive findings.
