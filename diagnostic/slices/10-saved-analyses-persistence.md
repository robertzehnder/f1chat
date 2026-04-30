---
slice_id: 10-saved-analyses-persistence
phase: 10
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T19:12:40-04:00
---

## Goal
Wire the existing `/api/saved-analyses` stub (currently a hard-coded `{ rows: [], count: 0 }` placeholder at `web/src/app/api/saved-analyses/route.ts`) to a real `core.saved_analysis` table so a user can name + persist a chat thread (the typed payload from a chat session — SQL string, fact payload, answer markdown, chart config) and retrieve it later by id or by listing. Adds a server-rendered `/saved-analyses` page that reads from the same DB and renders the persisted rows. The slice ships the SQL DDL, the rewired API route (GET list + GET-by-id + POST insert), the page, and a grading test, all behind DB-backed gates that prove the persistence round-trip end to end.

## Inputs
- `web/src/app/api/saved-analyses/route.ts` (existing stub — `GET` returns `{ rows: [], count: 0, message: "Saved analyses persistence is not wired yet." }`; this slice replaces the body)
- `web/src/lib/db/index.ts` (re-exports `sql`, `pool`, `chooseDriver`, `bootPglite`, `withTransaction` from `./driver`) and `web/src/lib/db/driver.ts` (defines `export async function sql<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]>` — returns the rows array directly, NOT a `{ rows, rowCount }` object). The pattern used by every other consumer (e.g. `web/src/lib/queries/sessions.ts`) is `import { sql } from "../db"` then `const rows = await sql<RowShape>(text, values)`. This slice consumes the same export without modification. (Note: `web/src/lib/db.ts` is the legacy sibling that exists alongside the `db/` directory; consumers import from `@/lib/db` which resolves to `web/src/lib/db/index.ts` because Next/TS module resolution prefers the directory's `index.ts`.)
- `web/src/lib/querySafety.ts` — `export function clampInt(value: number, min: number, max: number): number` is the existing helper for clamping/parsing query-string limits; the new route uses it instead of inlining `Math.min(Math.max(...))`.
- `sql/005_helper_tables.sql` (precedent for `core.*` lookup table layout — `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` pattern)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10 line 346 ("Saved analyses: persist SQL + typed fact payload + answer + chart config (existing `/api/saved-analyses` is a stub).")

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/10-catalog-completeness-page.md` (most recent Phase 10 page slice — reference for source-inspection grading-test pattern, subshell-wrapped `(cd web && …)` gates, and `bash scripts/loop/test_grading_gate.sh` invocation)
- `diagnostic/slices/03-strategy-evidence-summary.md` (reference for the Phase-3 DB-backed gate pattern: apply migration via `psql -v ON_ERROR_STOP=1 -f`, then `pg_class` / `pg_constraint` existence assertions in a `DO $$ … $$` block)

## Required services / env
- `DATABASE_URL` — Neon Postgres URL the loop's migration role connects through. The role must have:
  - `CREATE` on schema `core` (to add `core.saved_analysis`).
  - `INSERT`, `SELECT`, `UPDATE` on `core.saved_analysis` (implicit via ownership of the table the migration creates).
- `psql` available on `PATH` for the SQL apply, schema-existence, and round-trip gate commands below (same prerequisite as Phase 3 materialization slices).
- The web grading test (`web/scripts/tests/saved-analyses.test.mjs`) is a pure source-inspection Node `node:test` suite (no live DB, no env vars at test time). Live-DB persistence is verified by separate `psql` heredoc gates — gate #3 (round-trip INSERT/SELECT/DELETE) plus gates #2 and #2b (schema/types/defaults/CHECK) — not by the grading test itself, so the grading test stays env-free and matches the existing `web/scripts/tests/*.test.mjs` harness.

## Steps
1. Add `sql/021_saved_analysis.sql` as a single `BEGIN; … COMMIT;` migration that creates `core.saved_analysis` with the following column list and constraints (mirrors the `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` pattern from `sql/005_helper_tables.sql`):
   - `id BIGSERIAL PRIMARY KEY`
   - `name TEXT NOT NULL CONSTRAINT saved_analysis_name_nonempty CHECK (length(btrim(name)) > 0)` — user-supplied label for the persisted chat thread; the named CHECK enforces a non-empty trimmed string at the DB layer (not only at the route's `invalid_name` 400 path), so accidental writes (e.g. via `psql` or a future endpoint) cannot bypass the validation.
   - `payload JSONB NOT NULL` (the typed chat-thread payload — SQL string, fact payload, answer markdown, chart config, message list — opaque to the SQL layer; the route handler is the only writer/reader)
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC)` so the list endpoint can return newest-first without a sort scan.
   The migration is idempotent: the `CREATE TABLE` uses `IF NOT EXISTS`, the index uses `IF NOT EXISTS`, and the named CHECK constraint is added via `ALTER TABLE … ADD CONSTRAINT saved_analysis_name_nonempty CHECK (length(btrim(name)) > 0)` wrapped in a `DO $$ … IF NOT EXISTS (SELECT … FROM pg_constraint WHERE conname = 'saved_analysis_name_nonempty') THEN … END IF; $$` block so re-applying the file on a database that already has the constraint is a no-op (a bare `ALTER TABLE … ADD CONSTRAINT` would error on the second apply because Postgres has no `ADD CONSTRAINT IF NOT EXISTS` for CHECK constraints in versions <17). Bundling the CHECK into the `CREATE TABLE` body would also satisfy idempotency on first apply, but the post-table `DO` form keeps the slice safe for an environment where a previous apply already created the table without the constraint.
2. Replace the body of `web/src/app/api/saved-analyses/route.ts` with three handlers, named-importing the existing `sql<T>` helper from `@/lib/db` (the helper signature is `sql<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>` — it returns the rows array directly, NOT a `{ rows, rowCount }` PG result object, so all call sites bind the awaited value as `const rows = await sql<RowShape>(...)`). Imports: `import { NextRequest, NextResponse } from "next/server"; import { sql } from "@/lib/db"; import { clampInt } from "@/lib/querySafety";`.
   - `export async function GET(req: NextRequest)` — if `req.nextUrl.searchParams.get("id")` is present and matches `/^\d+$/`, parse it to a number and call `const rows = await sql<{ id: number; name: string; payload: unknown; created_at: string; updated_at: string }>("SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis WHERE id = $1", [id])`, then return `NextResponse.json(rows[0])` — or `NextResponse.json({ error: "not_found" }, { status: 404 })` if `rows.length === 0`. Otherwise compute `const limit = clampInt(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 1, 200);` and call `const rows = await sql<{ id: number; name: string; payload: unknown; created_at: string; updated_at: string }>("SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT $1", [limit])`, then return `NextResponse.json({ rows, count: rows.length })`.
   - `export async function POST(req: NextRequest)` — `const body = await req.json();` then validate: reject with `NextResponse.json({ error: "invalid_name" }, { status: 400 })` if `typeof body?.name !== "string"` or `body.name.trim() === ""`; reject with `NextResponse.json({ error: "invalid_payload" }, { status: 400 })` if `body?.payload === undefined` or `body.payload === null`; otherwise call `const inserted = await sql<{ id: number; name: string; payload: unknown; created_at: string; updated_at: string }>("INSERT INTO core.saved_analysis (name, payload) VALUES ($1, $2::jsonb) RETURNING id, name, payload, created_at, updated_at", [body.name.trim(), JSON.stringify(body.payload)])` and return `NextResponse.json(inserted[0], { status: 201 })`.
   - The file must keep `export const dynamic = "force-dynamic"` and must reference each of these literal substrings (so the grading test can statically prove the persistence wiring): `import { sql } from "@/lib/db"`, `core.saved_analysis`, `INSERT INTO core.saved_analysis`, `SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis`, `WHERE id = $1`, `ORDER BY created_at DESC`, and `RETURNING id, name, payload, created_at, updated_at`. The handler must NOT keep the `"Saved analyses persistence is not wired yet."` placeholder string from the existing stub (the grading test asserts this substring is absent).
3. Add `web/src/app/saved-analyses/page.tsx` as a server component:
   - `export const dynamic = "force-dynamic"`.
   - Imports `import { sql } from "@/lib/db";` and default-imports a new client component `SavedAnalysesList` from `./SavedAnalysesList`.
   - Inside the default-exported async function, call `const rows = await sql<{ id: number; name: string; created_at: string }>("SELECT id, name, created_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT 200", []);` (note: `sql` returns the rows array directly per the helper signature in `web/src/lib/db/driver.ts`, so no `.rows` indirection), and render `<div className="stack"><section className="card"><h2 className="panel-title">Saved Analyses</h2></section><SavedAnalysesList rows={rows} /></div>`.
4. Add `web/src/app/saved-analyses/SavedAnalysesList.tsx` as a default-exported function component taking `{ rows: Array<{ id: number; name: string; created_at: string }> }`. Render a table with one `<tr data-testid="saved-analysis-row">` per row showing `id`, `name`, and `created_at`, plus an empty-state `<p data-testid="saved-analysis-empty">No saved analyses yet.</p>` when `rows.length === 0`. The component must contain the literal substrings `data-testid="saved-analysis-row"`, `data-testid="saved-analysis-empty"`, `id`, `name`, and `created_at`.
5. Add the source-inspection grading test `web/scripts/tests/saved-analyses.test.mjs` (Node built-in `node:test` and `node:fs` only — no transpile, no DB, no env), mirroring the structure of `web/scripts/tests/catalog-completeness.test.mjs`. Required assertions G1–G5 are spelled out under Acceptance criteria below.

## Changed files expected
- `sql/021_saved_analysis.sql` (new — single `BEGIN; … COMMIT;` migration; `CREATE TABLE IF NOT EXISTS core.saved_analysis (…)`, named CHECK constraint `saved_analysis_name_nonempty` (`length(btrim(name)) > 0`) added idempotently via an `ALTER TABLE … ADD CONSTRAINT` wrapped in a `DO $$ … IF NOT EXISTS … THEN … END IF $$` block, plus `CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx`)
- `web/src/app/api/saved-analyses/route.ts` (rewrite — replaces the stub `GET` body; adds `POST`; keeps `export const dynamic = "force-dynamic"`)
- `web/src/app/saved-analyses/page.tsx` (new — server component)
- `web/src/app/saved-analyses/SavedAnalysesList.tsx` (new — client/list component)
- `web/scripts/tests/saved-analyses.test.mjs` (new — source-inspection grading test asserting G1–G5)

## Artifact paths
None.

## Gate commands
Each line below is intended to be runnable independently from the repo root. The web gates are wrapped in subshells so a `cd web` inside one line does NOT bleed into the next line's working directory (otherwise pasting the block would leave the shell in `web/` and a subsequent `cd web && …` line would resolve against `web/web` and fail before the gate ran).
```bash
set -euo pipefail

# 1. Apply the migration. Must exit 0. Idempotent: CREATE TABLE and
#    CREATE INDEX use IF NOT EXISTS, and the named CHECK constraint is
#    added via an ALTER TABLE … ADD CONSTRAINT wrapped in a DO $$ … IF
#    NOT EXISTS (SELECT … FROM pg_constraint WHERE conname =
#    'saved_analysis_name_nonempty') THEN … END IF; $$ block, so a
#    second apply is a no-op rather than erroring on the duplicate
#    CHECK (Postgres <17 has no ADD CONSTRAINT IF NOT EXISTS for CHECK).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/021_saved_analysis.sql

# 2. Confirm core.saved_analysis exists as a base table with the required
#    columns, declared column types, NOT NULL flags, NOW() defaults on
#    created_at/updated_at, primary key, the named CHECK constraint
#    saved_analysis_name_nonempty, and the saved_analysis_created_at_idx
#    index. Together (a)-(h) prove the live runtime schema matches what
#    the migration declares — a pre-existing core.saved_analysis with a
#    drifted column type (e.g. payload as JSON instead of JSONB), a
#    missing CHECK, or a missing NOW() default will fail this gate even
#    though `CREATE TABLE IF NOT EXISTS` was a no-op. The DO block
#    raises (and ON_ERROR_STOP=1 forces non-zero exit) unless every
#    assertion holds.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  pk_cols text[];
  col_record record;
  expected_cols text[] := ARRAY['id','name','payload','created_at','updated_at']::text[];
  found_cols text[];
  idx_exists boolean;
  check_def text;
BEGIN
  -- (a) base table exists
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'saved_analysis';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'expected core.saved_analysis as base table (relkind r), got %', table_kind;
  END IF;

  -- (b) PRIMARY KEY (id)
  SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'core'
    AND cl.relname = 'saved_analysis'
    AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM ARRAY['id']::text[] THEN
    RAISE EXCEPTION 'expected core.saved_analysis PRIMARY KEY (id), got %', pk_cols;
  END IF;

  -- (c) all expected columns are present and NOT NULL where required
  SELECT array_agg(attname::text ORDER BY attnum) INTO found_cols
  FROM pg_attribute
  WHERE attrelid = 'core.saved_analysis'::regclass
    AND attnum > 0
    AND NOT attisdropped;
  IF NOT (expected_cols <@ found_cols) THEN
    RAISE EXCEPTION 'core.saved_analysis is missing expected columns: expected %, found %', expected_cols, found_cols;
  END IF;

  -- (d) NOT NULL on name, payload, created_at, updated_at
  FOR col_record IN
    SELECT attname, attnotnull
    FROM pg_attribute
    WHERE attrelid = 'core.saved_analysis'::regclass
      AND attname IN ('name','payload','created_at','updated_at')
  LOOP
    IF NOT col_record.attnotnull THEN
      RAISE EXCEPTION 'expected core.saved_analysis.% NOT NULL', col_record.attname;
    END IF;
  END LOOP;

  -- (e) created_at index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'core'
      AND tablename = 'saved_analysis'
      AND indexname = 'saved_analysis_created_at_idx'
  ) INTO idx_exists;
  IF NOT idx_exists THEN
    RAISE EXCEPTION 'expected index core.saved_analysis_created_at_idx';
  END IF;

  -- (f) declared column types match the migration (catches drifted
  --     pre-existing tables where CREATE TABLE IF NOT EXISTS was a
  --     no-op but the live schema diverges from this slice's spec).
  FOR col_record IN
    SELECT a.attname::text AS attname,
           format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a
    WHERE a.attrelid = 'core.saved_analysis'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname IN ('id','name','payload','created_at','updated_at')
  LOOP
    IF col_record.attname = 'id' AND col_record.data_type <> 'bigint' THEN
      RAISE EXCEPTION 'expected core.saved_analysis.id type bigint, got %', col_record.data_type;
    ELSIF col_record.attname = 'name' AND col_record.data_type <> 'text' THEN
      RAISE EXCEPTION 'expected core.saved_analysis.name type text, got %', col_record.data_type;
    ELSIF col_record.attname = 'payload' AND col_record.data_type <> 'jsonb' THEN
      RAISE EXCEPTION 'expected core.saved_analysis.payload type jsonb, got %', col_record.data_type;
    ELSIF col_record.attname IN ('created_at','updated_at')
          AND col_record.data_type <> 'timestamp with time zone' THEN
      RAISE EXCEPTION 'expected core.saved_analysis.% type timestamp with time zone, got %',
        col_record.attname, col_record.data_type;
    END IF;
  END LOOP;

  -- (g) created_at and updated_at default to now() (or equivalent)
  FOR col_record IN
    SELECT a.attname::text AS attname,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'core.saved_analysis'::regclass
      AND a.attname IN ('created_at','updated_at')
  LOOP
    IF col_record.default_expr IS NULL
       OR lower(col_record.default_expr) NOT LIKE '%now()%' THEN
      RAISE EXCEPTION 'expected core.saved_analysis.% DEFAULT now(), got %',
        col_record.attname, col_record.default_expr;
    END IF;
  END LOOP;

  -- (h) named CHECK constraint saved_analysis_name_nonempty exists and
  --     enforces length(btrim(name)) > 0 (proves the DB-level
  --     non-empty-name contract from Step 1; route-level invalid_name
  --     handling alone is not sufficient because direct INSERTs would
  --     bypass it).
  SELECT pg_get_constraintdef(c.oid) INTO check_def
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'core'
    AND cl.relname = 'saved_analysis'
    AND c.contype = 'c'
    AND c.conname = 'saved_analysis_name_nonempty';
  IF check_def IS NULL THEN
    RAISE EXCEPTION 'expected CHECK constraint saved_analysis_name_nonempty on core.saved_analysis';
  END IF;
  IF lower(regexp_replace(check_def, '\s+', '', 'g'))
     NOT LIKE '%length(btrim(name))>0%' THEN
    RAISE EXCEPTION 'expected saved_analysis_name_nonempty to enforce length(btrim(name)) > 0, got %', check_def;
  END IF;
END $$;
SQL

# 2b. Negative-path probe: confirm the CHECK constraint actually rejects
#     an empty/whitespace-only name at the DB layer (not just that the
#     constraint definition string is present). The probe wraps the
#     INSERT in a subtransaction so the failure does not abort the
#     outer DO block, then asserts the SQLSTATE was a check_violation
#     (23514). Any other outcome (the INSERT succeeded, or failed with
#     a different SQLSTATE) raises and ON_ERROR_STOP=1 fails the gate.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  caught_sqlstate text := NULL;
BEGIN
  BEGIN
    INSERT INTO core.saved_analysis (name, payload)
    VALUES ('   ', jsonb_build_object('probe', 'empty-name'));
  EXCEPTION WHEN check_violation THEN
    caught_sqlstate := SQLSTATE;
  END;
  IF caught_sqlstate IS DISTINCT FROM '23514' THEN
    RAISE EXCEPTION 'expected check_violation (SQLSTATE 23514) when inserting whitespace-only name, got %',
      COALESCE(caught_sqlstate, '<INSERT succeeded — CHECK not enforced>');
  END IF;
END $$;
SQL

# 3. Persistence round-trip: INSERT a row, SELECT it back by id, then
#    DELETE it so the gate is repeatable and leaves the table state
#    untouched. The DO block raises if the inserted row's name/payload
#    do not round-trip exactly. Use a unique probe name keyed on
#    txid_current() so concurrent runs do not collide.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  probe_name text := 'saved-analysis-gate-probe-' || txid_current()::text;
  probe_payload jsonb := jsonb_build_object('sql', 'SELECT 1', 'answer', 'gate probe');
  inserted_id bigint;
  read_name text;
  read_payload jsonb;
BEGIN
  INSERT INTO core.saved_analysis (name, payload)
  VALUES (probe_name, probe_payload)
  RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'INSERT into core.saved_analysis did not return an id';
  END IF;

  SELECT name, payload INTO read_name, read_payload
  FROM core.saved_analysis WHERE id = inserted_id;

  IF read_name IS DISTINCT FROM probe_name THEN
    RAISE EXCEPTION 'round-trip name mismatch: wrote=% read=%', probe_name, read_name;
  END IF;
  IF read_payload IS DISTINCT FROM probe_payload THEN
    RAISE EXCEPTION 'round-trip payload mismatch: wrote=% read=%', probe_payload, read_payload;
  END IF;

  DELETE FROM core.saved_analysis WHERE id = inserted_id;
END $$;
SQL

# 4. Web side regression safety + grading.
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `psql … -f sql/021_saved_analysis.sql` (gate #1) exits `0` and is idempotent (re-running produces no error and no schema drift).
- [ ] `core.saved_analysis` exists as a base table with `PRIMARY KEY (id)`; columns `id` (type `bigint`), `name` (type `text`), `payload` (type `jsonb`), `created_at` (type `timestamp with time zone` with `DEFAULT now()`), `updated_at` (type `timestamp with time zone` with `DEFAULT now()`); `name`/`payload`/`created_at`/`updated_at` declared `NOT NULL`; named CHECK constraint `saved_analysis_name_nonempty` enforcing `length(btrim(name)) > 0`; and index `saved_analysis_created_at_idx` — gate #2 exits `0` (its DO block raises unless every assertion (a)–(h) holds, including the column-type and default-now() checks).
- [ ] Live DB-level rejection of empty/whitespace-only `name`: gate #2b (the `INSERT … VALUES ('   ', …)` probe) exits `0` because the INSERT raises `check_violation` (SQLSTATE `23514`) and the outer DO block confirms that exact SQLSTATE — proving the CHECK is enforced at the DB layer, not only at the route's `invalid_name` 400 path.
- [ ] Persistence round-trip: a row inserted into `core.saved_analysis` with a unique probe `name` and a `jsonb` `payload` round-trips by id with `name` and `payload` equal under `IS NOT DISTINCT FROM`, then is deleted to leave table state unchanged — gate #3 exits `0` (its DO block does not raise; the cleanup `DELETE` removes the probe row).
- [ ] `web/scripts/tests/saved-analyses.test.mjs` exists and passes under `bash scripts/loop/test_grading_gate.sh` with these assertions:
  - **G1**: `web/src/app/api/saved-analyses/route.ts` exists, contains `export const dynamic = "force-dynamic"`, exports both `GET` and `POST` (`/export\s+async\s+function\s+GET\b/` and `/export\s+async\s+function\s+POST\b/`), imports the repo's `sql` helper via the regex `/import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*["']@\/lib\/db["']/` (proving the route is wired to the actual `sql<T>(text, values): Promise<T[]>` export from `web/src/lib/db/index.ts`, not the non-existent `query` helper named in earlier drafts), references each of these literal substrings — `core.saved_analysis`, `INSERT INTO core.saved_analysis`, `SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis`, `WHERE id = $1`, `ORDER BY created_at DESC`, `RETURNING id, name, payload, created_at, updated_at` — and does NOT contain the placeholder substring `Saved analyses persistence is not wired yet.` (the test asserts the stub message is gone, proving the route was rewired and not just appended to).
  - **G2**: `web/src/app/saved-analyses/SavedAnalysesList.tsx` exists, matches `/export\s+default\s+function\b/`, and contains literal substrings `data-testid="saved-analysis-row"`, `data-testid="saved-analysis-empty"`, `id`, `name`, and `created_at`.
  - **G3**: `web/src/app/saved-analyses/page.tsx` (a) imports `SavedAnalysesList` via `/import\s+SavedAnalysesList\s+from\s+["']\.\/SavedAnalysesList["']/`, (b) declares `export const dynamic = "force-dynamic"` (literal substring), (c) imports the repo's `sql` helper via `/import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*["']@\/lib\/db["']/`, invokes the helper via `/\bsql\s*[<(]/` (matches both bare `sql(...)` and the typed `sql<RowShape>(...)` form used throughout the repo, e.g. `web/src/lib/queries/sessions.ts:129`), and references the literal substring `FROM core.saved_analysis`, (d) contains a `<SavedAnalysesList rows={<binding>}` JSX element from which `<binding>` is extracted via `/<SavedAnalysesList\s+rows=\{(\w+)\}/`, and (e) `<binding>` matches the `<name>` in some `/const\s+<name>\s*=\s*await\s+sql\s*[<(]/` declaration in the same file (i.e. the JSX rows prop is bound to the awaited rows-array result of the `sql<...>(...)` call, by name — `sql` returns `Promise<T[]>` so the bound value IS the rows array, no `.rows` indirection).
  - **G4**: `sql/021_saved_analysis.sql` exists and contains the literal substrings `CREATE TABLE IF NOT EXISTS core.saved_analysis`, `id BIGSERIAL PRIMARY KEY`, `name TEXT NOT NULL`, `payload JSONB NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC)`, the named CHECK constraint substring `saved_analysis_name_nonempty` together with `CHECK (length(btrim(name)) > 0)`, and is wrapped in `BEGIN;` … `COMMIT;`.
  - **G5**: `web/src/app/api/saved-analyses/route.ts` rejects an empty `name` with the literal substring `invalid_name` and a missing `payload` with the literal substring `invalid_payload` (the test grep-asserts the route source contains both error tokens, proving the validation branches are present without requiring a live HTTP fetch).
- [ ] `(cd web && npm run build)` exits `0`.
- [ ] `(cd web && npm run typecheck)` exits `0`.
- [ ] `bash scripts/loop/test_grading_gate.sh` exits `0` (any pre-existing baseline failures in `scripts/loop/state/test_grading_baseline.txt` may stay; no NEW non-baseline failures may be introduced — the wrapper enforces this).

## Out of scope
- Authentication / per-user scoping of saved analyses (the `core.saved_analysis` table has no `user_id` column in this slice — single-tenant model; multi-user scoping is a later slice).
- UI for editing/deleting saved analyses (the route only exposes GET list, GET-by-id, and POST insert; PATCH/DELETE handlers are deferred).
- Wiring the `/chat` page's "Save" button to the new POST endpoint (UI integration in a later slice; this slice ships only the persistence backend + a list page).
- Schema validation of the JSONB payload (the route accepts any JSON value; typed payload validation lands when the chat-side typed-payload contract is finalized in a later Phase 10 slice).

## Risk / rollback
- Risk: applying the migration on a database where the loop's role lacks `CREATE` on schema `core`. Mitigation: gate #1 fails non-zero with a clean `permission denied for schema core` error before any other gate runs.
- Risk: a future slice adds a column to `core.saved_analysis` and breaks the `SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis` projection in the route. Mitigation: the route's column list is enumerated explicitly (no `SELECT *`) and the grading test G1 asserts the exact substring; a column addition will not break reads, only require explicit opt-in.
- Risk: the round-trip gate's probe row leaks if the gate is interrupted between INSERT and DELETE. Mitigation: probe `name` is `'saved-analysis-gate-probe-' || txid_current()::text` so leaked rows are easy to identify and clean with `DELETE FROM core.saved_analysis WHERE name LIKE 'saved-analysis-gate-probe-%'`. The leak is harmless (no UI surfaces the probe row preferentially; it is just a numbered row in the list).
- Rollback: `git revert <commit>` reverts the SQL file and the web changes. To return the live DB to its pre-slice state, run `DROP TABLE IF EXISTS core.saved_analysis;` (the table has no SQL dependents in `core` / `core_build` / `raw`; the only consumer is the web route, which the same revert removes).

## Slice-completion note

**Branch:** `slice/10-saved-analyses-persistence` (pushed to `origin/slice/10-saved-analyses-persistence`).

**Commit:** the single `[slice:10-saved-analyses-persistence][awaiting-audit]` commit at the HEAD of `slice/10-saved-analyses-persistence`. Run `git log -1 slice/10-saved-analyses-persistence` to read the hash and full message.

**Files changed (all within declared scope):**
- `sql/021_saved_analysis.sql` — new single `BEGIN; … COMMIT;` migration. `CREATE TABLE IF NOT EXISTS core.saved_analysis (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());` plus a `DO $$ … IF NOT EXISTS (SELECT … FROM pg_constraint WHERE conname = 'saved_analysis_name_nonempty') THEN ALTER TABLE … ADD CONSTRAINT saved_analysis_name_nonempty CHECK (length(btrim(name)) > 0); END IF; $$` block (idempotent because Postgres <17 lacks `ADD CONSTRAINT IF NOT EXISTS` for CHECK), and `CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC);` written on a single line (so the grading test G4 substring assertion sees the whole `CREATE INDEX … (created_at DESC)` clause as one literal token).
- `web/src/app/api/saved-analyses/route.ts` — rewrote the stub. New body imports `import { sql } from "@/lib/db"` and `clampInt` from `@/lib/querySafety`, keeps `export const dynamic = "force-dynamic"`, exports async `GET` and async `POST`. `GET` branches on `?id=`: integer-shaped id → `await sql<SavedAnalysisRow>("SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis WHERE id = $1", [id])` returning the row or `{ error: "not_found" }` 404; otherwise list mode with `clampInt(Number(limit), 1, 200)` and `await sql<…>("SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT $1", [limit])` returning `{ rows, count }`. `POST` validates `body.name` (string, non-empty after trim → `invalid_name` 400) and `body.payload` (not undefined/null → `invalid_payload` 400), then `await sql<…>("INSERT INTO core.saved_analysis (name, payload) VALUES ($1, $2::jsonb) RETURNING id, name, payload, created_at, updated_at", [name.trim(), JSON.stringify(payload)])` returning `inserted[0]` with status 201. The placeholder string `Saved analyses persistence is not wired yet.` is gone.
- `web/src/app/saved-analyses/page.tsx` — new server component. `import { sql } from "@/lib/db"` + default-import `SavedAnalysesList from "./SavedAnalysesList"`, `export const dynamic = "force-dynamic"`. Body declares `const rows = await sql<{ id: number; name: string; created_at: string }>("SELECT id, name, created_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT 200", [])` (uses the rows-array result directly per `web/src/lib/db/driver.ts:188-199` — no `.rows` indirection) and renders `<div className="stack"><section className="card"><h2 className="panel-title">Saved Analyses</h2></section><SavedAnalysesList rows={rows} /></div>`.
- `web/src/app/saved-analyses/SavedAnalysesList.tsx` — new default-exported function component. Empty state is `<p data-testid="saved-analysis-empty">No saved analyses yet.</p>`; populated state renders one `<tr data-testid="saved-analysis-row">` per row with `id`, `name`, and `created_at` cells.
- `web/scripts/tests/saved-analyses.test.mjs` — new source-inspection grading test (Node `node:test`, `node:fs`, no DB/env). Implements G1-G5 exactly: G1 = route imports `sql` from `@/lib/db`, exports async `GET`+`POST`, contains all six required SQL substrings, no stub message; G2 = `SavedAnalysesList.tsx` default function with `data-testid` literals + `id`/`name`/`created_at`; G3 = `page.tsx` per-module `sql` import + invocation, `FROM core.saved_analysis`, JSX rows binding extracted via the `<SavedAnalysesList\s+rows=\{(\w+)\}` regex matched against a `const <name> = await sql\s*[<(]` declaration; G4 = SQL file substrings incl. `BEGIN;` … `COMMIT;`; G5 = `invalid_name` and `invalid_payload` literals.

**Decisions:**
- The `DO $$ … IF NOT EXISTS (SELECT … FROM pg_constraint …) THEN ALTER TABLE … ADD CONSTRAINT … END IF $$;` form was used for the named CHECK rather than embedding the constraint in the `CREATE TABLE` body, so re-applying the migration on a database where the table was created in an earlier slice/iteration WITHOUT the constraint still installs it (and re-applying with the constraint already present is a no-op). This is what the slice's Step 1 explicitly calls out.
- The `CREATE INDEX IF NOT EXISTS …` clause is intentionally written on a single line so the G4 grading-test substring assertion (`CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC)`) matches as one contiguous token. An initial draft used a line-broken form and tripped G4; the single-line form is functionally equivalent.
- The route's `sql<T>(text, values)` calls bind their result directly to a `const rows = await sql<…>(…)` (or `inserted` for the POST INSERT) because `web/src/lib/db/driver.ts:188-199` declares `sql<T extends QueryResultRow>(text, values?: unknown[]): Promise<T[]>` — i.e. it returns the rows array, not a `{ rows, rowCount }` PG result object. No `.rows` indirection is used anywhere in the new code, matching the pattern in `web/src/lib/queries/sessions.ts`.
- `JSON.stringify(body.payload)` is passed for the JSONB column with the explicit `$2::jsonb` cast in the INSERT. This avoids relying on driver-side JSON serialization heuristics for the unknown-shape payload and makes the typed shape explicit in the SQL.
- The page's `LIMIT 200` is hard-coded (not exposed via a query string); per the slice's Out-of-scope section, filter/sort UI controls and pagination affordances are deferred. The list endpoint (route GET, list mode) does still expose `?limit=` clamped 1..200 via `clampInt`.

**Gate results (exit codes):**
- Gate #1 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/021_saved_analysis.sql` — exit `0` on first apply (`BEGIN; CREATE TABLE; DO; CREATE INDEX; COMMIT`); exit `0` on second apply (`relation "saved_analysis" already exists, skipping` + `relation "saved_analysis_created_at_idx" already exists, skipping` notices, both `CREATE TABLE` and `CREATE INDEX` no-op, the DO block's `IF NOT EXISTS` skips the ALTER) — idempotency confirmed.
- Gate #2 (live schema/types/defaults/CHECK assertions in a `DO $$ … $$` block) — exit `0`. Every assertion (a)–(h) holds: relkind=`r`, PK=`{id}`, all five expected columns present, NOT NULL on `name`/`payload`/`created_at`/`updated_at`, `saved_analysis_created_at_idx` exists, declared types match (`bigint`, `text`, `jsonb`, `timestamp with time zone`×2), `created_at`/`updated_at` defaults contain `now()`, and `saved_analysis_name_nonempty` exists with constraintdef containing `length(btrim(name))>0` after whitespace strip.
- Gate #2b (negative-path `INSERT … VALUES ('   ', …)` probe) — exit `0`. The INSERT raises `check_violation` (SQLSTATE `23514`), the outer `DO` block confirms exactly that SQLSTATE and exits cleanly.
- Gate #3 (round-trip INSERT → SELECT → DELETE with a `txid_current()`-keyed probe name) — exit `0`. `name` and `payload` round-trip equal under `IS NOT DISTINCT FROM`; the cleanup `DELETE` removes the probe row.
- Gate #4 `(cd web && npm run build)` — exit `0`. New `/saved-analyses` route registered alongside `/api/saved-analyses` in the build summary.
- Gate #4 `(cd web && npm run typecheck)` — exit `0`.
- Gate #4 `bash scripts/loop/test_grading_gate.sh` — exit `0`. Wrapper output: `PASS (no new failures vs integration baseline) slice_fails=39 baseline_fails=39 baseline_failures_fixed=0`. Direct run of `node --test scripts/tests/saved-analyses.test.mjs` shows `# tests 5 # pass 5 # fail 0` (G1–G5 all green).

**Self-check (acceptance criteria):**
- Gate #1 idempotent — passes (two consecutive applies, both exit 0).
- Schema/PK/NOT NULL/types/defaults/CHECK existence — passes (Gate #2 exit 0).
- Live empty-name CHECK rejection — passes (Gate #2b exit 0; SQLSTATE 23514 captured).
- Round-trip persistence — passes (Gate #3 exit 0; probe row inserted, read back with matching name+payload, deleted).
- G1 (route SQL contract + `sql` import + GET/POST + no stub message) — passes.
- G2 (SavedAnalysesList default function + testids + id/name/created_at) — passes.
- G3 (page wires `await sql<…>(…)` to `<SavedAnalysesList rows={…}>` by name binding) — passes.
- G4 (SQL file substrings incl. BEGIN;…COMMIT;) — passes.
- G5 (`invalid_name` + `invalid_payload` literals in route) — passes.
- `(cd web && npm run build)` exit 0 — passes.
- `(cd web && npm run typecheck)` exit 0 — passes.
- `bash scripts/loop/test_grading_gate.sh` exit 0, no new non-baseline failures — passes (slice_fails=39 == baseline_fails=39).

**Out-of-scope confirmations:**
- No `user_id` column added; the table is single-tenant per the slice's Out of scope.
- No PATCH/DELETE handlers on the route; only GET (list + by-id) and POST.
- The `/chat` page's "Save" button is not wired to the new POST; UI integration is a later slice.
- No JSON-schema validation of the JSONB payload; the route accepts any non-null JSON value.
- `git status` confirms only the six expected files are modified or added (slice md + the five files listed under "Changed files expected"); no other files were touched.

## Audit verdict
**Status: PASS**

Gate #1 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/021_saved_analysis.sql` -> exit `0`
Gate #1 repeat `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/021_saved_analysis.sql` -> exit `0`
Gate #2 schema assertion `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL' ... DO $$ ... $$; SQL` -> exit `0`
Gate #2b CHECK-enforcement probe `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL' ... DO $$ ... $$; SQL` -> exit `0`
Gate #3 round-trip probe `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL' ... DO $$ ... $$; SQL` -> exit `0`
Gate #4 `(cd web && npm run build)` -> exit `0`
Gate #5 `(cd web && npm run typecheck)` -> exit `0`
Gate #6 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
Scope diff -> PASS; `git diff --name-only integration/perf-roadmap...HEAD` is limited to `diagnostic/slices/10-saved-analyses-persistence.md`, `sql/021_saved_analysis.sql`, `web/scripts/tests/saved-analyses.test.mjs`, `web/src/app/api/saved-analyses/route.ts`, `web/src/app/saved-analyses/SavedAnalysesList.tsx`, and `web/src/app/saved-analyses/page.tsx`.
Criterion migration/idempotency -> PASS; the migration wraps `BEGIN; ... COMMIT;`, creates `core.saved_analysis`, adds the named CHECK idempotently, creates the descending index, and a second apply also exits `0` at `sql/021_saved_analysis.sql:1`, `sql/021_saved_analysis.sql:3`, `sql/021_saved_analysis.sql:11`, `sql/021_saved_analysis.sql:28`, `sql/021_saved_analysis.sql:30`.
Criterion live schema contract -> PASS; gate #2 verified base-table relkind, `PRIMARY KEY (id)`, required columns, required `NOT NULL` flags, `bigint`/`text`/`jsonb`/`timestamptz` types, `DEFAULT NOW()` on both timestamps, the `saved_analysis_created_at_idx` index, and `saved_analysis_name_nonempty` enforcing `length(btrim(name)) > 0` from `sql/021_saved_analysis.sql:3` and `sql/021_saved_analysis.sql:22`.
Criterion DB-level empty-name rejection -> PASS; gate #2b exited `0`, confirming whitespace-only `name` raises `check_violation` (`23514`) against the CHECK installed at `sql/021_saved_analysis.sql:23`.
Criterion persistence round-trip -> PASS; gate #3 exited `0`, confirming `INSERT ... RETURNING id`, `SELECT ... WHERE id = inserted_id`, and cleanup `DELETE` all succeed against `core.saved_analysis`.
Criterion G1 -> PASS; the route keeps `dynamic = "force-dynamic"`, imports `sql` from `@/lib/db`, exports `GET` and `POST`, issues the required `SELECT`/`INSERT` statements, and removes the stub placeholder at `web/src/app/api/saved-analyses/route.ts:1`, `web/src/app/api/saved-analyses/route.ts:5`, `web/src/app/api/saved-analyses/route.ts:15`, `web/src/app/api/saved-analyses/route.ts:41`.
Criterion G2 -> PASS; the list component default-exports the required table/empty-state rendering with `data-testid="saved-analysis-row"` and `data-testid="saved-analysis-empty"` and displays `id`, `name`, and `created_at` at `web/src/app/saved-analyses/SavedAnalysesList.tsx:7`, `web/src/app/saved-analyses/SavedAnalysesList.tsx:9`, `web/src/app/saved-analyses/SavedAnalysesList.tsx:22`.
Criterion G3 -> PASS; the page imports `SavedAnalysesList`, awaits `const rows = await sql(...)`, and passes that binding into `<SavedAnalysesList rows={rows} />` at `web/src/app/saved-analyses/page.tsx:1`, `web/src/app/saved-analyses/page.tsx:6`, `web/src/app/saved-analyses/page.tsx:16`.
Criterion G4 -> PASS; the grading test asserts the SQL file contains the required table, column, CHECK, index, and transaction substrings at `web/scripts/tests/saved-analyses.test.mjs:116` and those substrings are present in `sql/021_saved_analysis.sql:3`, `sql/021_saved_analysis.sql:23`, `sql/021_saved_analysis.sql:28`.
Criterion G5 -> PASS; the route contains both validation tokens `invalid_name` and `invalid_payload` at `web/src/app/api/saved-analyses/route.ts:44` and `web/src/app/api/saved-analyses/route.ts:47`, and the grading assertion exists at `web/scripts/tests/saved-analyses.test.mjs:141`.
Criterion web build -> PASS; `(cd web && npm run build)` exited `0` and registered `/api/saved-analyses` plus `/saved-analyses`.
Criterion web typecheck -> PASS; `(cd web && npm run typecheck)` exited `0` after the build-generated `.next/types` artifacts were present, matching the slice's declared gate order.
Criterion grading wrapper -> PASS; `bash scripts/loop/test_grading_gate.sh` exited `0` with `PASS (no new failures vs integration baseline) slice_fails=39 baseline_fails=39 baseline_failures_fixed=0`.
Decision -> PASS; all acceptance criteria verified, all declared gates passed, and the diff stayed within declared scope.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the raw grading gate with `bash scripts/loop/test_grading_gate.sh`; `cd web && npm run test:grading` is not an acceptable slice gate in this loop (`diagnostic/slices/10-saved-analyses-persistence.md:37`, `diagnostic/_state.md:68-69`).
- [x] Add DB apply/existence/parity gate commands for the new `saved_analysis` table so the slice verifies the SQL artifact and schema backing, not only web build/typecheck (`diagnostic/slices/10-saved-analyses-persistence.md:30-41`, `diagnostic/_state.md:59`).
- [x] Rewrite the acceptance criteria to prove the core flow end to end: saving a named chat thread persists it and retrieving it later returns the same saved analysis via objective checks, not only “page renders” or “data displayed” (`diagnostic/slices/10-saved-analyses-persistence.md:44-46`).

### Medium
- [x] Replace the conditional “add basic Playwright/RTL tests if the project has any; otherwise visual smoke check via dev-server screenshot” with explicit automated test work and gates; the current fallback is ambiguous and introduces an unstated dev-server dependency (`diagnostic/slices/10-saved-analyses-persistence.md:24-27`).
- [x] Fill in the Required services / env block for the DB-backed persistence path, or explicitly narrow the slice to mocked-only behavior; `None at author time` conflicts with a feature whose goal is persistence in a new table (`diagnostic/slices/10-saved-analyses-persistence.md:21-22`, `diagnostic/slices/10-saved-analyses-persistence.md:30-31`).

### Low
- [x] Expand Changed files expected to include the test file(s) and any additional contract/server modules the steps necessarily touch so slice scope matches the planned work (`diagnostic/slices/10-saved-analyses-persistence.md:24-32`).

### Notes (informational only — no action)
- `diagnostic/_state.md` was current at audit time (`last updated: 2026-04-30T22:43:30Z`).

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace every planned use of an existing `query` helper from `@/lib/db` with the repo's actual DB API and align the page/route/test contracts to that API; `web/src/lib/db/index.ts` exports `sql`/`pool`/helpers, not `query`, and `sql()` returns row arrays, so Steps 2-3 and acceptance G1/G3 currently describe code that cannot be implemented against the current repo surface.

### Medium
- [x] Extend the live-DB schema gate to assert the database-level `CHECK (length(btrim(name)) > 0)` contract from Step 1, because the current gates prove only route-level `invalid_name` handling and can pass while the table silently omits the non-empty-name constraint.
- [x] Make gate #2 actually verify the live table's declared column types/defaults that the acceptance text claims it proves, or narrow the acceptance wording; `CREATE TABLE IF NOT EXISTS` plus source-grep G4 does not catch a pre-existing `core.saved_analysis` with drifted runtime schema.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current at audit time (`last updated: 2026-04-30T22:43:30Z`).

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current at audit time (`last updated: 2026-04-30T22:43:30Z`).
