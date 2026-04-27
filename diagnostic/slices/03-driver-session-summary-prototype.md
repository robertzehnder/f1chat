---
slice_id: 03-driver-session-summary-prototype
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T10:37:37-04:00
---

## Goal
Prototype the `driver_session_summary` semantic contract as a matview; prove the parity check pattern that all subsequent matviews will follow.

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
- `sql/driver_session_summary.sql`
- `web/src/lib/contracts/driverSessionSummary.ts`
- `web/scripts/tests/parity-driver-session-summary.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Matview rowcount matches the existing live-query rowcount.
- [ ] Parity check passes for ≥3 sessions.

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
- [ ] Replace the `CREATE MATERIALIZED VIEW` / `core_build` wording with the Phase 3 pattern established by `03-core-build-schema`: read from `core_build.driver_session_summary` and materialize into an explicitly named storage relation such as `core.driver_session_summary_mat`, or explicitly justify any different object model in the plan.
- [ ] Add executable database gate commands that apply the SQL and verify the acceptance criteria, including rowcount parity and bidirectional session-scoped `EXCEPT ALL` parity for at least three sessions; the current gates only run web commands and cannot prove the materialized relation exists or matches the live query.

### Medium
- [ ] Specify a deterministic selector for the parity-test sessions, preferably `core.session_completeness` rows with `completeness_status = 'analytic_ready'` ordered by `session_key`, so implementers and auditors test the same sessions.
- [ ] Clarify how the parity test file is executed by the gate commands, either by adding a direct `node web/scripts/tests/parity-driver-session-summary.test.mjs` gate or by stating the existing npm script that includes it.
- [ ] Expand `Required services / env` to include `psql` on PATH and the exact database privileges needed for the final object model, not only statement-level `CREATE MATERIALIZED VIEW`.
- [ ] Expand `Changed files expected` to include the slice file itself for the Slice-completion note/frontmatter updates, or state why this loop's required slice-file edit is excluded from scope accounting.

### Low
- [ ] Rename `sql/driver_session_summary.sql` to fit the existing numbered SQL migration convention, or explicitly state why this slice should use an unnumbered SQL file.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so its timestamp is current for this audit.
