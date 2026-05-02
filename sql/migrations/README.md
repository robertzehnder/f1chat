# OpenF1 schema migrations (sqitch)

All schema changes for the openf1 database (raw + core + core_build
schemas) are managed by [sqitch](https://sqitch.org/). This directory
is the sqitch project root: `sqitch.conf` and `sqitch.plan` live here,
alongside the `deploy/`, `revert/`, and `verify/` subdirectories.

## Prerequisites

Install sqitch with PostgreSQL support:

```bash
brew tap sqitchers/sqitch
brew install sqitchers/sqitch/sqitch --with-postgres-support
```

(Other platforms: see <https://sqitch.org/download/>.)

The `pg` engine requires the Perl `DBD::Pg` module; on macOS you may
need a working `pg_config` (e.g. `brew install postgresql@16`) and the
helper Perl modules `App::Info` and `Module::Build` available before
the brew formula will complete.

## Targets

A sqitch *target* is a database URI. The non-prod / staging target
matches `scripts/init_db.sh`'s defaults:

```
db:pg://openf1:openf1_local_dev@127.0.0.1:5432/openf1
```

Production (Neon) is wired up via the deployment platform's
`DATABASE_URL` and is **never** touched by gate commands or local
scripts in this repo. Production rollouts go through a separate
user-approved follow-up step (see Production rollout below).

All `sqitch` invocations below assume the project root is
`sql/migrations/`. Run them with `sqitch --chdir sql/migrations …` from
the repo root, or `cd sql/migrations` first.

## Daily workflow

### Deploy (apply pending changes)

The local-dev path is wrapped by `scripts/init_db.sh`, which calls:

```bash
sqitch --chdir sql/migrations deploy \
  "db:pg://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
```

To deploy explicitly without the wrapper:

```bash
sqitch --chdir sql/migrations deploy <target>
```

### Verify

```bash
sqitch --chdir sql/migrations verify <target>
```

Each verify script `RAISE EXCEPTION`s on missing objects, so a non-zero
exit means at least one change failed verification.

### Status

```bash
sqitch --chdir sql/migrations status <target>
```

Exits non-zero if the deployed change set lags `sqitch.plan` (i.e. the
DB has undeployed changes).

### Add a new change

```bash
cd sql/migrations
sqitch add <new_change_name> -r <previous_change> -n "Short description"
# Edit deploy/<new_change_name>.sql, revert/<new_change_name>.sql,
# verify/<new_change_name>.sql
sqitch deploy <target>
sqitch verify <target>
```

The `[requires]` chain in `sqitch.plan` is **load-bearing**: it
preserves the original `001 → 021 → …` order. New changes must
require the prior head change.

## Rollback

### Revert one change

```bash
sqitch --chdir sql/migrations revert --to @HEAD^ <target>
```

`@HEAD^` resolves to "one before head" in plan order, so this command
undoes only the most recently deployed change.

### Revert to a specific change

```bash
sqitch --chdir sql/migrations revert --to <change_name> <target>
```

This reverts every change deployed *after* `<change_name>`, in reverse
order. Each `revert/<name>.sql` script `DROP`s the objects its
matching `deploy/<name>.sql` created.

### Deep-revert caveat for the `*_mat` migrations (009 → 019)

Each of the eleven matview-adoption changes (`009_driver_session_summary_mat`
through `019_telemetry_lap_bridge_mat`) replaces a predecessor
`CREATE OR REPLACE VIEW` from `006_semantic_lap_layer` or
`007_semantic_summary_contracts` with a matview-backed `CREATE VIEW`
that reads from a sibling `*_mat` storage table. Their revert scripts
drop the storage table and the replacement VIEW, which means a deep
revert past one of these changes leaves the previously-replaced VIEW
absent. To restore the predecessor's VIEW definition, re-run the
predecessor's deploy:

```bash
sqitch --chdir sql/migrations deploy \
  --to 007_semantic_summary_contracts <target>
```

For the slice's gate command (revert HEAD only, then re-deploy HEAD)
this is not exercised — only HEAD's revert/redeploy round-trip is
asserted.

## Production rollout (informational — separate follow-up)

This slice does **not** deploy to production. The procedure for the
follow-up production step is:

1. Take a Neon point-in-time snapshot or branch off the current prod
   DB so a clean rollback target exists.
2. Apply on a Neon branch first:
   ```bash
   sqitch --chdir sql/migrations deploy "$NEON_BRANCH_DATABASE_URL"
   sqitch --chdir sql/migrations verify "$NEON_BRANCH_DATABASE_URL"
   ```
3. Smoke-test the application against the Neon branch.
4. Promote the Neon branch (`neon branches promote …`) so prod traffic
   moves to the deployed schema.
5. Rollback path if a regression is detected:
   ```bash
   sqitch --chdir sql/migrations revert --to <last_known_good_change> "$DATABASE_URL"
   ```
   Or, if a Neon branch was used in step 2, revert by promoting the
   pre-deploy branch back to primary (faster than running revert
   scripts against a populated prod DB).

## File layout

```
sql/migrations/
├── README.md          (this file)
├── sqitch.conf        sqitch project config (engine = pg)
├── sqitch.plan        ordered change list mirroring 001 → 021
├── deploy/            forward migrations (one .sql per change)
├── revert/            paired rollback scripts (one .sql per change)
└── verify/            existence / invariant checks (one .sql per change)
```

The bare-numbered files at `sql/001_create_schemas.sql` …
`sql/021_saved_analysis.sql` are retained as thin pointer-comment
files for legacy direct callers (e.g.
`web/scripts/perf-explain-before-after.mjs` and
`web/scripts/tests/saved-analyses.test.mjs`); the canonical content
lives under `deploy/`.
