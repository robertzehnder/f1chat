#!/usr/bin/env python3
"""
Phase 18-C: refresh core.session_completeness_data manually. Wraps a
single REFRESH MATERIALIZED VIEW CONCURRENTLY call with autocommit
(required — psycopg2 opens an implicit tx, and CONCURRENTLY refresh is
rejected inside one) and reports before/after row counts + elapsed ms.

Usage:
    python scripts/refresh_completeness_matview.py

Reads NEON_DB_* from <repo-root>/.env.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

try:
    import psycopg2
except ImportError:
    sys.stderr.write(
        "psycopg2 not installed. Activate your venv or run: pip install psycopg2-binary\n"
    )
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env"


def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def get_conn_kwargs(env: dict[str, str]) -> dict[str, Any]:
    def pick(key: str, default: str | None = None) -> str | None:
        return os.environ.get(key) or env.get(key) or default

    host = pick("NEON_DB_HOST")
    user = pick("NEON_DB_USER")
    pwd = pick("NEON_DB_PASSWORD")
    if not host or not user or pwd is None:
        sys.stderr.write("Missing NEON_DB_HOST / NEON_DB_USER / NEON_DB_PASSWORD\n")
        sys.exit(2)
    return {
        "host": host,
        "port": int(pick("NEON_DB_PORT", "5432") or "5432"),
        "dbname": pick("NEON_DB_NAME", "neondb"),
        "user": user,
        "password": pwd,
        "sslmode": "require",
        "application_name": "phase18_refresh_completeness_matview",
    }


def main() -> int:
    env = load_env_file(ENV_FILE)
    kwargs = get_conn_kwargs(env)
    print(f"Connecting to {kwargs['user']}@{kwargs['host']}:{kwargs['port']}/{kwargs['dbname']}")

    conn = psycopg2.connect(**kwargs)
    # Phase 18-C rev3: REFRESH MATERIALIZED VIEW CONCURRENTLY is rejected
    # inside a transaction block, and psycopg2 opens one by default. The
    # autocommit flag is required for the CONCURRENTLY form to land.
    conn.autocommit = True

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM core.session_completeness_data")
            (before_count,) = cur.fetchone()
        print(f"  before_count={before_count}")

        started = time.time()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY core.session_completeness_data"
                )
            elapsed_ms = int((time.time() - started) * 1000)
            print(f"  REFRESH CONCURRENTLY: {elapsed_ms} ms")
        except psycopg2.errors.ObjectNotInPrerequisiteState as exc:
            # Falls back if the matview was just created and never populated:
            # CONCURRENTLY refresh requires a prior non-concurrent populate.
            print(f"  CONCURRENTLY rejected ({exc}); falling back to non-concurrent REFRESH...")
            with conn.cursor() as cur:
                cur.execute("REFRESH MATERIALIZED VIEW core.session_completeness_data")
            elapsed_ms = int((time.time() - started) * 1000)
            print(f"  REFRESH (non-concurrent): {elapsed_ms} ms")

        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM core.session_completeness_data")
            (after_count,) = cur.fetchone()
        print(f"  after_count={after_count}  delta={after_count - before_count:+d}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
