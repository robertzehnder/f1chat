---
slice_id: 03-laps-enriched-grain-discovery
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T15:04:15Z
---

## Goal
Investigate the granularity (one-row-per-lap, per-stint, per-driver-session) for the `laps_enriched` contract; document the chosen grain.

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
- `diagnostic/notes/03-laps-enriched-grain.md`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Note documents the canonical grain with reasoning.

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
- [ ] Reconcile the slice scope: either make the steps/env/gates describe a grain-discovery documentation slice only, or expand the goal, changed-files list, DB gates, and acceptance criteria to cover materializing `laps_enriched`.
- [ ] Add executable DB gate commands for any plan that defines SQL objects or parity tests; the current gates only run web commands and cannot prove matview creation, column ordering, or parity.
- [ ] Expand `Changed files expected` to include every file implied by the implementation steps, including SQL, TypeScript contract, parity test, and the slice file itself, or remove those implementation steps.

### Medium
- [ ] Fix the web gate command ordering so all three commands can run from one shell, for example by using `npm --prefix web ...` instead of repeated `cd web && ...`.
- [ ] Specify deterministic session selection for the `>=3` parity sessions, preferably from analytic-ready sessions in `core.session_completeness`, if parity testing remains in scope.
- [ ] Clarify whether `CREATE MATERIALIZED VIEW` is actually in scope, since `03-core-build-schema` explicitly deferred materialization to dedicated later slices and this slice's stated goal is grain discovery.

### Low
- [ ] Replace the stale `## Audit verdict` placeholder with the appended `## Plan-audit verdict` section as the single audit-status location.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T15:03:18Z`).
