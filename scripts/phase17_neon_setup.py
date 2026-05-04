#!/usr/bin/env python3
"""
Phase 17: deploy missing alias-resolver migrations to Neon and verify the
GIN trigram indexes the resolver depends on. Run from the project root:

    python scripts/phase17_neon_setup.py

Reads NEON_DB_* from <repo-root>/.env. The script is best-effort idempotent:
024 is fully idempotent; 025 drops + recreates unique indexes (not safe
against pre-existing duplicate alias rows); 026 depends on 025.

Why this exists: sqitch.changes is missing on Neon, so we don't trust
sqitch's view of what's deployed. This script applies migrations 024-026
(the ones the chat resolver needs) directly, verifies the indexes landed,
checks pg_trgm/unaccent + the f1_unaccent function, and EXPLAINs the
resolver-shape queries to confirm the bitmap index scans are firing.

Audit fixes (codex audit, 2026-05-02):
- High: 026 is gated on 025 success (per the deploy file's `requires:`).
- High: connection is reopened after any migration failure (rollback alone
  has been observed to leave psycopg2's view of the tx state poisoned).
- Medium: preflight duplicate report for 025's four unique-index scopes;
  the script proceeds but warns loudly if 025 will fail.
- Medium: acceptance now also checks pg_trgm + unaccent extensions, the
  f1_unaccent function definition, the indexed expression for each trgm
  index, and that EXPLAIN (FORMAT JSON) reports a Bitmap Index Scan on
  the trgm index for each fuzzy benchmark query.
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
MIGRATIONS_DIR = REPO_ROOT / "sql" / "migrations" / "deploy"

# Migrations in deploy order.
MIGRATIONS = [
    "024_alias_trgm_indexes.sql",
    "025_alias_view_diacritic_alignment.sql",
    "026_alias_seed_expand_phase14.sql",
]

# 026 explicitly `requires: 025_alias_view_diacritic_alignment` and depends
# on the unique indexes 025 recreates for its ON CONFLICT clauses to land
# correctly. If 025 fails, 026 is skipped.
DEPENDS_ON: dict[str, str] = {
    "026_alias_seed_expand_phase14.sql": "025_alias_view_diacritic_alignment.sql",
}

BLOCKING = {"024_alias_trgm_indexes.sql"}

# Indexes that MUST exist after step 1 for the resolver to be fast.
EXPECTED_TRGM_INDEXES = [
    ("core", "idx_driver_alias_lookup_alias_trgm"),
    ("core", "idx_team_alias_lookup_alias_trgm"),
    ("core", "idx_session_venue_alias_lookup_alias_trgm"),
    ("raw", "idx_raw_sessions_country_name_norm_trgm"),
    ("raw", "idx_raw_sessions_location_norm_trgm"),
    ("raw", "idx_raw_sessions_circuit_short_norm_trgm"),
    ("raw", "idx_raw_sessions_session_name_norm_trgm"),
]

# For each trgm index, the substring its `pg_get_indexdef()` must contain to
# prove the indexed expression matches what the resolver SQL queries with.
EXPECTED_INDEXDEF_FRAGMENTS: dict[tuple[str, str], list[str]] = {
    ("core", "idx_driver_alias_lookup_alias_trgm"): [
        "core.driver_alias_lookup",
        "USING gin",
        "(normalized_alias",
        "gin_trgm_ops",
    ],
    ("core", "idx_team_alias_lookup_alias_trgm"): [
        "core.team_alias_lookup",
        "USING gin",
        "(normalized_alias",
        "gin_trgm_ops",
    ],
    ("core", "idx_session_venue_alias_lookup_alias_trgm"): [
        "core.session_venue_alias_lookup",
        "USING gin",
        "(normalized_alias",
        "gin_trgm_ops",
    ],
    ("raw", "idx_raw_sessions_country_name_norm_trgm"): [
        "raw.sessions",
        "USING gin",
        "country_name",
        "gin_trgm_ops",
    ],
    ("raw", "idx_raw_sessions_location_norm_trgm"): [
        "raw.sessions",
        "USING gin",
        "location",
        "gin_trgm_ops",
    ],
    ("raw", "idx_raw_sessions_circuit_short_norm_trgm"): [
        "raw.sessions",
        "USING gin",
        "circuit_short_name",
        "gin_trgm_ops",
    ],
    ("raw", "idx_raw_sessions_session_name_norm_trgm"): [
        "raw.sessions",
        "USING gin",
        "session_name",
        "gin_trgm_ops",
    ],
}

# Preflight: 025 creates these unique indexes; each fails with a duplicate-
# key error if the table already has rows that collide on the expression.
DUPLICATE_PREFLIGHT_QUERIES: list[tuple[str, str]] = [
    (
        "core.session_venue_alias_lookup (uq_session_venue_alias_lookup)",
        """
        SELECT k AS key, COUNT(*) AS dups
        FROM (
          SELECT (
            COALESCE(normalized_alias, public.f1_unaccent(lower(btrim(alias_text))))
            || '|' || COALESCE(country_name, '')
            || '|' || COALESCE(location, '')
            || '|' || COALESCE(circuit_short_name, '')
          ) AS k
          FROM core.session_venue_alias_lookup
        ) t
        GROUP BY k HAVING COUNT(*) > 1
        ORDER BY dups DESC
        LIMIT 10
        """,
    ),
    (
        "core.driver_alias_lookup (uq_driver_alias_lookup)",
        """
        SELECT k AS key, COUNT(*) AS dups
        FROM (
          SELECT (
            driver_number::text
            || '|' || COALESCE(normalized_alias, public.f1_unaccent(lower(btrim(alias_text))))
          ) AS k
          FROM core.driver_alias_lookup
        ) t
        GROUP BY k HAVING COUNT(*) > 1
        ORDER BY dups DESC
        LIMIT 10
        """,
    ),
    (
        "core.session_type_alias_lookup (uq_session_type_alias_lookup)",
        """
        SELECT k AS key, COUNT(*) AS dups
        FROM (
          SELECT COALESCE(normalized_alias, public.f1_unaccent(lower(btrim(alias_text)))) AS k
          FROM core.session_type_alias_lookup
        ) t
        GROUP BY k HAVING COUNT(*) > 1
        ORDER BY dups DESC
        LIMIT 10
        """,
    ),
    (
        "core.team_alias_lookup (uq_team_alias_lookup)",
        """
        SELECT k AS key, COUNT(*) AS dups
        FROM (
          SELECT (
            COALESCE(normalized_alias, public.f1_unaccent(lower(btrim(alias_text))))
            || '|' || COALESCE(canonical_team_name, '')
          ) AS k
          FROM core.team_alias_lookup
        ) t
        GROUP BY k HAVING COUNT(*) > 1
        ORDER BY dups DESC
        LIMIT 10
        """,
    ),
]


def load_env_file(path: Path) -> dict[str, str]:
    """Minimal .env parser: KEY=VALUE per line, ignores comments + blanks."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def get_conn_kwargs(env: dict[str, str]) -> dict[str, Any]:
    def pick(key: str, *fallbacks: str, default: str | None = None) -> str | None:
        for k in (key, *fallbacks):
            v = os.environ.get(k) or env.get(k)
            if v:
                return v
        return default

    host = pick("NEON_DB_HOST")
    port = pick("NEON_DB_PORT", default="5432")
    name = pick("NEON_DB_NAME", default="neondb")
    user = pick("NEON_DB_USER")
    pwd = pick("NEON_DB_PASSWORD")
    if not host or not user or pwd is None:
        sys.stderr.write(
            "Missing NEON_DB_HOST / NEON_DB_USER / NEON_DB_PASSWORD in env or .env\n"
        )
        sys.exit(2)
    return {
        "host": host,
        "port": int(port),
        "dbname": name,
        "user": user,
        "password": pwd,
        "sslmode": "require",
        "application_name": "phase17_neon_setup",
    }


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def open_conn(kwargs: dict[str, Any]):
    conn = psycopg2.connect(**kwargs)
    # Autocommit so each migration file's own BEGIN/COMMIT runs as-written.
    conn.autocommit = True
    return conn


def run_migration(conn, sql_text: str, label: str) -> None:
    started = time.time()
    with conn.cursor() as cur:
        cur.execute(sql_text)
    elapsed_ms = int((time.time() - started) * 1000)
    print(f"  ✓ {label}  ({elapsed_ms} ms)")


def existing_indexes(conn) -> set[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT schemaname, indexname
            FROM pg_indexes
            WHERE schemaname IN ('core', 'raw')
              AND indexname LIKE '%trgm%'
            """
        )
        return {(r[0], r[1]) for r in cur.fetchall()}


def get_indexdef(conn, schema: str, indexname: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT pg_get_indexdef(c.oid)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s AND c.relname = %s AND c.relkind = 'i'
            """,
            (schema, indexname),
        )
        row = cur.fetchone()
        return row[0] if row else None


def has_extension(conn, name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_extension WHERE extname = %s", (name,))
        return cur.fetchone() is not None


def has_f1_unaccent(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'f1_unaccent'
              AND pg_get_function_arguments(p.oid) = 'text'
              AND p.provolatile = 'i'  -- IMMUTABLE; resolver expression indexes need this
            """
        )
        return cur.fetchone() is not None


def preflight_duplicates(conn) -> list[str]:
    """
    Surface alias rows that will collide with the unique indexes 025
    creates. Returns a list of human-readable warnings; empty list means
    025's CREATE UNIQUE INDEX statements are expected to succeed.
    """
    warnings: list[str] = []
    with conn.cursor() as cur:
        # Skip preflight quietly if f1_unaccent isn't installed yet — that's
        # 024's job and is checked separately.
        if not has_f1_unaccent(conn):
            return ["public.f1_unaccent missing — apply 024 first; preflight skipped"]
    for label, sql in DUPLICATE_PREFLIGHT_QUERIES:
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"{label}: preflight ERROR — {exc}")
            continue
        if not rows:
            print(f"  ✓ {label}: no duplicates")
        else:
            warnings.append(
                f"{label}: {len(rows)} duplicate group(s) — 025 will fail. "
                f"Examples: {', '.join(repr(r[0]) for r in rows[:3])}"
            )
    return warnings


def acceptance_phase18c(conn) -> tuple[int, int]:
    """
    Phase 18-C: schema-only acceptance for the session_completeness storage
    matview migration. Runs anywhere (no row-count assumption); paired with
    the data-dependent block gated by OPENF1_ASSUME_POPULATED.
    """
    passed = 0
    total = 0

    def check(label: str, predicate: bool, detail: str = "") -> None:
        nonlocal passed, total
        total += 1
        if predicate:
            print(f"  ✓ {label}")
            passed += 1
        else:
            print(f"  ✗ {label}{(': ' + detail) if detail else ''}")

    with conn.cursor() as cur:
        # 1) facade is a view, storage is a matview.
        cur.execute(
            """
            SELECT relname, relkind FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='core'
              AND c.relname IN ('session_completeness','session_completeness_data')
            """
        )
        kinds = {r[0]: r[1] for r in cur.fetchall()}
        check(
            "core.session_completeness has relkind='v' (facade)",
            kinds.get("session_completeness") == "v",
            f"got {kinds.get('session_completeness')!r}"
        )
        check(
            "core.session_completeness_data has relkind='m' (storage)",
            kinds.get("session_completeness_data") == "m",
            f"got {kinds.get('session_completeness_data')!r}"
        )

        # 2) unique session_key index on storage matview.
        cur.execute(
            """
            SELECT 1 FROM pg_indexes
            WHERE schemaname='core'
              AND indexname='idx_session_completeness_data_session_key'
            """
        )
        check("idx_session_completeness_data_session_key exists", cur.fetchone() is not None)

        # 3) dependent views compile.
        for view in (
            "core.session_completeness",
            "core.weekend_session_coverage",
            "core.weekend_session_expectation_audit",
            "core.source_anomaly_tracking",
        ):
            try:
                cur.execute(f"SELECT * FROM {view} LIMIT 0")
                cur.fetchall()
                check(f"{view} compiles (LIMIT 0)", True)
            except Exception as exc:  # noqa: BLE001
                check(f"{view} compiles (LIMIT 0)", False, str(exc).splitlines()[0])

    # 4) data-dependent gate.
    populated_flag = os.environ.get("OPENF1_ASSUME_POPULATED")
    if populated_flag is None:
        # default-on for neon.tech hosts; opt-out via =0
        populated_flag = "1" if "neon.tech" in (os.environ.get("NEON_DB_HOST") or "") else "0"
    if populated_flag == "1":
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM core.session_completeness_data")
            (n,) = cur.fetchone()
            check(
                "core.session_completeness_data has rows (data-dependent)",
                n > 0,
                f"COUNT={n}"
            )
    else:
        print("  · data-dependent row-count check skipped (OPENF1_ASSUME_POPULATED=0)")

    return passed, total


def benchmark_resolver(conn) -> tuple[int, int]:
    """
    Run resolver-shape queries and assert each fuzzy query's plan uses a
    Bitmap Index Scan on the matching trgm index. Returns (passed, total).
    """
    queries = [
        (
            "fuzzy venue match (Silverstone)",
            """
            SELECT session_key
            FROM raw.sessions
            WHERE public.f1_unaccent(lower(btrim(location))) % 'silverstone'
              AND year = 2024
            LIMIT 5
            """,
            "idx_raw_sessions_location_norm_trgm",
        ),
        (
            "fuzzy country match (Britain)",
            """
            SELECT session_key
            FROM raw.sessions
            WHERE public.f1_unaccent(lower(btrim(country_name))) % 'britain'
              AND year = 2024
            LIMIT 5
            """,
            "idx_raw_sessions_country_name_norm_trgm",
        ),
        (
            "session_search_lookup view scan",
            """
            SELECT session_key, year, country_name, location
            FROM core.session_search_lookup
            WHERE year = 2024
              AND normalized_alias LIKE 'silverstone%'
            LIMIT 5
            """,
            None,  # view scan; index expectation is per-base-table, not asserted here
        ),
    ]
    passed = 0
    total = len(queries)
    for label, sql, expected_index in queries:
        try:
            started = time.time()
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
            elapsed_ms = int((time.time() - started) * 1000)
            uses_index = "n/a"
            if expected_index:
                with conn.cursor() as cur:
                    cur.execute(f"EXPLAIN (FORMAT JSON) {sql}")
                    plan = cur.fetchone()[0]
                uses_index = "yes" if plan_uses_index(plan, expected_index) else "no"
            ok = expected_index is None or uses_index == "yes"
            mark = "✓" if ok else "✗"
            print(
                f"  {mark} {label}: {elapsed_ms} ms, {len(rows)} rows, "
                f"index_used={uses_index}"
            )
            if ok:
                passed += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {label}: ERROR — {exc}")
    return passed, total


def plan_uses_index(plan: Any, expected_index: str) -> bool:
    """Walk EXPLAIN (FORMAT JSON) plan; True iff the index name appears."""
    def walk(node: Any) -> bool:
        if isinstance(node, dict):
            if node.get("Index Name") == expected_index:
                return True
            for v in node.values():
                if walk(v):
                    return True
        elif isinstance(node, list):
            return any(walk(v) for v in node)
        return False

    return walk(plan)


def main() -> int:
    env = load_env_file(ENV_FILE)
    if not env:
        print(f"warn: {ENV_FILE} not found; relying on shell env only", file=sys.stderr)

    kwargs = get_conn_kwargs(env)
    print(f"Connecting to {kwargs['user']}@{kwargs['host']}:{kwargs['port']}/{kwargs['dbname']}")
    conn = open_conn(kwargs)

    section("Pre-deploy: existing trgm indexes")
    before = existing_indexes(conn)
    if before:
        for s, i in sorted(before):
            print(f"  {s}.{i}")
    else:
        print("  (none)")

    section("Preflight: duplicate alias rows that would break 025")
    pf_warnings = preflight_duplicates(conn)
    if not pf_warnings:
        print("  ✓ no preflight blockers detected")
    else:
        for w in pf_warnings:
            print(f"  ⚠ {w}")

    section("Applying migrations")
    failures: dict[str, str] = {}
    for fname in MIGRATIONS:
        sql_path = MIGRATIONS_DIR / fname
        if not sql_path.exists():
            print(f"  SKIP {fname} (not found at {sql_path})")
            continue
        # Skip if a required upstream migration failed earlier in this run.
        prereq = DEPENDS_ON.get(fname)
        if prereq and prereq in failures:
            print(f"  SKIP {fname} (depends on {prereq}, which failed)")
            failures[fname] = f"skipped (depends on {prereq})"
            continue
        sql_text = sql_path.read_text(encoding="utf-8")
        try:
            run_migration(conn, sql_text, fname)
        except Exception as exc:  # noqa: BLE001
            label = "BLOCKING" if fname in BLOCKING else "non-blocking"
            print(f"  ✗ {fname} FAILED ({label}): {exc}")
            failures[fname] = str(exc)
            # Each migration file opens its own BEGIN; when it errors, the tx
            # is aborted. rollback() usually clears it but we've seen the
            # connection's view stay poisoned on Neon. Reopen to be safe.
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                conn = open_conn(kwargs)
            except Exception as reopen_exc:  # noqa: BLE001
                print(f"  ✗ reconnect failed: {reopen_exc}")
                return 1
            if fname in BLOCKING:
                return 1

    section("Post-deploy: trgm indexes")
    after = existing_indexes(conn)
    for s, i in sorted(after):
        marker = "+" if (s, i) not in before else " "
        print(f"  {marker} {s}.{i}")

    section("Acceptance: required indexes + extensions + f1_unaccent")
    acceptance_failed = False

    # 1) extensions
    for ext in ("pg_trgm", "unaccent"):
        if has_extension(conn, ext):
            print(f"  ✓ extension {ext}")
        else:
            print(f"  ✗ extension {ext} MISSING")
            acceptance_failed = True

    # 2) f1_unaccent function (IMMUTABLE, signature text)
    if has_f1_unaccent(conn):
        print("  ✓ public.f1_unaccent(text) IMMUTABLE")
    else:
        print("  ✗ public.f1_unaccent(text) MISSING or not IMMUTABLE")
        acceptance_failed = True

    # 3) every expected trgm index exists with the right indexdef
    for schema, indexname in EXPECTED_TRGM_INDEXES:
        if (schema, indexname) not in after:
            print(f"  ✗ MISSING {schema}.{indexname}")
            acceptance_failed = True
            continue
        idx_def = get_indexdef(conn, schema, indexname)
        if idx_def is None:
            print(f"  ✗ {schema}.{indexname} not retrievable via pg_get_indexdef")
            acceptance_failed = True
            continue
        fragments = EXPECTED_INDEXDEF_FRAGMENTS.get((schema, indexname), [])
        missing_frags = [f for f in fragments if f not in idx_def]
        if missing_frags:
            print(
                f"  ✗ {schema}.{indexname} indexdef missing fragments {missing_frags}: "
                f"{idx_def}"
            )
            acceptance_failed = True
        else:
            print(f"  ✓ {schema}.{indexname}")

    if acceptance_failed:
        print("\nResolver may still seq-scan; investigate before re-testing chat.")
        return 1

    section("Phase 18-C acceptance: matview facade + dependents")
    p18_passed, p18_total = acceptance_phase18c(conn)
    print(f"  phase18c: {p18_passed}/{p18_total} checks passed")
    if p18_passed < p18_total:
        acceptance_failed = True

    section("Benchmark: resolver-shape queries (with EXPLAIN bitmap-scan check)")
    passed, total = benchmark_resolver(conn)
    print(f"  benchmark: {passed}/{total} queries pass index-usage assertion")
    if passed < total:
        print("\nAt least one fuzzy query is NOT using its trgm index. The plan-cache")
        print("may need ANALYZE; or the expression in the query doesn't match the")
        print("index expression (compare pg_get_indexdef output with the SQL above).")

    conn.close()
    if failures:
        print("\nNon-blocking migration failures:")
        for fname, msg in failures.items():
            first_line = msg.splitlines()[0] if msg else ""
            print(f"  - {fname}: {first_line}")
    print("\nResolver speed acceptance complete.")
    return 0 if (not acceptance_failed and passed == total) else 1


if __name__ == "__main__":
    sys.exit(main())
