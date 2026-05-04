#!/usr/bin/env python3
"""Phase 19-C orchestrator: full baseline run end-to-end against Neon.

What this does:
  1. Verifies NEON_DATABASE_URL / NEON_DB_* env are set in web/.env.local
     (so `next dev` reaches Neon, not localhost).
  2. Probes Neon connectivity with a SELECT 1 (fail-fast).
  3. Starts `npm run dev` in the background, polls /api/healthz until ready.
  4. Runs `node web/scripts/run_category_benchmarks.mjs --category all
     --out diagnostic/phase_19_baseline_<YYYY-MM-DD>.json`.
  5. Generates a markdown sibling at
     diagnostic/phase_19_baseline_<YYYY-MM-DD>.md with per-category A/B/C
     counts, median elapsedMs, generationSource distribution, and
     cacheHit distribution.
  6. Stops the dev server cleanly.

Usage:
  python3 scripts/phase19_baseline_run.py
  python3 scripts/phase19_baseline_run.py --no-server  # use already-running dev server
  python3 scripts/phase19_baseline_run.py --base-url http://127.0.0.1:3001
  python3 scripts/phase19_baseline_run.py --categories dominance,corner

Exit codes:
  0 — success, baseline written
  1 — Neon connectivity failed
  2 — dev server failed to start
  3 — benchmark runner failed
  4 — markdown generation failed
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
DIAGNOSTIC_DIR = REPO_ROOT / "diagnostic"
DEFAULT_PORT = 3000
DEFAULT_BASE_URL = f"http://127.0.0.1:{DEFAULT_PORT}"

# How long to wait for `next dev` to become responsive.
DEV_SERVER_READY_TIMEOUT_S = 90


def log(msg: str) -> None:
    sys.stdout.write(f"[phase19_baseline] {msg}\n")
    sys.stdout.flush()


def err(msg: str) -> None:
    sys.stderr.write(f"[phase19_baseline] ERROR: {msg}\n")
    sys.stderr.flush()


def parse_env_local(env_local_path: Path) -> Dict[str, str]:
    """Parse a .env.local file (KEY=VALUE per line, comments allowed)."""
    out: Dict[str, str] = {}
    if not env_local_path.exists():
        return out
    for raw in env_local_path.read_text(encoding="utf8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def have_neon_creds(env: Dict[str, str]) -> Tuple[bool, str]:
    """Return (ok, reason). ok=True if Neon URL or discrete fields are populated."""
    if env.get("NEON_DATABASE_URL", "").startswith("postgresql://") or env.get("NEON_DATABASE_URL", "").startswith("postgres://"):
        return True, "NEON_DATABASE_URL present"
    if env.get("DATABASE_URL", "").startswith("postgresql://") or env.get("DATABASE_URL", "").startswith("postgres://"):
        return True, "DATABASE_URL present (assumed Neon)"
    discrete = ["NEON_DB_HOST", "NEON_DB_PORT", "NEON_DB_NAME", "NEON_DB_USER", "NEON_DB_PASSWORD"]
    if all(env.get(k) for k in discrete):
        return True, "NEON_DB_* discrete fields populated"
    missing = [k for k in discrete if not env.get(k)]
    return False, f"no NEON_DATABASE_URL and missing discrete fields: {','.join(missing)}"


def probe_neon(env: Dict[str, str]) -> Tuple[bool, str]:
    """Run SELECT 1 against Neon via psycopg2 if available, else fall back to a
    socket-level connectivity check on the discrete host:port."""
    try:
        import psycopg2  # type: ignore
    except ImportError:
        # Fall back to socket probe.
        host = env.get("NEON_DB_HOST", "")
        port = int(env.get("NEON_DB_PORT", "5432") or 5432)
        if not host:
            return False, "psycopg2 not installed and NEON_DB_HOST empty (cannot socket-probe)"
        try:
            with socket.create_connection((host, port), timeout=10):
                return True, f"socket-probe to {host}:{port} succeeded (psycopg2 not installed — install for full SELECT 1 check)"
        except OSError as e:
            return False, f"socket-probe to {host}:{port} failed: {e}"

    # Use psycopg2 for a real SELECT 1.
    conn_kwargs: Dict[str, object]
    if env.get("NEON_DATABASE_URL"):
        conn_kwargs = {"dsn": env["NEON_DATABASE_URL"]}
    elif env.get("DATABASE_URL"):
        conn_kwargs = {"dsn": env["DATABASE_URL"]}
    else:
        conn_kwargs = {
            "host": env["NEON_DB_HOST"],
            "port": int(env.get("NEON_DB_PORT", "5432") or 5432),
            "dbname": env["NEON_DB_NAME"],
            "user": env["NEON_DB_USER"],
            "password": env["NEON_DB_PASSWORD"],
            "sslmode": "require" if env.get("NEON_SSL", "true").lower() in ("1", "true", "yes") else "prefer",
            "connect_timeout": 10,
        }
    try:
        conn = psycopg2.connect(**conn_kwargs)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                row = cur.fetchone()
                if row and row[0] == 1:
                    return True, "SELECT 1 against Neon succeeded"
                return False, f"SELECT 1 returned {row}"
        finally:
            conn.close()
    except Exception as e:
        return False, f"connect failed: {e}"


def is_port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", port))
            return True
        except OSError:
            return False


def wait_for_server_ready(base_url: str, timeout_s: int) -> Tuple[bool, str]:
    """Poll /api/health-style endpoint until 200 or timeout. We try /api/health
    first, then fall back to GET / which Next serves immediately."""
    deadline = time.monotonic() + timeout_s
    last_err = ""
    paths = ["/api/healthz", "/api/health", "/"]
    while time.monotonic() < deadline:
        for path in paths:
            url = base_url.rstrip("/") + path
            try:
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    if resp.status < 500:
                        return True, f"server responded {resp.status} on {path}"
            except urllib.error.HTTPError as e:
                if e.code < 500:
                    return True, f"server responded {e.code} on {path}"
                last_err = f"{path} -> HTTP {e.code}"
            except Exception as e:
                last_err = f"{path} -> {e}"
        time.sleep(1.0)
    return False, last_err or "timeout with no response"


def start_dev_server(port: int, env_overrides: Dict[str, str]) -> subprocess.Popen:
    """Start `npm run dev` in WEB_DIR with env overrides. Returns the Popen handle."""
    if shutil.which("npm") is None:
        raise RuntimeError("npm not found in PATH")
    env = os.environ.copy()
    env.update(env_overrides)
    env["PORT"] = str(port)
    log(f"starting `npm run dev` on port {port} (cwd={WEB_DIR})")
    # detached process group so we can SIGTERM the whole tree.
    return subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(port)],
        cwd=WEB_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def stop_dev_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    log("stopping dev server")
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass


def capture_completeness_snapshot(env: Dict[str, str], run_id: str, logs_dir: Path) -> Optional[Path]:
    """Phase 19 outcome-fix Fix 6: capture core.session_completeness ONCE
    at the start of the run so the grader can later classify
    proven-data-unavailable vs wrong-filter on 0-row outcomes without
    re-hitting the DB. Returns the snapshot path on success, or None
    on any failure (the grader fails-safe to 'unknown' / C in that
    case)."""
    try:
        import psycopg2  # type: ignore
    except ImportError:
        log("snapshot: psycopg2 not installed, skipping (grader will fail-safe)")
        return None
    if env.get("NEON_DATABASE_URL"):
        kwargs: Dict[str, object] = {"dsn": env["NEON_DATABASE_URL"]}
    elif env.get("DATABASE_URL"):
        kwargs = {"dsn": env["DATABASE_URL"]}
    else:
        kwargs = {
            "host": env["NEON_DB_HOST"],
            "port": int(env.get("NEON_DB_PORT", "5432") or 5432),
            "dbname": env["NEON_DB_NAME"],
            "user": env["NEON_DB_USER"],
            "password": env["NEON_DB_PASSWORD"],
            "sslmode": "require" if env.get("NEON_SSL", "true").lower() in ("1", "true", "yes") else "prefer",
            "connect_timeout": 15,
        }
    snapshot: Dict[str, Dict[str, int]] = {}
    try:
        conn = psycopg2.connect(**kwargs)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                # The session_completeness contract surfaces row counts per
                # raw.* table. Column names follow the
                # "<base_table>_rows" pattern (drivers_rows, laps_rows,
                # weather_rows, ...). We capture every "_rows" column.
                cur.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'core' AND table_name = 'session_completeness' "
                    "AND column_name LIKE '%_rows' ORDER BY ordinal_position"
                )
                row_columns = [r[0] for r in cur.fetchall()]
                if not row_columns:
                    log("snapshot: core.session_completeness has no *_rows columns; skipping")
                    return None
                cols_clause = ", ".join(row_columns)
                cur.execute(
                    f"SELECT session_key, {cols_clause} FROM core.session_completeness"
                )
                for row in cur.fetchall():
                    session_key = int(row[0])
                    per_table: Dict[str, int] = {}
                    for idx, col in enumerate(row_columns, start=1):
                        # column_name "drivers_rows" → table "raw.drivers"
                        base = col.removesuffix("_rows")
                        per_table[f"raw.{base}"] = int(row[idx]) if row[idx] is not None else 0
                    snapshot[str(session_key)] = per_table
        finally:
            conn.close()
    except Exception as e:
        err(f"snapshot: capture failed: {e}")
        return None

    logs_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = logs_dir / f"session_completeness_snapshot_{run_id}.json"
    snapshot_path.write_text(json.dumps(snapshot, indent=2), encoding="utf8")
    log(f"snapshot: captured {len(snapshot)} sessions × {len(row_columns)} table columns → {snapshot_path}")
    return snapshot_path


def run_benchmark_runner(
    base_url: str,
    categories: str,
    out_path: Path,
    completeness_snapshot: Optional[Path] = None,
) -> int:
    cmd = [
        "node",
        "scripts/run_category_benchmarks.mjs",
        "--category",
        categories,
        "--out",
        str(out_path.resolve()),
    ]
    if completeness_snapshot is not None:
        cmd.extend(["--completeness-snapshot", str(completeness_snapshot.resolve())])
    env = os.environ.copy()
    env["OPENF1_CHAT_BASE_URL"] = base_url
    log(f"running benchmark: {' '.join(cmd)}  (OPENF1_CHAT_BASE_URL={base_url})")
    return subprocess.call(cmd, cwd=WEB_DIR, env=env)


def median(values: List[float]) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    if n % 2 == 1:
        return float(s[n // 2])
    return (s[n // 2 - 1] + s[n // 2]) / 2


def percentage(part: int, total: int) -> str:
    if total == 0:
        return "0.0%"
    return f"{(100.0 * part / total):.1f}%"


def summarize_results(aggregate_path: Path) -> str:
    blob = json.loads(aggregate_path.read_text(encoding="utf8"))
    results = blob.get("results", [])
    cats = blob.get("categories", [])

    lines: List[str] = []
    lines.append("# Phase 19 Baseline — Per-category A-rate snapshot")
    lines.append("")
    lines.append(f"Generated: {blob.get('generatedAt', datetime.now(timezone.utc).isoformat())}")
    lines.append(f"Base URL: `{blob.get('baseUrl', '?')}`")
    lines.append(f"Total questions: {len(results)}")
    lines.append("")
    lines.append("## Per-category summary")
    lines.append("")
    lines.append("| Category | Total | A | B | C | A-rate | median elapsedMs | cache hit % |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")

    # Bucket results by category to compute median elapsed + cache hit rate.
    by_category: Dict[str, List[Dict]] = {}
    for r in results:
        c = r.get("category", "?")
        by_category.setdefault(c, []).append(r)

    for entry in cats:
        cat = entry.get("category", "?")
        summary = entry.get("summary", {})
        gc = summary.get("gradeCounts", {})
        a = int(gc.get("A", 0))
        b = int(gc.get("B", 0))
        c = int(gc.get("C", 0))
        total = a + b + c
        rows = by_category.get(cat, [])
        elapsed = [r["elapsedMs"] for r in rows if isinstance(r.get("elapsedMs"), (int, float))]
        med = median(elapsed)
        med_str = f"{med:.0f}" if med is not None else "-"
        cache_hits = sum(1 for r in rows if r.get("cacheHit") is True)
        lines.append(
            f"| {cat} | {total} | {a} | {b} | {c} | {percentage(a, total)} | {med_str} | {percentage(cache_hits, len(rows))} |"
        )

    # Overall row.
    total_a = sum(int(e.get("summary", {}).get("gradeCounts", {}).get("A", 0)) for e in cats)
    total_b = sum(int(e.get("summary", {}).get("gradeCounts", {}).get("B", 0)) for e in cats)
    total_c = sum(int(e.get("summary", {}).get("gradeCounts", {}).get("C", 0)) for e in cats)
    total = total_a + total_b + total_c
    all_elapsed = [r["elapsedMs"] for r in results if isinstance(r.get("elapsedMs"), (int, float))]
    all_med = median(all_elapsed)
    all_med_str = f"{all_med:.0f}" if all_med is not None else "-"
    all_cache_hits = sum(1 for r in results if r.get("cacheHit") is True)
    lines.append(
        f"| **TOTAL** | {total} | {total_a} | {total_b} | {total_c} | {percentage(total_a, total)} | {all_med_str} | {percentage(all_cache_hits, len(results))} |"
    )

    # generationSource distribution (overall).
    lines.append("")
    lines.append("## generationSource distribution (overall)")
    lines.append("")
    src_counts: Dict[str, int] = {}
    for r in results:
        s = r.get("generationSource") or "?"
        src_counts[s] = src_counts.get(s, 0) + 1
    lines.append("| generationSource | count | % of total |")
    lines.append("|---|---:|---:|")
    for s, c in sorted(src_counts.items(), key=lambda kv: kv[1], reverse=True):
        lines.append(f"| `{s}` | {c} | {percentage(c, len(results))} |")

    # Lift-target categories: those at 0 A-rate are explicit Phase 21 targets.
    lines.append("")
    lines.append("## Lift targets (categories at 0% A-rate)")
    lines.append("")
    lines.append("These categories are the explicit lift targets for Phase 21. Each Phase 21 slice's PR-time acceptance must publish a delta vs this baseline.")
    lines.append("")
    targets = [e["category"] for e in cats if e.get("summary", {}).get("gradeCounts", {}).get("A", 0) == 0]
    if targets:
        for t in targets:
            lines.append(f"- {t}")
    else:
        lines.append("(none — every category has at least one A-graded question)")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--base-url", default=None)
    parser.add_argument(
        "--categories",
        default="all",
        help="Comma-separated category slugs OR 'all' (default).",
    )
    parser.add_argument("--no-server", action="store_true",
                        help="Skip starting `npm run dev`; assume a server is already at --base-url.")
    parser.add_argument("--no-probe", action="store_true",
                        help="Skip the Neon connectivity probe (use only if you already verified).")
    parser.add_argument(
        "--out",
        default=None,
        help="Output JSON path. Default: diagnostic/phase_19_baseline_<YYYY-MM-DD>.json",
    )
    args = parser.parse_args()

    base_url = args.base_url or f"http://127.0.0.1:{args.port}"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_json = Path(args.out) if args.out else (DIAGNOSTIC_DIR / f"phase_19_baseline_{today}.json")
    out_md = out_json.with_suffix(".md")

    DIAGNOSTIC_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: env / Neon credentials.
    env_local = parse_env_local(WEB_DIR / ".env.local")
    ok, reason = have_neon_creds(env_local)
    if not ok:
        err(f"web/.env.local has no Neon credentials: {reason}")
        err("Populate NEON_DATABASE_URL or the NEON_DB_* fields and retry.")
        return 1
    log(f"Neon creds: {reason}")

    # Step 2: connectivity probe.
    if not args.no_probe:
        ok, reason = probe_neon(env_local)
        if not ok:
            err(f"Neon connectivity failed: {reason}")
            return 1
        log(f"Neon probe: {reason}")
    else:
        log("Neon probe: skipped (--no-probe)")

    # Step 2b (Phase 19 outcome-fix Fix 6): completeness snapshot
    # capture. Captures core.session_completeness once at this
    # point-in-time; the grader reads from it later. Captured BEFORE
    # the dev server starts so the timestamp predates any of the
    # benchmark SQL execution.
    run_id = today + "-" + datetime.now(timezone.utc).strftime("%H%M%S")
    snapshot_path = capture_completeness_snapshot(env_local, run_id, WEB_DIR / "logs")

    # Step 3: dev server.
    proc: Optional[subprocess.Popen] = None
    if not args.no_server:
        if is_port_open(args.port):
            err(f"port {args.port} is already in use — pass --no-server if a dev server is already running, or pick a different --port.")
            return 2
        env_overrides = {
            "NODE_ENV": "development",
        }
        try:
            proc = start_dev_server(args.port, env_overrides)
        except Exception as e:
            err(f"failed to start dev server: {e}")
            return 2
        log(f"waiting up to {DEV_SERVER_READY_TIMEOUT_S}s for {base_url} to respond ...")
        ok, reason = wait_for_server_ready(base_url, DEV_SERVER_READY_TIMEOUT_S)
        if not ok:
            err(f"dev server did not become ready: {reason}")
            stop_dev_server(proc)
            return 2
        log(f"dev server ready: {reason}")
    else:
        log(f"--no-server set, expecting an existing dev server at {base_url}")

    # Step 4: benchmark runner.
    try:
        rc = run_benchmark_runner(
            base_url, args.categories, out_json, completeness_snapshot=snapshot_path
        )
        if rc != 0:
            err(f"benchmark runner exited with code {rc}")
            return 3
    finally:
        if proc is not None:
            stop_dev_server(proc)

    if not out_json.exists():
        err(f"benchmark runner finished but {out_json} was not written")
        return 3

    # Step 5: markdown.
    try:
        md = summarize_results(out_json)
        out_md.write_text(md, encoding="utf8")
        log(f"wrote markdown summary: {out_md}")
    except Exception as e:
        err(f"failed to summarize results: {e}")
        return 4

    log(f"DONE. JSON={out_json}  MD={out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
