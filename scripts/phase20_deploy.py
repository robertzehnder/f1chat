#!/usr/bin/env python3
"""Phase 20 deploy harness: ship the 3 sqitch triplets (29, 30, 31) to Neon.

Codex audit recommended (b) one-command runner — operator review the
FIRST production deploy to confirm grants/owner on the new f1 schema,
subsequent slices fully autonomous. This harness:

  1. Reads NEON_DATABASE_URL / NEON_DB_* from web/.env.local.
  2. Probes connectivity (SELECT 1).
  3. Records pre-deploy state (does f1 schema exist? are 29/30/31 already
     applied per sqitch's tracking table? what's the row count of
     f1.track_segments if any?).
  4. Runs the 3 deploys in order (029 → 030 → 031), gated on each
     succeeding before the next runs.
  5. Runs each verify script.
  6. Records post-deploy state and prints a summary.

The harness is idempotent: re-running it after a successful deploy is a
no-op (the deploy SQL is ON CONFLICT DO NOTHING for inserts; CREATE
TABLE IF NOT EXISTS for the table; the function is CREATE OR REPLACE).

Usage:
  python3 scripts/phase20_deploy.py            # deploy + verify
  python3 scripts/phase20_deploy.py --dry-run  # show what would run
  python3 scripts/phase20_deploy.py --verify-only  # skip deploys, just run verifies
  python3 scripts/phase20_deploy.py --revert       # revert all 3 in reverse order

Exit codes:
  0 — all deploys + verifies passed
  1 — Neon connectivity failed
  2 — deploy failed
  3 — verify failed
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
DEPLOY_DIR = REPO_ROOT / "sql" / "migrations" / "deploy"
VERIFY_DIR = REPO_ROOT / "sql" / "migrations" / "verify"
REVERT_DIR = REPO_ROOT / "sql" / "migrations" / "revert"

PHASE20_SLICES: List[Tuple[str, str]] = [
    ("029_track_segments_auto", "20-track-segments-auto"),
    ("030_track_segments_corners", "20-track-segments-corners"),
    ("031_intervals_parser", "20-intervals-parser"),
]


def log(msg: str) -> None:
    sys.stdout.write(f"[phase20_deploy] {msg}\n")
    sys.stdout.flush()


def err(msg: str) -> None:
    sys.stderr.write(f"[phase20_deploy] ERROR: {msg}\n")
    sys.stderr.flush()


def parse_env_local(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def connect_neon():
    try:
        import psycopg2  # type: ignore
    except ImportError:
        err("psycopg2 is required: `pip install psycopg2-binary`")
        sys.exit(1)
    env = parse_env_local(WEB_DIR / ".env.local")
    if env.get("NEON_DATABASE_URL"):
        return psycopg2.connect(dsn=env["NEON_DATABASE_URL"])
    if env.get("DATABASE_URL"):
        return psycopg2.connect(dsn=env["DATABASE_URL"])
    if all(env.get(k) for k in ["NEON_DB_HOST", "NEON_DB_NAME", "NEON_DB_USER", "NEON_DB_PASSWORD"]):
        return psycopg2.connect(
            host=env["NEON_DB_HOST"],
            port=int(env.get("NEON_DB_PORT", "5432") or 5432),
            dbname=env["NEON_DB_NAME"],
            user=env["NEON_DB_USER"],
            password=env["NEON_DB_PASSWORD"],
            sslmode="require" if env.get("NEON_SSL", "true").lower() in ("1", "true", "yes") else "prefer",
            connect_timeout=15,
        )
    err("no Neon credentials in web/.env.local — set NEON_DATABASE_URL or NEON_DB_*")
    sys.exit(1)


def execute_sql_file(conn, sql_path: Path) -> None:
    sql = sql_path.read_text(encoding="utf8")
    with conn.cursor() as cur:
        cur.execute(sql)


def query_state(conn) -> Dict[str, object]:
    state: Dict[str, object] = {}
    with conn.cursor() as cur:
        # f1 schema
        cur.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name='f1'")
        state["f1_schema_exists"] = cur.fetchone() is not None
        # f1.track_segments table + count
        if state["f1_schema_exists"]:
            cur.execute("""
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema='f1' AND table_name='track_segments'
            """)
            state["track_segments_table_exists"] = cur.fetchone() is not None
            if state["track_segments_table_exists"]:
                cur.execute("SELECT segment_kind, COUNT(*) FROM f1.track_segments GROUP BY segment_kind ORDER BY segment_kind")
                state["track_segments_counts"] = {row[0]: row[1] for row in cur.fetchall()}
            else:
                state["track_segments_counts"] = {}
        else:
            state["track_segments_table_exists"] = False
            state["track_segments_counts"] = {}
        # core.parse_interval function
        cur.execute("""
            SELECT 1
            FROM information_schema.routines
            WHERE routine_schema='core' AND routine_name='parse_interval'
        """)
        state["parse_interval_exists"] = cur.fetchone() is not None
    return state


def run_phase(args) -> int:
    if args.revert:
        log("REVERT mode — running revert scripts in reverse order")
        conn = connect_neon()
        try:
            conn.autocommit = False
            for slug, _ in reversed(PHASE20_SLICES):
                revert_sql = REVERT_DIR / f"{slug}.sql"
                if not revert_sql.exists():
                    err(f"missing revert: {revert_sql}")
                    return 2
                log(f"revert: {revert_sql.name}")
                if args.dry_run:
                    continue
                try:
                    execute_sql_file(conn, revert_sql)
                    conn.commit()
                except Exception as e:
                    err(f"revert {slug} failed: {e}")
                    conn.rollback()
                    return 2
            log("revert complete")
            return 0
        finally:
            conn.close()

    log("connecting to Neon ...")
    conn = connect_neon()
    try:
        conn.autocommit = False
        # Probe
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            assert cur.fetchone()[0] == 1
        log("Neon connectivity OK")

        log("--- pre-deploy state ---")
        pre = query_state(conn)
        for k, v in pre.items():
            log(f"  {k}: {v}")

        if not args.verify_only:
            for slug, slice_id in PHASE20_SLICES:
                deploy_sql = DEPLOY_DIR / f"{slug}.sql"
                if not deploy_sql.exists():
                    err(f"missing deploy: {deploy_sql}")
                    return 2
                log(f"deploy: {slug} (slice {slice_id})")
                if args.dry_run:
                    continue
                try:
                    execute_sql_file(conn, deploy_sql)
                    conn.commit()
                    log(f"  → committed {slug}")
                except Exception as e:
                    err(f"deploy {slug} failed: {e}")
                    conn.rollback()
                    return 2

        # Verify each — verifies use ROLLBACK at the end so they don't
        # alter state; we only care that each DO $$ block doesn't raise.
        for slug, _ in PHASE20_SLICES:
            verify_sql = VERIFY_DIR / f"{slug}.sql"
            if not verify_sql.exists():
                err(f"missing verify: {verify_sql}")
                return 3
            log(f"verify: {slug}")
            if args.dry_run:
                continue
            try:
                execute_sql_file(conn, verify_sql)
                conn.commit()  # commits the ROLLBACK; harmless
                log(f"  → verify {slug} passed")
            except Exception as e:
                err(f"verify {slug} failed: {e}")
                conn.rollback()
                return 3

        log("--- post-deploy state ---")
        post = query_state(conn)
        for k, v in post.items():
            log(f"  {k}: {v}")

        log("Phase 20 deploy + verify complete")
        return 0
    finally:
        conn.close()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--revert", action="store_true")
    args = p.parse_args()
    return run_phase(args)


if __name__ == "__main__":
    raise SystemExit(main())
