"""Database utilities for OpenF1 local Postgres project."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from psycopg2.extensions import connection


def load_env() -> None:
    load_dotenv()


def get_db_dsn() -> str:
    load_env()
    url = (os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
    if url:
        return url

    neon_host = (os.getenv("NEON_DB_HOST") or "").strip()
    if neon_host:
        port = os.getenv("NEON_DB_PORT", "5432")
        dbname = os.getenv("NEON_DB_NAME", "neondb")
        user = os.getenv("NEON_DB_USER", "")
        password = os.getenv("NEON_DB_PASSWORD", "")
        sslmode = os.getenv("NEON_DB_SSLMODE", "")
        if not sslmode and "neon.tech" in neon_host.lower():
            sslmode = "require"
        ssl_part = f" sslmode={sslmode}" if sslmode else ""
        return (
            f"host={neon_host} port={port} dbname={dbname} user={user} password={password}{ssl_part}"
        )

    host = os.getenv("DB_HOST", "127.0.0.1")
    port = os.getenv("DB_PORT", "5432")
    dbname = os.getenv("DB_NAME", "openf1")
    user = os.getenv("DB_USER", "openf1")
    password = os.getenv("DB_PASSWORD", "openf1_local_dev")
    sslmode = os.getenv("DB_SSLMODE", "")
    if not sslmode and "neon.tech" in host.lower():
        sslmode = "require"
    ssl_part = f" sslmode={sslmode}" if sslmode else ""
    return (
        f"host={host} port={port} dbname={dbname} user={user} password={password}{ssl_part}"
    )


def get_connection() -> connection:
    conn = psycopg2.connect(get_db_dsn())
    conn.autocommit = False
    return conn


def apply_sql_files(sql_dir: str | Path) -> None:
    sql_dir = Path(sql_dir)
    files = sorted(p for p in sql_dir.glob("*.sql") if p.is_file())
    if not files:
        raise FileNotFoundError(f"No SQL files found in {sql_dir}")

    with get_connection() as conn:
        with conn.cursor() as cur:
            for sql_file in files:
                print(f"Applying {sql_file}")
                cur.execute(sql_file.read_text(encoding="utf-8"))
        conn.commit()


def fetch_table_columns(conn: connection, schema: str, table: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s
              AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, table),
        )
        return [r[0] for r in cur.fetchall()]
