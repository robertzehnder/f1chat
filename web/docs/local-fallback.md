# Local PGlite Fallback

Run the chat runtime locally with no Postgres reachable.

## When to use

Set `OPENF1_LOCAL_FALLBACK=1` (and only for non-production runs) when you
want the app to boot, probe the configured Postgres pool with `SELECT 1`,
and — if the probe fails — fall back to an in-process
[`@electric-sql/pglite`](https://pglite.dev) instance seeded from a
committed SQL snapshot. This is intended for offline dev: airplane mode,
"Neon paused, I want to try a UI change," etc.

Without `OPENF1_LOCAL_FALLBACK=1` the runtime is byte-for-byte identical to
today: the existing `createPool()` ladder runs unchanged, no probe is
performed, and a misconfigured database surfaces lazily on the first query.

## Snapshot location

The snapshot SQL lives at `web/data/local-fallback-snapshot.sql`. To override
it, set `OPENF1_LOCAL_SNAPSHOT_PATH`. Relative paths resolve against the
`web/` cwd; absolute paths are honored as-is.

## createPool() ladder still applies

The four-branch ladder in `web/src/lib/db/driver.ts` is unchanged:

1. `NEON_DATABASE_URL` / `DATABASE_URL`
2. `NEON_DB_HOST` + `NEON_DB_*`
3. `DB_HOST` + `DB_*` (defaults `127.0.0.1:5432/openf1`)

Whichever branch builds the pool, the probe runs against that singleton
when `OPENF1_LOCAL_FALLBACK=1`.

## Production guard

`NODE_ENV === "production"` short-circuits the selection logic before it
inspects `OPENF1_LOCAL_FALLBACK`. PGlite never engages in production, even
if the env var is set. A misconfigured prod deploy that sets the flag still
fails closed against the configured Neon pool.

## Running the dedicated test

```bash
cd web && node --test scripts/tests/driver-fallback.test.mjs
```

The test spawns one child process per case so module state and
`process.env` are isolated. It exercises all five env shapes
(`DB_*`, `DATABASE_URL`, opt-out, production, `NEON_DB_HOST`) plus a
`runReadOnlySql` invocation against the seeded snapshot via
`withTransaction`.
