---
slice_id: 09-split-chatRuntime-completeness
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T14:52:55Z
---

## Goal
Extract completeness-checks (have we got enough data to answer?) from chatRuntime.ts into chatRuntime/completeness.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/completeness.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target completeness-check functions/types in `web/src/lib/chatRuntime.ts`. Lock the final list before moving.
2. Move them verbatim to `web/src/lib/chatRuntime/completeness.ts` (a new module). Add re-exports back through `web/src/lib/chatRuntime.ts` for any symbol that another file currently imports from `@/lib/chatRuntime`, so existing public surface is preserved.
3. Update direct imports of the moved symbols across the codebase to point at `@/lib/chatRuntime/completeness`. As of audit time, the only external file that imports from `@/lib/chatRuntime` is `web/src/app/api/chat/route.ts`, and it currently imports `buildChatRuntime` / `ChatRuntimeResult` (neither is a completeness symbol); confirm via repo-wide `grep -rn "from \"@/lib/chatRuntime\"" web/src` before/after the move and list any additional callsites discovered. If no external callsite imports a moved symbol, document that finding in the slice-completion note rather than touching unrelated files.
4. Verify no new circular imports are introduced by the split (see Acceptance criteria for the explicit check).

## Changed files expected
- `web/src/lib/chatRuntime.ts` (moved bodies removed; re-exports added if needed)
- `web/src/lib/chatRuntime/completeness.ts` (new)
- Any direct-import callsite of a moved symbol identified by Step 3's grep. Expected at audit time: none beyond `chatRuntime.ts` itself, since `web/src/app/api/chat/route.ts` only imports `buildChatRuntime` / `ChatRuntimeResult`. If Step 3 finds additional callsites, append them to this list in the slice-completion note.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/completeness.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
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
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the required grading gate uses the loop baseline wrapper instead of failing on unrelated known grading regressions.

### Medium
- [x] Expand `Changed files expected` to cover the direct-import callsites Step 3 says will be updated; the current list only names the source and destination module files.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:46:37Z, so no stale-state note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] Define the split boundary so `completeness.ts` does not import private completeness/query-plan types or helpers back from `chatRuntime.ts`; `web/src/lib/chatRuntime.ts:33-86` and `web/src/lib/chatRuntime.ts:760-957` show the likely dependencies (`CompletenessStatus`, `RowVolume`, `Grain`, `SessionCandidate`, `DriverCandidate`, `TableCheck`, `QueryPlan`, `fallbackOptionsForTables`, `grainForQuestion`, `buildQueryPlan`), and leaving them behind would force a circular back-import or a non-verbatim rewrite.

### Medium
- [ ] Add an explicit circular-dependency gate and matching acceptance criterion for Step 4; precedent already exists at `diagnostic/slices/09-split-chatRuntime-resolution.md:43-50` (`cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime`), while this slice currently names the check in `diagnostic/slices/09-split-chatRuntime-completeness.md:28,47-50` but does not make it executable.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated at 2026-04-30T14:46:37Z, so no stale-state note applies.
- `rg -n 'from "@/lib/chatRuntime"' web/src` exited `0` and only found `web/src/app/api/chat/route.ts:9`, so Step 3's "audit time" assumption still matches the repo.
