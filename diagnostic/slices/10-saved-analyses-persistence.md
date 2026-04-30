---
slice_id: 10-saved-analyses-persistence
phase: 10
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T23:30:00Z
---

## Goal
Wire the existing `/api/saved-analyses` stub (currently a hard-coded `{ rows: [], count: 0 }` placeholder at `web/src/app/api/saved-analyses/route.ts`) to a real `core.saved_analysis` table so a user can name + persist a chat thread (the typed payload from a chat session — SQL string, fact payload, answer markdown, chart config) and retrieve it later by id or by listing. Adds a server-rendered `/saved-analyses` page that reads from the same DB and renders the persisted rows. The slice ships the SQL DDL, the rewired API route (GET list + GET-by-id + POST insert), the page, and a grading test, all behind DB-backed gates that prove the persistence round-trip end to end.

## Inputs
- `web/src/app/api/saved-analyses/route.ts` (existing stub — `GET` returns `{ rows: [], count: 0, message: "Saved analyses persistence is not wired yet." }`; this slice replaces the body)
- `web/src/lib/db.ts` / `web/src/lib/db/index.ts` (existing `query<T>(sql, params)` helper — used by all other API routes; this slice consumes it without modification)
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
- The web grading test (`web/scripts/tests/saved-analyses.test.mjs`) is a pure source-inspection Node `node:test` suite (no live DB, no env vars at test time). Live-DB persistence is verified by a separate `psql` heredoc gate (gate #4 below), not by the grading test itself, so the grading test stays env-free and matches the existing `web/scripts/tests/*.test.mjs` harness.

## Steps
1. Add `sql/021_saved_analysis.sql` as a single `BEGIN; … COMMIT;` migration that creates `core.saved_analysis` with the following column list and constraints (mirrors the `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` pattern from `sql/005_helper_tables.sql`):
   - `id BIGSERIAL PRIMARY KEY`
   - `name TEXT NOT NULL` (user-supplied label for the persisted chat thread; non-empty enforced by `CHECK (length(btrim(name)) > 0)`)
   - `payload JSONB NOT NULL` (the typed chat-thread payload — SQL string, fact payload, answer markdown, chart config, message list — opaque to the SQL layer; the route handler is the only writer/reader)
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC)` so the list endpoint can return newest-first without a sort scan.
   The migration is idempotent: every DDL statement uses `IF NOT EXISTS` and the file may be re-applied without error.
2. Replace the body of `web/src/app/api/saved-analyses/route.ts` with three handlers (default-import the existing `query` helper from `@/lib/db`):
   - `export async function GET(req: NextRequest)` — if the URL has `?id=<digits>`, calls `query("SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis WHERE id = $1", [id])` and returns the single row (404 with `{ error: "not_found" }` if `rows.length === 0`); otherwise calls `query("SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT $1", [limit])` (default 50, max 200 via the existing `safeLimit` helper if available, else inline `Math.min(Math.max(parseInt(...) || 50, 1), 200)`) and returns `{ rows, count: rows.length }`.
   - `export async function POST(req: NextRequest)` — parses JSON body `{ name: string, payload: unknown }`; rejects with 400 `{ error: "invalid_name" }` if `typeof name !== "string"` or `name.trim() === ""`; rejects with 400 `{ error: "invalid_payload" }` if `payload === undefined` or `payload === null`; otherwise calls `query("INSERT INTO core.saved_analysis (name, payload) VALUES ($1, $2::jsonb) RETURNING id, name, payload, created_at, updated_at", [name.trim(), JSON.stringify(payload)])` and returns the inserted row with status 201.
   - The file must keep `export const dynamic = "force-dynamic"` and must reference each of these literal substrings (so the grading test can statically prove the persistence wiring): `core.saved_analysis`, `INSERT INTO core.saved_analysis`, `SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis`, `WHERE id = $1`, `ORDER BY created_at DESC`, and `RETURNING id, name, payload, created_at, updated_at`. The handler must NOT keep the `"Saved analyses persistence is not wired yet."` placeholder string from the existing stub (the grading test asserts this substring is absent).
3. Add `web/src/app/saved-analyses/page.tsx` as a server component:
   - `export const dynamic = "force-dynamic"`.
   - Default-imports a new client component `SavedAnalysesList` from `./SavedAnalysesList`.
   - Inside the default-exported async function, call `query("SELECT id, name, created_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT 200", [])` against `@/lib/db`, bind to `const rows = await …`, and render `<div className="stack"><section className="card"><h2 className="panel-title">Saved Analyses</h2></section><SavedAnalysesList rows={rows} /></div>`.
4. Add `web/src/app/saved-analyses/SavedAnalysesList.tsx` as a default-exported function component taking `{ rows: Array<{ id: number; name: string; created_at: string }> }`. Render a table with one `<tr data-testid="saved-analysis-row">` per row showing `id`, `name`, and `created_at`, plus an empty-state `<p data-testid="saved-analysis-empty">No saved analyses yet.</p>` when `rows.length === 0`. The component must contain the literal substrings `data-testid="saved-analysis-row"`, `data-testid="saved-analysis-empty"`, `id`, `name`, and `created_at`.
5. Add the source-inspection grading test `web/scripts/tests/saved-analyses.test.mjs` (Node built-in `node:test` and `node:fs` only — no transpile, no DB, no env), mirroring the structure of `web/scripts/tests/catalog-completeness.test.mjs`. Required assertions G1–G5 are spelled out under Acceptance criteria below.

## Changed files expected
- `sql/021_saved_analysis.sql` (new — single `BEGIN; … COMMIT;` migration; `CREATE TABLE IF NOT EXISTS core.saved_analysis (…)` plus `CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx`)
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

# 1. Apply the migration. Must exit 0. Idempotent (re-applying is a no-op
#    because every DDL uses IF NOT EXISTS).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/021_saved_analysis.sql

# 2. Confirm core.saved_analysis exists as a base table with the required
#    columns, types, NOT NULL flags, primary key, and the
#    saved_analysis_created_at_idx index. The DO block raises (and
#    ON_ERROR_STOP=1 forces non-zero exit) unless every assertion holds.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  pk_cols text[];
  col_record record;
  expected_cols text[] := ARRAY['id','name','payload','created_at','updated_at']::text[];
  found_cols text[];
  idx_exists boolean;
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
- [ ] `core.saved_analysis` exists as a base table with `PRIMARY KEY (id)`, columns `id`, `name`, `payload`, `created_at`, `updated_at`, `name`/`payload`/`created_at`/`updated_at` declared `NOT NULL`, and index `saved_analysis_created_at_idx` — gate #2 exits `0` (its DO block raises unless every assertion holds).
- [ ] Persistence round-trip: a row inserted into `core.saved_analysis` with a unique probe `name` and a `jsonb` `payload` round-trips by id with `name` and `payload` equal under `IS NOT DISTINCT FROM`, then is deleted to leave table state unchanged — gate #3 exits `0` (its DO block does not raise; the cleanup `DELETE` removes the probe row).
- [ ] `web/scripts/tests/saved-analyses.test.mjs` exists and passes under `bash scripts/loop/test_grading_gate.sh` with these assertions:
  - **G1**: `web/src/app/api/saved-analyses/route.ts` exists, contains `export const dynamic = "force-dynamic"`, exports both `GET` and `POST` (`/export\s+async\s+function\s+GET\b/` and `/export\s+async\s+function\s+POST\b/`), references each of these literal substrings — `core.saved_analysis`, `INSERT INTO core.saved_analysis`, `SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis`, `WHERE id = $1`, `ORDER BY created_at DESC`, `RETURNING id, name, payload, created_at, updated_at` — and does NOT contain the placeholder substring `Saved analyses persistence is not wired yet.` (the test asserts the stub message is gone, proving the route was rewired and not just appended to).
  - **G2**: `web/src/app/saved-analyses/SavedAnalysesList.tsx` exists, matches `/export\s+default\s+function\b/`, and contains literal substrings `data-testid="saved-analysis-row"`, `data-testid="saved-analysis-empty"`, `id`, `name`, and `created_at`.
  - **G3**: `web/src/app/saved-analyses/page.tsx` (a) imports `SavedAnalysesList` via `/import\s+SavedAnalysesList\s+from\s+["']\.\/SavedAnalysesList["']/`, (b) declares `export const dynamic = "force-dynamic"` (literal substring), (c) calls `query(` somewhere in the file body and references the literal substring `FROM core.saved_analysis`, (d) contains a `<SavedAnalysesList rows={<binding>}` JSX element from which `<binding>` is extracted via `/<SavedAnalysesList\s+rows=\{(\w+)\}/`, and (e) `<binding>` matches the `<name>` in some `const <name>\s*=\s*await\s+query\(` declaration in the same file (i.e. the JSX rows prop is bound to the awaited query result, by name).
  - **G4**: `sql/021_saved_analysis.sql` exists and contains the literal substrings `CREATE TABLE IF NOT EXISTS core.saved_analysis`, `id BIGSERIAL PRIMARY KEY`, `name TEXT NOT NULL`, `payload JSONB NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, and `CREATE INDEX IF NOT EXISTS saved_analysis_created_at_idx ON core.saved_analysis (created_at DESC)`. The file is wrapped in `BEGIN;` … `COMMIT;`.
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
(filled by Claude)

## Audit verdict
(filled by Codex)

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
