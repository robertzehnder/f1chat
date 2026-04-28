---
slice_id: 06-stmt-cache-off
phase: 6
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28T17:08:38Z
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
1. Read `web/src/lib/db.ts` and confirm the `pg.Pool` is instantiated via `createPool()` and that the existing `sql<T>(text, values)` helper calls `pool.query(text, values)`. The current public signature is `sql<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>` and the helper does NOT accept a `QueryConfig` object from callers — keep that surface unchanged.
2. Apply the change: rewrite the body of `sql<T>()` so that instead of `pool.query<T>(text, values)` it calls `pool.query<T>({ text, values, name: undefined })`. This makes the unnamed-statement intent explicit and assertable by tests, without altering the public `(text, values)` signature. Do NOT add a Neon-specific config knob; keep the helper driver-agnostic.
3. Add a unit test at `web/src/lib/__tests__/db.stmt-cache.test.ts` (or co-located equivalent if the suite uses a different convention) that:
   - Stubs `pool.query` (e.g. by re-exporting `pool` and using a `jest.spyOn` / `vi.spyOn` against it, or by injecting a fake `Pool` via the global cache `globalThis.__openf1Pool` in a `beforeEach`).
   - Calls `sql<T>("SELECT $1::int AS x", [1])` and `sql<T>("SELECT 1")` and asserts that `pool.query` was invoked with a single `QueryConfig` argument whose `name` property is `undefined` (using e.g. `expect(spy.mock.calls[0][0]).toMatchObject({ name: undefined })` or `expect(spy.mock.calls[0][0].name).toBeUndefined()`).
   - Asserts that the `QueryConfig` passed to `pool.query` has the expected `text` and `values` fields populated from the helper arguments — i.e. the helper preserves text/values while keeping `name` undefined.
   - Adds a TypeScript-level regression guard using `// @ts-expect-error` showing that the public API of `sql()` does NOT accept a `QueryConfig` (so a caller cannot smuggle a `name` field through the helper). Example: `// @ts-expect-error sql() does not accept QueryConfig` followed by `await sql({ text: "SELECT 1", values: [], name: "foo" } as never)`. Compilation of the test file under `npm run typecheck` is itself the assertion that the type-level guard holds.
4. Verify against the staging endpoint (NOT production) by running the script described in the Gate commands section, which opens 20 short-lived pool checkouts in parallel against `STAGING_NEON_DATABASE_URL`, runs a parameterised query on each, and asserts no `prepared statement` error is raised. Capture stdout+stderr to `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log` and commit it as the verification artifact. The gate command MUST use `set -o pipefail` (or an equivalent explicit exit-status check) so a non-zero exit from the verifier cannot be masked by the trailing `tee`.
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
# Staging-pooler verification (REQUIRES STAGING_NEON_DATABASE_URL — must NOT be production).
# `set -o pipefail` is REQUIRED so a non-zero exit from the verifier cannot be
# masked by the trailing `tee`. Run the whole block in a single `bash -c` (or
# inline `set -o pipefail` at the start of the same shell session) so the
# pipefail option is in effect for the piped command on the next line.
bash -c 'set -euo pipefail; cd web && STAGING_NEON_DATABASE_URL="$STAGING_NEON_DATABASE_URL" \
  node --loader tsx scripts/verify-stmt-cache-off.ts \
  | tee ../diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log'
test -s diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log
! grep -E 'prepared statement .* (already exists|does not exist)' \
    diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log
```

## Acceptance criteria
- [ ] `web/src/lib/db.ts` `sql<T>()` helper invokes `pool.query` with a `QueryConfig` argument whose `name` property is `undefined` on every call, so no server-side prepared statement is registered. The helper's public signature remains `sql<T>(text: string, values?: unknown[])`.
- [ ] `web/src/lib/__tests__/db.stmt-cache.test.ts` exists and its assertions pass under `npm test -- db.stmt-cache`. The test stubs `pool.query`, asserts the `QueryConfig` passed has `name === undefined` (and the expected `text` / `values`), and includes a `// @ts-expect-error` line proving the public API of `sql()` rejects a `QueryConfig` (so callers cannot smuggle a `name` field through the helper).
- [ ] All commands in `## Gate commands` exit 0, including the `! grep …` check that proves the staging-pooler log contains no `prepared statement` error. The staging-verification gate runs under `set -o pipefail` (or equivalent) so a verifier failure cannot be masked by the `tee` pipeline.
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

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Require `set -o pipefail` (or an equivalent explicit exit-status check) in the Step 4 staging-verification gate so a failing `node --loader tsx scripts/verify-stmt-cache-off.ts` run cannot be masked by the `| tee ...` pipeline.

### Medium
- [x] Reconcile Step 3 and its acceptance criterion with the actual `sql<T>(text, values)` helper signature in `web/src/lib/db.ts`: either expand the planned API change to support/query-config inputs explicitly, or rewrite the regression case around a real supported call path instead of "a caller passes `{ text, values, name: \"foo\" }` directly".

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] Reconcile the slice with the actual Phase 6 requirement in [diagnostic/roadmap_2026-04_performance_and_upgrade.md:279-281](/Users/robertzehnder/.openf1-loop-worktrees/06-stmt-cache-off/diagnostic/roadmap_2026-04_performance_and_upgrade.md:279): `statement_cache_size: 0` is a driver-level setting tied to the `@neondatabase/serverless` path, while the current repo uses `pg` and `sql()` currently calls `pool.query(text, values)` with no `name` at [web/src/lib/db.ts:93-98](/Users/robertzehnder/.openf1-loop-worktrees/06-stmt-cache-off/web/src/lib/db.ts:93); rewriting that call to `{ name: undefined }` does not disable an existing cache, so retarget the slice to a real cache-bearing codepath or rewrite the goal/steps around a behavior the current `pg` path can actually change.
- [ ] Replace the planned unit-test location and gate with the repo’s actual harness: `web/package.json:5-16` defines `build`, `typecheck`, and `test:grading`, but no `test` script, so `web/src/lib/__tests__/db.stmt-cache.test.ts` plus `cd web && npm test -- db.stmt-cache` is not runnable as written (`rg -n "__tests__/|test:grading|vitest|jest|db\\.stmt-cache" web -g '!web/.next'` exited 0 and found no matching harness beyond `test:grading`).

### Medium
- [ ] Resolve the contradiction between `## Required services / env` and the final acceptance bullet: the plan explicitly allows a local PgBouncer fallback, but the acceptance criterion requires proof that verification ran against “a non-production pooled Neon endpoint”; either allow the documented local PgBouncer path in acceptance/gates or remove it from the permitted verification targets.
- [ ] Narrow or expand the scope so it matches the repo’s real DB call sites: the slice claims to prove “every `pool.query()` call” / “no code path passes a `name` field,” but `runReadOnlySql()` bypasses `sql()` and uses `pool.connect()` plus `client.query(...)` directly at [web/src/lib/queries.ts:789-806](/Users/robertzehnder/.openf1-loop-worktrees/06-stmt-cache-off/web/src/lib/queries.ts:789); either include direct `client.query` paths in the plan or limit the goal/acceptance to the `sql()` helper only.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
