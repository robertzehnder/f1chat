---
slice_id: 10-session-detail-pace-table
phase: 10
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T21:05:00Z
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
2. Add a server component `web/src/app/sessions/[sessionKey]/PaceTable.tsx` that takes the rows from step 1 and renders them via the existing `@/components/DataTable` with `title="Per-driver Pace"`. No client-side hooks; no new charting libs. The visible column set is the row-key set returned by `getSessionDriverPace` because `DataTable` derives column headers from `Object.keys(rows[0])` (`web/src/components/DataTable.tsx:17`); therefore the visible-column list equals the SQL SELECT list in Step 1 — `driver_number, driver_name, team_name, lap_count, valid_lap_count, best_lap, median_lap, avg_lap, best_valid_lap, median_valid_lap, best_s1, best_s2, best_s3, avg_s1, avg_s2, avg_s3`. The Goal-required metrics (median lap = `median_lap`, fastest lap = `best_lap`, sector splits = `best_s1`/`best_s2`/`best_s3`) are part of that set.
3. Wire it into `web/src/app/sessions/[sessionKey]/page.tsx`: import `getSessionDriverPace` and `PaceTable`, add the call to the existing `Promise.all` so its result is destructured as `pace` (i.e. the awaited tuple includes `pace`), and render `<PaceTable rows={pace} />` inside the existing layout.
4. Add an automated source-assertion test at `web/scripts/tests/session-detail-pace-table.test.mjs` (pattern: `web/scripts/tests/db-stmt-cache.test.mjs`) that uses `node:fs.readFileSync` + `node:assert/strict` to assert:
   - `web/src/lib/queries/sessions.ts` source contains both `export async function getSessionDriverPace` and `FROM core.driver_session_summary` within the same function body, plus `WHERE session_key = $1`.
   - `web/src/app/sessions/[sessionKey]/PaceTable.tsx` exists, exports a default function, imports from `@/components/DataTable`, and renders `<DataTable` with a `rows={` prop (i.e. the source contains both substrings) so the visible-column set is delegated to `DataTable`'s `Object.keys(rows[0])` derivation.
   - `web/src/app/sessions/[sessionKey]/page.tsx` source must (a) import `getSessionDriverPace` from `@/lib/queries` (or the sessions submodule), and (b) bind the awaited query result to the `<PaceTable>` `rows` prop via a **shared identifier** — not two independent substring matches. The test enforces this by extracting a destructured identifier with the regex `/const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/` (capture group 1 — the **last** name in the Promise.all destructure, which Step 3 fixes as `pace`), additionally asserting the matched Promise.all argument list contains `getSessionDriverPace(` (regex `/await\s+Promise\.all\(\[[\s\S]*?getSessionDriverPace\(/`), and then asserting the literal `<PaceTable rows={<captured>}` appears in the same source — where `<captured>` is interpolated from capture group 1 of the destructure regex. The destructure-regex match, the inner-`Promise.all`-call regex match, and the interpolated `<PaceTable rows={<captured>}` substring being present together are the observable proof that the same awaited `getSessionDriverPace(...)` result is the value passed into `<PaceTable rows={...}/>`. Two independent substring assertions (one for the call site, one for `rows={`) are explicitly **not** sufficient and the test must fail if the destructure regex captures nothing or the captured identifier does not appear inside the `<PaceTable rows={...}` prop.
   - The `getSessionDriverPace` function body contains **every** column name enumerated in Step 1 — i.e., the literal substrings `driver_number`, `driver_name`, `team_name`, `lap_count`, `valid_lap_count`, `best_lap`, `median_lap`, `avg_lap`, `best_valid_lap`, `median_valid_lap`, `best_s1`, `best_s2`, `best_s3`, `avg_s1`, `avg_s2`, `avg_s3` — and does **not** reference `raw.laps` (the slice must use the materialized `core.*` contract per Phase 10 item 1). The test iterates the column list and asserts each as a substring so the SELECT-shape — and therefore the `DataTable`-rendered visible-column list per Step 2 — stays in lock-step with Step 1. Because `DataTable` renders `<th>{column}</th>` for every key of `rows[0]` (`web/src/components/DataTable.tsx:24-29`), the SELECT-list assertion is also the observable check on visible columns.

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
- [ ] All four assertion groups inside `web/scripts/tests/session-detail-pace-table.test.mjs` (listed in Step 4) pass — this is the observable check that the page is wired to `core.driver_session_summary` rather than to `raw.laps`, and that `PaceTable` is rendered from `page.tsx`.
- [ ] The `getSessionDriverPace` SQL string in `web/src/lib/queries/sessions.ts` contains every column listed in Step 1; this is enforced by the per-column substring loop in Step 4's fourth assertion group, so the test and this criterion are the same observable check.
- [ ] `page.tsx` binds the awaited `getSessionDriverPace(...)` result to `<PaceTable rows={...}>` through a **shared identifier** captured from the `Promise.all` destructure — not via two independent substring matches. This is enforced by Step 4's third assertion group: the destructure-regex `/const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/` captures the identifier (capture group 1), the matched `Promise.all` argument contains `getSessionDriverPace(` (per the inner regex `/await\s+Promise\.all\(\[[\s\S]*?getSessionDriverPace\(/`), and the same captured identifier appears in `<PaceTable rows={<captured>}`. Dead or unrelated dataflow (e.g. an unused `getSessionDriverPace(` call alongside an unrelated `<PaceTable rows={someOther}>`) fails this check.
- [ ] The visible `PaceTable` columns (the `<th>` set rendered by `DataTable` from `Object.keys(rows[0])` per `web/src/components/DataTable.tsx:17,24-29`) include **at minimum** the Goal-required metrics — `median_lap`, `best_lap`, `best_s1`, `best_s2`, `best_s3` — alongside identifying columns `driver_number`, `driver_name`, `team_name`. Because the visible column set is row-key-derived, this is observable through Step 4's fourth assertion group (the per-column substring loop on the SELECT list) combined with Step 4's second assertion group (which proves `PaceTable` delegates rendering to `DataTable` via `rows={`).

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

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make the final acceptance criterion and Step 4 use the same observable check: either assert the full `SELECT` column list/order from Step 1 in `session-detail-pace-table.test.mjs`, or narrow the criterion so it no longer claims the test proves the query references only the enumerated columns.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T20:16:19Z, so no stale-state note is needed.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Tighten Step 4 and the acceptance criteria so the automated check proves `page.tsx` both calls `getSessionDriverPace(...)` and passes that result into `<PaceTable rows={...} />`; the current import-plus-`<PaceTable` assertion can pass without the promised `Promise.all` wiring.
- [x] Specify the required visible `PaceTable` columns (or explicitly narrow the goal) and add an observable check for them; the plan currently claims a per-driver pace section for median lap, fastest lap, and sector splits, but neither the steps nor the acceptance criteria make that user-facing output verifiable.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T20:16:19Z, so no stale-state note is needed.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Rewrite Step 4 and the matching acceptance criteria to prove the same awaited `getSessionDriverPace(...)` result is passed into `<PaceTable rows={...} />`; separate substring checks for a call site and a rendered `rows={` prop still allow dead or unrelated dataflow.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T20:16:19Z, so no stale-state note is needed.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [ ] Align Step 3 with Step 4's destructure regex: either require `pace` to be the final identifier in the `Promise.all` destructure, or relax the regex/acceptance wording so any destructured `pace` position passes the promised wiring check.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T20:16:19Z, so no stale-state note is needed.
