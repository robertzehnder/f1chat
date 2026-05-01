---
slice_id: 12-migration-runner-adoption
phase: 12
status: blocked
owner: user
user_approval_required: yes
created: 2026-04-26
updated: 2026-05-01T19:11:29-04:00
---

## Goal
Adopt **sqitch** as the SQL migration runner for all schema changes going
forward, port every existing `sql/NNN_*.sql` file (including the matview
contracts) into sqitch deploy/revert/verify scripts, and replace the
ad-hoc `scripts/init_db.sh` psql-loop with a sqitch-driven apply path.
Land behind explicit user approval; production deploy is a separate
follow-up step gated on a green non-prod run.

## Inputs
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 12
- Existing schema source of truth: `sql/001_create_schemas.sql` …
  `sql/021_saved_analysis.sql`
- Existing applier: `scripts/init_db.sh` (psql `-v ON_ERROR_STOP=1` loop)

## Prior context
- `diagnostic/_state.md`

## Decisions
- **Runner = sqitch.** Picked over Atlas/custom-python because (1) pure
  SQL — no new language runtime added to the repo; (2) deploy/revert/
  verify split is first-class, which is what makes the rollback gate
  testable; (3) does not couple migrations to the `web/` Node toolchain
  (matview SQL is independent of the Next.js app).
- **Non-prod first.** All gate commands in this slice run against the
  local dockerised Postgres (`scripts/init_db.sh`'s defaults — host
  `127.0.0.1`, db `openf1`). Production rollout is documented but NOT
  executed inside this slice; it is a separate user-approved step.
- **Rollback artifact lives in-repo** as `sql/migrations/README.md`
  plus per-change `revert/*.sql` scripts (sqitch convention), not in the
  slice-completion note.

## Required services / env

### Non-prod / staging (used by this slice's Steps and Gate commands)
- Local dockerised Postgres reachable at `DB_HOST=127.0.0.1`,
  `DB_PORT=5432`, `DB_NAME=openf1`, `DB_USER=openf1`,
  `DB_PASSWORD=openf1_local_dev` (defaults from `scripts/init_db.sh`).
  Override via `.env` if running elsewhere; do NOT point this at
  production.
- `sqitch` CLI ≥ 1.4 with the `pg` engine available on `$PATH`
  (`brew install sqitch --with-postgres-support` or distro equivalent).
- `psql` client (already required by `scripts/init_db.sh`).

### Production (informational — NOT exercised by this slice)
- Production `DATABASE_URL` (Neon connection string) — used only for the
  follow-up production deploy step, after this slice is merged and the
  user signs off on the staging run captured in the slice-completion
  note.
- Deployment platform credentials (Neon project / branch admin token).

## Steps
1. **Scaffold sqitch in the repo.** Create `sql/migrations/` and run
   `sqitch init` from inside it (no `--top-dir` flag) so the project
   root, `sqitch.conf`, `sqitch.plan`, and the `deploy/ revert/ verify/`
   subdirectories all live under `sql/migrations/` — matching the
   `sqitch --chdir sql/migrations ...` gate invocations below. Concrete
   command: `mkdir -p sql/migrations && (cd sql/migrations && sqitch
   init openf1 --engine pg)`. Commit the resulting
   `sql/migrations/sqitch.conf` + `sql/migrations/sqitch.plan`
   skeleton. Do NOT place `sqitch.conf` at the repo root.
2. **Port existing SQL** — for each `sql/NNN_*.sql`, run
   `sqitch add <name> -n "<one-line>"` to generate
   `sql/migrations/deploy/<name>.sql`,
   `sql/migrations/revert/<name>.sql`,
   `sql/migrations/verify/<name>.sql`. Move the existing file content
   into `deploy/`. Author a paired `revert/` script (drop / restore
   prior state) and a `verify/` script (e.g. `SELECT 1 FROM
   pg_matviews WHERE matviewname = '...'` for matview changes,
   `pg_class`/`pg_index` lookups for tables/indexes). Order in
   `sqitch.plan` must preserve the existing `001 → 021` sequence via
   the `[requires]` chain.
3. **Replace `scripts/init_db.sh`'s psql loop** with `sqitch deploy
   db:pg://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME`. Keep the
   `f1_codex_helpers` post-step. Update the script's header comment to
   point at `sql/migrations/README.md`.
4. **Write `sql/migrations/README.md`** documenting: how to deploy
   (`sqitch deploy <target>`), how to revert one change
   (`sqitch revert --to @HEAD^ <target>`), how to verify
   (`sqitch verify <target>`), and the production rollout / rollback
   procedure (deploy on a Neon branch first, run verify, promote;
   rollback = `sqitch revert --to <tag> <prod-target>`).
5. **Stage end-to-end against the local dockerised Postgres**:
   drop and recreate the `openf1` database, run the new
   `scripts/init_db.sh`, confirm every change in `sqitch.plan` reaches
   "deployed" status, then exercise the rollback gate (revert the head
   change, re-deploy, re-verify).
6. **Land behind explicit user approval.** Production deploy is NOT
   executed in this slice — it is a follow-up requiring the
   user-approved sentinel.

## Changed files expected
- `sql/migrations/sqitch.conf` (new) — sqitch project config, `pg`
  engine. Lives **inside** `sql/migrations/` (NOT at repo root) so the
  project root matches the `sqitch --chdir sql/migrations ...` gate
  invocations.
- `sql/migrations/sqitch.plan` (new) — ordered change list mirroring
  `001 → 021`.
- `sql/migrations/deploy/*.sql` (new, ~21 files) — ported from the
  existing bare-numbered SQL.
- `sql/migrations/revert/*.sql` (new, ~21 files) — paired rollback
  scripts.
- `sql/migrations/verify/*.sql` (new, ~21 files) — existence /
  invariant checks per change.
- `sql/migrations/README.md` (new) — rollout + rollback runbook.
- `scripts/init_db.sh` (modified) — replace the explicit psql loop with
  `sqitch deploy`; keep the helper-load tail.
- `sql/001_create_schemas.sql` … `sql/021_saved_analysis.sql` —
  removed (content lives in `sql/migrations/deploy/`) OR retained as
  thin pointer comments; the implementation must pick one and apply
  uniformly.

## Artifact paths
- `diagnostic/artifacts/migrations/12-sqitch-staging-run-<date>.log` —
  full output of Step 5 (drop/recreate, sqitch deploy, sqitch verify,
  rollback round-trip) for the audit record.

## Gate commands

All gate commands run against the local dockerised Postgres declared
under "Required services / env → Non-prod / staging". They MUST NOT be
pointed at production.

```bash
# Sanity: sqitch plan parses and project metadata loads. Targeting an
# explicit non-existent DB URI ('db:pg:') exercises plan/config parsing
# without needing a live DB; sqitch returns 0 if the plan is well-formed
# and non-zero on parse errors. No '|| true' — this gate must fail loudly
# when the plan/config is malformed.
sqitch --chdir sql/migrations plan
sqitch --chdir sql/migrations config --list

# Full forward apply against a freshly recreated non-prod DB.
# DROP DATABASE / CREATE DATABASE cannot run inside a transaction, and
# psql wraps multiple statements passed via a single -c into one
# implicit transaction. Therefore each statement gets its own -c
# invocation. Both run against the maintenance DB ('postgres') because
# the target DB is being recreated.
psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-openf1}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${DB_NAME:-openf1};"
psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-openf1}" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE ${DB_NAME:-openf1};"
bash scripts/init_db.sh

# Prove every change in sqitch.plan reached "deployed". 'sqitch status'
# exits non-zero when there are undeployed changes ("Undeployed change:
# ..."), and the awk check asserts the deployed-change count equals the
# plan-change count (excludes header/comment/pragma/blank lines from the
# plan, mirroring sqitch's own parser).
sqitch --chdir sql/migrations status db:pg://${DB_USER:-openf1}:${DB_PASSWORD:-openf1_local_dev}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME:-openf1}
PLAN_CHANGES=$(awk '/^[^%#[:space:]]/ {print $1}' sql/migrations/sqitch.plan | wc -l | tr -d ' ')
DEPLOYED_CHANGES=$(sqitch --chdir sql/migrations log --format=oneline db:pg://${DB_USER:-openf1}:${DB_PASSWORD:-openf1_local_dev}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME:-openf1} | grep -c '^deploy ')
test "$PLAN_CHANGES" -eq "$DEPLOYED_CHANGES"

# Verify every change reports OK.
sqitch --chdir sql/migrations verify db:pg://${DB_USER:-openf1}:${DB_PASSWORD:-openf1_local_dev}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME:-openf1}

# Rollback round-trip: revert the head change, assert the head change's
# specific objects are gone, then re-deploy and re-verify. The head
# change is 021_saved_analysis (the last entry in sqitch.plan); it
# creates core.saved_analysis (table), saved_analysis_name_nonempty
# (check constraint), and saved_analysis_created_at_idx (index). After
# revert these three must all be absent; after re-deploy they must all
# be present. The implementer MUST update this block if a future change
# is appended after 021 (so head_objects always names the actual head
# change's outputs).
sqitch --chdir sql/migrations revert --to @HEAD^ -y db:pg://${DB_USER:-openf1}:${DB_PASSWORD:-openf1_local_dev}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME:-openf1}
psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-openf1}" -d "${DB_NAME:-openf1}" -v ON_ERROR_STOP=1 -c "
  DO \$\$
  DECLARE
    leftover INT;
  BEGIN
    SELECT
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='core' AND c.relname='saved_analysis')
      + (SELECT count(*) FROM pg_constraint WHERE conname='saved_analysis_name_nonempty')
      + (SELECT count(*) FROM pg_class WHERE relname='saved_analysis_created_at_idx')
    INTO leftover;
    IF leftover <> 0 THEN
      RAISE EXCEPTION 'rollback left % head-change objects behind (expected 0)', leftover;
    END IF;
  END \$\$;
"
sqitch --chdir sql/migrations deploy db:pg://${DB_USER:-openf1}:${DB_PASSWORD:-openf1_local_dev}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME:-openf1}
psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-openf1}" -d "${DB_NAME:-openf1}" -v ON_ERROR_STOP=1 -c "
  DO \$\$
  DECLARE
    restored INT;
  BEGIN
    SELECT
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='core' AND c.relname='saved_analysis')
      + (SELECT count(*) FROM pg_constraint WHERE conname='saved_analysis_name_nonempty')
      + (SELECT count(*) FROM pg_class WHERE relname='saved_analysis_created_at_idx')
    INTO restored;
    IF restored <> 3 THEN
      RAISE EXCEPTION 're-deploy restored only %/3 head-change objects', restored;
    END IF;
  END \$\$;
"
sqitch --chdir sql/migrations verify db:pg://${DB_USER:-openf1}:${DB_PASSWORD:-openf1_local_dev}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME:-openf1}

# Existence / refresh-correctness for the migrated matviews — independent
# of sqitch's own verify, so a buggy verify script cannot mask a missing
# object. The DO block asserts pg_matviews in the public schema is
# EXACTLY the expected 11-name set (no missing, no extras, no renames);
# RAISE EXCEPTION on any difference fails the gate via psql's non-zero
# exit. Refreshes follow as a separate -c so a refresh failure is also
# loud.
psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-openf1}" -d "${DB_NAME:-openf1}" -v ON_ERROR_STOP=1 -c "
  DO \$\$
  DECLARE
    expected text[] := ARRAY[
      'driver_session_summary_mat',
      'grid_vs_finish_mat',
      'lap_context_summary_mat',
      'lap_phase_summary_mat',
      'laps_enriched_mat',
      'pit_cycle_summary_mat',
      'race_progression_summary_mat',
      'stint_summary_mat',
      'strategy_evidence_summary_mat',
      'strategy_summary_mat',
      'telemetry_lap_bridge_mat'
    ];
    actual text[];
    missing text[];
    extra text[];
  BEGIN
    SELECT array_agg(matviewname ORDER BY matviewname)
      INTO actual
      FROM pg_matviews
      WHERE schemaname = 'public';
    IF actual IS NULL THEN
      RAISE EXCEPTION 'public schema has no matviews; expected %', expected;
    END IF;
    SELECT array_agg(x) INTO missing
      FROM unnest(expected) AS x
      WHERE x <> ALL (actual);
    SELECT array_agg(x) INTO extra
      FROM unnest(actual) AS x
      WHERE x <> ALL (expected);
    IF missing IS NOT NULL OR extra IS NOT NULL THEN
      RAISE EXCEPTION 'matview set mismatch: missing=% extra=% (actual=%)',
        coalesce(missing, ARRAY[]::text[]),
        coalesce(extra,   ARRAY[]::text[]),
        actual;
    END IF;
  END \$\$;
"
psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-openf1}" -d "${DB_NAME:-openf1}" -v ON_ERROR_STOP=1 -c "
  REFRESH MATERIALIZED VIEW driver_session_summary_mat;
  REFRESH MATERIALIZED VIEW laps_enriched_mat;
  REFRESH MATERIALIZED VIEW stint_summary_mat;
  REFRESH MATERIALIZED VIEW strategy_summary_mat;
  REFRESH MATERIALIZED VIEW race_progression_summary_mat;
  REFRESH MATERIALIZED VIEW grid_vs_finish_mat;
  REFRESH MATERIALIZED VIEW pit_cycle_summary_mat;
  REFRESH MATERIALIZED VIEW strategy_evidence_summary_mat;
  REFRESH MATERIALIZED VIEW lap_phase_summary_mat;
  REFRESH MATERIALIZED VIEW lap_context_summary_mat;
  REFRESH MATERIALIZED VIEW telemetry_lap_bridge_mat;
"

# Web build + typecheck (still required — schema names are referenced
# from web/src/lib/db.ts callers).
cd web && npm run build
cd web && npm run typecheck

# Grading gate via the loop wrapper (per repo policy — diffs against
# scripts/loop/state/test_grading_baseline.txt so pre-existing failures
# do not auto-REJECT).
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `sqitch --chdir sql/migrations status <non-prod-target>` exits 0
      after `bash scripts/init_db.sh` against a freshly recreated
      `openf1` DB (sqitch returns non-zero when undeployed changes
      remain), AND the gate's `test "$PLAN_CHANGES" -eq
      "$DEPLOYED_CHANGES"` line passes — i.e., the count of changes in
      `sqitch.plan` equals the count of `deploy` events in
      `sqitch log`.
- [ ] `sqitch --chdir sql/migrations verify <non-prod-target>` exits 0
      against the same DB.
- [ ] The rollback round-trip in Gate commands (revert head → re-deploy
      → re-verify) exits 0; specifically, after the revert the three
      objects created by the head change `021_saved_analysis`
      (`core.saved_analysis` table, `saved_analysis_name_nonempty` check
      constraint, `saved_analysis_created_at_idx` index) are all absent
      from `pg_class`/`pg_constraint` (post-revert assertion `DO`
      block), and after re-deploy all three are present (post-redeploy
      assertion `DO` block). Both `DO` blocks `RAISE EXCEPTION` on
      mismatch, so a non-zero `psql` exit means the rollback gate
      failed.
- [ ] The matview-set assertion `DO` block in Gate commands exits 0 —
      i.e., `pg_matviews` for the `public` schema is exactly the
      11-name set hard-coded in that block (`driver_session_summary_mat`,
      `grid_vs_finish_mat`, `lap_context_summary_mat`,
      `lap_phase_summary_mat`, `laps_enriched_mat`,
      `pit_cycle_summary_mat`, `race_progression_summary_mat`,
      `stint_summary_mat`, `strategy_evidence_summary_mat`,
      `strategy_summary_mat`, `telemetry_lap_bridge_mat`) with no
      missing, extra, or renamed matviews. The block `RAISE EXCEPTION`s
      on any mismatch, so a non-zero `psql` exit means the gate failed.
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` exit
      0; `bash scripts/loop/test_grading_gate.sh` exits 0 (or only
      reports pre-baseline failures).
- [ ] `sql/migrations/README.md` exists and contains both a "deploy"
      and a "rollback" section naming the exact `sqitch` invocations.
- [ ] `diagnostic/artifacts/migrations/12-sqitch-staging-run-<date>.log`
      is committed and contains the full Step-5 transcript.

## Out of scope
- Running the migration runner against production. That happens in a
  separate, user-approved follow-up after this slice merges.
- Refactoring matview SQL contents — this slice ports them verbatim
  into deploy/ scripts.
- Replacing `f1_codex_helpers` loading; `scripts/init_db.sh` still
  invokes `load_codex_helpers.sh` after `sqitch deploy`.

## Risk / rollback
Production-touching adoption of a new tool. Mitigations:
- All Step-5 validation runs against the non-prod local DB; no
  production credentials are referenced in this slice.
- Rollback procedure is exercised by a gate command (revert→deploy→
  verify round-trip), not just documented.
- Per-change `revert/*.sql` scripts mean any single bad migration can
  be unwound with `sqitch revert --to <tag>` — the runbook in
  `sql/migrations/README.md` is the durable repo artifact for this.
- If sqitch adoption fails the gates, the rollback for the slice
  itself is `git revert` of the merge commit — `scripts/init_db.sh`
  reverts to the prior psql loop and the bare-numbered `sql/NNN_*.sql`
  files are restored.

## Slice-completion note

**Status: blocked (owner=user) — slice plan defect; gate is unsatisfiable as written.**

Branch: `slice/12-migration-runner-adoption` (no implementation commits — partial sqitch scaffold rolled back before push so the branch contains only the frontmatter/blocker note edit).

### Blocker

The "Existence / refresh-correctness for the migrated matviews" gate
command in this slice asserts that `pg_matviews` (PostgreSQL's catalog
view that lists ONLY `MATERIALIZED VIEW` objects) in the `public`
schema is exactly the 11-name set:

    driver_session_summary_mat, grid_vs_finish_mat,
    lap_context_summary_mat, lap_phase_summary_mat,
    laps_enriched_mat, pit_cycle_summary_mat,
    race_progression_summary_mat, stint_summary_mat,
    strategy_evidence_summary_mat, strategy_summary_mat,
    telemetry_lap_bridge_mat

…and then runs `REFRESH MATERIALIZED VIEW <name>;` against each.

Both predicates are false against the actual SQL this slice ports.
The 11 named objects are NOT materialized views and are NOT in the
`public` schema. Verified against the live `openf1` database
(127.0.0.1:5433) on 2026-05-01:

```
openf1=# SELECT schemaname, matviewname FROM pg_matviews;
 schemaname | matviewname
------------+-------------
(0 rows)

openf1=# SELECT schemaname, tablename FROM pg_tables
         WHERE tablename LIKE '%_mat' ORDER BY 1,2;
 schemaname |           tablename
------------+-------------------------------
 core       | driver_session_summary_mat
 core       | grid_vs_finish_mat
 core       | lap_context_summary_mat
 core       | lap_phase_summary_mat
 core       | laps_enriched_mat
 core       | pit_cycle_summary_mat
 core       | race_progression_summary_mat
 core       | stint_summary_mat
 core       | strategy_evidence_summary_mat
 core       | strategy_summary_mat
 core       | telemetry_lap_bridge_mat
(11 rows)
```

The 11 names match exactly, but they are heap **TABLES** in the
`core` schema (the "table + facade view" pattern, populated by
`TRUNCATE … ; INSERT INTO …`), not `MATERIALIZED VIEW` objects in
`public`. Confirmed by reading `sql/009_*.sql`–`sql/019_*.sql` and
by `git log` on those files (commits `0b094ef`, `87b0582`,
`3f747ac`, `4aa714b`, `b8656d8`, `cd492e8`, `7c28a34`, `bd740d7`,
`add979b`, `22bd558`, `f9067d4` — every one says "materialize as
table + facade" or "heap-with-indexes + facade", never "materialized
view"). `grep -rin "MATERIALIZED" sql/` returns zero matches.

### Why this cannot be fixed inside this slice's scope

1. **Cannot change the gate.** Slice files are not under
   "Changed files expected"; gate commands are the slice's
   contract with the auditor.
2. **Cannot change the SQL semantics.** "Out of scope" §2 is
   explicit: *"Refactoring matview SQL contents — this slice
   ports them verbatim into deploy/ scripts."* Converting
   `CREATE TABLE core.X_mat (...) ; TRUNCATE … ; INSERT …` into
   `CREATE MATERIALIZED VIEW public.X_mat AS SELECT … ;` is a
   semantic refactor of the matview SQL contents (object kind
   changes from heap-table to matview, schema changes from `core`
   to `public`, populate path changes from
   `TRUNCATE+INSERT` to `REFRESH MATERIALIZED VIEW`,
   downstream `core.X` facade view's relkind changes). It is the
   exact change "Out of scope" forbids.
3. **No third path satisfies both.** `pg_matviews` returns only
   relkind='m' relations — heap tables (relkind='r') are
   unreachable from that catalog view, so no read-only assertion
   adjustment can make the gate pass.

### What needs to happen (owner=user / planner)

Replanning options, all of which are slice-spec edits and so are
out of this implementer's scope:

- **(A)** Rewrite the gate to check the 11 `_mat` heap tables
  where they actually live, e.g.:
  ```sql
  SELECT array_agg(relname ORDER BY relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relkind = 'r'
      AND c.relname LIKE '%\_mat' ESCAPE '\';
  ```
  and replace the `REFRESH MATERIALIZED VIEW …` block with
  whatever existing repopulate path these tables use (the SQL
  files do `TRUNCATE+INSERT` inline at apply-time, so a fresh
  `init_db.sh` already populates them — the gate may need
  nothing more than an existence check). This is the cheapest
  fix and keeps "verbatim porting" intact.
- **(B)** Rescope the slice to also convert the 11 `core.*_mat`
  heap tables into real `public.*_mat` materialized views, and
  remove "Refactoring matview SQL contents" from "Out of scope".
  This is a much larger change with web-side fan-out: every
  `core.X` facade view downstream of these tables needs its
  definition reviewed (the current facades are
  `CREATE VIEW core.X AS SELECT * FROM core.X_mat`, which works
  for either object kind, but any code that targets `core.X_mat`
  directly — the rebuild SQL itself does — would have to move
  to `public.X_mat`).

Option (A) is recommended: the gate was almost certainly drafted
with the *intent* of verifying these 11 specific objects exist
and refresh, and the only defect is the cataloged object-kind
the gate queries.

### Self-check / what I did before blocking

- Read the slice end-to-end and the linked `_state.md`.
- Verified `sqitch` CLI was missing on the host; installed a
  Docker-backed wrapper at `~/.local/bin/sqitch` (sqitch v1.6.1,
  `pg` engine). This is a host-environment change only — no
  repo files touched.
- Created `.env` (gitignored) overriding `DB_PORT=5433` so the
  gate URLs would point at the running `openf1-postgres`
  container; confirmed `psql` reaches it from both host and
  Docker (via `host.docker.internal`).
- Started Step 1 by running `sqitch init openf1 --engine pg`
  inside `sql/migrations/`; rolled back the resulting
  `sqitch.conf`/`sqitch.plan`/`deploy|revert|verify/`
  directories with `rm -rf sql/migrations` before commit, so
  the pushed branch contains zero implementation diff. Stopped
  before porting any of the 21 SQL files because the matview
  gate is unsatisfiable regardless of how the port is done.
- No Step 2–6 work performed; no artifact written under
  `diagnostic/artifacts/migrations/`.

### Acceptance criteria status

- [ ] `sqitch status` exits 0 — **blocked** (no port performed).
- [ ] `sqitch verify` exits 0 — **blocked** (no port performed).
- [ ] Rollback round-trip — **blocked** (no port performed).
- [ ] Matview-set assertion exits 0 — **unsatisfiable** (defect
      above; this is the blocker).
- [ ] `web build` / `typecheck` / `test_grading_gate.sh` — not
      run; would only be meaningful after a full port.
- [ ] `sql/migrations/README.md` exists — **blocked**.
- [ ] `12-sqitch-staging-run-*.log` artifact — **blocked**.

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the web-only gate block with migration-runner gates that exercise the declared scope end-to-end in a non-prod database, including applying the migrations, verifying the migrated matview objects exist/refresh correctly, and proving the rollback procedure works.
- [x] Replace `Production DATABASE_URL` in Required services / env with the exact non-prod/staging database and deployment prerequisites needed for Step 2, and state the production approval/deploy inputs separately so the implementer does not run first-pass validation against production.

### Medium
- [x] Commit to one migration-runner path in the plan and expand Changed files expected to cover the runner-specific config, invocation, and documentation files the implementation will necessarily touch; `sqitch / Atlas / custom python` is too open-ended to audit.
- [x] Rewrite the acceptance criteria as command- or artifact-based checks owned by this slice instead of `Implementation works in staging` and a slice-completion note; they must be testable without subjective judgment.
- [x] If a grading gate remains, invoke it via `bash scripts/loop/test_grading_gate.sh` rather than raw `cd web && npm run test:grading`, per loop policy.

### Low
- [x] Clarify where the rollback procedure must live during implementation; `slice-completion note` conflicts with the production-facing nature of the change and does not identify a durable repo artifact.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-05-01T22:56:29Z, so no stale-state note is required.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace the rollback acceptance check `post-revert pg_matviews count matching count(plan_changes) - 1` with an object-level assertion tied to the specific reverted head change; the current formula is wrong because plan changes and materialized views are not 1:1, so it can fail on correct rollback or pass with leftover objects.

### Medium
- [x] Add an explicit post-deploy gate command that proves the acceptance criterion “every change in `sqitch.plan` is deployed” instead of relying on `sqitch verify`; the listed gates never run a status/log check after `bash scripts/init_db.sh`, so that criterion is not currently testable from the gate block.
- [x] Remove `|| true` from the “sqitch project is well-formed and plan parses” sanity gate or rewrite the command/comment so the gate has a real pass/fail condition; as written it masks malformed-project failures while claiming to validate them.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-05-01T22:56:29Z, so no stale-state note is required.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Split the fresh-DB gate into separate `psql -c` invocations (or equivalent non-transactional commands); PostgreSQL executes multiple SQL statements passed via one `-c` as a single transaction, so `DROP DATABASE ...; CREATE DATABASE ...` will fail because `DROP DATABASE` cannot run inside a transaction block.

### Medium
- [x] Resolve the Sqitch project-root/layout contradiction by making Step 1, Changed files expected, and the `sqitch --chdir ...` gates agree on where `sqitch.conf` and `sqitch.plan` live; `sqitch init ... --top-dir sql/migrations` defaults the plan file under `sql/migrations/`, but the plan currently expects a repo-root `sqitch.conf` while all gates run from `sql/migrations`.
- [x] Replace the matview acceptance check with an executable assertion that the `public` schema contains exactly the 11 named matviews and no extras; the current gate only prints `pg_matviews` rows and refreshes named views, so extra or renamed matviews would not fail the gate.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-05-01T22:56:29Z, so no stale-state note is required.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-05-01T22:56:29Z, so no stale-state note is required.
