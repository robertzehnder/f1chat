#!/usr/bin/env python3
"""Phase 25.2 per-slice deploy harness.

Operates on a single Phase 21 slice at a time. Each slice has a
deploy SQL, a verify SQL, an optional revert SQL, a slice_id in
diagnostic/slices_status.json, and a set of question JSONs whose
floor_active_after_slice points at the slice. After a successful
deploy + verify, this harness:

  1. flips slices_status.json entry pending -> merged + merged_at
  2. clears floor_active_after_slice in every question JSON whose
     value matches the slice_id (the rev4 cleanup-or-fail rule)
  3. optionally re-validates the questions tagged for the slice
     against the live dev server (--validate)

Usage:

  # deploy + verify + cleanup, code mutations committed in working tree
  python3 scripts/phase25_deploy_slice.py \
    --slice 21-stint-degradation-curve \
    --migration 033_analytics_stint_degradation_curve

  # add live re-validation against the local dev server (port 3000)
  python3 scripts/phase25_deploy_slice.py \
    --slice 21-stint-degradation-curve \
    --migration 033_analytics_stint_degradation_curve \
    --validate \
    --validate-questions 2020,2024,2026

  # dry-run preview
  python3 scripts/phase25_deploy_slice.py \
    --slice 21-stint-degradation-curve \
    --migration 033_analytics_stint_degradation_curve \
    --dry-run

Re-running a successful deploy is idempotent because:
  - matview migrations use CREATE MATERIALIZED VIEW IF NOT EXISTS
  - facade views use CREATE OR REPLACE VIEW
  - slices_status.json flip is idempotent (no-op once status=merged)
  - floor_active_after_slice cleanup is idempotent (already null)

Exit codes:
  0  all steps passed
  1  Neon connectivity failed
  2  deploy failed
  3  verify failed
  4  slices_status.json update failed (e.g. unknown slice_id)
  5  question JSON cleanup failed
  6  live re-validation failed (any question graded below its target)
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
DEPLOY_DIR = REPO_ROOT / "sql" / "migrations" / "deploy"
VERIFY_DIR = REPO_ROOT / "sql" / "migrations" / "verify"
REVERT_DIR = REPO_ROOT / "sql" / "migrations" / "revert"
SLICES_STATUS = REPO_ROOT / "diagnostic" / "slices_status.json"
QUESTIONS_GLOB = WEB_DIR / "scripts"
TARGET_GRADES_PATH = REPO_ROOT / "diagnostic" / "phase25_target_grades.json"


def log(msg: str) -> None:
    sys.stdout.write(f"[phase25_deploy] {msg}\n")
    sys.stdout.flush()


def err(msg: str) -> None:
    sys.stderr.write(f"[phase25_deploy] ERROR: {msg}\n")
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


def deploy_and_verify(migration: str, dry_run: bool) -> int:
    deploy_sql = DEPLOY_DIR / f"{migration}.sql"
    verify_sql = VERIFY_DIR / f"{migration}.sql"
    if not deploy_sql.exists():
        err(f"missing deploy SQL: {deploy_sql}")
        return 2
    if not verify_sql.exists():
        err(f"missing verify SQL: {verify_sql}")
        return 3

    log(f"connecting to Neon (migration {migration}) ...")
    conn = connect_neon()
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            assert cur.fetchone()[0] == 1
        log("Neon connectivity OK")

        log(f"deploy: {deploy_sql.name}")
        if dry_run:
            log("  (dry-run; skipping execute)")
        else:
            try:
                execute_sql_file(conn, deploy_sql)
                conn.commit()
                log("  → deploy committed")
            except Exception as exc:
                err(f"deploy failed: {exc}")
                conn.rollback()
                return 2

        log(f"verify: {verify_sql.name}")
        if dry_run:
            log("  (dry-run; skipping execute)")
        else:
            try:
                execute_sql_file(conn, verify_sql)
                conn.commit()
                log("  → verify passed")
            except Exception as exc:
                err(f"verify failed: {exc}")
                conn.rollback()
                return 3

        return 0
    finally:
        conn.close()


def update_slices_status(slice_id: str, dry_run: bool) -> int:
    if not SLICES_STATUS.exists():
        err(f"slices_status.json not found at {SLICES_STATUS}")
        return 4
    raw = SLICES_STATUS.read_text(encoding="utf8")
    data = json.loads(raw)
    slices = data.get("slices") or []
    target = next((s for s in slices if s.get("slice_id") == slice_id), None)
    if target is None:
        err(f"slice_id '{slice_id}' not in slices_status.json")
        return 4
    if target.get("status") == "merged":
        log(f"slices_status.json: '{slice_id}' already merged (no-op)")
        return 0
    target["status"] = "merged"
    target["merged_at"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if dry_run:
        log(f"slices_status.json: would flip '{slice_id}' -> merged at {target['merged_at']} (dry-run)")
        return 0
    SLICES_STATUS.write_text(json.dumps(data, indent=2) + "\n", encoding="utf8")
    log(f"slices_status.json: flipped '{slice_id}' -> merged at {target['merged_at']}")
    return 0


def cleanup_floor_active(slice_id: str, dry_run: bool) -> Tuple[int, List[int]]:
    """Set floor_active_after_slice to null in every question whose
    value matches slice_id. Returns (exit_code, list_of_qids_cleared)."""
    cleared_ids: List[int] = []
    for qfile in sorted(QUESTIONS_GLOB.glob("chat-health-check.questions.*.json")):
        try:
            doc = json.loads(qfile.read_text(encoding="utf8"))
        except Exception as exc:
            err(f"failed to parse {qfile}: {exc}")
            return 5, cleared_ids
        if not isinstance(doc, list):
            # Some files are SCHEMA.md descriptors etc.; skip non-arrays.
            continue
        changed = False
        for q in doc:
            if isinstance(q, dict) and q.get("floor_active_after_slice") == slice_id:
                cleared_ids.append(int(q.get("id")))
                if not dry_run:
                    q["floor_active_after_slice"] = None
                changed = True
        if changed and not dry_run:
            qfile.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf8")
            log(f"  cleanup: {qfile.name} — cleared {sum(1 for q in doc if isinstance(q, dict) and q.get('floor_active_after_slice') is None and int(q.get('id')) in cleared_ids)} entries")
    if cleared_ids:
        log(f"floor_active_after_slice cleared on qids: {sorted(set(cleared_ids))}")
    else:
        log("floor_active_after_slice cleanup: no questions referenced this slice (no-op)")
    return 0, cleared_ids


def load_target_grades() -> Dict[str, str]:
    if not TARGET_GRADES_PATH.exists():
        return {}
    doc = json.loads(TARGET_GRADES_PATH.read_text(encoding="utf8"))
    overrides = doc.get("overrides") or {}
    return {str(k): v.get("phase25_target_grade") for k, v in overrides.items() if v.get("phase25_target_grade")}


def question_target_grade(qid: int, manifest: Dict[str, str], source_floor: Optional[str]) -> str:
    """Manifest override first; fall back to source expected_grade_floor."""
    key = str(qid)
    if key in manifest:
        return manifest[key]
    return source_floor or "A"


GRADE_RANK = {"A": 4, "B": 3, "C": 2, "D": 1, "F": 0}


def grade_meets(observed: str, target: str) -> bool:
    return GRADE_RANK.get(observed, 0) >= GRADE_RANK.get(target, 4)


def find_source_floors(qids: List[int]) -> Dict[int, Optional[str]]:
    """Lookup expected_grade_floor for each qid across all question files."""
    result: Dict[int, Optional[str]] = {qid: None for qid in qids}
    remaining = set(qids)
    for qfile in QUESTIONS_GLOB.glob("chat-health-check.questions.*.json"):
        if not remaining:
            break
        try:
            doc = json.loads(qfile.read_text(encoding="utf8"))
        except Exception:
            continue
        if not isinstance(doc, list):
            continue
        for q in doc:
            if isinstance(q, dict):
                qid = q.get("id")
                if isinstance(qid, int) and qid in remaining:
                    result[qid] = q.get("expected_grade_floor")
                    remaining.discard(qid)
    return result


def run_validation(qids: List[int], retries: int) -> int:
    if not qids:
        log("no validation qids supplied; skipping live re-validation")
        return 0
    import subprocess
    cmd = [
        "node",
        str(WEB_DIR / "scripts" / "run_category_benchmarks.mjs"),
        "--question",
        ",".join(str(q) for q in qids),
        "--retries",
        str(retries),
    ]
    log("validate: " + " ".join(cmd))
    proc = subprocess.run(
        cmd,
        cwd=str(WEB_DIR),
        capture_output=True,
        text=True,
        timeout=900,
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        err(f"benchmark runner exited {proc.returncode}")
        return 6

    # Parse per-question final grades from stdout. Final grade per
    # question is the LAST grade line emitted for that qid (the runner
    # prints one line per attempt; --retries uses BEST grade across
    # attempts — we can re-derive that ourselves to be safe).
    best_per_qid: Dict[int, str] = {}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("q"):
            continue
        # Format: "  q1940 attempt 1/1 → A (10024ms)"
        try:
            q_part, _, grade_part = line.partition("→")
            qid = int(q_part.strip().split()[0][1:])
            grade = grade_part.strip().split()[0].strip()
            if grade not in GRADE_RANK:
                continue
            current = best_per_qid.get(qid)
            if current is None or GRADE_RANK[grade] > GRADE_RANK[current]:
                best_per_qid[qid] = grade
        except Exception:
            continue

    # Apply target-grade gate.
    manifest = load_target_grades()
    source_floors = find_source_floors(qids)
    failures: List[str] = []
    for qid in qids:
        observed = best_per_qid.get(qid, "?")
        target = question_target_grade(qid, manifest, source_floors.get(qid))
        ok = observed in GRADE_RANK and grade_meets(observed, target)
        marker = "OK" if ok else "FAIL"
        log(f"  gate q{qid}: observed={observed} target={target} → {marker}")
        if not ok:
            failures.append(f"q{qid} observed={observed} < target={target}")
    if failures:
        err("validation failures: " + "; ".join(failures))
        return 6
    log("all validation gates passed")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--slice", required=True, help="slice_id, e.g. 21-stint-degradation-curve")
    p.add_argument("--migration", required=True, help="migration filename without .sql, e.g. 033_analytics_stint_degradation_curve")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--validate", action="store_true", help="run live re-validation after deploy + cleanup")
    p.add_argument("--validate-questions", help="comma-separated qids to validate (default: questions cleared by floor_active_after_slice)")
    p.add_argument("--retries", type=int, default=2, help="benchmark retries per question (default 2)")
    p.add_argument("--skip-deploy", action="store_true", help="skip deploy+verify (use after a successful deploy when re-running cleanup)")
    args = p.parse_args()

    if not args.skip_deploy:
        rc = deploy_and_verify(args.migration, args.dry_run)
        if rc != 0:
            return rc

    rc = update_slices_status(args.slice, args.dry_run)
    if rc != 0:
        return rc

    rc, cleared_ids = cleanup_floor_active(args.slice, args.dry_run)
    if rc != 0:
        return rc

    if args.validate:
        if args.validate_questions:
            qids = [int(x) for x in args.validate_questions.split(",") if x.strip()]
        else:
            qids = sorted(set(cleared_ids))
        if args.dry_run:
            log(f"validate: would run benchmarks on {qids} (dry-run)")
            return 0
        return run_validation(qids, args.retries)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
