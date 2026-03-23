# FastF1 vs OpenF1 Audit Toolkit

This toolkit gives you a practical starting point to:

1. create a **separate Postgres database** for FastF1-derived data
2. extract **2023, 2024, and 2025** session data from FastF1
3. store it in a warehouse-friendly schema
4. compare FastF1 and your existing OpenF1 warehouse on overlap areas
5. produce repeatable audit reports so you can decide whether to:
   - keep OpenF1 as the main source
   - supplement with FastF1
   - or replace some subject areas with FastF1

## What this is optimized for

This project is optimized for **data-quality bakeoffs**, not for replacing your existing app.

The main use case is:
- warehouse OpenF1 separately
- warehouse FastF1 separately
- compare the two across the exact question families your app cares about

## Source coverage reality

FastF1 and OpenF1 do **not** have identical data models.

This toolkit therefore focuses on the overlap areas that matter most for your app:
- session metadata
- driver roster / team labels
- session results
- laps and lap timing
- weather
- fastest lap / pace / sector summaries
- basic telemetry export when requested

It intentionally treats some themes as optional or experimental:
- full-field telemetry for every session (very heavy)
- full position/track trace parity
- exact 1:1 status semantics

## Folder structure

- `requirements.txt` — Python dependencies
- `.env.example` — environment variables
- `sql/001_create_fastf1_schema.sql` — tables for the FastF1 audit warehouse
- `src/db.py` — DB helpers
- `src/extract_fastf1.py` — FastF1 extraction + load
- `src/compare_fastf1_openf1.py` — overlap comparison report generator
- `src/metric_catalog.py` — comparison themes and metric definitions
- `reports/` — output directory for generated CSV and Markdown reports

## Recommended database layout

Use two separate databases on the same local Postgres server:

- `openf1` — your existing warehouse
- `fastf1_audit` — the new FastF1 comparison warehouse

This avoids cross-contaminating your main schema while keeping the comparison workflow simple.

## Suggested setup

### 1. Create a venv and install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Copy environment file

```bash
cp .env.example .env
```

### 3. Create the FastF1 audit database

Example using `createdb`:

```bash
createdb fastf1_audit
psql fastf1_audit -f sql/001_create_fastf1_schema.sql
```

### 4. Enable FastF1 cache directory

FastF1 supports caching of API requests. Set a writable cache directory in `.env`.

### 5. Extract FastF1 data

Race-only, 2023–2025, no telemetry:

```bash
python -m src.extract_fastf1 \
  --years 2023 2024 2025 \
  --session-types Race \
  --include-telemetry false
```

If you want more sessions:

```bash
python -m src.extract_fastf1 \
  --years 2023 2024 2025 \
  --session-types Race Qualifying Sprint "Practice 1" "Practice 2" "Practice 3" \
  --include-telemetry false
```

If you want telemetry too, start small:

```bash
python -m src.extract_fastf1 \
  --years 2025 \
  --session-types Race \
  --include-telemetry true \
  --telemetry-mode fastest-lap-only
```

## Comparison workflow

Once your FastF1 warehouse is loaded and your OpenF1 warehouse already exists, run:

```bash
python -m src.compare_fastf1_openf1
```

This produces:
- `reports/source_audit_summary.csv`
- `reports/source_audit_summary.md`
- `reports/session_level_diffs.csv`
- `reports/driver_roster_diffs.csv`
- `reports/lap_metric_diffs.csv`

## What the comparison script checks

### Session-level
- session presence by year / event / session type
- date alignment
- naming differences

### Driver/session-level
- roster count
- driver number coverage
- team label differences

### Lap-level
- lap count by driver-session
- best lap
- average lap
- sector bests

### Result-level
- finishing position where available

### Weather-level
- weather row presence

## Recommended decision rule

After the comparison report runs, decide by theme:

- **Keep OpenF1** where overlap is strong and telemetry-first workflows matter most
- **Supplement with FastF1** where semantic richness or data hygiene is better
- **Replace a theme selectively** only if FastF1 clearly wins on correctness and consistency

A likely final architecture is:
- OpenF1 = raw operational warehouse + telemetry backbone
- FastF1 = enrichment and validation layer for lap/session semantics

## Important caveats

- FastF1 is a Python library, not a raw SQL-ready source, so extraction logic is part of your maintenance burden.
- Full telemetry extraction across 2023–2025 can become large quickly.
- Some fields in FastF1 and OpenF1 are conceptually similar but not identical.
- This toolkit is a starting point. You should validate exact table/column parity against your own app’s question families.
