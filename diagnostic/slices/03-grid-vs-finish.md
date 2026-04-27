---
slice_id: 03-grid-vs-finish
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T17:57:36-04:00
---

## Goal
Materialize `grid_vs_finish` (per driver per session: grid pos, finish pos, delta).

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/03-core-build-schema.md`

## Required services / env
`DATABASE_URL` (Neon Postgres). Statement-level `CREATE MATERIALIZED VIEW` requires the role used by the loop to have schema-create privileges on `core_build`.

## Steps
1. Define the matview's SQL with a stable column ordering.
2. Add a TS contract type matching the matview columns.
3. Add a parity test comparing matview output to the equivalent live-query output for ≥3 sessions.
4. Run gate commands; capture output.

## Changed files expected
- `sql/grid_vs_finish.sql`
- `web/src/lib/contracts/gridVsFinish.ts`
- `web/scripts/tests/parity-grid-vs-finish.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Parity test passes.

## Out of scope
- Refresh strategy / cron (later phase or D-3 decision).
- Cutover from live query to matview in route.ts (later).

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace the `CREATE MATERIALIZED VIEW` / `core_build` framing with the established Phase 3 object model: read from `core_build.grid_vs_finish`, create and populate a real storage table such as `core.grid_vs_finish_mat`, and replace public `core.grid_vs_finish` with a thin facade view.
- [ ] Add executable database gate commands that apply the SQL and verify the storage object, facade view, global rowcount parity, and bidirectional session-scoped `EXCEPT ALL` parity against `core_build.grid_vs_finish` for three deterministic `analytic_ready` sessions; the current gates only run web commands and cannot prove the database objects exist or match the canonical query.
- [ ] Rewrite the web gate commands so they can be executed in the listed order from one shell without failing on `cd web` after the first command, for example by using `npm --prefix web ...` for build, typecheck, and grading tests.

### Medium
- [ ] Remove or justify the TypeScript contract and `.mjs` parity-test deliverables, because the merged Phase 3 materialization slices use a numbered SQL migration plus inline `psql` parity gates rather than `web/src/lib/contracts/*` files or standalone parity tests.
- [ ] Expand `Prior context` to include the merged Phase 3 materialization precedents and source definitions this slice depends on, especially `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3, `diagnostic/slices/03-driver-session-summary-prototype.md`, `diagnostic/slices/03-laps-enriched-materialize.md`, `diagnostic/slices/03-stint-summary.md`, `diagnostic/slices/03-strategy-summary.md`, `diagnostic/slices/03-race-progression-summary.md`, `sql/008_core_build_schema.sql`, and `sql/007_semantic_summary_contracts.sql`.
- [ ] Specify the expected SQL filename and file scope using the repo's numbered migration convention, likely `sql/014_grid_vs_finish_mat.sql`, and include the slice file itself as an allowed frontmatter/completion-note change.
- [ ] Expand acceptance criteria so each criterion maps to a specific gate command and exit condition, rather than only saying the parity test passes.
- [ ] Correct the required services / env block to state the privileges needed for the real-table + facade pattern (`CREATE` on `core`, `USAGE`/`SELECT` on `core_build`, ownership or sufficient privilege to `CREATE OR REPLACE VIEW core.grid_vs_finish`, and `psql` on PATH), and remove the `CREATE MATERIALIZED VIEW` privilege requirement unless the revised plan explicitly justifies a different architecture.

### Low
- [ ] Document the expected grain and storage constraint for `grid_vs_finish`, such as `PRIMARY KEY (session_key, driver_number)` if the source query guarantees uniqueness, or add a pre-flight grain probe if the plan cannot justify that constraint from the SQL.
- [ ] Replace the generic rollback note with a DB rollback outline that restores the original `core.grid_vs_finish` view body dependency-safely before dropping the storage table.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T21:56:32Z`).
