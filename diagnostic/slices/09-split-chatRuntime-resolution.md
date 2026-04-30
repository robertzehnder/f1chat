---
slice_id: 09-split-chatRuntime-resolution
phase: 9
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T14:44:57Z
---

## Goal
Extract entity-resolution wiring from chatRuntime.ts into chatRuntime/resolution.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/resolution.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target entity-resolution symbols in `web/src/lib/chatRuntime.ts` (e.g. `ResolutionStatus`, `requiresResolvedSession`, `sessionRecencyValue`, `compareSessionScored`, `buildSessionLabel`, `mergeSessionRows`, `mergeDriverRows`, `deriveResolutionStatus`, `scoreDriverCandidate`, plus their helper-only internals). Lock the final list before moving.
2. Move them verbatim to `web/src/lib/chatRuntime/resolution.ts` (a new module). Add `export *` (or named) re-exports back through `web/src/lib/chatRuntime.ts` for any symbol that another file currently imports from `@/lib/chatRuntime`, so existing public surface is preserved.
3. Update direct imports of the moved symbols across the codebase to point at `@/lib/chatRuntime/resolution`. As of the audit, the only external file that imports from `@/lib/chatRuntime` is `web/src/app/api/chat/route.ts`, and it currently imports `buildChatRuntime` / `ChatRuntimeResult` (neither is being moved); confirm via repo-wide grep before/after the move and list any additional callsites discovered. If no external callsite imports a moved symbol, document that finding in the slice-completion note rather than touching unrelated files.
4. Verify no new circular imports are introduced by the split (see Acceptance criteria for the explicit check).

## Changed files expected
- `web/src/lib/chatRuntime.ts` (moved bodies removed; re-exports added if needed)
- `web/src/lib/chatRuntime/resolution.ts` (new)
- Any direct-import callsite of a moved symbol identified by Step 3's grep. Expected at audit time: none beyond `chatRuntime.ts` itself, since `web/src/app/api/chat/route.ts` only imports `buildChatRuntime`/`ChatRuntimeResult`. If Step 3 finds additional callsites, append them to this list in the slice-completion note.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/resolution.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] A repo-wide `grep -rn "from \"@/lib/chatRuntime/resolution\"" web/src` shows every direct importer of a moved symbol resolves from `@/lib/chatRuntime/resolution`, while symbols still imported from `@/lib/chatRuntime` continue to resolve via the back-compat re-exports (verified by `npm run typecheck` succeeding without changing those callsites).
- [ ] `npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` (run from `web/`) reports no circular dependency involving `chatRuntime.ts` ↔ `chatRuntime/resolution.ts`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-split-chatRuntime-resolution` (from `integration/perf-roadmap`).

**Commit:** HEAD of `slice/09-split-chatRuntime-resolution` — single commit `refactor(chatRuntime): extract entity-resolution helpers into chatRuntime/resolution.ts` tagged `[slice:09-split-chatRuntime-resolution][awaiting-audit]`. Inspect with `git log -1 slice/09-split-chatRuntime-resolution`.

### Final moved-symbol list (Step 1 lock)

Locked the move list before edits to:
- Type: `ResolutionStatus` (now exported from `resolution.ts`)
- Constant (helper-only-internal): `SESSION_REQUIRED_TYPES` (private to `resolution.ts`; only `requiresResolvedSession` referenced it)
- Functions:
  - `requiresResolvedSession` (exported)
  - `sessionRecencyValue` (exported; only consumer was `compareScoredSessions`, but exported for symmetry with the other named moves)
  - `compareScoredSessions` (exported; the slice referred to it as `compareSessionScored` — confirmed the actual identifier is `compareScoredSessions`, no other symbol of that name exists)
  - `buildSessionLabel` (exported)
  - `mergeSessionRows` (exported)
  - `mergeDriverRows` (exported)
  - `deriveResolutionStatus` (exported)
  - `scoreDriverCandidate` (exported)
- Helper-only-internal: `isBroadSessionDiscoveryQuestion` (private to `resolution.ts`; only `requiresResolvedSession` referenced it)
- Co-moved (`isWarehouseWideQuestion`): `requiresResolvedSession` calls it, but `buildChatRuntime` also calls it directly at the completeness-gate site. Rather than duplicate the body or create a circular `chatRuntime.ts` ↔ `resolution.ts` import, moved it to `resolution.ts` and re-imported it into `chatRuntime.ts`.
- Local helpers in `resolution.ts` (kept private; same precedent as `classification.ts` carrying its own `normalize`):
  - `unique<T>` (used by `scoreDriverCandidate`)
  - `containsWholePhrase` (used by `scoreDriverCandidate`)

Decisions:
- No `export *` re-exports added to `chatRuntime.ts`. Step 3 grep showed no external file imports any moved symbol from `@/lib/chatRuntime`, so no back-compat surface had to be preserved.
- Trivial helpers `unique` / `containsWholePhrase` were duplicated locally rather than imported from `chatRuntime.ts`, to avoid creating a `chatRuntime.ts` ↔ `resolution.ts` circular import (which madge would flag); duplication is consistent with how `chatRuntime/classification.ts` already keeps its own private `normalize`.

### Step 3 grep result (direct importers of moved symbols)

`grep -rn "from \"@/lib/chatRuntime\"" web/src` returned exactly one match:

```
web/src/app/api/chat/route.ts:9:import { buildChatRuntime, type ChatRuntimeResult } from "@/lib/chatRuntime";
```

`buildChatRuntime` and `ChatRuntimeResult` are NOT in the moved set, so `route.ts` was left untouched. No additional callsites were discovered.

`grep -rn "from \"@/lib/chatRuntime/resolution\"" web/src` returned no matches; the only importer of `resolution.ts` is `web/src/lib/chatRuntime.ts` (relative import `./chatRuntime/resolution`), which is the expected single internal consumer.

### Step 4 — circularity check

`npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` (run from `web/`) reports `✔ No circular dependency found!` (3 files processed). `chatRuntime.ts → chatRuntime/resolution.ts` is a one-way edge.

### Gate command exit codes

| Gate | Exit code |
|---|---:|
| `cd web && npm run build` | 0 |
| `cd web && npm run typecheck` | 0 |
| `bash scripts/loop/test_grading_gate.sh` | 0 |
| `cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` | 0 |

Grading-gate baseline check: `[test_grading_gate] PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`.

### Self-checks against acceptance criteria

- [x] `web/src/lib/chatRuntime/resolution.ts` exists and exports the moved symbols.
- [x] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies — only the new import statement that re-binds `ResolutionStatus`, `requiresResolvedSession`, `isWarehouseWideQuestion`, `buildSessionLabel`, `mergeSessionRows`, `mergeDriverRows`, `compareScoredSessions`, `deriveResolutionStatus`, `scoreDriverCandidate` from `./chatRuntime/resolution`. `git diff --stat web/src/lib/chatRuntime.ts` shows `11 insertions(+), 167 deletions(-)` and `grep -n "isBroadSessionDiscoveryQuestion\|sessionRecencyValue\|SESSION_REQUIRED_TYPES" web/src/lib/chatRuntime.ts` returns no matches.
- [x] No external direct importer of a moved symbol exists. `web/src/app/api/chat/route.ts` continues to import only `buildChatRuntime` / `ChatRuntimeResult` from `@/lib/chatRuntime`; `npm run typecheck` passes without modifying that file. The repo-wide grep `from "@/lib/chatRuntime/resolution"` returned no matches outside the new module itself, confirming there are no external direct importers to update.
- [x] Madge reports no circular dependency between `chatRuntime.ts` and `chatRuntime/resolution.ts`.
- [x] All four gate commands exit 0.

### Changed files (matches "Changed files expected")

- `web/src/lib/chatRuntime.ts` — moved bodies removed; new import block added; no behavioral edits.
- `web/src/lib/chatRuntime/resolution.ts` — new module containing the moved symbols verbatim plus two trivially duplicated local helpers (`unique`, `containsWholePhrase`).
- No additional callsites were touched (Step 3 grep confirmed none exist).

### Round-2 re-verification (2026-04-30T10:40:52-04:00)

After the round-1 audit verdict (REVISE), no code changes were required — the round-1 audit confirmed the refactor stays in scope, criteria 1/2/4 PASS, the only failure was Gate #2 `cd web && npm run typecheck` exiting `2` with `TS6053` errors about missing `.next/types/app/api/{admin/perf-summary,chat,query/preview}/route.ts`. Those files are emitted by `next build` into `web/.next/types/...`, and tsc uses them via the Next.js TS plugin. Re-ran the four gates in the documented order in this worktree:

| Gate | Round-2 exit code |
|---|---:|
| `cd web && npm run build` | 0 |
| `cd web && npm run typecheck` | 0 |
| `bash scripts/loop/test_grading_gate.sh` | 0 (`slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`) |
| `cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` | 0 (`✔ No circular dependency found!`, 3 files processed) |

After Gate #1, `ls web/.next/types/app/api/{admin/perf-summary,chat,query/preview}/route.ts` lists all three files — i.e. `next build` does emit them. The most likely cause of the round-1 typecheck failure is that Gate #2 was run against a `.next/` directory that had been cleared (or never freshly built) between gates rather than the one Gate #1 just produced. Running the gate sequence end-to-end in one shell session in this worktree produces a clean exit `0` for typecheck, satisfying acceptance criteria 3 and 5 from `diagnostic/slices/09-split-chatRuntime-resolution.md:49,51`.

No additional commits were needed beyond the existing implementation commit `157314f` (`refactor(chatRuntime): extract entity-resolution helpers into chatRuntime/resolution.ts`); only the slice file frontmatter and this note are updated to advance the slice back to `awaiting_audit`.

## Audit verdict
**Status: PASS**

Gate #1 `cd web && npm run build` -> exit `0`

Gate #2 `cd web && npm run typecheck` -> exit `0`

Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`

Gate #4 `cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` -> exit `0`

Scope diff check -> PASS; `git diff --name-only integration/perf-roadmap...HEAD` returned `diagnostic/slices/09-split-chatRuntime-resolution.md`, `web/src/lib/chatRuntime.ts`, and `web/src/lib/chatRuntime/resolution.ts`, all in scope per `diagnostic/slices/09-split-chatRuntime-resolution.md:30-35`.

Criterion 1 -> PASS; `web/src/lib/chatRuntime/resolution.ts:4`, `web/src/lib/chatRuntime/resolution.ts:33`, `web/src/lib/chatRuntime/resolution.ts:45`, `web/src/lib/chatRuntime/resolution.ts:63`, `web/src/lib/chatRuntime/resolution.ts:68`, `web/src/lib/chatRuntime/resolution.ts:79`, `web/src/lib/chatRuntime/resolution.ts:90`, `web/src/lib/chatRuntime/resolution.ts:106`, `web/src/lib/chatRuntime/resolution.ts:122`, and `web/src/lib/chatRuntime/resolution.ts:132` export the moved symbols.

Criterion 2 -> PASS; `web/src/lib/chatRuntime.ts:16-26` contains the import wiring from `./chatRuntime/resolution`, and `rg -n 'function (isBroadSessionDiscoveryQuestion|isWarehouseWideQuestion|requiresResolvedSession|sessionRecencyValue|compareScoredSessions|buildSessionLabel|mergeSessionRows|mergeDriverRows|deriveResolutionStatus|scoreDriverCandidate)|type ResolutionStatus|SESSION_REQUIRED_TYPES' web/src/lib/chatRuntime.ts` returned only `web/src/lib/chatRuntime.ts:25:type ResolutionStatus`, i.e. the import specifier, not moved bodies.

Criterion 3 -> PASS; `grep -rn 'from "@/lib/chatRuntime/resolution"' web/src` exited `1` with no matches, so there are no direct external importers of moved symbols to update, while `grep -rn 'from "@/lib/chatRuntime"' web/src` returned `web/src/app/api/chat/route.ts:9`, which still imports only `buildChatRuntime` and `ChatRuntimeResult`; Gate #2 exit `0` verifies those imports still resolve.

Criterion 4 -> PASS; Gate #4 exited `0`, satisfying `diagnostic/slices/09-split-chatRuntime-resolution.md:50`.

Criterion 5 -> PASS; all gate commands exited `0`.

Decision -> PASS

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is baseline-aware per loop protocol.

### Medium
- [x] Expand `Changed files expected` to include the direct-import callsites Step 3 says will be updated, not only `chatRuntime.ts` and `chatRuntime/resolution.ts`.
- [x] Add an acceptance criterion that makes Step 3 testable by requiring direct imports of the moved symbols to resolve from `web/src/lib/chatRuntime/resolution.ts` while back-compat re-exports from `web/src/lib/chatRuntime.ts` remain intact.

### Low
- [x] Add an explicit gate or acceptance check for the “no circular imports” requirement in Step 4 instead of leaving it as an unverified instruction.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:25:18Z, so its auditor notes are current.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:25:18Z, so its auditor notes are current.
