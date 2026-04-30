---
slice_id: 09-split-deterministicSql-strategy
phase: 9
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T12:18:07-04:00
---

## Goal
Extract strategy-related SQL from deterministicSql.ts into deterministicSql/strategy.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/strategy.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target strategy-related functions/types in `web/src/lib/deterministicSql.ts` (e.g., strategy SQL builders/templates such as `buildStrategy*Sql`, `STRATEGY_*` constants, or whatever the strategy logic is named in the current file — the implementer enumerates the actual symbols during Step 1 and records them in the Slice-completion note).
2. Move them to `web/src/lib/deterministicSql/strategy.ts`; re-export from `web/src/lib/deterministicSql.ts` for back-compat.
3. Run `rg "<moved symbol names>" web/src` to enumerate every direct import site of the moved symbols. If any external file imports them, update the import to `@/lib/deterministicSql/strategy` and add that file to `Changed files expected` before committing. If `rg` returns only `web/src/lib/deterministicSql.ts` (i.e., the symbols are internal-only today), record that finding in the Slice-completion note and skip external import edits — the back-compat re-export keeps any future external caller working.
4. Verify no circular imports via a source-level check: `web/src/lib/deterministicSql/strategy.ts` must not contain any `import`/`from` statement that resolves to `web/src/lib/deterministicSql.ts` (i.e., no `'../deterministicSql'`, `'../deterministicSql.js'`, `'@/lib/deterministicSql'`, or `'@/lib/deterministicSql.js'` specifier). The grep gate below is the direct proof-of-record; `npm run build` / `npm run typecheck` remain belt-and-braces but are not the primary evidence for this requirement.

## Changed files expected
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/deterministicSql/strategy.ts`
- Any additional `web/src/**` files surfaced by the Step 3 ripgrep that directly import the moved symbols (expected to be zero based on a pre-plan scan, but the implementer must extend this list if Step 3 finds external import sites).

## Artifact paths
None.

## Gate commands
```bash
# Source-level no-circular-import check: strategy.ts must NOT import from deterministicSql.ts.
# This grep must produce zero matches (the leading `!` inverts rg's exit code).
! rg -nP "(?:from|import)\s+['\"](?:\.\./deterministicSql|@/lib/deterministicSql)(?:\.js)?['\"]" web/src/lib/deterministicSql/strategy.ts
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/strategy.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] Step 3 ripgrep is recorded in the Slice-completion note; any external `web/src/**` import sites it surfaces resolve from `web/src/lib/deterministicSql/strategy.ts` (or, if none exist, the note states that explicitly).
- [ ] The source-level grep gate (`! rg -nP "(?:from|import)\s+['\"](?:\.\./deterministicSql|@/lib/deterministicSql)(?:\.js)?['\"]" web/src/lib/deterministicSql/strategy.ts`) exits 0 with no matches, directly proving `web/src/lib/deterministicSql/strategy.ts` does not import from `web/src/lib/deterministicSql.ts`.
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` both exit 0 (secondary corroboration of no circular ESM resolution).
- [ ] All gate commands pass.

## Decisions
- The audit item literally read "Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh`". The wrapper script lives at `scripts/loop/test_grading_gate.sh` relative to the repo root (not under `web/`), so we run it as `bash scripts/loop/test_grading_gate.sh` without a leading `cd web`. This matches the invocation used by the recently-merged sibling slices (e.g. `09-split-chatRuntime-planTrace`, `08-validators-grid-finish`).

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
- [x] Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh` in the gate commands so the plan uses the required baseline-aware grading gate wrapper.

### Medium
- [x] Expand `Changed files expected` to include the direct import sites touched by Step 3, or narrow Step 3 if no repo-wide import rewrites are intended.

### Low
- [ ]

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T16:12:28Z, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High
- [ ]

### Medium
- [ ]

### Low
- [ ]

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T16:12:28Z, so no staleness note applies.
