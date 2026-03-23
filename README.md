# OpenF1 Local Postgres Project

This project sets up a production-minded local PostgreSQL ingestion workflow for OpenF1 CSV data, designed to migrate cleanly to Supabase later.

## 1) Proposed Folder Structure

```text
openf1/
  docker-compose.yml
  .env.example
  requirements.txt
  README.md
  sql/
    001_create_schemas.sql
    002_create_tables.sql
    003_indexes.sql
    004_constraints.sql
    005_helper_tables.sql
    006_semantic_lap_layer.sql
  scripts/
    init_db.sh
    load_codex_helpers.sh
  src/
    __init__.py
    db.py
    mappings.py
    file_discovery.py
    ingest.py
  data/
    ... your downloaded OpenF1 CSVs ...
```

## 2) Proposed Schema Design

### Why `raw + core`

- `raw` holds ingestion-ready OpenF1 tables with recognizable source fields.
- `core` exposes app-friendly views/dimensions (`core.sessions`, `core.session_drivers`, `core.driver_dim`) for analytics/app queries.
- `core` also includes helper lookup tables/views for resolver reliability (`core.session_search_lookup`, `core.driver_identity_lookup`, `core.session_completeness`).
- `core` now includes semantic lap/replay contracts (`core.lap_semantic_bridge`, `core.laps_enriched`, `core.replay_lap_frames`) plus policy/registry tables (`core.valid_lap_policy`, `core.compound_alias_lookup`, `core.metric_registry`).
- This mirrors common Supabase patterns and supports gradual transformation.

### Main entities

- `raw.meetings` -> one-to-many -> `raw.sessions`
- `raw.sessions` -> one-to-many -> event/telemetry tables
- `raw.drivers` is session-scoped OpenF1 driver participation
- `core.driver_dim` is deduped reusable driver view
- `core.session_search_lookup` is an alias-aware surface for session/entity resolution
- `core.driver_identity_lookup` normalizes driver aliases and canonical identity fields
- `core.session_completeness` provides session-level table coverage and row-count snapshots

### Included tables

- `meetings`, `sessions`, `drivers`
- `laps`, `car_data`, `location`, `intervals`, `position_history`
- `pit`, `stints`, `team_radio`, `race_control`, `weather`
- `session_result`, `starting_grid`, `overtakes`
- `championship_drivers`, `championship_teams`
- ingestion audit tables: `ingestion_runs`, `ingestion_files`

## 3) Key Assumptions

- CSV files are OpenF1-like and can include chunked/per-driver telemetry files.
- Timestamps are loaded into `TIMESTAMPTZ` and normalized in UTC by ingestion.
- Some files may be empty or missing columns; ingestion handles this gracefully.
- High-volume telemetry is loaded in chunks (`pandas` chunk reader + `COPY` into temp table + `INSERT/UPSERT`).

## 4) Primary Keys / Unique Constraints

### Primary keys

- `raw.meetings`: `meeting_key`
- `raw.sessions`: `session_key`
- Other tables: surrogate `id BIGSERIAL`

### Unique indexes for idempotent upsert

- `drivers`: `(session_key, driver_number)`
- `laps`: `(session_key, driver_number, lap_number)`
- `stints`: `(session_key, driver_number, stint_number)`
- `starting_grid`: `(session_key, driver_number)`
- `session_result`: `(session_key, driver_number)`
- `championship_drivers`: `(session_key, driver_number)`
- `championship_teams`: `(session_key, team_name)`
- `car_data`: `(session_key, driver_number, date)`
- `location`: `(session_key, driver_number, date)`
- `intervals`: `(session_key, driver_number, date)`
- `position_history`: `(session_key, driver_number, date)`
- `weather`: `(session_key, date)`
- `pit`: `(session_key, driver_number, lap_number, date)`
- `team_radio`: `(session_key, driver_number, date, recording_url)`
- `race_control`: `(session_key, date, category, driver_number, message)`
- `overtakes`: `(session_key, date, overtaker_driver_number, overtaken_driver_number)`

## 5) Ingestion Strategy

- Discover files recursively under `data/`.
- Map filename/prefix to destination table.
- Load in dependency order (dimensions first, then facts/events, then telemetry).
- For each CSV chunk:
  - normalize column names
  - inject `session_key`/`meeting_key` from path if missing
  - add `source_file`
  - timestamp normalization to UTC ISO
  - bulk `COPY` chunk into temp table
  - `INSERT ... ON CONFLICT DO UPDATE` (upsert mode) or straight insert (reload mode)
- Logs per-file status and row counts into `raw.ingestion_files`.

## Local Setup

### 1. Copy environment template

```bash
cd openf1
cp .env.example .env
```

### 2. Start Postgres (Docker)

```bash
docker compose up -d
```

### 3. Create schema/tables/indexes/views

```bash
./scripts/init_db.sh
```

If `f1_codex_helpers/` exists, `init_db.sh` also loads helper alias seeds automatically.

You can reload helper seeds manually at any time:

```bash
./scripts/load_codex_helpers.sh
```

### 4. Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 5. Run ingestion

Reload mode (truncate + reload):

```bash
python -m src.ingest --data-dir ./data --mode reload
```

Upsert mode (safe reruns):

```bash
python -m src.ingest --data-dir ./data --mode upsert
```

Optional chunk tuning:

```bash
python -m src.ingest --data-dir ./data --mode upsert --chunk-size 200000
```

## Useful Validation Queries

```sql
-- Count sessions
SELECT COUNT(*) FROM raw.sessions;

-- Count laps for one session
SELECT session_key, COUNT(*)
FROM raw.laps
WHERE session_key = 9839
GROUP BY session_key;

-- Count telemetry rows for one driver in one session
SELECT COUNT(*)
FROM raw.car_data
WHERE session_key = 9839 AND driver_number = 55;

-- Join sessions to meetings
SELECT s.session_key, s.session_name, m.meeting_name, m.country_name
FROM core.sessions s
LEFT JOIN core.meetings m USING (meeting_key)
ORDER BY s.date_start DESC
LIMIT 25;

-- Join laps to drivers
SELECT l.session_key, l.driver_number, d.full_name, COUNT(*) AS lap_rows
FROM raw.laps l
LEFT JOIN raw.drivers d
  ON d.session_key = l.session_key
 AND d.driver_number = l.driver_number
GROUP BY l.session_key, l.driver_number, d.full_name
ORDER BY l.session_key DESC, l.driver_number;
```

## Supabase Migration Notes

- SQL uses Postgres-compatible constructs supported by Supabase.
- `raw + core` separation is ready for migration.
- You can move `core` views into Supabase migrations directly.
- Future improvement: partition `raw.car_data` and `raw.location` by season/session for very large volumes.

## Recommended Local DB Defaults

- Database: `openf1`
- User: `openf1`
- Password: `openf1_local_dev`
