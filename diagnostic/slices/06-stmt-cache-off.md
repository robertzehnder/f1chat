---
slice_id: 06-stmt-cache-off
phase: 6
status: pending_plan_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28
---

## Goal
Disable server-side prepared-statement reuse for the pooled `pg` connection so that Neon's transaction-mode pooler (PgBouncer) cannot leak prepared-statement state across pool checkouts and surface `prepared statement "S_n" does not exist / already exists` errors under load. Concretely: ensure every `pool.query()` call sends an unnamed (cache-bypassing) statement, and prove with a test assertion that no code path passes a `name` field that would register a server-side prepared statement.

## Inputs
- `web/src/lib/db.ts` (the pooled `pg.Pool` factory and `sql<T>()` helper — the slice originally listed `web/src/lib/db/driver.ts`, which does not exist in the tree; the correct path is `web/src/lib/db.ts`)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6, item 3 ("Disable prepared-statement cache when on the pooled endpoint")
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §3 (pooled-endpoint constraints, line 115)

## Prior context
- `diagnostic/_state.md`
- `web/src/lib/db.ts`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md`

## Required services / env
This slice MUST NOT be verified against the production `DATABASE_URL` / `NEON_DATABASE_URL`. Use one of the following non-production targets, in order of preference:

1. A dedicated Neon **staging/preview branch** pooled endpoint (`…-pooler.<region>.aws.neon.tech`) configured via `STAGING_NEON_DATABASE_URL` (export it locally for the verification step; do not commit). Prefer a Neon branch created off `main` for this slice and deleted afterwards.
2. If no Neon staging branch is available, a local PgBouncer-in-transaction-mode container in front of local Postgres (`docker run --rm -p 6432:6432 -e DATABASES="postgres=host=host.docker.internal port=5432 dbname=openf1 user=openf1 password=openf1_local_dev" -e POOL_MODE=transaction edoburu/pgbouncer`) with `STAGING_NEON_DATABASE_URL=postgres://openf1:openf1_local_dev@127.0.0.1:6432/postgres`.

The user-approval sentinel for this slice authorises the implementer to obtain or use the staging Neon branch URL; production credentials remain off-limits.

## Steps
1. Read `web/src/lib/db.ts` and confirm the `pg.Pool` is instantiated via `createPool()` and that `sql<T>()` calls `pool.query(text, values)` without a `name` field.
2. Apply the change: ensure `sql<T>()` always sends an unnamed statement. Specifically — call `pool.query({ text, values, name: undefined })` (or equivalent) so that even if a future caller passes a query config object that includes `name`, the `sql()` helper strips it. This guarantees no statement is registered server-side and therefore nothing for the pooler to lose across checkouts. Do NOT add a Neon-specific config knob; keep the helper driver-agnostic.
3. Add a unit test at `web/src/lib/__tests__/db.stmt-cache.test.ts` (or co-located equivalent if the suite uses a different convention) that:
   - Stubs `pool.query` and asserts every call from `sql<T>()` produces a `QueryConfig` with `name === undefined` (or is a plain text+values call with no `name`).
   - Includes a regression case where a caller passes `{ text, values, name: "foo" }` directly and verifies the assertion still holds (i.e. the helper strips `name`).
4. Verify against the staging endpoint (NOT production) by running the script described in the Gate commands section, which opens 20 short-lived pool checkouts in parallel against `STAGING_NEON_DATABASE_URL`, runs a parameterised query on each, and asserts no `prepared statement` error is raised. Capture stdout+stderr to `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log` and commit it as the verification artifact.
5. Update `diagnostic/_state.md` only as the merge step requires; this slice itself does not modify it.

## Changed files expected
- `web/src/lib/db.ts` — strip `name` from outbound query configs in `sql<T>()`.
- `web/src/lib/__tests__/db.stmt-cache.test.ts` — new unit test asserting unnamed-statement invariant.
- `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log` — captured staging-pooler verification output.
- (Possibly) `web/scripts/verify-stmt-cache-off.ts` — small Node script invoked by the Gate command in step 4 (see below). Add only if the suite has no equivalent harness already.

## Artifact paths
- `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log`

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
# Unit test specifically asserting the unnamed-statement invariant:
cd web && npm test -- db.stmt-cache
# Staging-pooler verification (REQUIRES STAGING_NEON_DATABASE_URL — must NOT be production):
cd web && STAGING_NEON_DATABASE_URL="$STAGING_NEON_DATABASE_URL" \
  node --loader tsx scripts/verify-stmt-cache-off.ts \
  | tee ../diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log
test -s diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log
! grep -E 'prepared statement .* (already exists|does not exist)' \
    diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log
```

## Acceptance criteria
- [ ] `web/src/lib/db.ts` `sql<T>()` helper passes `name: undefined` (or strips `name`) on every outbound `pool.query` call, so no server-side prepared statement is registered.
- [ ] `web/src/lib/__tests__/db.stmt-cache.test.ts` exists and its assertions pass under `npm test -- db.stmt-cache`, including the regression case where a caller-supplied `name` field is dropped by the helper.
- [ ] All commands in `## Gate commands` exit 0, including the `! grep …` check that proves the staging-pooler log contains no `prepared statement` error.
- [ ] `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log` is committed and is non-empty (`test -s` passes) — this is the proof that step 4 ran against a non-production pooled Neon endpoint.

## Out of scope
- Switching to `@neondatabase/serverless` or any other driver.
- Connection-pool sizing or `statement_timeout` tuning.
- Production DB validation — explicitly not in scope; production verification happens only after merge as part of the standard rollout path.

## Risk / rollback
Production-touching at deploy time, but verification is staging-only per `## Required services / env`. Require user-approved sentinel before merge. Rollback: `git revert` the slice commit; no Neon-config change is made by this slice, so no Neon-side rollback is required.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `Production DATABASE_URL` / "Verify against a real Neon connection" with a safe staging or dedicated Neon pooler target and specify the exact non-production verification command or procedure the implementer must run.
- [x] Add a concrete gate or artifact requirement for the Neon verification in Step 4 / acceptance criteria; the current gate list cannot prove the required staging validation happened.

### Medium
- [x] Align `Changed files expected` with Step 3 by either naming the expected test/doc files or removing the docs expectation from the step.
- [x] Rewrite `Change is implemented and tested per the goal` into a checkable criterion that names the intended driver setting or test assertion instead of a generic outcome.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
