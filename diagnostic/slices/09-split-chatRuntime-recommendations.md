---
slice_id: 09-split-chatRuntime-recommendations
phase: 9
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T11:15:30-04:00
---

## Goal
Extract follow-up recommendation logic from chatRuntime.ts into chatRuntime/recommendations.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/recommendations.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts` (e.g., `isFollowUp` and any related follow-up recommendation helpers/types).
2. Move them to `web/src/lib/chatRuntime/recommendations.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Run `rg "isFollowUp|<other moved symbol names>" web/src` to enumerate every direct import site of the moved symbols. If any external file imports them, update the import to `@/lib/chatRuntime/recommendations` and add that file to `Changed files expected` before committing. If `rg` returns only `web/src/lib/chatRuntime.ts` (i.e., the symbols are internal-only today), record that finding in the Slice-completion note and skip external import edits — the back-compat re-export keeps any future external caller working.
4. Verify no circular imports: the new file must not import from `web/src/lib/chatRuntime.ts`. Confirm `cd web && npm run build` and `cd web && npm run typecheck` succeed (both fail loudly on circular ESM resolution).

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/recommendations.ts`
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
- [ ] `web/src/lib/chatRuntime/recommendations.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] Every direct import of the moved symbols in `web/src/**` resolves from `web/src/lib/chatRuntime/recommendations.ts` (verified by the Step 3 ripgrep, whose result is recorded in the Slice-completion note).
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` succeed, which is the proof-of-record that no circular import was introduced between `chatRuntime.ts` and `chatRuntime/recommendations.ts`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-split-chatRuntime-recommendations`

**Commit hash:** head commit on `slice/09-split-chatRuntime-recommendations`, message tagged `[slice:09-split-chatRuntime-recommendations][awaiting-audit]`. This is the only implementation commit on the branch; the three prior commits ahead of `integration/perf-roadmap` are the planning-phase commits (`plan-revise`, `plan-revise: address round-1 audit items`, and `[plan-approved]`). Resolve with `git log -1 --format=%H slice/09-split-chatRuntime-recommendations` after pulling the branch.

**What moved:** Only `isFollowUp` was identified as follow-up recommendation logic in `web/src/lib/chatRuntime.ts`. Function body (3 lines including the `lower = normalize(...)` line and the regex test) was moved verbatim into `web/src/lib/chatRuntime/recommendations.ts`. The new file declares its own private `normalize` helper (matching the convention in `chatRuntime/classification.ts` and `chatRuntime/resolution.ts`, which each duplicate the same small helpers to avoid importing from `chatRuntime.ts`).

**Step 3 ripgrep result:** `rg "isFollowUp" web/` (run on the worktree) returned only `web/src/lib/chatRuntime.ts` (the import + re-export + call site) and `web/src/lib/chatRuntime/recommendations.ts` (the definition). No external file in `web/src/**` directly imports `isFollowUp`, so per the slice's Step 3 fallback ("If `rg` returns only `web/src/lib/chatRuntime.ts` … skip external import edits") no additional files were edited. The `export { isFollowUp };` statement added to `chatRuntime.ts` keeps any future external caller working through the back-compat path.

**Circular-import check (Step 4):** `chatRuntime/recommendations.ts` imports nothing from `chatRuntime.ts` (no imports at all — only the inline `normalize` helper). `cd web && npm run build` and `cd web && npm run typecheck` both succeed (exit 0), which is the proof-of-record per the acceptance criterion that no circular ESM resolution was introduced.

**Decisions:**
- Followed the precedent set by `chatRuntime/classification.ts` and `chatRuntime/resolution.ts` and inlined a private `normalize` helper instead of importing one from `chatRuntime.ts` (which would create the circular import the slice explicitly forbids).
- Added `export { isFollowUp };` in `chatRuntime.ts` for back-compat per Step 2, even though no external caller exists today.

**Gate-command exit codes (run in slice order from worktree root):**
1. `cd web && npm run build` → exit 0
2. `cd web && npm run typecheck` → exit 0
3. `bash scripts/loop/test_grading_gate.sh` → exit 0 (`slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`)

**Acceptance-criteria self-check:**
- [x] `web/src/lib/chatRuntime/recommendations.ts` exists and exports `isFollowUp`.
- [x] `web/src/lib/chatRuntime.ts` no longer contains the `isFollowUp` body — only an `import { isFollowUp } from "./chatRuntime/recommendations"` and an `export { isFollowUp };` re-export.
- [x] Step 3 ripgrep recorded above; only intra-module reference is the `chatRuntime.ts` call site, which now resolves through the new module.
- [x] `npm run build` and `npm run typecheck` succeed → no circular import.
- [x] All gate commands pass.

**Changed files (matches "Changed files expected"):**
- `web/src/lib/chatRuntime.ts` (modified — body removed, import + re-export added)
- `web/src/lib/chatRuntime/recommendations.ts` (new file)
- `diagnostic/slices/09-split-chatRuntime-recommendations.md` (slice metadata + this note; not in scope list because it's the slice file itself)

No other files were touched. The Step 3 ripgrep confirmed no external import sites exist, so the "expected to be zero" branch of the scope spec applied and no additional files were added to the changed-files list.

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace `cd web && npm run test:grading` in Gate commands with `bash scripts/loop/test_grading_gate.sh` so the slice uses the loop-approved grading wrapper instead of failing on known baseline issues.
- [x] Expand `Changed files expected` to cover the import sites Step 3 requires, or narrow Step 3 so the declared file scope matches the planned edits.

### Low
- [x] Add an acceptance criterion that makes Step 3 and Step 4 auditable by requiring all direct imports to resolve from `web/src/lib/chatRuntime/recommendations.ts` and the referenced gate(s) to be the proof that no circular import was introduced.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:09:50Z, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:09:50Z, so no stale-state note is needed.
