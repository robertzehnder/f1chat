---
slice_id: 06-driver-swap-local-fallback
phase: 6
status: pending_plan_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28T16:08:22Z
---

## Goal
When the developer opts in via `OPENF1_LOCAL_FALLBACK=1` **and** either `DATABASE_URL` / `NEON_DATABASE_URL` is missing **or** a startup probe against the configured Neon pool fails, fall back to an in-process **PGlite** (`@electric-sql/pglite`) database seeded from a committed snapshot so dev can run without Neon connectivity. The fallback never engages automatically: without `OPENF1_LOCAL_FALLBACK=1` behavior is identical to today (missing URL throws, unreachable URL surfaces the probe error). Production is unchanged: when `NODE_ENV === "production"` the fallback is refused regardless of any other env, and a missing URL is still a hard error.

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
- **Verification surface:** all gates are repo-local. No staging / real-Neon connection is required to merge this slice — the audit's High #1 is addressed by exercising both the URL-missing path and the URL-unreachable path against an unroutable host (`127.0.0.1:1`) so the probe fails deterministically without external services.

## Required services / env
- **Production (unchanged):** `NEON_DATABASE_URL` (or `DATABASE_URL`) pointing at the Neon pooler. SSL/timeout behavior in `web/src/lib/db.ts` is preserved verbatim by the move.
- **Local fallback prerequisites:**
  - `OPENF1_LOCAL_FALLBACK=1` — opt-in switch. Without it, behavior is identical to today.
  - `OPENF1_LOCAL_SNAPSHOT_PATH` — optional; defaults to `data/local-fallback-snapshot.sql` resolved against the `web/` cwd (i.e., the on-disk path is `web/data/local-fallback-snapshot.sql`). Absolute paths in the env var are honored as-is. The plan, the test file, and `bootPglite()` all use this same `web/`-relative basis — no other resolution rule.
  - `@electric-sql/pglite` added to `web/package.json` dependencies.
  - The snapshot SQL file checked into the repo.
- **Selection logic** (implemented in a single `chooseDriver()` function and asserted by the new test file):
  1. `NODE_ENV === "production"` → require a URL; throw on missing; never use PGlite even if `OPENF1_LOCAL_FALLBACK=1`.
  2. Else if no URL set **and** `OPENF1_LOCAL_FALLBACK=1` → boot PGlite from the snapshot.
  3. Else if a URL is set → run a startup probe (`SELECT 1`, `connectionTimeoutMillis: 2000`). On success, use the existing `pg.Pool`. On failure, if `OPENF1_LOCAL_FALLBACK=1` → fall back to PGlite; otherwise re-throw the probe error so the dev surface remains identical to today.
  4. Else (no URL, no opt-in) → throw the existing "Missing required environment variable" error.

## Steps
1. Move `web/src/lib/db.ts` → `web/src/lib/db/driver.ts` with `git mv` (no content change in this commit-step). Add a barrel `web/src/lib/db/index.ts` that re-exports `pool` and `sql` so every existing import (`from "@/lib/db"` or relative `"./db"`) keeps resolving.
2. Add `@electric-sql/pglite` to `web/package.json` dependencies and run `npm install --no-audit --no-fund` from `web/` to refresh `package-lock.json`.
3. In `driver.ts`, factor the existing pool construction into a private `tryNeonPool()` (current logic, untouched semantics) and add:
   - `bootPglite(snapshotPath: string): Promise<PGlite>` — instantiates `new PGlite()`, runs the snapshot SQL via `db.exec(...)`, returns the instance.
   - `chooseDriver(): Promise<{ kind: "neon"; pool: Pool } | { kind: "pglite"; db: PGlite }>` — implements the selection logic above; logs `[db] using local PGlite fallback (reason=<missing-url|probe-failed>)` once on the fallback path so a developer can see why.
4. Wire the exports. `sql<T>(text, values)` is the async-aware shim: it awaits a memoized `chooseDriver()` (resolved exactly once per process) and dispatches to either the `pg.Pool` or the PGlite instance, normalizing both `{ rows }` shapes to `T[]`. The `pool` export keeps today's contract — synchronous, eagerly constructed at module load whenever a URL is present, identical to the current `web/src/lib/db.ts` behavior — and exported from the barrel as `Pool | undefined`. The async `chooseDriver()` probe does NOT gate `pool`'s construction; it only governs which driver `sql()` dispatches to. Concretely: under healthy-Neon (URL set, probe passes), `pool` is the same `pg.Pool` instance both at import time and after the probe resolves, and `sql()` routes to it. Under fallback (probe fails, opt-in), `pool` is still the (now-unhealthy) `pg.Pool` and direct callers of `pool.*` will fail loudly against a dead Neon — which is why this step also requires: search `web/src/` for `pool.query(` / `pool.connect(` and convert any survivors to `sql(...)` in this slice. Under URL-missing, `pool` is `undefined` (matches today's pre-throw state). The barrel re-exports `pool` and `sql`; no behavioral surprise for healthy-Neon callers.
5. Add `web/data/local-fallback-snapshot.sql` containing the minimum schema + seed needed for the chat runtime to answer something offline:
   - `CREATE SCHEMA` for `raw`, `core`, `contract` (mirrors prod).
   - One driver row, one session row, lookup tables (`compound_alias_lookup`, `metric_registry`, `valid_lap_policy`, `replay_contract_registry`).
   - One row in each summary contract the resolver and grading tests touch.
   - The file is human-readable SQL so a follow-up slice can regenerate it from `pg_dump`.
6. Add `web/scripts/tests/driver-fallback.test.mjs` (`node --test`) with subtests, each in its own worker (`node:test` `t.test` + `import()` against a unique cache-busting query string, or one subtest per file invocation) so the module-level driver singleton resets. Cases A and B do NOT use `SELECT 1` — they exercise real chat-runtime queries against the seeded `core.*` / `contract.*` rows so the test fails if the snapshot is missing schemas/rows the resolver actually relies on (the audit's round-3 High):
   - **Case A — URL missing, opt-in:** `DATABASE_URL=""`, `NEON_DATABASE_URL=""`, `OPENF1_LOCAL_FALLBACK=1`, `NODE_ENV=test`. Import `sql` and run two representative chat-runtime queries: (1) `SELECT driver_number, full_name FROM core.driver` — assert ≥ 1 row matching the seeded driver; (2) `SELECT * FROM contract.replay_contract_registry` — assert ≥ 1 row, and assert at least one of the seeded summary contracts the resolver/grading suites touch (e.g., `contract.pit_cycle_summary`, `contract.lap_phase_summary`) returns a row when queried directly. The intent: prove the snapshot supplies the offline data path the developer flow advertises, not just connectivity.
   - **Case B — URL unreachable, opt-in:** `DATABASE_URL="postgres://invalid:invalid@127.0.0.1:1/none"`, `OPENF1_LOCAL_FALLBACK=1`, `NODE_ENV=test`. Assert the probe fails, the fallback log line is emitted, and the same chat-runtime queries from Case A succeed against the snapshot.
   - **Case C — URL missing, opt-out:** `DATABASE_URL=""`, `NEON_DATABASE_URL=""`, `OPENF1_LOCAL_FALLBACK` unset, `NODE_ENV=test`. Importing `sql` and calling it must throw `Missing required environment variable: DB_HOST` (the same error today's code path raises).
   - **Case D — production guard:** `DATABASE_URL=""`, `NEON_DATABASE_URL=""`, `OPENF1_LOCAL_FALLBACK=1`, `NODE_ENV=production`. Must throw the missing-URL error; the fallback must never engage.
7. Add `web/docs/local-fallback.md` (~30 lines): when to set `OPENF1_LOCAL_FALLBACK=1`, where the snapshot lives, the production guard, and the command to run the test file standalone.

## Changed files expected
- `web/src/lib/db.ts` → moved to `web/src/lib/db/driver.ts` (and extended with selection logic + PGlite boot)
- `web/src/lib/db/index.ts` (new barrel; re-exports `sql`, `pool`)
- `web/package.json` (adds `@electric-sql/pglite`)
- `web/package-lock.json` (regenerated by `npm install`)
- `web/data/local-fallback-snapshot.sql` (new)
- `web/scripts/tests/driver-fallback.test.mjs` (new)
- `web/docs/local-fallback.md` (new)
- Any `web/src/**` file currently calling `pool.query(...)` / `pool.connect(...)` directly is converted to `sql(...)` (expected: 0–2 sites; if the count exceeds 5, stop and re-plan).

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
- [ ] `cd web && npm run test:grading` passes (existing tests still green after the move + barrel).
- [ ] `cd web && node --test scripts/tests/driver-fallback.test.mjs` passes all four cases (A: missing URL + opt-in → PGlite; B: unreachable URL + opt-in → PGlite; C: missing URL, opt-out → throws today's missing-env error; D: `NODE_ENV=production` ignores `OPENF1_LOCAL_FALLBACK` and throws). Cases A and B specifically assert real chat-runtime queries against `core.driver` and a seeded `contract.*` summary return ≥ 1 row, proving the snapshot exposes the offline data path — not just `SELECT 1` connectivity.
- [ ] `cd web && ! rg -n "pool\.(query|connect)\(" src/` succeeds (i.e., rg finds no direct `pool.query(` / `pool.connect(` callers remaining under `web/src/`), enforcing Step 4's survivor-elimination requirement before fallback can be considered safe.
- [ ] Existing call sites that `import { sql, pool } from "@/lib/db"` continue to compile and resolve via the new barrel — verified by `npm run typecheck` succeeding without modifying any call site that uses only `sql`.
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
(filled by Claude)

## Audit verdict
(filled by Codex)

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
