---
slice_id: 03-telemetry-lap-bridge
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T23:57:41-0400
---

## Goal
Materialize `telemetry_lap_bridge` (joins high-frequency telemetry to discrete laps for downstream queries).

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
- `sql/telemetry_lap_bridge.sql`
- `web/src/lib/contracts/telemetryLapBridge.ts`
- `web/scripts/tests/parity-telemetry-bridge.test.mjs`

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
- [ ] Add database gate commands that apply the `telemetry_lap_bridge` SQL to `core_build`, verify the materialized view exists, and run the parity check against the live query via `psql "$DATABASE_URL"` before the web gates, per the Phase 3 per-contract materialization protocol in `diagnostic/_state.md`.
- [ ] Rewrite the Acceptance criteria so each required outcome is testable from command exit codes, including successful DB apply, successful existence verification, successful parity for 3 deterministic sessions, and successful web gates.

### Medium
- [ ] Add the slice file path `diagnostic/slices/03-telemetry-lap-bridge.md` to Changed files expected, because implementation will update this file's frontmatter and Slice-completion note.
- [ ] Specify the database artifact the SQL step must create, including the exact relation name/schema and how the implementer should apply it, because "Define the matview's SQL" does not currently produce the runtime object that step 3 depends on.

### Low
- [ ] Add `psql` availability to Required services / env once DB gate commands are included.

### Notes (informational only — no action)
- `diagnostic/_state.md` was read and its `last updated` timestamp is within 24 hours.
