---
slice_id: 10-session-detail-strategy-summary
phase: 10
status: pending_plan_audit
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Add a strategy-summary card to the session-detail page that, per driver, surfaces pit-stop count, compounds used, and the one-stop/two-stop classification. Data must come from the materialized `core.strategy_summary` contract — no `raw.*` reads.

## Inputs
- `web/src/app/sessions/[sessionKey]/page.tsx` (existing session-detail page)
- `web/src/lib/queries/sessions.ts` (existing query module)
- `sql/012_strategy_summary_mat.sql` (column inventory for `core.strategy_summary`)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10

## Prior context
- `diagnostic/_state.md`
- `web/scripts/tests/session-detail-stint-timeline.test.mjs` (reference for source-inspection grading-test pattern)
- `web/scripts/tests/session-detail-pace-table.test.mjs` (reference for source-inspection grading-test pattern)

## Required services / env
None at author time. Tests are pure source-inspection (Node `node:test`) and do not require a live database.

## Steps
1. Add `export async function getSessionStrategySummary(sessionKey: number)` to `web/src/lib/queries/sessions.ts`. The body must `SELECT ... FROM core.strategy_summary WHERE session_key = $1` and project the columns the card consumes: `driver_number`, `driver_name`, `team_name`, `total_stints`, `pit_stop_count`, `compounds_used`, `strategy_type`, `total_pit_duration_seconds`, `pit_laps`. Order by `driver_number ASC`. Do not reference `raw.*` tables.
2. Create `web/src/app/sessions/[sessionKey]/StrategySummary.tsx` as a default-exported function component taking `{ rows: Record<string, unknown>[] }`. Render one row per driver showing: `#<driver_number> <driver_name> · <team_name>`, `pit_stop_count`, the `compounds_used` array joined as a readable list, and `strategy_type`. Mark each driver row with `data-testid="strategy-row"` and the strategy-type cell with `data-testid="strategy-type"`.
3. Wire `StrategySummary` into `web/src/app/sessions/[sessionKey]/page.tsx`: add `getSessionStrategySummary` to the existing `Promise.all([...])` and capture the destructured result, then render `<StrategySummary rows={<captured>} />` immediately after `<StintTimeline rows={...} />` and before the weather/race-control two-col block. Default-import from `./StrategySummary`.
4. Add the source-inspection grading test `web/scripts/tests/session-detail-strategy-summary.test.mjs` mirroring the structure of `web/scripts/tests/session-detail-stint-timeline.test.mjs`. Required assertions (G1–G5) are spelled out under Acceptance criteria.

## Changed files expected
- `web/src/lib/queries/sessions.ts` (new export `getSessionStrategySummary`)
- `web/src/app/sessions/[sessionKey]/StrategySummary.tsx` (new component)
- `web/src/app/sessions/[sessionKey]/page.tsx` (import + Promise.all entry + render slot)
- `web/scripts/tests/session-detail-strategy-summary.test.mjs` (new dedicated grading test)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/scripts/tests/session-detail-strategy-summary.test.mjs` exists and passes under `bash scripts/loop/test_grading_gate.sh` with these assertions:
  - **G1**: `getSessionStrategySummary` is declared in `web/src/lib/queries/sessions.ts`; its body contains `FROM core.strategy_summary` and `WHERE session_key = $1`; it does NOT reference `raw.stints` or `raw.pit`; and it references each of `driver_number`, `driver_name`, `team_name`, `total_stints`, `pit_stop_count`, `compounds_used`, `strategy_type`, `total_pit_duration_seconds`, `pit_laps`.
  - **G2**: `web/src/app/sessions/[sessionKey]/StrategySummary.tsx` exists, exports a default function, and contains the literal substrings `data-testid="strategy-row"`, `data-testid="strategy-type"`, `compounds_used`, `pit_stop_count`, and `strategy_type`.
  - **G3**: `page.tsx` imports `getSessionStrategySummary` from `@/lib/queries` or `@/lib/queries/sessions`, calls it inside the `Promise.all([...])` argument list, destructures a final identifier from the awaited result, and passes that identifier as `<StrategySummary rows={<captured>}`.
  - **G4**: `page.tsx` default-imports `StrategySummary` from `./StrategySummary`.
  - **G5**: In `page.tsx`, the `<StrategySummary rows={...}>` element appears AFTER `<StintTimeline rows={...}>` and BEFORE the `Weather Preview` two-col block.
- [ ] `cd web && npm run build` exits 0.
- [ ] `cd web && npm run typecheck` exits 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (any pre-existing baseline failures must not regress).

## Out of scope
- Undercut/overcut evidence (lives in `core.strategy_evidence_summary`, separate slice).
- Pit-cycle position-change visualization (lives in `core.pit_cycle_summary`, separate slice).
- Database-layer changes (the `core.strategy_summary` materialization already exists at `sql/012_strategy_summary_mat.sql`).

## Risk / rollback
Rollback: `git revert <commit>`. The card is additive; no existing route, query, or component is modified except for the additive `Promise.all` entry and render slot in `page.tsx`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the loop's baseline-aware grading gate instead of the raw repo-wide test script.

### Medium
- [x] Fix the `Changed files expected` paths to use the real session-detail route segment `web/src/app/sessions/[sessionKey]/...` instead of nonexistent `[id]` paths.
- [x] Expand `Changed files expected` to include the query-layer and grading-test files this slice will need, at minimum the `web/src/lib/queries/sessions.ts` contract reader and a dedicated `web/scripts/tests/session-detail-strategy-summary.test.mjs` gate file.
- [x] Replace the Playwright/RTL-or-screenshot fallback in Step 3 with the repo's actual grading-test approach, since this codebase already uses source-inspection node tests for adjacent session-detail slices and does not rely on Playwright/RTL here.
- [x] Rewrite the acceptance criteria as command-verifiable outcomes that name the required `core.strategy_summary` wiring and the concrete grading assertion(s), rather than broad statements like "renders without runtime errors" and "matches the underlying contract for at least one test session."

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:41:07Z, so the loop context is current.
- Adjacent implemented session-detail slices already follow the `[sessionKey]` route shape and dedicated grading-test pattern in `web/scripts/tests/session-detail-*.test.mjs`.
