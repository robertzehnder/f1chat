---
slice_id: 10-session-detail-pace-table
phase: 10
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T20:30:00Z
---

## Goal
Add a per-driver pace section (median lap, fastest lap, sector splits) to the
session-detail page, sourced from the Phase 3 `core.driver_session_summary`
contract.

## Inputs
- `web/src/app/sessions/[sessionKey]/page.tsx`
- `web/src/lib/queries/sessions.ts`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10 (item 1: "lap-pace table/chart … backed by `core.*_mat`")
- `sql/009_driver_session_summary_mat.sql` (column list of the underlying contract)

## Prior context
- `diagnostic/_state.md`

## Required services / env
- The `bash scripts/loop/test_grading_gate.sh` gate runs `node --test scripts/tests/*.test.mjs`. The test added by this slice is a **source-string assertion** test (no DB / network) following the established pattern of `web/scripts/tests/db-stmt-cache.test.mjs` and `web/scripts/tests/prompt-prefix-split.test.mjs`, so no DB env is required at gate time.
- `npm run build` and `npm run typecheck` run statically and require no DB.
- The page itself reads `core.driver_session_summary` at request time; rendering it in a real browser additionally requires the standard repo DB env (`POSTGRES_URL` / `*_DATABASE_URL` / `NEON_DB_HOST` per `web/src/lib/db.ts`). Live render-against-DB is **not** part of the gate; it is only required for the optional manual smoke step in Acceptance criteria below.

## Steps
1. Add `getSessionDriverPace(sessionKey: number)` to `web/src/lib/queries/sessions.ts` that selects `driver_number, driver_name, team_name, lap_count, valid_lap_count, best_lap, median_lap, avg_lap, best_valid_lap, median_valid_lap, best_s1, best_s2, best_s3, avg_s1, avg_s2, avg_s3` from `core.driver_session_summary` filtered by `session_key`, ordered by `best_valid_lap NULLS LAST, best_lap NULLS LAST`.
2. Add a server component `web/src/app/sessions/[sessionKey]/PaceTable.tsx` that takes the rows from step 1 and renders them via the existing `@/components/DataTable` with `title="Per-driver Pace"`. No client-side hooks; no new charting libs.
3. Wire it into `web/src/app/sessions/[sessionKey]/page.tsx`: import `getSessionDriverPace` and `PaceTable`, add the call to the existing `Promise.all`, and render `<PaceTable rows={pace} />` inside the existing layout.
4. Add an automated source-assertion test at `web/scripts/tests/session-detail-pace-table.test.mjs` (pattern: `web/scripts/tests/db-stmt-cache.test.mjs`) that uses `node:fs.readFileSync` + `node:assert/strict` to assert:
   - `web/src/lib/queries/sessions.ts` source contains both `export async function getSessionDriverPace` and `FROM core.driver_session_summary` within the same function body, plus `WHERE session_key = $1`.
   - `web/src/app/sessions/[sessionKey]/PaceTable.tsx` exists, exports a default function, and imports from `@/components/DataTable`.
   - `web/src/app/sessions/[sessionKey]/page.tsx` imports `getSessionDriverPace` from `@/lib/queries` (or the sessions submodule) and references `<PaceTable`.
   - The `getSessionDriverPace` function body contains the strings `best_valid_lap`, `median_lap`, `best_s1`, and does **not** reference `raw.laps` (the slice must use the materialized `core.*` contract per Phase 10 item 1).

## Changed files expected
- `web/src/lib/queries/sessions.ts` (new exported function `getSessionDriverPace`)
- `web/src/app/sessions/[sessionKey]/PaceTable.tsx` (new file)
- `web/src/app/sessions/[sessionKey]/page.tsx` (wire-up edits)
- `web/scripts/tests/session-detail-pace-table.test.mjs` (new file)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `cd web && npm run typecheck` exits 0.
- [ ] `cd web && npm run build` exits 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (no new failures vs `scripts/loop/state/test_grading_baseline.txt`); the new `session-detail-pace-table.test.mjs` is part of the run and passes.
- [ ] All four assertions inside `web/scripts/tests/session-detail-pace-table.test.mjs` (listed in Step 4) pass — this is the observable check that the page is wired to `core.driver_session_summary` rather than to `raw.laps`, and that `PaceTable` is rendered from `page.tsx`.
- [ ] The `getSessionDriverPace` SQL string in `web/src/lib/queries/sessions.ts` references the columns enumerated in Step 1 only; the test in Step 4 enforces the contract-shape subset (`best_valid_lap`, `median_lap`, `best_s1`).

## Out of scope
- Charting / visualization (timeline, gantt) — covered by sibling slice `10-session-detail-stint-timeline.md`.
- Strategy summary block — covered by sibling slice `10-session-detail-strategy-summary.md`.
- Adding new columns to `core.driver_session_summary_mat`.
- Modifying `core.driver_session_summary` view or the `core_build` source-definition layer.

## Risk / rollback
Rollback: `git revert <commit>`. The change is additive (new query function, new component, new test, one wire-up in `page.tsx`); reverting restores the prior page render.

## Decisions
- **Test strategy.** The repo's only automated UI-adjacent gate is `node --test scripts/tests/*.test.mjs` (no Playwright, no RTL setup). Existing precedents (`db-stmt-cache.test.mjs`, `prompt-prefix-split.test.mjs`, `cache-control-markers.test.mjs`) assert structural properties via source-string reads. We follow that pattern instead of introducing a new test runner. This addresses Medium-4 by replacing "Playwright/RTL if the project has any" with one concrete strategy that runs under the existing `test:grading` gate.
- **Route path.** The actual session-detail route is `web/src/app/sessions/[sessionKey]/page.tsx`. All `[id]` references in earlier wording were wrong; this revision uses `[sessionKey]` throughout (Medium-2).
- **Contract choice.** `core.driver_session_summary` (a thin view over `core.driver_session_summary_mat`, see `sql/009_driver_session_summary_mat.sql:7-46`) carries every pace metric this slice needs (`best_lap`, `median_lap`, `best_s1..3`, `avg_s1..3`). Going through the public view rather than `_mat` directly keeps us aligned with the Phase 3 facade pattern.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace the raw `cd web && npm run test:grading` gate with `bash scripts/loop/test_grading_gate.sh` so the slice uses the repo's required grading wrapper and baseline diff behavior.
- [x] Correct the route/file scope to the actual session-detail path (`web/src/app/sessions/[sessionKey]/page.tsx`) and update any related wording that still refers to `[id]`.
- [x] Expand `Changed files expected` to include the test file(s) Step 3 requires, or narrow Step 3 if no new automated test file will be created.
- [x] Replace the ambiguous "Playwright/RTL tests if the project has any" step with one concrete test strategy and gateable command that matches this repo's existing test harness.
- [x] Specify the required data/runtime prerequisites for validating this page, including the DB-backed session data/env expected by the chosen test or verification path.
- [x] Rewrite the acceptance criteria so each item is observable via a named automated check or explicit artifact, including how "matches the underlying contract" will be verified for a specific session.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T20:16:19Z, so no stale-state note is needed.
