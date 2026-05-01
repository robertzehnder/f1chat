---
slice_id: 12-env-assertions
phase: 12
status: pending_plan_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-05-01T23:45:00Z
---

## Goal
Complete Phase 12 item 2 ("prod must use Neon URL; local must use Docker") and item 3 (`.env.example` documentation) of the database-env hardening work in `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 12. The Neon pooler-URL production assertion already exists in `web/src/lib/db.ts` (`assertPooledDatabaseUrl`); this slice extends that file with a parallel local-Docker assertion and rounds out `.env.example` so the Phase 12 contract is fully documented.

Concretely:
1. Add `assertLocalDockerDb(env)` to `web/src/lib/db.ts` that, when `NODE_ENV !== "production"` AND none of `NEON_DATABASE_URL`, `DATABASE_URL`, or `NEON_DB_HOST` is set (presence is judged after `?.trim()`, matching `firstUrl(...).trim()` for the URL pair and `NEON_DB_HOST?.trim()` at `web/src/lib/db.ts:101` so whitespace-only values do not bypass the assertion — the local-Docker `DB_*` branch will be taken in `createPool()` — every other branch is bypassed by one of those three), asserts `DB_HOST` resolves to a local/Docker-internal target (`127.0.0.1`, `localhost`, `::1`, `db`, `postgres`). Throw with a clear message naming the offending host and the allowed set.
2. Wire that assertion into the same module-load site that currently invokes `assertPooledDatabaseUrl(process.env)` (`web/src/lib/db.ts:131`) so it runs once at startup before `createPool()`.
3. Document the full set of database-env vars actually consumed by `web/src/lib/db.ts` in root `.env.example`: keep existing `DB_*` defaults; add commented placeholder lines for `NEON_DATABASE_URL` (Phase 6 pooled URL), `NEON_DATABASE_URL_REPLICA` (Phase 12 read-replica contract — item 1, later slice), `DATABASE_URL` (generic fallback URL — still consumed via `firstUrl("NEON_DATABASE_URL", "DATABASE_URL")`), the per-component Neon override block `NEON_DB_HOST` / `NEON_DB_PORT` / `NEON_DB_NAME` / `NEON_DB_USER` / `NEON_DB_PASSWORD` (still consumed by the `NEON_DB_HOST` branch in `createPool()`), and the SSL-toggle pair `DB_SSL` / `NEON_SSL` (consumed by `sslForHost()` at `web/src/lib/db.ts:71-74` — `"true"`/`"false"` override the default `neon.tech`-host heuristic). One-line comment per branch naming precedence (`NEON_DATABASE_URL` > `DATABASE_URL` > `NEON_DB_*` > local `DB_*`).
4. Add focused unit tests in a NEW file `web/scripts/tests/local-docker-db-assertion.test.mjs` mirroring the transpile-stub pattern of `web/scripts/tests/pooled-url-assertion.test.mjs`. Cover: throws on remote host (e.g. `db.example.com`) when local branch active; passes for each allowed host; no-ops when `NODE_ENV=production`; no-ops when **each** of `NEON_DATABASE_URL`, `DATABASE_URL`, or `NEON_DB_HOST` is set (each one drives a non-`DB_*` branch in `createPool()` per `web/src/lib/db.ts:83-128`, so the assertion must early-return for every one — not only the `NEON_DATABASE_URL` case).

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
   - Early-return if any of `env.NEON_DATABASE_URL?.trim()`, `env.DATABASE_URL?.trim()`, or `env.NEON_DB_HOST?.trim()` is non-empty (those branches drive `createPool()` after the same `?.trim()` filter — `firstUrl(...).trim()` at `web/src/lib/db.ts:19` for the URL pair and `NEON_DB_HOST?.trim()` at `web/src/lib/db.ts:101` for the per-component branch — so a whitespace-only value falls through to the Docker `DB_*` branch and the assertion must NOT bypass on it).
   - Otherwise, read `env.DB_HOST` (default `"127.0.0.1"`, matching `createPool()` line 119). If trimmed value is not in the allowed set `{"127.0.0.1", "localhost", "::1", "db", "postgres"}`, throw an `Error` whose message names the offending host and lists the allowed set.
2. Add a second module-load invocation directly after the existing `assertPooledDatabaseUrl(process.env)` line: `assertLocalDockerDb(process.env);`. Export `assertLocalDockerDb` for testability, mirroring `assertPooledDatabaseUrl`.
3. Add `web/scripts/tests/local-docker-db-assertion.test.mjs`. Reuse the transpile + `pg.stub.mjs` pattern from `pooled-url-assertion.test.mjs` verbatim (same `loadAssertPooledDatabaseUrl`-style helper renamed appropriately, same env-clearing prologue so the module-load calls are no-ops). Required cases — covering every non-`DB_*` branch in `web/src/lib/db.ts:83-128` so the assertion provably defers to each Neon branch. Every "throws" case below MUST also assert (via `assert.match` or equivalent) that the thrown `Error.message` contains BOTH (a) the literal offending `DB_HOST` value and (b) every entry in the allowed set `{"127.0.0.1", "localhost", "::1", "db", "postgres"}` — substring/regex matches on the message string, not merely `assert.throws`. This locks Step 1's error contract in tests so a future regression that drops the host name or the allowed list fails the gate:
   - throws when `DB_HOST="db.example.com"` and no `NEON_*`/`DATABASE_URL` is set (local-Docker branch active, remote host); message contains `db.example.com` and all five allowed hosts.
   - does not throw for each of `127.0.0.1`, `localhost`, `::1`, `db`, `postgres`.
   - does not throw when `NODE_ENV="production"` regardless of `DB_HOST`.
   - does not throw when `NEON_DATABASE_URL` is set even if `DB_HOST` would otherwise be invalid (Neon-URL branch wins; assertion early-returns).
   - does not throw when `DATABASE_URL` is set even if `DB_HOST` would otherwise be invalid (generic-URL branch wins via `firstUrl("NEON_DATABASE_URL", "DATABASE_URL")`; assertion early-returns).
   - does not throw when `NEON_DB_HOST` is set even if `DB_HOST` would otherwise be invalid (Neon-host branch wins; assertion early-returns).
   - does not throw when `DB_HOST` is unset (defaults to `127.0.0.1`).
   - throws when `NEON_DATABASE_URL="   "` (whitespace-only) and `DB_HOST="db.example.com"` (whitespace must NOT bypass — `firstUrl()` trims so the local `DB_*` branch is still active in `createPool()`); message contains `db.example.com` and all five allowed hosts.
   - throws when `DATABASE_URL="\t"` (whitespace-only) and `DB_HOST="db.example.com"` (same precedent — `firstUrl(...).trim()` returns falsy, local branch active); message contains `db.example.com` and all five allowed hosts.
   - throws when `NEON_DB_HOST="   "` (whitespace-only) and `DB_HOST="db.example.com"` (same precedent — `NEON_DB_HOST?.trim()` returns falsy, local branch active); message contains `db.example.com` and all five allowed hosts.
4. Update root `.env.example` so every database-env var consumed by `web/src/lib/db.ts` is documented (do NOT drop existing supported branches — the code and tests still depend on them):
   - Add commented, line-per-var placeholders for the URL branches in precedence order: `NEON_DATABASE_URL` (Phase 6 pooled URL — wins first), `NEON_DATABASE_URL_REPLICA` (Phase 12 read-replica contract — item 1, later slice; commented), and `DATABASE_URL` (generic fallback URL — still consumed via `firstUrl("NEON_DATABASE_URL", "DATABASE_URL")`).
   - Add a commented per-component Neon override block: `NEON_DB_HOST`, `NEON_DB_PORT`, `NEON_DB_NAME`, `NEON_DB_USER`, `NEON_DB_PASSWORD` (still consumed by the `NEON_DB_HOST` branch in `createPool()`; preserves the existing `NEON_DB_*` documentation rather than replacing it).
   - Add a commented SSL-toggle block: `DB_SSL` and `NEON_SSL` (consumed by `sslForHost()` — explicit `"true"`/`"false"` overrides the `neon.tech`-host heuristic; both keys read by the same helper, so document both).
   - Keep the local `DB_HOST=127.0.0.1` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` block as the only un-commented block; add a one-line header comment "Local Docker Postgres (used when none of `NEON_DATABASE_URL`, `DATABASE_URL`, or `NEON_DB_HOST` is set)".
   - Each block gets a one-line comment naming precedence: `NEON_DATABASE_URL` > `DATABASE_URL` > `NEON_DB_*` > local `DB_*`. (The SSL-toggle block is orthogonal to that precedence — it modifies whichever branch is selected — and gets its own one-line comment saying so.)
   - Leave `OPENF1_*` ingestion lines untouched.
5. Run gate commands locally; they must all pass before flipping status to `awaiting_audit`.

## Changed files expected
- `web/src/lib/db.ts` — adds and invokes `assertLocalDockerDb`; exports it.
- `web/scripts/tests/local-docker-db-assertion.test.mjs` — NEW test file.
- `.env.example` — documents `NEON_DATABASE_URL`, `NEON_DATABASE_URL_REPLICA`, `DATABASE_URL`, the per-component `NEON_DB_*` override block, the SSL-toggle pair (`DB_SSL`, `NEON_SSL`), and the local-Docker block.
- `diagnostic/slices/12-env-assertions.md` — slice file itself (frontmatter / completion-note / verdict updates as the slice progresses through statuses).

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
- [ ] `cd web && node --test scripts/tests/local-docker-db-assertion.test.mjs` exits 0 with all ten named cases passing (the seven branch-coverage cases plus three whitespace-only cases for `NEON_DATABASE_URL`, `DATABASE_URL`, and `NEON_DB_HOST` that must NOT bypass the assertion). Every "throws" case asserts (via `assert.match` or equivalent string/regex check on `Error.message`) that the message contains BOTH the literal offending `DB_HOST` value (e.g. `db.example.com`) AND every entry in the allowed-host set (`127.0.0.1`, `localhost`, `::1`, `db`, `postgres`); a bare `assert.throws` without message-content checks does not satisfy this criterion.
- [ ] `cd web && node --test scripts/tests/pooled-url-assertion.test.mjs` exits 0 (regression guard — adding the second module-load assertion must not break the existing pooler tests).
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (no new failures vs. `scripts/loop/state/test_grading_baseline.txt`).
- [ ] `git diff --name-only integration/perf-roadmap...HEAD` lists only paths from `## Changed files expected` (no unexpected modifications). Per loop convention, scope is checked against the integration branch using `--name-only`; the slice file itself is in the expected list because frontmatter/status updates land on this branch.
- [ ] `web/src/lib/db.ts` exports `assertLocalDockerDb` and invokes it at module load directly after `assertPooledDatabaseUrl(process.env)`.
- [ ] `.env.example` contains commented placeholder lines for `NEON_DATABASE_URL`, `NEON_DATABASE_URL_REPLICA`, `DATABASE_URL`, the `NEON_DB_HOST` / `NEON_DB_PORT` / `NEON_DB_NAME` / `NEON_DB_USER` / `NEON_DB_PASSWORD` override block, and the SSL-toggle pair (`DB_SSL`, `NEON_SSL`), plus a header comment on the local-Docker block naming precedence (`NEON_DATABASE_URL` > `DATABASE_URL` > `NEON_DB_*` > local `DB_*`).
- [ ] `.env.example` preserves the existing local `DB_*` defaults verbatim — `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_NAME=openf1`, `DB_USER=openf1`, `DB_PASSWORD=openf1_local_dev` — as the ONLY uncommented database block (every `NEON_*`, `DATABASE_URL`, and `DB_SSL`/`NEON_SSL` line stays commented with `#`). Phase 12 item 3 is documentation-facing, so the local-dev defaults that work out-of-the-box must not be regressed by this slice.

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

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make the goal, test plan, and acceptance criteria consistently cover all non-`DB_*` branches in `web/src/lib/db.ts`: add explicit slice-local proof that `assertLocalDockerDb` early-returns when `DATABASE_URL` or `NEON_DB_HOST` is set, not only when `NEON_DATABASE_URL` is set.
- [x] Fix the diff-scope bookkeeping: implementation must update `diagnostic/slices/12-env-assertions.md` when it flips the slice to `awaiting_audit`, so include the slice file in `## Changed files expected` and stop asserting that the diff contains exactly the current three files.
- [x] Align the diff acceptance check with repo convention by replacing `git diff --stat main...HEAD` with a scope check against `integration/perf-roadmap...HEAD` (using `--name-only`, per loop guidance).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T20:49:40Z`).

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Align the Goal text with `web/src/lib/db.ts` branch selection by naming `DATABASE_URL` alongside `NEON_DATABASE_URL`/`NEON_DB_HOST`; as written, "no `NEON_*` URL/host is set" does not imply the local `DB_*` branch because `DATABASE_URL` still bypasses it.
- [x] Preserve or explicitly document the still-supported `DATABASE_URL` and `NEON_DB_*` branches in `.env.example`, or narrow the slice claim from "document the full set of database-env vars"; the current Step 4 would replace the existing `NEON_DB_HOST` block while the code and tests still depend on that branch.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T20:49:40Z`).

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Align the new assertion's branch-detection rules with `web/src/lib/db.ts`: require trimmed-presence checks for `NEON_DATABASE_URL`, `DATABASE_URL`, and `NEON_DB_HOST` (matching `firstUrl(...).trim()` / `NEON_DB_HOST?.trim()`), and add a slice-local test that whitespace-only values do not bypass the local-`DB_*` assertion.
- [x] Resolve the `.env.example` scope contradiction: either document the other database env vars `web/src/lib/db.ts` already consumes (`DB_SSL` and `NEON_SSL`) or narrow the Goal/Steps/Acceptance language so it no longer claims to document the "full set" of database env vars from that module.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T20:49:40Z`).

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make the acceptance criteria and slice-local test plan enforce Step 1's error-contract: require the failing assertion case(s) to verify that the thrown message names the offending `DB_HOST` and lists the allowed local/Docker hosts, not just that some error was thrown.
- [x] Make the acceptance criteria explicitly preserve the existing local `DB_*` defaults in `.env.example` (`DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_NAME=openf1`, `DB_USER=openf1`, `DB_PASSWORD=openf1_local_dev`) as the only uncommented database block, since Step 4 requires keeping them and Phase 12 item 3 is documentation-facing.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T20:49:40Z`).
