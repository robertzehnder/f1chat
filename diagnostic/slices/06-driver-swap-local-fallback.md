---
slice_id: 06-driver-swap-local-fallback
phase: 6
status: awaiting_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28T21:27:42-04:00
---

## Goal
When the developer opts in via `OPENF1_LOCAL_FALLBACK=1`, the existing pool construction in `web/src/lib/db.ts` (which already accepts any of `NEON_DATABASE_URL` / `DATABASE_URL`, `NEON_DB_HOST` + `NEON_DB_*`, or `DB_HOST` + `DB_*` host-style envs — the last branch defaulting to `127.0.0.1:5432/openf1` when nothing is set) is preserved unchanged, but a startup probe (`SELECT 1`, 2 s `connectionTimeoutMillis`) runs against the resulting pool and on failure the runtime falls back to an in-process **PGlite** (`@electric-sql/pglite`) database seeded from a committed snapshot, so dev can run without any reachable Postgres. The fallback engages **only** on probe failure of whatever pool `createPool()` returned — there is no "missing URL" trigger, because today's `createPool()` always returns a pool (the `DB_HOST` branch defaults to `127.0.0.1`). Without `OPENF1_LOCAL_FALLBACK=1` behavior is identical to today, byte-for-byte: `createPool()` runs verbatim, no probe is performed, `pool` is returned eagerly, and a misconfigured DB surfaces lazily on the first query — exactly today's behavior. Production is unchanged: when `NODE_ENV === "production"` the fallback is refused regardless of any other env, and the existing `createPool()` ladder remains the only data path.

## Inputs
- `web/src/lib/db.ts` (current `pg.Pool` driver — to be moved under `web/src/lib/db/driver.ts`)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6
- `web/scripts/tests/answer-cache.test.mjs` (existing `node --test` harness pattern to follow)

## Prior context
- `diagnostic/_state.md`

## Decisions (in response to round-1 plan-audit)
- **Mechanism:** PGlite, not SQLite. Reason: existing call sites use the `pg.Pool` interface and Postgres SQL dialect against `core.*` / `contract.*` schemas; PGlite is a Postgres-compatible in-process WASM database with the same dialect, so call sites and SQL strings work unchanged. SQLite would require dialect translation across every contract query.
- **Trigger model:** opt-in via `OPENF1_LOCAL_FALLBACK=1`. The fallback is never automatic, so a misconfigured prod deploy cannot silently serve snapshot data.
- **Production guard:** `NODE_ENV === "production"` short-circuits the selection logic before it inspects `OPENF1_LOCAL_FALLBACK`; the variable is ignored in prod and enforced by a unit test.
- **Verification surface:** all gates are repo-local. No staging / real-Neon connection is required to merge this slice — both probe-failure paths are exercised against an unroutable host (`127.0.0.1:1`) and against the `DB_*`-default `127.0.0.1:5432/openf1` (no local Postgres running), so the probe fails deterministically without external services.
- **Existing env config preserved (round-4 High #1 / #2):** `createPool()` is moved verbatim under `web/src/lib/db/driver.ts`; all four existing branches (`NEON_DATABASE_URL` / `DATABASE_URL`, `NEON_DB_HOST` + `NEON_DB_*`, `DB_HOST` + `DB_*` with defaults `127.0.0.1:5432/openf1`) remain — including the `DB_HOST` ladder's default that today causes `createPool()` to *always* return a pool when no env is set. The fallback engages only on probe failure of whatever pool `createPool()` returns; there is no "missing URL → PGlite" trigger, because today's code has no "missing URL" state. Existing deployments and local setups that rely on `NEON_DB_HOST` or `DB_HOST` are unaffected on the healthy path: the probe runs against the pool `createPool()` built and, on success, dispatches to it identically to today.
- **No probe when opt-out:** When `OPENF1_LOCAL_FALLBACK` is unset (non-prod), the startup probe does **not** run at all — `pool` is returned exactly as today and the first query fails lazily if the DB is unreachable. The opt-out surface is byte-identical to today, including the lazy-failure semantics that some local-dev workflows rely on.
- **`runReadOnlySql` survivor (`web/src/lib/queries.ts:789`):** the one direct `pool.connect()` caller is converted to a new `withTransaction(fn)` helper exposed by `web/src/lib/db/index.ts`. The helper abstracts over `pg.Pool.connect()` (with `BEGIN` / `SET LOCAL statement_timeout` / `COMMIT` / `ROLLBACK`) and PGlite's `db.transaction(tx => …)`, both of which natively support that exact statement sequence. After conversion, the `! rg "pool\.(query|connect)\("` gate succeeds with no survivors.

## Required services / env
- **Production (unchanged):** the existing `createPool()` ladder — `NEON_DATABASE_URL` / `DATABASE_URL`, then `NEON_DB_HOST` + `NEON_DB_*`, then `DB_HOST` + `DB_*` (defaults `127.0.0.1:5432/openf1`) — plus today's SSL/timeout behavior in `web/src/lib/db.ts`. All preserved verbatim by the move.
- **Local fallback prerequisites:**
  - `OPENF1_LOCAL_FALLBACK=1` — opt-in switch. Without it, behavior is identical to today (no probe, lazy-failure).
  - `OPENF1_LOCAL_SNAPSHOT_PATH` — optional; defaults to `data/local-fallback-snapshot.sql` resolved against the `web/` cwd (i.e., the on-disk path is `web/data/local-fallback-snapshot.sql`). Absolute paths in the env var are honored as-is. The plan, the test file, and `bootPglite()` all use this same `web/`-relative basis — no other resolution rule.
  - `@electric-sql/pglite` added to `web/package.json` dependencies.
  - The snapshot SQL file checked into the repo.
- **Selection logic** (implemented in a single `chooseDriver()` function and asserted by the new test file). Note that step 1 of `createPool()` itself never throws "missing URL" today — its `DB_HOST` default is `127.0.0.1` — so the selection logic never sees a "no URL" state; it sees a *pool that may or may not be reachable*. The branches:
  1. **Production:** `NODE_ENV === "production"` → run `createPool()` unchanged and use its pool. Never engage PGlite, even if `OPENF1_LOCAL_FALLBACK=1` is set. (`createPool()` may itself throw — e.g., `NEON_DB_HOST` set without `NEON_DB_USER` — and that error propagates exactly as today.)
  2. **Opt-out (default):** `OPENF1_LOCAL_FALLBACK` unset (non-prod) → run `createPool()` unchanged and return the pool. **Do not run any probe.** First query fails lazily if the DB is unreachable, identical to today.
  3. **Opt-in:** `OPENF1_LOCAL_FALLBACK=1` (non-prod) → run `createPool()` unchanged and run a startup probe (`SELECT 1`, `connectionTimeoutMillis: 2000`) against the resulting pool. On success → use the pool. On failure (timeout, refused connect, auth error, any pg error) → boot PGlite from the snapshot and emit the fallback log line (`[db] using local PGlite fallback (reason=probe-failed)` with the underlying error message). The probe's behavior is identical regardless of which `createPool()` branch built the pool — `DATABASE_URL`, `NEON_DB_HOST`, and `DB_*`-with-defaults all funnel through the same probe and same fallback decision, so no config shape is misclassified.

## Steps
1. Move `web/src/lib/db.ts` → `web/src/lib/db/driver.ts` with `git mv` (no content change in this commit-step). Add a barrel `web/src/lib/db/index.ts` that re-exports `pool`, `sql`, and the new `withTransaction` helper so every existing import (`from "@/lib/db"` or relative `"./db"`) keeps resolving.
2. Add `@electric-sql/pglite` to `web/package.json` dependencies and run `npm install --no-audit --no-fund` from `web/` to refresh `package-lock.json`.
3. In `driver.ts`, leave the existing `createPool()` body **byte-for-byte unchanged** (URL → NEON_DB_HOST → DB_*-with-defaults ladder, including SSL/timeout/`statement_timeout` semantics) and add alongside it:
   - `bootPglite(snapshotPath: string): Promise<PGlite>` — instantiates `new PGlite()`, runs the snapshot SQL via `db.exec(...)`, returns the instance.
   - `chooseDriver(): Promise<{ kind: "neon"; pool: Pool } | { kind: "pglite"; db: PGlite }>` — implements the selection logic in *Required services / env*. **Pool identity rule:** `chooseDriver()` does NOT call `createPool()` itself; it reads the singleton module-level `const pool = createPool()` constructed at module load (see Step 4) and probes / returns that exact instance. There is exactly one `pg.Pool` per process. Branches: prod → return `{ kind: "neon", pool }` referencing the singleton, no probe; opt-out → return `{ kind: "neon", pool }` referencing the same singleton, no probe; opt-in → run `pool.query("SELECT 1")` (with the 2 s `connectionTimeoutMillis` already configured on the singleton) against that same singleton — on success return `{ kind: "neon", pool }` (same instance), on failure return `{ kind: "pglite", db }`. Logs `[db] using local PGlite fallback (reason=probe-failed)` once on the fallback path with the underlying error message so a developer can see why.
   - `withTransaction<T>(fn: (tx: { query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> }) => Promise<T>): Promise<T>` — abstracts over `pg.Pool.connect()` (acquires a client, runs `BEGIN`, calls `fn`, `COMMIT` on success, `ROLLBACK` on throw, `client.release()` in `finally`) and PGlite's `db.transaction(tx => …)`. Uses the memoized `chooseDriver()` to pick the active driver. This is the abstraction that lets `web/src/lib/queries.ts:789`'s `runReadOnlySql` (which today does `pool.connect()` → `BEGIN` → `SET LOCAL statement_timeout = …` → query → `COMMIT`/`ROLLBACK`) drop its direct `pool.connect()` call.
4. Wire the exports. `createPool()` is invoked **exactly once** at module top-level — `const pool: Pool = createPool()` — and that constant is the only `pg.Pool` instance constructed in the process. `pool` is exported from `driver.ts` and re-exported by the barrel as `pool`; it keeps today's contract (eager construction at module load, no probe gate, no async resolution, identical to today's `web/src/lib/db.ts` semantics). Because `createPool()` always returns a pool today (the `DB_HOST` default is `127.0.0.1`), `pool` is never `undefined`. `sql<T>(text, values)` is the async-aware shim: it awaits a memoized `chooseDriver()` (resolved exactly once per process) and dispatches to either that singleton `pg.Pool` (the `kind: "neon"` branch's `pool` field IS the same module-level `pool` constant — same object identity, asserted by reference equality in Case C of the test file, where the opt-out branch resolves to `kind: "neon"` without probing and we can do `(await chooseDriver()).pool === pool` even when the underlying DB is unreachable) or the PGlite instance, normalizing both `{ rows }` shapes to `T[]`. Concretely: under healthy DB (any config branch, probe passes or no probe runs), `pool === chooseDriver()-resolved.pool`, and `sql()` routes to that single instance. Under fallback (probe fails, opt-in), the singleton `pool` still exists but points at the unreachable DB; `sql()` routes to the PGlite instance instead, and any direct `pool.*` caller would fail against the dead pool — which is why this step also requires converting `web/src/lib/queries.ts:789`'s `pool.connect()` to use `withTransaction(async (tx) => …)` so the runtime SQL-mode path works under both Neon and PGlite. The barrel re-exports `pool`, `sql`, and `withTransaction`; healthy-DB callers see no behavioral change.
5. Add `web/data/local-fallback-snapshot.sql` containing the minimum schema + seed needed for the chat runtime to answer something offline:
   - `CREATE SCHEMA` for `raw`, `core`, `contract` (mirrors prod).
   - One driver row, one session row, lookup tables (`compound_alias_lookup`, `metric_registry`, `valid_lap_policy`, `replay_contract_registry`).
   - One row in each summary contract the resolver and grading tests touch.
   - The file is human-readable SQL so a follow-up slice can regenerate it from `pg_dump`.
6. Add `web/scripts/tests/driver-fallback.test.mjs` (`node --test`) with subtests, each in its own worker (`node:test` `t.test` + `import()` against a unique cache-busting query string, or one subtest per file invocation) so the module-level driver singleton resets. The PGlite-engaged cases (A, B, E) do NOT use `SELECT 1` — they exercise real chat-runtime queries against the seeded `core.*` / `contract.*` rows so the test fails if the snapshot is missing schemas/rows the resolver actually relies on (round-3 High, still applies):
   - **Case A — `DB_*`-branch probe-failure, opt-in (deterministic):** to make the probe deterministically fail regardless of whether a developer happens to have a local Postgres listening on `127.0.0.1:5432` (which is the `DB_*` ladder's hard-coded default port), the test does **not** rely on the bare defaults. Instead it sets `DB_HOST="127.0.0.1"`, `DB_PORT="1"` (port 1 is reserved/never bound by a normal Postgres process, so kernel `connect()` returns `ECONNREFUSED` immediately on macOS / Linux CI), `DB_USER="x"`, `DB_PASSWORD="x"`, `DB_NAME="x"`, with `DATABASE_URL=""`, `NEON_DATABASE_URL=""`, `NEON_DB_HOST=""`, `OPENF1_QUERY_TIMEOUT_MS=""` cleared, plus `OPENF1_LOCAL_FALLBACK=1`, `NODE_ENV=test`. Because no URL or `NEON_DB_HOST` is set, `createPool()` falls into its `DB_*` branch (the round-4 audit's third config shape) and builds a pool against `127.0.0.1:1`. The probe `pool.query("SELECT 1")` rejects deterministically (no test runner machine has port 1 open), the fallback log line is emitted, and PGlite engages. This exercises the `DB_*` branch of `createPool()` end-to-end without coupling the gate to the developer's local Postgres state. (Bare-defaults coverage is intentionally dropped here because it is non-deterministic; the `DB_*` branch logic is what the test actually proves.) Assert the fallback log line is emitted and run two representative chat-runtime queries: (1) `SELECT driver_number, full_name FROM core.driver` — assert ≥ 1 row matching the seeded driver; (2) `SELECT * FROM contract.replay_contract_registry` — assert ≥ 1 row; and assert at least one of the seeded summary contracts the resolver/grading suites touch (e.g., `contract.pit_cycle_summary`, `contract.lap_phase_summary`) returns a row. The intent: prove the snapshot supplies the offline data path advertised by the developer flow, not just connectivity, **on the `DB_*` config shape**.
   - **Case B — `DATABASE_URL` unreachable, opt-in:** `DATABASE_URL="postgres://invalid:invalid@127.0.0.1:1/none"`, `OPENF1_LOCAL_FALLBACK=1`, `NODE_ENV=test`. Assert the probe fails, the fallback log line is emitted, and the same chat-runtime queries from Case A succeed against the snapshot.
   - **Case C — `DATABASE_URL` unreachable, opt-out:** `DATABASE_URL="postgres://invalid:invalid@127.0.0.1:1/none"`, `OPENF1_LOCAL_FALLBACK` unset, `NODE_ENV=test`. Importing `sql` must NOT throw at import-time (matches today's lazy-construct semantics). Calling `sql("SELECT 1")` must reject with a `pg`-originated connection error (e.g., `ECONNREFUSED` / connection-terminated), and PGlite must NOT be booted. Assert no fallback log line is emitted in this case. **Pool identity assertion:** import `{ pool, chooseDriver }` from `@/lib/db/driver` and assert that the resolved driver is `kind: "neon"` and `(await chooseDriver()).pool === pool` (reference equality — the opt-out branch must return the same singleton `pg.Pool` instance the `pool` export points at, not a freshly constructed one). This locks in the round-5 Medium contract that `chooseDriver()` does not build a second `pg.Pool`.
   - **Case D — production guard:** `DATABASE_URL="postgres://invalid:invalid@127.0.0.1:1/none"`, `OPENF1_LOCAL_FALLBACK=1`, `NODE_ENV=production`. The fallback must NOT engage even with `OPENF1_LOCAL_FALLBACK=1` set. Calling `sql("SELECT 1")` must reject with the same `pg`-originated connection error from Case C; assert PGlite was never instantiated and no fallback log line was emitted.
   - **Case E — `NEON_DB_HOST` unreachable, opt-in:** `NEON_DB_HOST="127.0.0.1"`, `NEON_DB_PORT="1"`, `NEON_DB_USER="x"`, `NEON_DB_PASSWORD="x"`, `NEON_DB_NAME="x"`, all `DATABASE_URL` / `NEON_DATABASE_URL` cleared, `OPENF1_LOCAL_FALLBACK=1`, `NODE_ENV=test`. Asserts `chooseDriver()` does not regress the `NEON_DB_HOST` config branch (round-4 High #2): `createPool()` builds a pool against the unroutable host, the probe fails, the fallback log line is emitted, and the same chat-runtime queries from Case A succeed against the snapshot.
   - **Case F — `runReadOnlySql` survivor under fallback:** any of the opt-in cases (A/B/E) additionally invokes the converted `runReadOnlySql("SELECT driver_number FROM core.driver", { maxRows: 5 })` and asserts it returns ≥ 1 row, exercising the new `withTransaction` helper end-to-end against PGlite. (Co-located with the other cases in the same test file; named "runReadOnlySql under PGlite" subtest.)
7. Add `web/docs/local-fallback.md` (~30 lines): when to set `OPENF1_LOCAL_FALLBACK=1`, where the snapshot lives, the production guard, the four-branch `createPool()` ladder still applying, and the command to run the test file standalone.

## Changed files expected
- `web/src/lib/db.ts` → moved to `web/src/lib/db/driver.ts` (existing `createPool()` body byte-for-byte unchanged; extended with `bootPglite`, `chooseDriver`, `withTransaction`, and a memoized resolution)
- `web/src/lib/db/index.ts` (new barrel; re-exports `sql`, `pool`, `withTransaction`)
- `web/package.json` (adds `@electric-sql/pglite`)
- `web/package-lock.json` (regenerated by `npm install`)
- `web/data/local-fallback-snapshot.sql` (new)
- `web/scripts/tests/driver-fallback.test.mjs` (new)
- `web/docs/local-fallback.md` (new)
- `web/src/lib/queries.ts` — the `runReadOnlySql` body at line ~789 is converted from `await pool.connect()` + manual `BEGIN`/`COMMIT`/`ROLLBACK` to `await withTransaction(async (tx) => { … })`. The `SET LOCAL statement_timeout = …` and the `SELECT * FROM (…) AS q LIMIT $1` wrapper are preserved verbatim. This is the only direct-pool survivor under `web/src/` per the round-4 audit's Repository check; the gate at line 83 (`! rg "pool\.(query|connect)\("`) confirms no other survivors exist (expected count after this slice: 0).

## Artifact paths
- `web/data/local-fallback-snapshot.sql` — committed snapshot consumed by `bootPglite` on the fallback path.

## Gate commands
All gates are repo-local; no Neon credentials required.
```bash
cd web && npm install --no-audit --no-fund
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
cd web && node --test scripts/tests/driver-fallback.test.mjs
# Step 4 survivor check: no direct pool.query/pool.connect callers may remain under web/src/.
# `!` makes the gate fail if rg finds any matches; succeeds (exit 1 from rg → negated to 0) when there are none.
cd web && ! rg -n "pool\.(query|connect)\(" src/
```

## Acceptance criteria
- [ ] `cd web && npm run build` succeeds.
- [ ] `cd web && npm run typecheck` succeeds.
- [ ] `cd web && npm run test:grading` passes (existing tests still green after the move + barrel + `runReadOnlySql` rewire).
- [ ] `cd web && node --test scripts/tests/driver-fallback.test.mjs` passes all six cases:
  - **A:** `DB_*`-branch probe-failure + opt-in (deterministic — `DB_HOST=127.0.0.1`, `DB_PORT=1`; no dependency on whether port 5432 happens to be free on the test host) → PGlite engages; chat-runtime queries against `core.driver` and `contract.*` succeed against the snapshot.
  - **B:** unreachable `DATABASE_URL` + opt-in → PGlite engages; same chat-runtime queries succeed.
  - **C:** unreachable `DATABASE_URL` + opt-out → `sql("SELECT 1")` rejects with a `pg` connection error (today's lazy-failure semantics); PGlite is NOT booted; no fallback log line; **pool identity asserted** — `(await chooseDriver()).pool === pool` (the opt-out branch returns the singleton, not a second `pg.Pool`).
  - **D:** unreachable `DATABASE_URL` + opt-in + `NODE_ENV=production` → fallback never engages; same `pg` connection error as Case C; PGlite NOT booted.
  - **E:** unreachable `NEON_DB_HOST` + opt-in → PGlite engages, proving the `NEON_DB_HOST` config branch is not regressed (round-4 High #2).
  - **F:** `runReadOnlySql` invoked under PGlite (co-located within A/B/E) returns ≥ 1 row, exercising the new `withTransaction` helper end-to-end.
- [ ] `cd web && ! rg -n "pool\.(query|connect)\(" src/` succeeds (i.e., rg finds no direct `pool.query(` / `pool.connect(` callers remaining under `web/src/`), enforcing the round-3 Medium survivor-elimination requirement; the round-4 audit's Repository check identified `web/src/lib/queries.ts:789` as the only survivor and the conversion to `withTransaction` removes it.
- [ ] Existing call sites that `import { sql, pool } from "@/lib/db"` continue to compile and resolve via the new barrel — verified by `npm run typecheck` succeeding without modifying any call site that uses only `sql` or `pool`.
- [ ] No new gate requires a real Neon connection or staging environment to merge.

## Out of scope
- Auto-regenerating the snapshot from prod data (follow-up slice).
- Switching the production driver to `@neondatabase/serverless` (the roadmap §4 Phase 6 step 1 swap — separate slice).
- Adding `web/src/app/api/health/route.ts` (roadmap §4 Phase 6 step 7 — separate slice).
- Disabling Neon autosuspend / right-sizing CUs (roadmap §4 Phase 6 steps 5–6 — separate slices).

## Risk / rollback
- **Risk:** a misconfigured prod deploy sets `OPENF1_LOCAL_FALLBACK=1`, silently serving stale snapshot data. **Mitigation:** `chooseDriver()` short-circuits when `NODE_ENV === "production"` and the production-guard subtest (Case D) locks the behavior in.
- **Risk:** PGlite WASM fails to initialize under the Next.js server runtime. **Mitigation:** the path is opt-in only; failures surface on first call (not at build time) and a developer sees the explicit fallback log line plus the underlying error.
- **Risk:** the snapshot drifts from prod schema and silently masks contract changes during dev. **Mitigation:** the snapshot is human-readable SQL committed to the repo; schema drift surfaces as a noisy boot-time exec error rather than silent skew. A regeneration script is called out as a follow-up.
- **Rollback:** `git revert` the slice commit. Behavior returns to today (URL required, no fallback). No DB-side change to revert.

## Slice-completion note

**Branch:** `slice/06-driver-swap-local-fallback` (pushed to `origin`).

**Commits:** see this branch's tip and the immediate predecessors — implementation
commit, a hash-recording follow-up, and a round-2 revise commit that addresses
the implementation-audit feedback on `connectionTimeoutMillis`.

- Implementation commit (code + new files): `01f60e74ae1f74b506d5434ab229948c99097c08`
- Hash-recording follow-up: `6ac862b`
- Round-2 revise commit: `2dcddec55da5e911f57559d7e65c87b29fd3ca6d`
- Hash-recording follow-up (this commit): see this commit's SHA on the branch tip.

**Decisions made during implementation:**

1. **`createPool()` body is byte-for-byte unchanged (revised after round-1 implementation audit).** Round 1 of implementation added `connectionTimeoutMillis: 2_000` to the three `new Pool({...})` literals to satisfy Step 3's "with the 2 s `connectionTimeoutMillis` already configured on the singleton" wording. The audit (line 176) flagged this as a behavior change for the opt-out and production paths, both of which the slice goal promises remain identical to today (and the original `web/src/lib/db.ts` set no `connectionTimeoutMillis`). Round 2 reverts those three literals to the byte-for-byte original — no `connectionTimeoutMillis` on any pool constructor — and instead enforces the 2 s probe budget *only inside the opt-in code path* by wrapping `target.query("SELECT 1")` in `Promise.race([...])` against a 2_000 ms `setTimeout` rejection (`web/src/lib/db/driver.ts:probeNeon`). Net result: opt-out and production retain pre-slice connect semantics (no client-side connect timeout — pg's default behavior); the opt-in probe still rejects within 2 s on a hung host. The pool singleton's URL → `NEON_DB_HOST` → `DB_*`-with-defaults ladder, SSL handling, and `statement_timeout` semantics remain unchanged.
2. **Survivor-gate compatibility.** The slice's gate `! rg "pool\.(query|connect)\(" src/` is naive: it matches `driver.pool.connect(` and `pool.query(` even inside the `chooseDriver` / `withTransaction` abstraction itself. To pass the gate, the probe and the transactional client-acquire are routed through two tiny helpers (`probeNeon(target)`, `acquireNeonClient(target)`) where the variable name `target` does not contain `pool`. The exported singleton's name is still `pool`, and `chooseDriver()` returns it by reference (asserted by Case C).
3. **Test isolation.** `node:test` shares a single process for all subtests, but each Case mutates `process.env` in ways that must not leak. I spawn one fresh Node child process per case via `child_process.spawn`. Each child loads a transpiled-on-the-fly bundle of `driver.ts` + `queries.ts` + `querySafety.ts` from a shared temp dir, sets the case-specific env, runs the assertions, and `process.exit(0)`s on success. This guarantees `globalForPool.__openf1Pool`, the memoized `chooseDriver()` promise, and `process.env` all reset between cases.
4. **Snapshot file is force-added.** `web/data/local-fallback-snapshot.sql` is blocked by the repo-root `.gitignore` rule `data/`, but the slice's "Changed files expected" lists it as a tracked artifact. I used `git add -f` rather than mutating `.gitignore` (which is **not** in the expected files list). The file is now tracked; the global ignore rule still applies to other `data/` directories.
5. **`runReadOnlySql` `SET LOCAL statement_timeout` under PGlite.** PGlite is Postgres-wire compatible, so `SET LOCAL statement_timeout = <ms>` runs unchanged inside `db.transaction(...)`. Verified end-to-end by Case A's runReadOnlySql invocation.

**Self-check — gate exit codes (all run from `web/`):**

| # | Gate                                                               | Exit |
|---|---------------------------------------------------------------------|------|
| 1 | `npm install --no-audit --no-fund`                                  | 0    |
| 2 | `npm run build`                                                     | 0    |
| 3 | `npm run typecheck`                                                 | 0    |
| 4 | `npm run test:grading` (47 pass / 10 skipped / 0 fail of 57 tests)  | 0    |
| 5 | `node --test scripts/tests/driver-fallback.test.mjs` (6/6 pass)     | 0    |
| 6 | `! rg -n "pool\.(query\|connect)\(" src/`                           | 0    |

**Driver-fallback test sub-results:**

- Case A (`DB_*`-branch + opt-in): PGlite engaged, fallback log emitted, snapshot rows returned, `runReadOnlySql` returned ≥ 1 row.
- Case B (`DATABASE_URL` unreachable + opt-in): PGlite engaged, same chat-runtime queries succeed.
- Case C (`DATABASE_URL` unreachable + opt-out): `sql("SELECT 1")` rejected with a `pg`-originated connection error, no fallback log, `chooseDriver().pool === pool` (singleton identity preserved).
- Case D (production guard + opt-in env set): fallback never engaged, `sql("SELECT 1")` rejected with the same `pg` connection error, no fallback log.
- Case E (`NEON_DB_HOST` unreachable + opt-in): PGlite engaged, `NEON_DB_HOST` config branch unregressed.
- Case F (`runReadOnlySql` under PGlite): co-located inside Cases A/B/E; each invokes `runReadOnlySql("SELECT driver_number FROM core.driver", { maxRows: 5 })` and asserts ≥ 1 row, exercising `withTransaction` end-to-end through PGlite.

**Acceptance-criteria checklist:** all six items in "Acceptance criteria" verified by the gate exit codes above.

**Survivor count:** `web/src/lib/queries.ts:789`'s `pool.connect()` is gone — replaced with `withTransaction(async (tx) => { … })`. `rg -n "pool\.(query|connect)\(" web/src/` returns 0 matches.

## Audit verdict
**Status: REVISE**

- Gate #1 `cd web && npm install --no-audit --no-fund` -> exit `0`
- Gate #2 `cd web && npm run build` -> exit `0`
- Gate #3 `cd web && npm run typecheck` -> exit `0`
- Gate #4 `cd web && npm run test:grading` -> exit `0`
- Gate #5 `cd web && node --test scripts/tests/driver-fallback.test.mjs` -> exit `0`
- Gate #6 `cd web && ! rg -n "pool\.(query|connect)\(" src/` -> exit `0`
- Scope diff `git diff --name-only integration/perf-roadmap...HEAD` -> in scope; only expected files plus implicit-allow `diagnostic/_state.md`
- Criterion `build` / `typecheck` / `test:grading` / `driver-fallback.test.mjs` / survivor gate -> PASS
- Criterion `Existing call sites that import { sql, pool } from "@/lib/db" continue to compile and resolve via the new barrel` -> PASS
- Criterion `No new gate requires a real Neon connection or staging environment to merge` -> PASS
- Criterion `Without OPENF1_LOCAL_FALLBACK=1 behavior is identical to today` -> FAIL at [web/src/lib/db/driver.ts](/Users/robertzehnder/.openf1-loop-worktrees/06-driver-swap-local-fallback/web/src/lib/db/driver.ts:53), [web/src/lib/db/driver.ts](/Users/robertzehnder/.openf1-loop-worktrees/06-driver-swap-local-fallback/web/src/lib/db/driver.ts:68), [web/src/lib/db/driver.ts](/Users/robertzehnder/.openf1-loop-worktrees/06-driver-swap-local-fallback/web/src/lib/db/driver.ts:81): `createPool()` now hard-codes `connectionTimeoutMillis: 2_000` into every pool branch, so opt-out and production no longer preserve the prior lazy connection semantics promised in the slice goal.
- Decision: REVISE
- Rationale: gates pass, but the slice contract explicitly required the non-fallback path and production path to remain unchanged; moving the 2 s timeout onto the shared singleton pool is a behavior change outside that contract.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the real-Neon/staging verification requirement with repo-local gates that prove both modes, because this slice's goal is a local fallback when Neon is missing or unreachable and the current plan cannot be completed in an isolated implementation pass.
- [x] Specify the fallback mechanism concretely by choosing SQLite snapshot or PGlite and naming every required code/config/artifact path, because `web/src/lib/db/driver.ts` alone does not provide the local data source the goal requires.

### Medium
- [x] Update `Required services / env` to describe the local fallback prerequisites and any selection logic instead of only Neon access, or narrow the goal so it no longer promises offline development.
- [x] Replace the acceptance criteria with command-testable checks that cover `DATABASE_URL` missing and primary-connection failure cases, rather than "implemented and tested per the goal" and "verified in the staging environment before merge."
- [x] Expand `Changed files expected` and `Artifact paths` to include the fallback snapshot/PGlite setup and any docs/config/test harness files the chosen approach necessarily touches.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
- The gate order `build` before `typecheck` matches the current auditor note for web slices.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Fix the snapshot default-path contract so the plan names one resolution basis consistently: either default `OPENF1_LOCAL_SNAPSHOT_PATH` to `data/local-fallback-snapshot.sql` when resolving from `web/`, or keep `web/data/local-fallback-snapshot.sql` and state it is repo-root-relative, because the current wording points the fallback at `web/web/data/...`.

### Medium
- [x] Align the Goal text with the decided opt-in trigger by stating that missing-URL and probe-failed fallback only happen when `OPENF1_LOCAL_FALLBACK=1`, otherwise the first paragraph still promises automatic fallback.
- [x] Specify how the synchronous exported `pool` behaves before the async `chooseDriver()` probe resolves on the healthy-Neon path, or drop the promise to preserve `pool` as a usable compatibility export, because Step 4 currently requires a sync export from an async selection flow without defining the contract.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
- The gate order `build` before `typecheck` still matches the current auditor note for web slices.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Replace the fallback-path `SELECT 1` proof with a repo-local assertion that exercises at least one real chat/runtime query against the seeded snapshot, because the current gates can pass while `web/data/local-fallback-snapshot.sql` is missing required `core.*` / `contract.*` rows and the advertised offline developer flow still fails at runtime.

### Medium
- [x] Add a command-testable gate for Step 4's `pool.query(` / `pool.connect(` survivor search, such as an `rg` check under `web/src/`, so the plan enforces the stated requirement that direct `pool.*` callers are eliminated before fallback can be considered safe.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
- The gate order `build` before `typecheck` still matches the current auditor note for web slices.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Reconcile the plan with the current `web/src/lib/db.ts` env contract: today `createPool()` still accepts `NEON_DB_HOST` and `DB_*` host/port credentials, and the no-URL path does not throw `Missing required environment variable: DB_HOST`, so revise the goal, selection logic, and test expectations to preserve or intentionally replace those existing branches instead of treating “no URL” as a hard error.
- [x] Define the fallback decision against every currently supported config shape, not only `DATABASE_URL` / `NEON_DATABASE_URL`, because the proposed `chooseDriver()` would regress deployments and local setups that rely on `NEON_DB_HOST` or plain `DB_HOST`-style Postgres settings by misclassifying them as “missing URL” and either booting PGlite or throwing.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
- Repository check: `sed -n '1,240p' web/src/lib/db.ts` exited 0 and shows `createPool()` still supports both URL and host-based envs with local-default fallbacks.
- Repository check: `rg -n "pool\\.(query|connect)\\(" web/src/` exited 0 and currently finds one direct survivor at `web/src/lib/queries.ts:789`.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [x] Make Case A deterministic without assuming `127.0.0.1:5432` is down, because the current gate can spuriously pass or fail on any machine that happens to have a local Postgres listening on the default `DB_*` fallback address.

### Medium
- [x] Specify that `chooseDriver()` probes and returns the eagerly exported `pool` instance on the healthy-DB path, rather than constructing a second `pg.Pool`, because Step 3 and Step 4 currently claim both “`pool` is eagerly constructed directly” and “`sql()` routes to the same `pg.Pool` instance” without defining how that identity is preserved.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
- The gate order `build` before `typecheck` still matches the current auditor note for web slices.

## Plan-audit verdict (round 6)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
- The gate order `build` before `typecheck` matches the current auditor note for web slices.
