---
slice_id: 12-env-assertions
phase: 12
status: pending_plan_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-05-01
---

## Goal
Complete Phase 12 item 2 ("prod must use Neon URL; local must use Docker") and item 3 (`.env.example` documentation) of the database-env hardening work in `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 12. The Neon pooler-URL production assertion already exists in `web/src/lib/db.ts` (`assertPooledDatabaseUrl`); this slice extends that file with a parallel local-Docker assertion and rounds out `.env.example` so the Phase 12 contract is fully documented.

Concretely:
1. Add `assertLocalDockerDb(env)` to `web/src/lib/db.ts` that, when `NODE_ENV !== "production"` AND no `NEON_*` URL/host is set (i.e. the local-Docker `DB_*` branch will be taken in `createPool()`), asserts `DB_HOST` resolves to a local/Docker-internal target (`127.0.0.1`, `localhost`, `::1`, `db`, `postgres`). Throw with a clear message naming the offending host and the allowed set.
2. Wire that assertion into the same module-load site that currently invokes `assertPooledDatabaseUrl(process.env)` (`web/src/lib/db.ts:131`) so it runs once at startup before `createPool()`.
3. Document the full set of database-env vars in root `.env.example`: keep existing `DB_*` defaults; uncomment-style placeholder lines for `NEON_DATABASE_URL` (pooled — Phase 6 contract) and `NEON_DATABASE_URL_REPLICA` (Phase 12 read-replica contract); brief 1-line comment per group naming the precedence (NEON_* wins over `DATABASE_URL` / `DB_*`).
4. Add focused unit tests in a NEW file `web/scripts/tests/local-docker-db-assertion.test.mjs` mirroring the transpile-stub pattern of `web/scripts/tests/pooled-url-assertion.test.mjs`. Cover: throws on remote host (e.g. `db.example.com`) when local branch active; passes for each allowed host; no-ops when `NODE_ENV=production`; no-ops when any `NEON_*` URL/host is set (Neon branch will be chosen, not Docker branch).

Out of scope for this slice: read-replica pool plumbing (Phase 12 item 1), migration-runner adoption (Phase 12 item 4), and any LLM/`OPENF1_*` env assertions — those are not part of Phase 12's scope per the roadmap and are not gated here.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 12 (items 2 and 3)
- `web/src/lib/db.ts` — current env-config branches (`NEON_DATABASE_URL`, `DATABASE_URL`, `NEON_DB_HOST`, `DB_*`) and the existing `assertPooledDatabaseUrl` module-load call
- `web/scripts/tests/pooled-url-assertion.test.mjs` — transpile-stub pattern to mirror
- Root `.env.example`

## Prior context
- `diagnostic/_state.md`
- `web/src/lib/db.ts`
- `web/scripts/tests/pooled-url-assertion.test.mjs`
- `.env.example`

## Required services / env
None — all deliverables and gates are repo-local. Tests use the same in-process `typescript` transpile + `pg` stub pattern as the existing pooled-URL test, so no real Postgres connection is required. No staging deployment, no platform credentials, no external services.

## Steps
1. Implement `assertLocalDockerDb(env: NodeJS.ProcessEnv): void` in `web/src/lib/db.ts`:
   - Early-return if `env.NODE_ENV === "production"` (production is governed by `assertPooledDatabaseUrl`).
   - Early-return if any of `env.NEON_DATABASE_URL`, `env.DATABASE_URL`, or `env.NEON_DB_HOST` is non-empty (those branches drive `createPool()`, not the Docker `DB_*` branch).
   - Otherwise, read `env.DB_HOST` (default `"127.0.0.1"`, matching `createPool()` line 119). If trimmed value is not in the allowed set `{"127.0.0.1", "localhost", "::1", "db", "postgres"}`, throw an `Error` whose message names the offending host and lists the allowed set.
2. Add a second module-load invocation directly after the existing `assertPooledDatabaseUrl(process.env)` line: `assertLocalDockerDb(process.env);`. Export `assertLocalDockerDb` for testability, mirroring `assertPooledDatabaseUrl`.
3. Add `web/scripts/tests/local-docker-db-assertion.test.mjs`. Reuse the transpile + `pg.stub.mjs` pattern from `pooled-url-assertion.test.mjs` verbatim (same `loadAssertPooledDatabaseUrl`-style helper renamed appropriately, same env-clearing prologue so the module-load calls are no-ops). Required cases:
   - throws when `DB_HOST="db.example.com"` and no `NEON_*`/`DATABASE_URL` is set (local-Docker branch active, remote host).
   - does not throw for each of `127.0.0.1`, `localhost`, `::1`, `db`, `postgres`.
   - does not throw when `NODE_ENV="production"` regardless of `DB_HOST`.
   - does not throw when `NEON_DATABASE_URL` is set even if `DB_HOST` would otherwise be invalid (Neon branch wins; assertion early-returns).
   - does not throw when `DB_HOST` is unset (defaults to `127.0.0.1`).
4. Update root `.env.example`:
   - Replace the existing one-line NEON comment block with explicit, line-per-var commented placeholders for `NEON_DATABASE_URL` and add a new `NEON_DATABASE_URL_REPLICA` placeholder (commented, since Phase 12 item 1 / read-replica plumbing is a later slice).
   - Keep the local `DB_HOST=127.0.0.1` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` block; add a one-line header comment "Local Docker Postgres (used when no NEON_* var is set)".
   - Leave `OPENF1_*` ingestion lines untouched.
5. Run gate commands locally; they must all pass before flipping status to `awaiting_audit`.

## Changed files expected
- `web/src/lib/db.ts` — adds and invokes `assertLocalDockerDb`; exports it.
- `web/scripts/tests/local-docker-db-assertion.test.mjs` — NEW test file.
- `.env.example` — documents `NEON_DATABASE_URL`, `NEON_DATABASE_URL_REPLICA`, and the local-Docker block.

(Note: the previously-listed `web/src/lib/env.ts` and `web/src/app/layout.tsx` are removed from scope — they don't exist / aren't where env assertions live, and the Phase 12 contract is satisfied by extending `db.ts`.)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && node --test scripts/tests/pooled-url-assertion.test.mjs
cd web && node --test scripts/tests/local-docker-db-assertion.test.mjs
bash scripts/loop/test_grading_gate.sh
```

The two `node --test …` lines are the slice-local proofs that (a) the existing pooler assertion still works after the new module-load call is wired in (regression guard) and (b) the new local-Docker assertion behaves per spec. `test_grading_gate.sh` is the required baseline-aware grading gate per the auditor lesson logged in `_state.md` (slice 08-synthesis-payload-cutover).

## Acceptance criteria
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` exit 0 on the slice branch.
- [ ] `cd web && node --test scripts/tests/local-docker-db-assertion.test.mjs` exits 0 with all five named cases passing.
- [ ] `cd web && node --test scripts/tests/pooled-url-assertion.test.mjs` exits 0 (regression guard — adding the second module-load assertion must not break the existing pooler tests).
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (no new failures vs. `scripts/loop/state/test_grading_baseline.txt`).
- [ ] `git diff --stat main...HEAD` lists exactly the three files in `## Changed files expected` (no unexpected modifications).
- [ ] `web/src/lib/db.ts` exports `assertLocalDockerDb` and invokes it at module load directly after `assertPooledDatabaseUrl(process.env)`.
- [ ] `.env.example` contains commented placeholder lines for `NEON_DATABASE_URL` and `NEON_DATABASE_URL_REPLICA`, and a header comment on the local-Docker block.

## Out of scope
- Read-replica pool wiring (`pool.read` / `pool.write`) — Phase 12 item 1, separate slice.
- Migration runner adoption (sqitch/Atlas/Python) — Phase 12 item 4, separate slice.
- LLM key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and `OPENF1_*` startup assertions — not part of Phase 12 per the roadmap.
- Any change to `web/src/app/layout.tsx` or creation of `web/src/lib/env.ts` (was in the prior plan; removed as off-target).

## Risk / rollback
The new assertion only runs when the local-Docker branch is active (no `NEON_*` URL/host, `NODE_ENV !== "production"`); production is unaffected. Worst case during local dev: a contributor with `DB_HOST` pointed at a remote host gets a clear startup error naming the offending host and the allowed set — they can either add `NEON_DATABASE_URL` (preferred for non-local Postgres) or correct `DB_HOST`.

Rollback procedure (repo-local — no infra rollback needed since nothing deploys from this slice):
1. Revert the merge commit on `main` (`git revert -m 1 <merge-sha>`).
2. Re-run `cd web && npm run build` and the two `node --test` files to confirm clean state.

No production state, schema, or external service is touched, so the rollback is a single git revert.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Align the goal, steps, changed-file scope, and acceptance criteria with Phase 12's approved env-hardening scope: cover the existing Neon/local database-env behavior (`NEON_DATABASE_URL` and local Docker expectations), not only `DATABASE_URL`/LLM keys/`OPENF1_*`.
- [x] Replace the staging/deployment-only step and acceptance criterion with repo-local, auditable deliverables, or specify the exact non-prod environment, required credentials, operator, and success command/output so the implementer is not blocked on unspecified deployment access.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the required baseline-aware grading gate.
- [x] Fix `Changed files expected` to match the modules this plan actually has to touch: `web/src/lib/env.ts` does not exist here, while the current database-env assertions live in `web/src/lib/db.ts`; include any required docs file such as `.env.example` if the slice keeps the Phase 12 env-documentation work in scope.
- [x] Make the acceptance criteria testable from declared artifacts and gate commands; `Implementation works in staging` and `Rollback plan documented in slice-completion note` are not verifiable by the listed gates.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T20:49:40Z`).
