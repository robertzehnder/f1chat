# Phase 13 Neon backfill runbook — 2026-05-02

This is the user-driven step that loads the Phase 13 data into the
production Neon warehouse. The agent has prepared everything in code
and validated it locally (against the empty docker DB at port 5433).
The actual API pulls + writes against Neon need your credentials and
take a few hours of API time, so they need to run from your shell.

## Prerequisites

You need a shell that has the Neon connection variables exported. The
running web dev server has them in its process env; the simplest path
is to launch a new shell with the same env source the dev server uses.

```bash
# In a shell with NEON_DB_HOST/PORT/USER/PASSWORD/NAME exported,
# or equivalently DATABASE_URL pointing at the Neon pooler.
# scripts/ingest.mjs reads DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
# (NOT NEON_*), so map them across:
export DB_HOST="$NEON_DB_HOST"
export DB_PORT="${NEON_DB_PORT:-5432}"
export DB_NAME="$NEON_DB_NAME"
export DB_USER="$NEON_DB_USER"
export DB_PASSWORD="$NEON_DB_PASSWORD"

# Confirm connection.
psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER" \
  -c "SELECT current_database(), inet_server_addr();"
```

## Step 1 — Apply the Phase 13 sqitch migrations

The two new migrations (022 + 023) need to be deployed before the
data backfill, because the session_result loader writes to columns
that 022 adds, and 023 reads from session_result rows that the
loader produces.

```bash
sqitch --chdir sql/migrations deploy \
  "db:pg://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
sqitch --chdir sql/migrations verify \
  "db:pg://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
```

Expected output: `+ 022_session_result_extend_columns ok`,
`+ 023_starting_grid_derivation ok`. The 023 deploy will be a no-op
(no rows in `raw.session_result` yet); the actual rows land after
Step 3 below, then a second 023 run via Step 4 fills `raw.starting_grid`.

## Step 2 — Backfill `raw.meetings`

Years 2023, 2024, 2025, 2026 (2026 has the schedule loaded; the
calendar rows are useful even before the events happen).

```bash
node scripts/ingest.mjs meetings --years 2023,2024,2025,2026
```

Expected:
- ~24 rows per year (24 GPs + occasional pre-season testing rows)
- 100 rows total ± some (cancelled events / off-by-one entries)
- The CLI logs `csv=... COPY <N>` for each year

Verify:
```sql
SELECT year, count(*) FROM raw.meetings GROUP BY year ORDER BY year;
SELECT count(*) FROM core.sessions WHERE year = 2025 AND meeting_name IS NULL;
-- Expect 0 after this step
```

## Step 3 — Backfill `raw.session_result`

This is the big one — one API call per session_key, ~15 calls per
weekend × 24 weekends × 4 years ≈ 1500 calls. At 3 RPS (the default
rate limit) that's ~8 minutes of API wall-clock per year. Run one
year at a time so you can checkpoint:

```bash
node scripts/ingest.mjs session_result --years 2025
node scripts/ingest.mjs session_result --years 2024
node scripts/ingest.mjs session_result --years 2023
node scripts/ingest.mjs session_result --years 2026   # schedule-only; most calls return empty
```

Expected per race weekend:
- Race: 19-20 result rows
- Qualifying: 19-20 rows
- Sprint Qualifying / Sprint Shootout (sprint weekends only): 19-20 rows
- Sprint (sprint weekends only): 19-20 rows
- Practice 1/2/3: typically empty (no result rows for practice)

Verify:
```sql
SELECT s.year, s.session_type, count(sr.*) AS result_rows,
       count(DISTINCT sr.session_key) AS sessions_with_results
FROM core.sessions s
LEFT JOIN raw.session_result sr ON sr.session_key = s.session_key
WHERE s.year BETWEEN 2023 AND 2025
GROUP BY s.year, s.session_type
ORDER BY s.year DESC, s.session_type;

-- Spot check: who won 2025 Monaco?
SELECT sr.driver_number, sr.position, sr.points, sr.duration, sr.gap_to_leader
FROM core.sessions s
JOIN raw.session_result sr ON sr.session_key = s.session_key
WHERE s.year = 2025 AND s.session_type = 'Race'
  AND s.location = 'Monaco'
ORDER BY sr.position
LIMIT 5;
```

## Step 4 — Re-run the starting_grid derivation

Now that `raw.session_result` has rows for the qualifying sessions,
`raw.starting_grid` can be derived. The 023 deploy was already run
in Step 1 (a no-op then); re-run it now to actually populate the
table. Sqitch handles this idempotently by re-deploying the same
change. Easiest way: revert to HEAD^ and redeploy:

```bash
TARGET="db:pg://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
sqitch --chdir sql/migrations revert -y --to @HEAD^ "$TARGET"
sqitch --chdir sql/migrations deploy "$TARGET"
sqitch --chdir sql/migrations verify "$TARGET"
```

Or alternatively, run the deploy SQL directly (the INSERT is
idempotent via ON CONFLICT DO NOTHING):

```bash
psql "$TARGET" -f sql/migrations/deploy/023_starting_grid_derivation.sql
```

Verify:
```sql
SELECT s.year, count(sg.*) AS grid_rows,
       count(DISTINCT sg.session_key) AS sessions_with_grid
FROM core.sessions s
LEFT JOIN raw.starting_grid sg ON sg.session_key = s.session_key
WHERE s.year BETWEEN 2023 AND 2025
  AND s.session_type IN ('Race', 'Sprint')
GROUP BY s.year
ORDER BY s.year DESC;

-- Spot check: who was on pole at 2025 Monaco?
SELECT sg.driver_number, sg.grid_position
FROM core.sessions s
JOIN raw.starting_grid sg ON sg.session_key = s.session_key
WHERE s.year = 2025 AND s.session_type = 'Race'
  AND s.location = 'Monaco'
ORDER BY sg.grid_position
LIMIT 5;
```

## Step 5 — Refresh dependent matviews

`core_build.grid_vs_finish` is a regular view, not a matview, so
nothing to refresh there. But the `core.*_mat` materialized-shape
tables (despite being plain tables — see Phase 12 slice's
plan-correction note) are populated by the build pipeline, NOT the
sqitch migrations. If your data-build pipeline is what populates
them, run it now to refresh the derived contracts that depend on
session_result / starting_grid.

If you don't have a separate build step, the chat path will read
`raw.session_result` and `raw.starting_grid` directly via the views,
which is fine — the matview-shaped tables are an optimization, not
a correctness requirement for these specific contracts.

## Step 6 — Sanity check via the chat path

Start the dev server (it's likely already running on port 3000) and
hit the chat with a few smoke questions:

```bash
# in another shell, with the dev server's env
curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Who won the 2025 Monaco Grand Prix?"}' | jq .answer

curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Who was on pole at the 2025 Italian Grand Prix?"}' | jq .answer

curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "What was the gap between Verstappen and Leclerc at the end of the 2025 Australian Grand Prix?"}' | jq .answer
```

Each should return an answer that cites the actual race data. The
third question requires the `gap_to_leader` column added in
migration 022.

## Step 7 — Re-run the variant benchmark

The full 2026-05-01 variant benchmark with the new data should show
a meaningful improvement on the C-rate. Compare:

```bash
# Before: 15A / 3B / 32C on the variant suite (per cold-bench run)
# After:  expected ≥ 30A on the variant suite (Phase 13 backfill alone)

cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000 \
  OPENF1_CHAT_DEBUG_TRACE=1 \
  npm run healthcheck:chat -- --questions scripts/chat-health-check.questions.variant_2026-05-01.json
```

The headline number to watch:
- `factual_correctness A/B/C` — Phase 13 should lift this materially
  (especially for "who won X" / "who finished where" / "pole at Y"
  type questions)
- `unknown` generationSource rate — this stays high until Phase 14
  (alias resolver) lands

## Rollback

Each step is independently reversible:

- Step 1 (migrations): `sqitch revert --to @HEAD^^ "$TARGET"` (twice
  to undo 023 then 022)
- Step 2 (meetings): `DELETE FROM raw.meetings WHERE year IN (2023, 2024, 2025, 2026);`
- Step 3 (session_result): `DELETE FROM raw.session_result WHERE
  session_key IN (SELECT session_key FROM raw.sessions WHERE year IN
  (2023, 2024, 2025, 2026));`
- Step 4 (starting_grid): the partial-unique index restricts the
  derived rows; revert with `DELETE FROM raw.starting_grid WHERE
  source_file = 'derived_from_qualifying_session_result';`

## Estimated wall-clock

- Step 1: <30s
- Step 2: ~30s
- Step 3: ~30 min total across the 4 years (rate-limited)
- Step 4: <30s
- Step 5: depends on your data-build pipeline (likely 5-15 min)
- Step 6: <1 min
- Step 7: ~10 min for the full variant suite

Total: roughly 1-1.5 hours of clock time, ~5 minutes of attention.
