# FastF1 vs OpenF1 Audit Workflow

This project is a practical, repeatable source-comparison workflow for your app.

It keeps FastF1 and OpenF1 isolated while answering:
- where OpenF1 is already strong enough
- where FastF1 is better
- where supplementation is useful
- which semantic layers should remain OpenF1-only vs benefit from FastF1 enrichment

## Toolkit Assessment

### What was already implemented
- a starter FastF1 extraction script
- a starter FastF1 raw schema
- basic FastF1 vs OpenF1 comparison CSV outputs
- optional telemetry extraction

### What was missing (now added)
- resumable extraction run logging
- extraction run/session audit tables
- robust session mapping between sources
- theme-based test rows in a standard report shape
- theme summary scores and winner/recommended action
- benchmark-family rollups tied to your question families
- use-case source recommendation summary
- shell scripts for repeatable local run order

## Recommended Folder Structure

```text
fastf1_audit/
  .env.example
  README.md
  requirements.txt
  config/
    benchmark_family_map.csv
    theme_tests.yaml
  sql/
    001_create_fastf1_schema.sql
    002_create_fastf1_views.sql
  scripts/
    init_fastf1_db.sh
    extract_fastf1.sh
    run_comparison.sh
    export_reports.sh
    run_full_audit.sh
  src/
    __init__.py
    db.py
    logging_utils.py
    normalization.py
    metric_catalog.py
    extract_fastf1.py
    compare_fastf1_openf1.py
  reports/
  exports/
  logs/
```

## Isolation Model

- OpenF1 warehouse: separate DB connection (`OPENF1_*`)
- FastF1 audit warehouse: separate DB connection (`FASTF1_*`)
- No writes are performed to your OpenF1 database

## Setup

### 1. Create venv and install

```bash
cd /Users/robertzehnder/Documents/coding/f1/openf1/fastf1_audit
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Set `FASTF1_*` to your dedicated FastF1 audit DB and `OPENF1_*` to your existing OpenF1 DB.

### 3. Initialize FastF1 schema

```bash
./scripts/init_fastf1_db.sh
```

## Recommended Local Run Order

Race-first, telemetry-off baseline:

```bash
# Uses AUDIT_YEARS=2023,2024,2025 and AUDIT_SESSION_TYPES=Race by default
./scripts/extract_fastf1.sh
./scripts/run_comparison.sh
./scripts/export_reports.sh
```

Single command variant:

```bash
./scripts/run_full_audit.sh
```

This gives you a first-pass decision framework quickly, then you can expand.

## Extraction Behavior

`src.extract_fastf1` now supports:
- years: `2023,2024,2025` (default from `.env`)
- session types: `Race` default
- telemetry optional (`INCLUDE_TELEMETRY=false` default)
- telemetry mode:
  - `fastest-lap-only` (default)
  - `all-loaded-laps`
- resume mode (`RESUME_MODE=true` default)
- max sessions for smoke tests (`MAX_SESSIONS`)

Extraction run metadata is written to:
- `fastf1_core.extraction_runs`
- `fastf1_core.extraction_session_log`

## Comparison Themes

The comparison pipeline emits test rows and summaries for:
1. session coverage
2. session naming quality
3. driver roster coverage
4. driver-team mapping
5. lap timing quality
6. sector timing quality
7. pit and stint quality
8. result / finishing-order quality
9. starting grid quality
10. telemetry usefulness
11. weather coverage
12. race progression quality
13. strategy analysis usefulness

## Source Comparison Output Design

Primary row-level output (`reports/source_comparison_tests.csv` and `.json`) columns:
- `theme`
- `test_name`
- `year`
- `session_key_or_equivalent` (`openf1_session_key|fastf1_session_uid` when mapped)
- `event_name`
- `session_type`
- `openf1_result`
- `fastf1_result`
- `match_status`
- `severity`
- `notes`
- `recommended_source`

Theme summary output (`reports/source_theme_summary.csv` and `.json`) columns:
- `theme`
- `openf1_score`
- `fastf1_score`
- `winner`
- `rationale`
- `recommended_action`

Benchmark-oriented output:
- `reports/benchmark_audit_summary.csv` and `.json`

Use-case source recommendations:
- `reports/source_recommendation_summary.csv` and `.json`

Markdown rollup:
- `reports/source_audit_report.md`

## Benchmark-Family Audit

The benchmark report uses:
- `BENCHMARK_RESULTS_JSON` (OpenF1 benchmark run output)
- `config/benchmark_family_map.csv`

It helps separate likely causes:
- logic/prompt/query-template issues
- source limitations (OpenF1 vs FastF1)
- mixed/unclear areas requiring deeper inspection

## Optional Expansion Pass (Telemetry)

After baseline race-only pass, expand incrementally:

```bash
# Example: telemetry-enabled rerun for same scope
# (edit .env first)
INCLUDE_TELEMETRY=true
TELEMETRY_MODE=fastest-lap-only
./scripts/extract_fastf1.sh
./scripts/run_comparison.sh
```

## Practical Guidance For Your App Decisions

Start with Race 2023-2025 and answer by theme:
- keep OpenF1 primary where scores are strong and stable
- supplement with FastF1 where theme winner is FastF1
- keep dual checks where score is tied/unclear

Then use `source_recommendation_summary.csv` for concrete use cases:
- session resolution
- clean-lap logic
- pace comparisons
- pit/strategy analysis
- result/final classification
- telemetry overlays

## Troubleshooting

- If extraction is interrupted, rerun with `RESUME_MODE=true`.
- If FastF1 cache issues appear, clear/recreate `FASTF1_CACHE_DIR`.
- If benchmark summary is empty, confirm `BENCHMARK_RESULTS_JSON` path.
- If you want a smaller smoke test, set `MAX_SESSIONS=10` in `.env`.
- If you see `FATAL: role "postgres" does not exist`, your `.env` is still using placeholder credentials. Update to your local Postgres user (for this repo typically `openf1` on port `5433`), then rerun `./scripts/init_fastf1_db.sh`.
- If SQLAlchemy import is slow or hangs on Python 3.13, keep `DISABLE_SQLALCHEMY_CEXT_RUNTIME=1` in `.env`.
