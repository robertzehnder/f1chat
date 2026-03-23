"""CSV ingestion CLI for OpenF1 raw tables."""

from __future__ import annotations

import argparse
import io
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2 import sql

from .db import fetch_table_columns, get_connection
from .file_discovery import DiscoveredFile, discover_files
from .mappings import LOAD_ORDER, TABLE_SPECS


def normalize_column(col: str) -> str:
    return col.strip().lower().replace(" ", "_").replace("-", "_")


def to_utc_iso(series: pd.Series) -> pd.Series:
    dt = pd.to_datetime(series, utc=True, errors="coerce")
    # Keep sub-second precision so telemetry keys do not collapse to second-level granularity.
    return dt.dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def append_error_log(
    error_log_path: Path,
    *,
    run_id: str,
    table: str,
    source_file: str,
    error: str,
    mode: str,
) -> None:
    error_log_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp_utc": utc_now_iso(),
        "run_id": run_id,
        "table": table,
        "source_file": source_file,
        "mode": mode,
        "error": error,
    }
    with error_log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=True) + "\n")


def table_columns_cache(conn: psycopg2.extensions.connection) -> dict[str, list[str]]:
    return {table: fetch_table_columns(conn, "raw", table) for table in TABLE_SPECS.keys()}


def start_run(cur: psycopg2.extensions.cursor, mode: str, data_dir: str) -> str:
    run_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO raw.ingestion_runs (run_id, mode, data_dir, status)
        VALUES (%s, %s, %s, 'running')
        """,
        (run_id, mode, data_dir),
    )
    return run_id


def finish_run(cur: psycopg2.extensions.cursor, run_id: str, status: str, notes: str | None = None) -> None:
    cur.execute(
        """
        UPDATE raw.ingestion_runs
        SET finished_at = NOW(), status = %s, notes = %s
        WHERE run_id = %s
        """,
        (status, notes, run_id),
    )


def log_file_status(
    cur: psycopg2.extensions.cursor,
    run_id: str,
    table: str,
    source_file: str,
    rows_loaded: int,
    status: str,
    error_message: str | None = None,
) -> None:
    cur.execute(
        """
        INSERT INTO raw.ingestion_files (run_id, table_name, source_file, rows_loaded, status, error_message)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (run_id, table, source_file, rows_loaded, status, error_message),
    )


def truncate_tables(cur: psycopg2.extensions.cursor) -> None:
    for table in reversed(LOAD_ORDER):
        cur.execute(sql.SQL("TRUNCATE TABLE raw.{} CASCADE").format(sql.Identifier(table)))


def copy_dataframe_to_temp(
    cur: psycopg2.extensions.cursor,
    temp_table: str,
    columns: list[str],
    df: pd.DataFrame,
) -> None:
    out = io.StringIO()
    df.to_csv(out, index=False, header=False, na_rep="")
    out.seek(0)

    copy_stmt = sql.SQL("COPY {} ({}) FROM STDIN WITH (FORMAT CSV, NULL '')").format(
        sql.Identifier(temp_table),
        sql.SQL(", ").join(sql.Identifier(c) for c in columns),
    )
    cur.copy_expert(copy_stmt.as_string(cur), out)


def upsert_temp_into_target(
    cur: psycopg2.extensions.cursor,
    table: str,
    columns: list[str],
    conflict_columns: tuple[str, ...],
) -> None:
    if table == "sessions" and "meeting_key" in columns:
        # Ensure parent meeting rows exist so sessions FK can load even if no meetings.csv file exists.
        cur.execute(
            """
            INSERT INTO raw.meetings (
                meeting_key,
                year,
                country_name,
                location,
                circuit_short_name,
                source_file
            )
            SELECT DISTINCT
                meeting_key,
                year,
                country_name,
                location,
                circuit_short_name,
                source_file
            FROM _tmp_ingest
            WHERE meeting_key IS NOT NULL
            ON CONFLICT (meeting_key) DO UPDATE
            SET
                year = COALESCE(EXCLUDED.year, raw.meetings.year),
                country_name = COALESCE(EXCLUDED.country_name, raw.meetings.country_name),
                location = COALESCE(EXCLUDED.location, raw.meetings.location),
                circuit_short_name = COALESCE(EXCLUDED.circuit_short_name, raw.meetings.circuit_short_name),
                source_file = COALESCE(EXCLUDED.source_file, raw.meetings.source_file)
            """
        )

    insert_cols = sql.SQL(", ").join(sql.Identifier(c) for c in columns)
    select_cols = sql.SQL(", ").join(sql.Identifier(c) for c in columns)

    valid_conflicts = tuple(c for c in conflict_columns if c in columns)
    update_cols = [c for c in columns if c not in valid_conflicts and c not in ("id",)]

    if valid_conflicts:
        conflict_sql = sql.SQL(", ").join(sql.Identifier(c) for c in valid_conflicts)
        if update_cols:
            set_sql = sql.SQL(", ").join(
                sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c)) for c in update_cols
            )
            stmt = sql.SQL(
                """
                INSERT INTO raw.{table} ({insert_cols})
                SELECT {select_cols} FROM _tmp_ingest
                ON CONFLICT ({conflict_cols}) DO UPDATE SET {set_sql}
                """
            ).format(
                table=sql.Identifier(table),
                insert_cols=insert_cols,
                select_cols=select_cols,
                conflict_cols=conflict_sql,
                set_sql=set_sql,
            )
        else:
            stmt = sql.SQL(
                """
                INSERT INTO raw.{table} ({insert_cols})
                SELECT {select_cols} FROM _tmp_ingest
                ON CONFLICT ({conflict_cols}) DO NOTHING
                """
            ).format(
                table=sql.Identifier(table),
                insert_cols=insert_cols,
                select_cols=select_cols,
                conflict_cols=conflict_sql,
            )
    else:
        stmt = sql.SQL(
            """
            INSERT INTO raw.{table} ({insert_cols})
            SELECT {select_cols} FROM _tmp_ingest
            """
        ).format(
            table=sql.Identifier(table),
            insert_cols=insert_cols,
            select_cols=select_cols,
        )

    cur.execute(stmt)


def prepare_dataframe(
    file: DiscoveredFile,
    chunk: pd.DataFrame,
    target_columns: list[str],
    timestamp_columns: tuple[str, ...],
) -> pd.DataFrame:
    chunk = chunk.rename(columns={c: normalize_column(c) for c in chunk.columns})

    if "session_key" in target_columns and "session_key" not in chunk.columns and file.session_key is not None:
        chunk["session_key"] = file.session_key

    if "meeting_key" in target_columns and "meeting_key" not in chunk.columns and file.meeting_key is not None:
        chunk["meeting_key"] = file.meeting_key

    if "source_file" in target_columns:
        chunk["source_file"] = str(file.path)

    for col in timestamp_columns:
        if col in chunk.columns:
            chunk[col] = to_utc_iso(chunk[col])

    common_cols = [c for c in target_columns if c in chunk.columns and c != "id"]
    if not common_cols:
        return pd.DataFrame()

    return chunk[common_cols].replace({pd.NA: None})


def ingest_file(
    conn: psycopg2.extensions.connection,
    file: DiscoveredFile,
    mode: str,
    chunk_size: int,
    column_cache: dict[str, list[str]],
) -> int:
    table = file.table
    spec = TABLE_SPECS[table]
    target_columns = column_cache[table]

    total_rows = 0
    reader = pd.read_csv(
        file.path,
        dtype=str,
        chunksize=chunk_size,
        keep_default_na=False,
        na_values=["", "NULL", "null", "NaN", "nan"],
    )

    with conn.cursor() as cur:
        for chunk in reader:
            prepared = prepare_dataframe(file, chunk, target_columns, spec.timestamp_columns)
            if prepared.empty:
                continue

            if mode == "upsert":
                valid_conflicts = [c for c in spec.conflict_columns if c in prepared.columns]
                if valid_conflicts:
                    # Prevent "ON CONFLICT ... cannot affect row a second time" when a CSV chunk
                    # contains duplicate logical keys.
                    prepared = prepared.drop_duplicates(subset=valid_conflicts, keep="last")
                    if prepared.empty:
                        continue

            cur.execute("DROP TABLE IF EXISTS _tmp_ingest")
            cur.execute(sql.SQL("CREATE TEMP TABLE _tmp_ingest (LIKE raw.{} INCLUDING DEFAULTS)").format(sql.Identifier(table)))

            cols = prepared.columns.tolist()
            copy_dataframe_to_temp(cur, "_tmp_ingest", cols, prepared)

            if mode == "upsert":
                upsert_temp_into_target(cur, table, cols, spec.conflict_columns)
            else:
                insert_cols = sql.SQL(", ").join(sql.Identifier(c) for c in cols)
                stmt = sql.SQL(
                    "INSERT INTO raw.{table} ({cols}) SELECT {cols} FROM _tmp_ingest"
                ).format(table=sql.Identifier(table), cols=insert_cols)
                cur.execute(stmt)

            total_rows += len(prepared)

    return total_rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest OpenF1 CSV data into local Postgres")
    parser.add_argument("--data-dir", default=os.getenv("OPENF1_DATA_DIR", "./data"))
    parser.add_argument("--mode", choices=["reload", "upsert"], default=os.getenv("OPENF1_INGEST_MODE", "upsert"))
    parser.add_argument("--chunk-size", type=int, default=int(os.getenv("OPENF1_CHUNK_SIZE", "100000")))
    parser.add_argument(
        "--error-log",
        default=os.getenv("OPENF1_ERROR_LOG", "./logs/ingest_errors.jsonl"),
        help="Path to structured JSONL ingestion error log.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    error_log_path = Path(args.error_log)
    files = discover_files(Path(args.data_dir))
    if not files:
        print(f"No discoverable CSV files found in {args.data_dir}")
        return

    print(f"Discovered {len(files)} CSV files")

    with get_connection() as conn:
        with conn.cursor() as cur:
            run_id = start_run(cur, args.mode, str(Path(args.data_dir).resolve()))
        conn.commit()

        try:
            if args.mode == "reload":
                with conn.cursor() as cur:
                    truncate_tables(cur)
                conn.commit()

            column_cache = table_columns_cache(conn)

            for file in files:
                try:
                    rows = ingest_file(conn, file, args.mode, args.chunk_size, column_cache)
                    with conn.cursor() as cur:
                        log_file_status(cur, run_id, file.table, str(file.path), rows, "success")
                    conn.commit()
                    print(f"[{file.table}] loaded {rows} rows from {file.path}")
                except pd.errors.EmptyDataError:
                    conn.rollback()
                    with conn.cursor() as cur:
                        log_file_status(cur, run_id, file.table, str(file.path), 0, "empty")
                    conn.commit()
                    print(f"[{file.table}] empty file skipped: {file.path}")
                except Exception as exc:
                    conn.rollback()
                    append_error_log(
                        error_log_path,
                        run_id=run_id,
                        table=file.table,
                        source_file=str(file.path),
                        error=str(exc),
                        mode=args.mode,
                    )
                    with conn.cursor() as cur:
                        log_file_status(cur, run_id, file.table, str(file.path), 0, "failed", str(exc))
                    conn.commit()
                    print(f"[{file.table}] failed: {file.path} :: {exc}")

            with conn.cursor() as cur:
                finish_run(cur, run_id, "completed")
            conn.commit()
            print(f"Run complete: {run_id}")
        except Exception as exc:
            conn.rollback()
            append_error_log(
                error_log_path,
                run_id=run_id,
                table="__run__",
                source_file=str(Path(args.data_dir).resolve()),
                error=str(exc),
                mode=args.mode,
            )
            with conn.cursor() as cur:
                finish_run(cur, run_id, "failed", notes=str(exc))
            conn.commit()
            raise


if __name__ == "__main__":
    main()
