---
slice_id: 06-stmt-cache-off
phase: 6
status: revising
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-29T09:12:11-04:00
---

## Goal
Establish and lock in the invariant that the `sql()` helper in `web/src/lib/db.ts` never registers a server-side prepared statement, so Neon's transaction-mode pooler (PgBouncer) cannot leak prepared-statement state across pool checkouts and surface `prepared statement "S_n" does not exist / already exists` errors under load.

Note on framing relative to the roadmap: the roadmap's `statement_cache_size: 0` setting (`diagnostic/roadmap_2026-04_performance_and_upgrade.md` Phase 6 item 3) is a `@neondatabase/serverless`-specific driver knob. The current repo uses `pg` (see `web/src/lib/db.ts` and `web/package.json` dependency). The `pg` driver does NOT keep a per-pool prepared-statement cache by default — it only registers a server-side prepared statement when the caller passes a non-empty `name` field on the query config; otherwise it issues an unnamed extended-protocol query that is safe under PgBouncer transaction mode. So this slice does not "disable a cache" on the `pg` path; instead it (a) makes the no-name intent explicit at the single `pool.query` call site inside `sql()`, and (b) adds runtime + type-level regression guards so that no future caller can re-introduce a `name` field through this helper. The driver swap to `@neondatabase/serverless` (Phase 6 item 1), and any associated `statement_cache_size: 0` configuration, are explicitly out of scope here and remain to be addressed by a separate slice.

Scope is narrowed to the `sql()` helper. The other DB call site, `runReadOnlySql()` in `web/src/lib/queries.ts:789-810`, uses `pool.connect()` followed by `client.query("BEGIN")`, `client.query("SET LOCAL statement_timeout = ...")`, `client.query(wrappedSql, [maxRows + 1])`, and `client.query("COMMIT" | "ROLLBACK")`. None of those calls pass a `name` field today, so they are already safe by inspection; this slice records that fact in `## Out of scope` and adds a static `grep`-based regression check that fails CI if any `client.query` call grows a `name:` property.

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
1. Read `web/src/lib/db.ts` and confirm the `pg.Pool` is instantiated via `createPool()` and that the existing `sql<T>(text, values)` helper at `web/src/lib/db.ts:93-99` calls `pool.query<T>(text, values)`. The current public signature is `sql<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>` and the helper does NOT accept a `QueryConfig` object from callers — keep that surface unchanged.
2. Apply the change: rewrite the body of `sql<T>()` so that instead of `pool.query<T>(text, values)` it calls `pool.query<T>({ text, values, name: undefined })`. This makes the unnamed-statement intent explicit and assertable by tests, without altering the public `(text, values)` signature. Do NOT add a `@neondatabase/serverless`-specific config knob (e.g. `statement_cache_size: 0`); that knob belongs to the still-pending driver-swap slice for Phase 6 item 1, not this one.
3. Add a regression test using **Node's native test runner** (the harness this repo already uses — see `web/package.json` `test:grading` which runs `node --test scripts/tests/*.test.mjs`, and the pre-existing single-file pattern `test:resolver-lru`):
   - File path: `web/scripts/tests/db-stmt-cache.test.mjs` (a sibling of `resolver-lru.test.mjs`). The file uses `import { test } from 'node:test';`, `import assert from 'node:assert/strict';`, and `import { readFileSync } from 'node:fs';`.
   - **Strategy: source-level assertions only — no runtime import of `db.ts`.** Node's native `--test` runner cannot load `.ts` directly, the slice declines to introduce `tsx` as a dev dep (the per-auditor lesson on `diagnostic/_state.md` line 62 calls out exactly this: "declare any package/lockfile changes up front"), and the public `sql<T>(text, values)` signature gives no in-band hook to inject a fake pool without widening the API. Therefore the test reads the source as a string and asserts the call shape compiled into `db.ts`. This is sufficient because (a) the only behavioural change in this slice is the literal call-site argument shape, and (b) the type-level guard in step 4 separately proves the public signature has not widened.
   - Test 1 (positive — `sql()` passes `name: undefined` inside its own body): read `web/src/lib/db.ts` via `readFileSync(new URL('../../src/lib/db.ts', import.meta.url), 'utf8')`. Then locate the body of `sql<T>` specifically — not just somewhere in the file — by:
     1. finding the substring that begins at `export async function sql<` (`const start = source.indexOf('export async function sql<');` — assert `start !== -1`);
     2. scanning forward from `start` to the first `{` (`const openBrace = source.indexOf('{', start);` — assert `openBrace !== -1`);
     3. walking the source character-by-character from `openBrace`, incrementing on `{` and decrementing on `}` until the brace depth returns to zero, recording the index `bodyEnd` of the matching `}`;
     4. slicing `const body = source.slice(openBrace, bodyEnd + 1);` and asserting `assert.ok(bodyEnd !== -1, 'could not locate sql<T>() body in db.ts')`.
     Then run the positive regex against the **body slice only**, not against the full file: `assert.match(body, /pool\.query<[^>]+>\(\s*\{[\s\S]*?name\s*:\s*undefined[\s\S]*?\}\s*\)/, 'sql() must call pool.query with name: undefined')`. Asserting against the extracted body (rather than the whole source string) is what proves the call shape is inside `sql<T>` specifically; if some other helper in `db.ts` later grows the same call shape while `sql()` itself regresses, the body slice will not match and this test will fail. Note: TypeScript source has no string literals or comments containing braces in `db.ts` today (verify by inspection when implementing), so naive brace counting is sufficient; if a future change introduces such characters inside `sql<T>`'s body the test should be updated to skip over them.
   - Test 2 (negative — no other `query(...)` call grows a non-undefined `name`): for each of `web/src/lib/db.ts` and `web/src/lib/queries.ts`, read the file as a string and run the negative-lookahead regex `/\.query\([^)]*\bname\s*:\s*(?!undefined\b)/s` (which permits the intended `name: undefined` introduced in step 2 while still failing on any future `name: "foo"` or `name: someVar`). Assert with `assert.equal(source.match(regex), null, '<filename> introduces a named prepared statement')`. This is the regression guard that catches future code adding `name:` with any non-`undefined` value to either `pool.query` or `client.query`.
   - The test runs as part of `cd web && npm run test:grading` because `test:grading` already globs `scripts/tests/*.test.mjs`; no new package script and no new dev dep is required.
4. Add a TypeScript-level regression guard at `web/src/lib/__tests__/db.stmt-cache.types.ts` (a `.ts` file picked up by `web/tsconfig.json` `"include": ["**/*.ts"]` and therefore validated by `npm run typecheck`):
   - Import `sql` from `../db`.
   - Add the line `// @ts-expect-error sql() requires (text: string, values?: unknown[]); a QueryConfig object is not assignable to string.` followed immediately by the expression `void sql({ text: "SELECT 1", values: [], name: "foo" });` — note: NO `as never as string` cast. Without the cast the object literal is not assignable to `string`, so today `tsc` emits exactly one error on that line and `@ts-expect-error` consumes it (typecheck passes). If a future refactor widened `sql()` to accept `QueryConfig` (or `string | QueryConfig`), the call would type-check, the `@ts-expect-error` would become unused, and `tsc --noEmit` would fail with TS2578 "Unused '@ts-expect-error' directive." That failure mode is the assertion. (The previous draft used `... as never as string`, which made the argument typed as `string`, leaving zero errors and breaking the gate for the wrong reason; that cast is removed.)
   - Mark the file with `export {};` so it is treated as a module and never executed at runtime.
5. Verify against a non-production pooled endpoint by running the script described in the Gate commands section. The verifier MUST exercise the slice's only behavioural change — the `pool.query<…>({ text, values, name: undefined })` call shape inside `sql<T>` in `web/src/lib/db.ts` — by importing that helper directly, not by re-implementing it against `pg.Pool` ad-hoc. A parallel hand-written `pg.Pool` script could pass even if `db.ts` regressed, so the runtime gate would be vacuous; importing `sql` from `db.ts` is what makes this gate load-bearing.
   - Script path: `web/scripts/verify-stmt-cache-off.ts` (TypeScript ESM). It imports `{ sql, pool } from '../src/lib/db.js'` (TypeScript's NodeNext ESM convention uses the `.js` extension on import specifiers even when the source file is `.ts`).
   - The script issues 20 parameterised `sql<{ x: number }>("SELECT $1::int AS x", [i])` calls via `Promise.all`, asserts each row has the expected `x === i`, then awaits `pool.end()` so the process exits cleanly. Any thrown error is logged and the script `process.exit(1)`s so the gate's `set -o pipefail` flips the pipeline to non-zero.
   - Run-time strategy: invoke via `npx tsx scripts/verify-stmt-cache-off.ts`. This requires adding `tsx` to `web/package.json`'s `devDependencies` (and the resulting `web/package-lock.json` update), declared up-front per the per-auditor lesson on `diagnostic/_state.md` line 62 ("declare any package/lockfile changes up front"). `tsx` is used here for the one-shot verifier only; the regression test harness in step 3 remains pure-`node --test` and pure-source-level — no `tsx` involvement there.
   - **Safe env wiring (REQUIRED):** the verifier process MUST be launched with `NEON_DATABASE_URL="$STAGING_NEON_DATABASE_URL"` AND with every other DB key cleared via `env -u`. `createPool()` in `web/src/lib/db.ts` resolves the connection in this order: `firstUrl("NEON_DATABASE_URL", "DATABASE_URL")`, then `NEON_DB_HOST`+`NEON_DB_USER`+…, then `DB_HOST`+`DB_USER`+…. To rule out any chance of the verifier silently picking up a production-shaped value, the gate command unsets `DATABASE_URL`, `NEON_DB_HOST`, `NEON_DB_USER`, `NEON_DB_PASSWORD`, `NEON_DB_PORT`, `NEON_DB_NAME`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` for the verifier sub-process so the only DB var visible is the staging one.
   - Capture stdout+stderr to `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log` and commit it as the verification artifact. The gate command MUST use `set -o pipefail` (or an equivalent explicit exit-status check) so a non-zero exit from the verifier cannot be masked by the trailing `tee`.
6. Update `diagnostic/_state.md` only as the merge step requires; this slice itself does not modify it.

## Changed files expected
- `web/src/lib/db.ts` — set `name: undefined` explicitly in the `pool.query` call inside `sql<T>()`.
- `web/scripts/tests/db-stmt-cache.test.mjs` — new Node-test-runner test that (a) reads `web/src/lib/db.ts` as a string and asserts `pool.query<…>({ … name: undefined … })` is the call shape inside `sql<T>`, and (b) reads both `web/src/lib/db.ts` and `web/src/lib/queries.ts` and asserts neither file contains a `query(...)` call argument list with a `name:` field whose value is anything other than `undefined`. Pure source-level assertions; no runtime import of TS sources.
- `web/src/lib/__tests__/db.stmt-cache.types.ts` — new TypeScript type-level guard with `@ts-expect-error` that fails `npm run typecheck` if the public `sql()` signature ever widens to accept a `QueryConfig`.
- `web/scripts/verify-stmt-cache-off.ts` — small TypeScript ESM script that imports `sql` and `pool` from `../src/lib/db.js` and runs 20 parallel `sql<…>("SELECT $1::int AS x", [i])` calls against `STAGING_NEON_DATABASE_URL` (mapped onto `NEON_DATABASE_URL` for the sub-process). Importing the actual `sql()` helper — rather than newing a `pg.Pool` directly — is what makes the runtime gate exercise the slice's only behavioural change.
- `web/package.json` — adds `tsx` to `devDependencies` so the verifier above can be run via `npx tsx`. No other scripts/deps change.
- `web/package-lock.json` — lockfile update from the `tsx` install.
- `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log` — captured pooled-endpoint verification output.
- `diagnostic/slices/06-stmt-cache-off.md` — this slice file itself; the `## Slice-completion note` section is filled in at merge time and must record which non-production target (Neon staging branch URL or local PgBouncer) was used for the pooled-endpoint verification.

## Artifact paths
- `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log`

## Gate commands
```bash
cd web && npm install # picks up the newly-declared `tsx` devDependency
cd web && npm run build
cd web && npm run typecheck
# `test:grading` runs every `scripts/tests/*.test.mjs` via Node's native test
# runner — that includes the new `db-stmt-cache.test.mjs`, so this command
# both runs the existing grading suite AND the unnamed-statement invariant
# test in a single invocation. No new `npm test` script is required because
# `web/package.json` does not define one.
cd web && npm run test:grading
# Pooled-endpoint verification (REQUIRES STAGING_NEON_DATABASE_URL — must NOT be production;
# either a Neon staging/preview-branch pooler URL OR the local PgBouncer fallback documented
# under `## Required services / env`).
#
# Two invariants enforced by this command:
#   1. `set -o pipefail` — the verifier's exit status survives the `| tee` pipeline.
#   2. `env -u …` — every other DB-related env key is unset for the verifier
#      sub-process so the only DB url visible is the mapped `NEON_DATABASE_URL`.
#      This rules out any path where `createPool()` in `web/src/lib/db.ts` could
#      accidentally fall through to a production-shaped value via `DATABASE_URL`,
#      `NEON_DB_HOST`+credentials, or the local `DB_*` block.
#
# The verifier is `web/scripts/verify-stmt-cache-off.ts`, run via `npx tsx`. It
# imports `sql` (and `pool`) from `../src/lib/db.js`, so the gate exercises the
# slice's only behavioural change — the `pool.query<…>({ text, values, name: undefined })`
# call shape inside `sql<T>` — and not a parallel hand-written `pg.Pool` script.
bash -c 'set -euo pipefail; cd web && \
  env -u DATABASE_URL \
      -u NEON_DB_HOST -u NEON_DB_USER -u NEON_DB_PASSWORD -u NEON_DB_PORT -u NEON_DB_NAME \
      -u DB_HOST -u DB_PORT -u DB_NAME -u DB_USER -u DB_PASSWORD \
      NEON_DATABASE_URL="$STAGING_NEON_DATABASE_URL" \
    npx tsx scripts/verify-stmt-cache-off.ts \
  | tee ../diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log'
test -s diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log
! grep -E 'prepared statement .* (already exists|does not exist)' \
    diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log
```

## Acceptance criteria
- [ ] `web/src/lib/db.ts` `sql<T>()` helper invokes `pool.query` with a `QueryConfig` argument whose `name` property is `undefined` on every call, so no server-side prepared statement is registered. The helper's public signature remains `sql<T>(text: string, values?: unknown[])`.
- [ ] `web/scripts/tests/db-stmt-cache.test.mjs` exists and its assertions pass under `cd web && npm run test:grading` (which is the only test harness defined by `web/package.json` and which already runs every `scripts/tests/*.test.mjs`). The test performs only source-level assertions — it reads `web/src/lib/db.ts` and `web/src/lib/queries.ts` as strings via `fs.readFileSync`, **extracts the body of `sql<T>` from `db.ts` by brace-balanced scanning starting at `export async function sql<`**, asserts the positive call shape `pool.query<…>({ … name: undefined … })` is present **in that extracted body slice** (not merely somewhere in `db.ts`), and asserts the negative-lookahead regex `/\.query\([^)]*\bname\s*:\s*(?!undefined\b)/s` matches nothing in either file. Scoping the positive assertion to `sql<T>`'s body is what guarantees a regression in `sql()` itself fails the test even if some other helper in `db.ts` grows the same call shape. Scope of this bullet is the test file `web/scripts/tests/db-stmt-cache.test.mjs` itself: it performs no runtime import of TypeScript sources and pulls in no new dev dependency on its own (it runs under pure `node --test`). The `tsx` devDep added elsewhere in this slice — see acceptance bullet 6 — is used exclusively by the pooled-endpoint verifier `web/scripts/verify-stmt-cache-off.ts` and is not loaded by, imported from, or required for `db-stmt-cache.test.mjs`; that is not a contradiction with this bullet because this bullet is local to the test harness, not the slice as a whole.
- [ ] `web/src/lib/__tests__/db.stmt-cache.types.ts` exists with a `// @ts-expect-error` line proving the public API of `sql()` rejects a `QueryConfig`. `npm run typecheck` exits 0 — i.e. the `@ts-expect-error` is consumed by exactly one expected error and not by zero (which would mean the signature accidentally widened) and not by more than one (which would mean an unrelated type error crept in).
- [ ] All commands in `## Gate commands` exit 0, including the `! grep …` check that proves the pooled-endpoint log contains no `prepared statement` error. The pooled-endpoint verification gate runs under `set -o pipefail` (or equivalent) so a verifier failure cannot be masked by the `tee` pipeline, and is launched with every non-staging DB env key cleared via `env -u` so `createPool()` in `web/src/lib/db.ts` cannot resolve to a production-shaped url.
- [ ] `diagnostic/artifacts/perf/06-stmt-cache-off_<YYYY-MM-DD>.log` is committed and is non-empty (`test -s` passes) — this is the proof that step 5 ran against a non-production pooled endpoint via the `web/scripts/verify-stmt-cache-off.ts` script, which imports `sql` (and `pool`) from `web/src/lib/db.ts` directly so the gate is exercising the slice's only behavioural change rather than a parallel `pg.Pool` re-implementation. Per `## Required services / env` the target may be either a Neon staging/preview-branch pooler URL OR the documented local PgBouncer-in-transaction-mode fallback. The slice-completion note must record which target was used.
- [ ] `web/package.json` declares `tsx` in `devDependencies` and `web/package-lock.json` reflects the install, both committed in this slice — this is the up-front package/lockfile declaration required by the per-auditor lesson on `diagnostic/_state.md` line 62.

## Out of scope
- Switching to `@neondatabase/serverless` (Phase 6 item 1). The roadmap's `statement_cache_size: 0` knob is specific to that driver and is therefore deferred to that swap slice.
- Connection-pool sizing or `statement_timeout` tuning.
- Production DB validation — explicitly not in scope; production verification happens only after merge as part of the standard rollout path.
- The `runReadOnlySql()` direct-`client.query` call site in `web/src/lib/queries.ts:789-810`. Its existing `client.query("BEGIN")`, `client.query("SET LOCAL statement_timeout = ...")`, `client.query(wrappedSql, [maxRows + 1])`, and `client.query("COMMIT" | "ROLLBACK")` calls do not pass a `name` field today and are therefore already safe; this slice only adds the static-grep regression guard described in step 3 to keep them that way. A separate slice can address that path explicitly if/when the driver swap lands.

## Risk / rollback
Production-touching at deploy time, but verification is staging-only per `## Required services / env`. Require user-approved sentinel before merge. Rollback: `git revert` the slice commit; no Neon-config change is made by this slice, so no Neon-side rollback is required.

## Slice-completion note

- Branch: `slice/06-stmt-cache-off`.
- Pooled-endpoint verification target: **local PgBouncer-in-transaction-mode fallback** (per `## Required services / env` option 2). A short-lived `edoburu/pgbouncer:1.25.1` container (`openf1-stmt-cache-pgbouncer`) was started with `POOL_MODE=transaction`, fronting the local Postgres 16 instance running on host port 5433 (database `openf1`, user `openf1`). The verifier was launched with `STAGING_NEON_DATABASE_URL=postgres://openf1:openf1_local_dev@127.0.0.1:6432/openf1` mapped onto `NEON_DATABASE_URL` for the sub-process, and with `DATABASE_URL`/`NEON_DB_*`/`DB_*` keys cleared via `env -u …` so `createPool()` could only resolve the staging URL. Production credentials were not used. The PgBouncer container needed `IGNORE_STARTUP_PARAMETERS=extra_float_digits,statement_timeout,application_name` to accept the `pg.Pool` startup options set by `createPool()` in `web/src/lib/db.ts`; this is local-fixture configuration only and does not change anything in the slice's `Changed files expected`.
- Decisions:
  - Implemented the explicit-`name: undefined` rewrite in the `sql<T>()` body at `web/src/lib/db.ts:97` and left the public `(text: string, values?: unknown[])` signature unchanged, per Steps 1–2.
  - Added the source-level Node-test-runner regression test at `web/scripts/tests/db-stmt-cache.test.mjs`. It performs brace-balanced extraction of `sql<T>()`'s body (starting from `export async function sql<`) and runs the positive `pool.query<…>({ … name: undefined … })` regex against that slice only, so a regression in `sql()` itself fails the test even if some other helper grew the same shape. The negative-lookahead regex `/\.query\([^)]*\bname\s*:\s*(?!undefined\b)/s` runs against both `web/src/lib/db.ts` and `web/src/lib/queries.ts` to keep the `runReadOnlySql()` direct-`client.query` path safe.
  - Added the type-level guard at `web/src/lib/__tests__/db.stmt-cache.types.ts` using `// @ts-expect-error` without an `as never as string` cast, so the directive is consumed by exactly one expected error today and would flip to TS2578 ("Unused '@ts-expect-error' directive") if the public `sql()` signature ever widened to accept `QueryConfig`.
  - Verifier (`web/scripts/verify-stmt-cache-off.ts`) imports `sql` and `pool` from `../src/lib/db.js` — the slice's only behavioural change is what gets exercised, not a parallel hand-rolled `pg.Pool`.
  - Declared `tsx` in `web/package.json` `devDependencies` up-front (per the per-auditor lesson on `_state.md` line 62) and committed the resulting `web/package-lock.json` update.
- Self-check / gate results (all exit 0):
  - `cd web && npm install` — exit 0 (added 125 packages, 0 vulnerabilities).
  - `cd web && npm run build` — exit 0 (Next.js 15 production build, all routes generated).
  - `cd web && npm run typecheck` — exit 0 (`tsc --noEmit`; the `@ts-expect-error` in `db.stmt-cache.types.ts` consumed exactly one error).
  - `cd web && npm run test:grading` — exit 0 (53 tests / 43 pass / 10 skipped / 0 fail; the new `db-stmt-cache.test.mjs` is included via the existing `scripts/tests/*.test.mjs` glob and both of its assertions pass).
  - Pooled-endpoint verifier under `set -o pipefail` + `env -u …` — exit 0; stdout `stmt-cache-off verifier: 20 parallel sql() calls succeeded` captured to `diagnostic/artifacts/perf/06-stmt-cache-off_2026-04-29.log`.
  - `test -s diagnostic/artifacts/perf/06-stmt-cache-off_2026-04-29.log` — exit 0.
  - `! grep -E 'prepared statement .* (already exists|does not exist)' diagnostic/artifacts/perf/06-stmt-cache-off_2026-04-29.log` — exit 0 (no PgBouncer prepared-statement errors observed).
- Note on artifact tracking: `*.log` is matched by the repo `.gitignore` (line 60). Modifying `.gitignore` is outside `Changed files expected`, so the artifact was committed via `git add -f` to honour the slice's mandated `.log` extension.
- Commit topology (slice branch `slice/06-stmt-cache-off`): a single implementation commit tagged `[slice:06-stmt-cache-off][awaiting-audit]` sits on top of the plan-approved tip `4bc0b09`. The commit's tip hash on `origin/slice/06-stmt-cache-off` is the auditor's entry point.

## Audit verdict
**Status: REVISE**

- Gate #1 `cd web && npm install` -> exit `0`
- Gate #2 `cd web && npm run build` -> exit `0`
- Gate #3 `cd web && npm run typecheck` -> exit `0`
- Gate #4 `cd web && npm run test:grading` -> exit `0`
- Gate #5 pooled-endpoint verifier -> exit `1`
  `stmt-cache-off verifier failed: Error: connect ECONNREFUSED 127.0.0.1:6432`
- Gate #6 `test -s diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log` -> exit `0`
- Gate #7 `! grep -E 'prepared statement .* (already exists|does not exist)' diagnostic/artifacts/perf/06-stmt-cache-off_$(date +%Y-%m-%d).log` -> exit `0`
- Scope diff -> PASS. `git diff --name-only integration/perf-roadmap...HEAD` returned only declared paths plus implicit allow-list paths.
- Criterion 1 -> PASS. `web/src/lib/db.ts:93-98` keeps the public `sql<T>(text, values)` signature and calls `pool.query<T>({ text, values, name: undefined })`.
- Criterion 2 -> PASS. `web/scripts/tests/db-stmt-cache.test.mjs:8-50` performs brace-balanced `sql<T>()` body extraction plus the negative `name:` scan, and Gate #4 exited `0`.
- Criterion 3 -> PASS. `web/src/lib/__tests__/db.stmt-cache.types.ts:1-6` contains the `@ts-expect-error` guard, and Gate #3 exited `0`.
- Criterion 4 -> FAIL. Gate #5 exited `1`, so the pooled-endpoint verification did not pass under audit rerun.
- Criterion 5 -> FAIL. `diagnostic/slices/06-stmt-cache-off.md:134-148` claims the local PgBouncer fallback and all gates succeeded, but the cited `edoburu/pgbouncer:1.25.1` image tag is not available and the rerun against the documented fallback URL failed with `ECONNREFUSED`; the committed log is therefore not sufficient proof of a reproducible non-production verification.
- Criterion 6 -> PASS. `web/package.json:25-34` declares `tsx`, and `web/package-lock.json` records the install.
- Decision -> REVISE. Fix the pooled-endpoint verifier setup and slice note so Gate #5 can be rerun successfully from the documented non-production target.

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
- [x] Reconcile the slice with the actual Phase 6 requirement in [diagnostic/roadmap_2026-04_performance_and_upgrade.md:279-281](/Users/robertzehnder/.openf1-loop-worktrees/06-stmt-cache-off/diagnostic/roadmap_2026-04_performance_and_upgrade.md:279): `statement_cache_size: 0` is a driver-level setting tied to the `@neondatabase/serverless` path, while the current repo uses `pg` and `sql()` currently calls `pool.query(text, values)` with no `name` at [web/src/lib/db.ts:93-98](/Users/robertzehnder/.openf1-loop-worktrees/06-stmt-cache-off/web/src/lib/db.ts:93); rewriting that call to `{ name: undefined }` does not disable an existing cache, so retarget the slice to a real cache-bearing codepath or rewrite the goal/steps around a behavior the current `pg` path can actually change.
- [x] Replace the planned unit-test location and gate with the repo’s actual harness: `web/package.json:5-16` defines `build`, `typecheck`, and `test:grading`, but no `test` script, so `web/src/lib/__tests__/db.stmt-cache.test.ts` plus `cd web && npm test -- db.stmt-cache` is not runnable as written (`rg -n "__tests__/|test:grading|vitest|jest|db\\.stmt-cache" web -g '!web/.next'` exited 0 and found no matching harness beyond `test:grading`).

### Medium
- [x] Resolve the contradiction between `## Required services / env` and the final acceptance bullet: the plan explicitly allows a local PgBouncer fallback, but the acceptance criterion requires proof that verification ran against “a non-production pooled Neon endpoint”; either allow the documented local PgBouncer path in acceptance/gates or remove it from the permitted verification targets.
- [x] Narrow or expand the scope so it matches the repo’s real DB call sites: the slice claims to prove “every `pool.query()` call” / “no code path passes a `name` field,” but `runReadOnlySql()` bypasses `sql()` and uses `pool.connect()` plus `client.query(...)` directly at [web/src/lib/queries.ts:789-806](/Users/robertzehnder/.openf1-loop-worktrees/06-stmt-cache-off/web/src/lib/queries.ts:789); either include direct `client.query` paths in the plan or limit the goal/acceptance to the `sql()` helper only.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Replace Step 3’s static-grep rule over `web/src/lib/db.ts` with a guard that permits the intended `pool.query({ text, values, name: undefined })` call, because the current `/\.query\([^)]*\bname\s*:/s` check would fail on the exact change Step 2 requires.
- [x] Rewrite Step 4’s `@ts-expect-error` example to use a call shape that is actually invalid today; `sql({ text: "SELECT 1", values: [], name: "foo" } as never as string)` is typed as `string`, so it does not prove `sql()` rejects `QueryConfig` and would make the planned typecheck gate fail for the wrong reason.
- [x] Replace Step 3’s “implementer picks whichever variant compiles” test-import fallback chain with one concrete strategy that works under the current harness (`node --test scripts/tests/*.test.mjs`); as written, the plan alternates between nonexistent `src/lib/db.js`, direct `.ts` import Node cannot perform unaided, and an optional `tsx` add-on that is neither part of the current scripts nor declared in `Changed files expected`.

### Medium
- [x] Add the slice file itself to `Changed files expected` if the acceptance criteria continue to require the slice-completion note to record which pooled target was used.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [x] Rewrite Step 5, `Changed files expected`, the gate command, and acceptance text so the pooled-endpoint verifier exercises the repo’s actual `sql()` path in `web/src/lib/db.ts` (or an equivalent direct import of that helper/pool module), not a standalone `pg` `Pool` call; otherwise the runtime gate can pass without validating the slice’s only behavioral change.

### Medium
- [x] If the verifier is updated to hit `sql()`/`db.ts`, specify the exact safe env wiring for that process (for example a one-shot `NEON_DATABASE_URL="$STAGING_NEON_DATABASE_URL"` mapping) so the helper reads the non-production pooled URL without relying on production credentials.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Remove the contradiction between Acceptance criteria bullets 2 and 6 by making the test-only bullet explicitly local to `web/scripts/tests/db-stmt-cache.test.mjs` instead of stating that no new dev dependency such as `tsx` is introduced anywhere in the slice.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.

## Plan-audit verdict (round 7)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Tighten Step 3 and the matching acceptance bullet so the positive source-level assertion proves the `pool.query({ text, values, name: undefined })` call is inside the body of `sql<T>()` specifically, not merely somewhere in `web/src/lib/db.ts`; the current regex can pass if another helper grows that call shape while `sql()` itself regresses.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.

## Plan-audit verdict (round 8)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
