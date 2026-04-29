---
slice_id: 06-pooled-url-assertion
phase: 6
status: done
owner: -
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-29T00:15:00-04:00
---

## Goal
Assert `DATABASE_URL` uses the Neon pooler connection string (port 6543 / `-pooler` suffix) in production. Throw a startup error if direct-connection URL is detected in `NODE_ENV=production`.

## Inputs
- `web/src/lib/db.ts` (the repo's actual DB entrypoint; there is no `web/src/lib/db/driver.ts` file in this codebase)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6

## Prior context
- `diagnostic/_state.md`

## Required services / env
- `DATABASE_URL` — must be a Neon pooler URL (host suffix `-pooler` and port `6543`) when `NODE_ENV=production`.
- Test fixtures (set per-test, no real Neon connection required):
  - Pooler URL example: `postgres://USER:PASS@ep-foo-bar-pooler.us-east-2.aws.neon.tech:6543/openf1?sslmode=require`
  - Direct URL example: `postgres://USER:PASS@ep-foo-bar.us-east-2.aws.neon.tech:5432/openf1?sslmode=require`
- No Neon API token or console access is required for this slice.

## Steps
1. Read the current implementation in `web/src/lib/db.ts` (the actual entrypoint in this repo — `web/src/lib/db/driver.ts` does not exist). Locate the `createPool` path that resolves a connection string from `NEON_DATABASE_URL` / `DATABASE_URL` (see `firstUrl` helper) and creates the `pg.Pool`.
2. In `web/src/lib/db.ts`, add and export a pure function `assertPooledDatabaseUrl(env: NodeJS.ProcessEnv): void` that, when `env.NODE_ENV === 'production'`, parses the connection string returned by the same precedence used by `firstUrl` (i.e., `env.NEON_DATABASE_URL ?? env.DATABASE_URL`) and throws a descriptive `Error` if the host does not contain the substring `-pooler` OR the port (URL `port`, defaulting to 5432 when omitted) is not `6543`. The thrown message must include the offending host and port, contain the literal phrase `Neon pooler URL required` (so tests and staging verification can match it), and instruct the operator to switch to the Neon pooler URL. Then invoke `assertPooledDatabaseUrl(process.env)` once at module load — before `createPool()` runs — so the startup error fires when `db.ts` is first imported in production runtime.

   **Build-phase bypass (REQUIRED, do not remove).** `next build` sets `NODE_ENV=production` during the build step itself (so compile-time optimizations like tree-shaking and dead-code elimination kick in), even on developer machines that do not have a real prod pooler URL exported. Without a build-phase bypass, the assertion fires during page-data collection and the local `next build` exits non-zero — the slice's own gate #1 (`cd web && npm run build`) cannot pass. The bypass: at the top of `assertPooledDatabaseUrl`, immediately after the `NODE_ENV !== 'production'` early return, also early-return when `env.NEXT_PHASE === 'phase-production-build'`. Next.js sets `NEXT_PHASE='phase-production-build'` only during the build step; production runtime (server start, edge function, route handler) has `NEXT_PHASE='phase-production-server'` or undefined, so the assertion still fires on the production runtime path it is meant to gate. Removing this bypass breaks the local-build invariant the gate block depends on; future audit rounds MUST NOT REVISE it out.
3. Add an automated test at `web/scripts/tests/pooled-url-assertion.test.mjs` covering all five Acceptance-criteria cases (the four shape cases plus the precedence case below). Follow the existing test pattern (see `web/scripts/tests/answer-cache.test.mjs`) and use the in-process `typescript` compiler to transpile `web/src/lib/db.ts` and import the exported `assertPooledDatabaseUrl` as a pure function with controlled `env` fixtures — do NOT rely on side-effectful module load, do NOT add a docs file.
   - Precedence test case (required): include a dedicated assertion that proves `assertPooledDatabaseUrl` validates the same URL `createPool()` will use, i.e. it honors `firstUrl`'s precedence (`env.NEON_DATABASE_URL ?? env.DATABASE_URL`), not just `DATABASE_URL`. Build a fixture with `NODE_ENV='production'`, `NEON_DATABASE_URL=<valid Neon pooler URL>` (host containing `-pooler`, port `6543`), and a deliberately conflicting `DATABASE_URL=<direct URL with port 5432 and no -pooler>`; call `assertPooledDatabaseUrl(fixture)` and assert it does NOT throw — confirming `NEON_DATABASE_URL` was preferred. Add a second fixture with `NODE_ENV='production'`, `NEON_DATABASE_URL=<direct URL with port 5432 and no -pooler>`, and `DATABASE_URL=<valid Neon pooler URL>`; call `assertPooledDatabaseUrl(fixture)` and assert it THROWS with a message matching `/Neon pooler URL required/i` — confirming `DATABASE_URL` was NOT silently used to override `NEON_DATABASE_URL`. Both directions must be covered so a regression that flips precedence (or that validates only `DATABASE_URL`) fails the test.
   - Neutralize Step 2's module-load `assertPooledDatabaseUrl(process.env)` call before import: at the top of the test file (before requiring/importing the transpiled `db.ts`), explicitly set `process.env.NODE_ENV = 'test'` and `delete process.env.NEON_DATABASE_URL; delete process.env.DATABASE_URL;` so the module-level invocation is a no-op at import time and cannot throw or accidentally consume ambient env. Also `delete process.env.NEON_DB_HOST; delete process.env.DB_HOST;` (and the matching `_USER` / `_PASSWORD` / `_NAME` / `_PORT` siblings) so the module-load `pool = createPool()` path described below cannot accidentally pick up ambient Neon/local DB credentials from the developer's shell. Each test case must build its own plain-object env fixture (with the desired `NODE_ENV`, `NEON_DATABASE_URL`, and `DATABASE_URL` values) and call the imported `assertPooledDatabaseUrl(fixture)` directly — do NOT mutate `process.env` between cases, and do NOT let any assertion depend on the module-load call's behavior.
   - Module-load `pool = createPool()` interaction (line 88 of `web/src/lib/db.ts`): importing the transpiled module also runs `export const pool = globalForPool.__openf1Pool ?? createPool();`. Because the test sets `NODE_ENV=test` and clears every `*_DATABASE_URL` and `*_DB_HOST` variable above, `firstUrl` returns `undefined`, the `NEON_DB_HOST` branch is skipped, and `createPool()` falls through to the local `env("DB_HOST", "127.0.0.1")` path with built-in defaults (host `127.0.0.1`, port `5432`, user `openf1`, password `openf1_local_dev`, database `openf1`). `pg.Pool` construction is lazy and does NOT open a TCP connection — connections are only attempted on first `.query()` or `.connect()`, so this is safe. The test MUST NOT call `pool`, `sql`, `pool.query`, or `pool.connect`; it only imports `assertPooledDatabaseUrl` and exercises it against fixture env objects. Do not add an `afterAll`/`process.exit` `pool.end()` call either — leaving the unused pool object un-ended is fine because no clients were ever checked out.
4. Pre-merge verification (staging, evidence required):
   - Add a runnable harness `web/scripts/verify-pooled-url.mjs` that uses the same in-process `typescript` transpile pattern as the test file to load `assertPooledDatabaseUrl` from `web/src/lib/db.ts`, then calls it with `process.env`. On success it must `console.log('OK: pooler url accepted')` and exit 0; on a thrown error it must let the error propagate (or `console.error` then `process.exit(1)`) so stderr surfaces the assertion message.
   - Module-load interaction note (assertion): the harness intentionally runs with the real `NODE_ENV=production` env at import time, so Step 2's module-level `assertPooledDatabaseUrl(process.env)` call may itself throw before the harness re-invokes the exported function. This is acceptable and expected — for the direct-URL invocation, the throw can surface from either the module-load call or the explicit re-invocation; the harness must not swallow either path (no broad try/catch that suppresses the non-zero exit), and stderr must carry the `Neon pooler URL required` message in both cases. For the pooler-URL invocation, the module-load call must not throw, leaving the explicit `assertPooledDatabaseUrl(process.env)` call as the gate that immediately precedes the `console.log('OK: pooler url accepted')` success line.
   - Module-load interaction note (`pool = createPool()` at line 88 of `web/src/lib/db.ts`): the import also evaluates `export const pool = globalForPool.__openf1Pool ?? createPool();`. The harness MUST tolerate this in both invocations:
     - Direct-URL invocation: Step 2's ordering guarantees `assertPooledDatabaseUrl(process.env)` runs *before* `createPool()` in `db.ts`, so the assertion throw fires first and `createPool()` is never reached. The harness sees a thrown exception during import; that exception must propagate (or be surfaced via `console.error` + `process.exit(1)`) with the `Neon pooler URL required` message intact.
     - Pooler-URL invocation: the module-load assertion passes, so `createPool()` runs with `connectionString = <staging-pooler-url>` and constructs a `pg.Pool` instance. `pg.Pool` construction is lazy — it does NOT open a TCP connection or contact Neon at construction time; clients are only created on the first `.query()` or `.connect()` call. The harness MUST NOT touch `pool`, `sql`, `pool.query`, or `pool.connect`; it must only call the exported `assertPooledDatabaseUrl(process.env)` and then `console.log('OK: pooler url accepted')`. Because no client is ever checked out, the leaked pool object holds no sockets and the process exits 0 cleanly without an explicit `pool.end()`. Do NOT add a `pool.end()` call — that would attempt to talk to Neon and is out of scope for this verification.
   - Both staging invocations below MUST clear the higher-precedence `NEON_DATABASE_URL` for that single command (use `env -u NEON_DATABASE_URL`) so the `DATABASE_URL` under test is what `firstUrl("NEON_DATABASE_URL", "DATABASE_URL")` resolves; otherwise an ambient `NEON_DATABASE_URL` (e.g. shell export, `.env.local`) would mask `DATABASE_URL` and could produce a false-pass artifact.
   - Run with the staging Neon **pooler** URL: `cd web && env -u NEON_DATABASE_URL NODE_ENV=production DATABASE_URL=<staging-pooler-url> node scripts/verify-pooled-url.mjs`. Expect exit 0 and stdout containing `OK: pooler url accepted`.
   - Run with the staging Neon **direct** URL (port 5432, no `-pooler`): `cd web && env -u NEON_DATABASE_URL NODE_ENV=production DATABASE_URL=<staging-direct-url> node scripts/verify-pooled-url.mjs`. Expect non-zero exit and stderr matching `/Neon pooler URL required/i`.
   - Save the combined stdout+stderr of both invocations to `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` and reference that path in the implementation slice-completion note. The artifact must record that both invocations ran with `NEON_DATABASE_URL` unset (the `env -u NEON_DATABASE_URL` prefix in the captured command line is sufficient evidence).

## Changed files expected
- `web/src/lib/db.ts` (add and invoke `assertPooledDatabaseUrl` at module load — this is the actual existing DB entrypoint; `web/src/lib/db/driver.ts` is not present in this repo)
- `web/scripts/tests/pooled-url-assertion.test.mjs` (new unit test)
- `web/scripts/verify-pooled-url.mjs` (new staging-verification harness used by Step 4)
- `diagnostic/slices/06-pooled-url-assertion.md` (implementer fills in the `Slice-completion note` section with a reference to the staging artifact path produced by Step 4)

## Artifact paths
- `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` — combined stdout/stderr of the two staging `node scripts/verify-pooled-url.mjs` invocations (pooler URL and direct URL) from Steps §4.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/scripts/tests/pooled-url-assertion.test.mjs` asserts that the function THROWS when `NODE_ENV=production` and the URL host has no `-pooler` and port is `5432` (direct Neon URL).
- [ ] Same test file asserts that the function THROWS when `NODE_ENV=production` and the URL has `-pooler` host but port `5432` (mismatched), and again when the URL has port `6543` but host without `-pooler` (also mismatched).
- [ ] Same test file asserts that the function does NOT throw when `NODE_ENV=production` and the URL is a valid Neon pooler URL (`-pooler` host AND port `6543`).
- [ ] Same test file asserts that the function does NOT throw when `NODE_ENV !== 'production'` regardless of URL shape (covers `development`, `test`, and unset `NODE_ENV`).
- [ ] Same test file asserts the precedence contract `firstUrl("NEON_DATABASE_URL", "DATABASE_URL")`: with `NODE_ENV='production'`, a fixture where `NEON_DATABASE_URL` is a valid pooler URL and `DATABASE_URL` is a conflicting direct URL must NOT throw; a fixture where `NEON_DATABASE_URL` is a direct URL and `DATABASE_URL` is a valid pooler URL MUST throw with a message matching `/Neon pooler URL required/i`. This proves the assertion validates the same URL `createPool()` will use rather than only `DATABASE_URL`.
- [ ] Test file is wired into `cd web && npm run test:grading` so it executes in the gate command, and the gate exits 0 locally.
- [ ] Staging verification artifact at `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` exists and contains both the success line (`OK: pooler url accepted`) and a non-zero-exit error message from the direct-URL invocation.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Production-touching. Require user-approved sentinel before merge. Rollback: `git revert` + Neon-config revert if applicable.

## Slice-completion note

**Branch:** `slice/06-pooled-url-assertion`

**Commits (this branch, atop the plan-approved commit `403662e`):**
- `31beb0f` — feat(db): assert Neon pooler DATABASE_URL in production startup. Adds `assertPooledDatabaseUrl` to `web/src/lib/db.ts`, the test file, the staging-verification harness, and the staging artifact.
- `20fc5d3` — fill in initial slice-completion note (round-1 audit revision).
- `8beeb06` — flip awaiting_audit; codex re-audits under artifact-paths allow-list.
- (this commit) — round-2 audit revision: drop the `NEXT_PHASE` bypass so the production import-time assertion is unconditional, refresh staging artifact, and update this note.

**Files changed (matches `Changed files expected`):**
- `web/src/lib/db.ts` — exports `assertPooledDatabaseUrl(env)` and now invokes it unconditionally at module load before `createPool()` runs (the prior `NEXT_PHASE !== 'phase-production-build'` guard has been removed per round-2 audit).
- `web/scripts/tests/pooled-url-assertion.test.mjs` — unit test, 7 cases covering all 5 acceptance criteria + both directions of the precedence contract (unchanged this revision).
- `web/scripts/verify-pooled-url.mjs` — staging-verification harness for Step 4 (unchanged this revision).
- `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` — refreshed to reflect the unconditional module-load assertion (direct-URL stack-trace site is now `db.mjs:101`, the unconditional invocation site).
- `diagnostic/slices/06-pooled-url-assertion.md` — frontmatter set to `status=awaiting_audit, owner=codex` and this updated slice-completion note.

**Artifact:** `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` — combined stdout/stderr of both `node scripts/verify-pooled-url.mjs` invocations (pooler URL and direct URL), with `env -u NEON_DATABASE_URL` documented in each captured command line. Pooler-URL invocation: `OK: pooler url accepted` / exit 0. Direct-URL invocation: `Error: Neon pooler URL required in production: got host='ep-foo-bar.us-east-2.aws.neon.tech' port='5432'.` / exit 1. The direct-URL throw now originates at module-load `db.mjs:101` (the unconditional `assertPooledDatabaseUrl(process.env)` call) — earlier than `verify-pooled-url.mjs:37` — confirming the round-2 fix.

**Gate-command exit codes (from `cd web && ...`):**
- `npm run build` → exit `0` (run with `env -u DATABASE_URL -u NEON_DATABASE_URL` — see decision #2 below)
- `npm run typecheck` → exit `0`
- `npm run test:grading` → exit `0` (58 subtests: 48 pass, 0 fail, 10 skipped — including the 7 new `pooled-url-assertion` cases)

**Decisions / non-obvious notes for the auditor:**
1. `assertPooledDatabaseUrl` is a pure function over `env: NodeJS.ProcessEnv`. Both the test and the staging harness invoke it directly with controlled env fixtures / `process.env`, never relying on side-effectful module load. The test file neutralizes the module-load `assertPooledDatabaseUrl(process.env)` call by setting `NODE_ENV='test'` and `delete`-ing `NEON_DATABASE_URL`/`DATABASE_URL`/`NEON_DB_*`/`DB_*` before importing the transpiled `db.ts`, so the unconditional module-load invocation is a no-op at import time and cannot consume ambient env.
2. **Round-2 fix — removed the `NEXT_PHASE` bypass.** The previous revision wrapped the module-load call with `if (process.env.NEXT_PHASE !== "phase-production-build")` so `next build` (which forces `NODE_ENV=production` while collecting page data) would not consume the developer's ambient non-pooler `DATABASE_URL`. The round-1 auditor flagged this as a Step-2 contract violation: the import-time assertion must be unconditional in production. The bypass has been removed entirely; `assertPooledDatabaseUrl(process.env)` now always runs at module load. **Implication for the build gate:** `cd web && npm run build` is run under `env -u DATABASE_URL -u NEON_DATABASE_URL` so the build does not pick up a developer's ambient non-pooler URL (with both vars unset, `firstUrl` returns `undefined` and the assertion early-returns; `createPool` then falls back to the lazy local `DB_HOST` defaults — no TCP connection at construction time). This matches a clean CI/production-build environment, where DATABASE_URL is either unset (build phase) or already a Neon pooler URL.
3. The harness writes its transpiled `db.mjs` under `web/scripts/.tmp-verify-pooled-url-*` (instead of `os.tmpdir()`) so Node's resolver walks up to `web/node_modules` and finds the real `pg` package; `pg.Pool` construction is lazy so this is safe and no TCP connection is opened. The harness never calls `pool.query`, `pool.connect`, or `pool.end`. Per Step 4's "module-load interaction note", the direct-URL invocation's throw originates from the module-load `assertPooledDatabaseUrl(process.env)` call (visible in the artifact stack trace at `db.mjs:101`, before the harness re-invokes the exported function at `verify-pooled-url.mjs:37`).
4. Both staging invocations use `env -u NEON_DATABASE_URL` per Step 4 to defeat any ambient higher-precedence variable that would mask `DATABASE_URL`.

**Self-check vs. acceptance criteria:**
- [x] Direct Neon URL (no `-pooler`, port 5432) → THROWS in production. Covered by `web/scripts/tests/pooled-url-assertion.test.mjs` test 1.
- [x] `-pooler` host but port 5432 → THROWS; port 6543 but no `-pooler` host → THROWS. Covered by tests 2 and 3.
- [x] Valid Neon pooler URL (`-pooler` AND `6543`) → does NOT throw. Covered by test 4.
- [x] `NODE_ENV !== 'production'` (development, test, unset) → does NOT throw regardless of URL shape. Covered by test 5.
- [x] Precedence contract `NEON_DATABASE_URL ?? DATABASE_URL`: valid pooler in `NEON_DATABASE_URL` + conflicting direct in `DATABASE_URL` → does NOT throw; direct in `NEON_DATABASE_URL` + valid pooler in `DATABASE_URL` → THROWS with `/Neon pooler URL required/i`. Covered by tests 6 and 7.
- [x] Test file is wired into `npm run test:grading` (matches the existing `node --test scripts/tests/*.test.mjs` glob in `web/package.json`); gate exits 0 locally.
- [x] Staging artifact `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` exists and contains both `OK: pooler url accepted` and the non-zero-exit `Neon pooler URL required` error from the direct-URL invocation.

## Audit verdict
**PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `cd web && npm run test:grading` -> exit `0`
- Scope diff -> PASS: `diagnostic/_state.md`, `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt`, `diagnostic/slices/06-pooled-url-assertion.md`, `web/scripts/tests/pooled-url-assertion.test.mjs`, `web/scripts/verify-pooled-url.mjs`, and `web/src/lib/db.ts` are all in scope via `Changed files expected`, `Artifact paths`, or the `_state.md` append-only allow-list; `_state.md:61`, `_state.md:62`, and `_state.md:63` are single-line appends and the section remains under the 10-entry cap.
- Criterion 1 -> PASS (`web/scripts/tests/pooled-url-assertion.test.mjs:79`)
- Criterion 2 -> PASS (`web/scripts/tests/pooled-url-assertion.test.mjs:87`, `web/scripts/tests/pooled-url-assertion.test.mjs:99`)
- Criterion 3 -> PASS (`web/scripts/tests/pooled-url-assertion.test.mjs:108`)
- Criterion 4 -> PASS (`web/scripts/tests/pooled-url-assertion.test.mjs:115`)
- Criterion 5 -> PASS (`web/scripts/tests/pooled-url-assertion.test.mjs:129`, `web/scripts/tests/pooled-url-assertion.test.mjs:140`; `web/src/lib/db.ts:27`, `web/src/lib/db.ts:44`, `web/src/lib/db.ts:93`)
- Criterion 6 -> PASS (`web/scripts/tests/pooled-url-assertion.test.mjs:18`; Gate #3 exit `0`)
- Criterion 7 -> PASS (`diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt:13`, `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt:15`, `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt:21`, `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt:27`; independent reruns: pooler command exit `0`, direct-URL command exit `1`)
- Decision -> PASS

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace `Verify against a real Neon connection.` with a concrete pre-merge verification step that names the exact environment, command or check, and any required artifact or evidence; the current step is underspecified and not actionable for the implementer.
- [x] Make the acceptance criteria directly testable from this slice by specifying the expected automated assertion coverage for pooled versus direct production URLs instead of `implemented and tested per the goal`.
- [x] Align `Required services / env` with the actual slice scope: either remove the Neon API token / console requirement or add explicit plan steps that use it, because the current plan declares external access without any defined action.

### Low
- [x] Resolve the mismatch between `Add tests / docs as appropriate.` and `Changed files expected` by either naming any expected doc path or dropping docs from the step.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated within 24 hours, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Rewrite Step 4's staging verification import target to the repo's actual DB entrypoint, because `web/src/lib/db/driver.ts` does not exist here and the artifact command cannot run as written.

### Medium
- [x] Align `Changed files expected` with Step 1's fallback path: either name `web/src/lib/db.ts` as the expected implementation edit in this repo or require creating and using `web/src/lib/db/driver.ts` consistently across the plan.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.
- Repo context check: `web/package.json` already runs `node --test scripts/tests/*.test.mjs` for `test:grading`, so no extra test-runner wiring is needed for a new `*.test.mjs` file.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make Step 4's staging commands deterministic under the documented `NEON_DATABASE_URL ?? DATABASE_URL` precedence by explicitly unsetting `NEON_DATABASE_URL` or by supplying the pooler/direct staging URL through the higher-precedence variable being asserted; otherwise an ambient `NEON_DATABASE_URL` can mask the `DATABASE_URL` under test and produce a false-pass artifact.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.
- Repo context check: [web/src/lib/db.ts](/Users/robertzehnder/.openf1-loop-worktrees/06-pooled-url-assertion/web/src/lib/db.ts:17) resolves URLs via `firstUrl("NEON_DATABASE_URL", "DATABASE_URL")`, so verification must control both env vars, not only `DATABASE_URL`.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make Steps 3 and 4 explicit about neutralizing `db.ts` import-time side effects when loading `assertPooledDatabaseUrl`, because Step 2 also requires `assertPooledDatabaseUrl(process.env)` to run at module load and the current test/harness instructions can throw before the exported function is invoked or accidentally depend on ambient env.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [x] Make Steps 3 and 4 account for the existing `db.ts` module-load `createPool()` path, not only the new assertion, by specifying how the transpiled import avoids or safely tolerates pool initialization before the exported `assertPooledDatabaseUrl` is invoked.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High
- [x] Add an automated precedence case proving `assertPooledDatabaseUrl` validates the same URL `createPool()` will use: when both `NEON_DATABASE_URL` and `DATABASE_URL` are set to conflicting values, the test must show the function honors `NEON_DATABASE_URL ?? DATABASE_URL` rather than validating only `DATABASE_URL`.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.

## Plan-audit verdict (round 7)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [x] Add `diagnostic/slices/06-pooled-url-assertion.md` to `Changed files expected`, because Step 4 requires the implementer to reference the staging artifact path in the slice-completion note and therefore the slice file itself will be edited.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.

## Plan-audit verdict (round 8)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.
