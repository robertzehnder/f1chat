#!/usr/bin/env python3
"""Phase 24/25 autonomous loop driver.

Drives the per-question A-grade iteration cycle against the dev server
without operator supervision. For each non-A active-floor question:

  1. Classify failure mode (phase24_classify_failure.py).
  2. Ask codex to formulate a fix hypothesis (codex exec).
  3. If verdict=SKIP, mark slice merged_skipped, move on.
  4. If verdict=PROCEED, dispatch implementation (codex exec
     --auto-edit), then validate by re-running the question.
  5. Loop up to MAX_ITERATIONS=10 attempts.
  6. On 10th failure, ask codex for SKIP/CONTINUE/ESCALATE decision.
  7. After each merged slice, run a no-regression check on the
     prior-A questions; revert + re-classify on regression.

Resumable: state at scripts/loop/state/phase24_progress.json. Re-run
with --resume to pick up where it left off.

Usage:
    nohup python3 scripts/phase24_autonomous_loop.py \\
      --baseline diagnostic/phase_19_baseline_2026-05-04.json \\
      --base-url http://127.0.0.1:3000 \\
      --max-iterations 10 \\
      --max-runtime-hours 24 \\
      --resume \\
      > logs/phase24_autonomous_loop.out 2>&1 &

Stop with `kill <pid>`. Driver checkpoints between slices.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
STATE_DIR = REPO_ROOT / "scripts" / "loop" / "state"
LOG_DIR = REPO_ROOT / "logs"
PROGRESS_PATH = STATE_DIR / "phase24_progress.json"
SLICES_STATUS_PATH = REPO_ROOT / "diagnostic" / "slices_status.json"

CODEX_BIN = "codex"
NODE_BIN = "node"

# Codex exec wraps prompts in a session. We give it explicit
# instructions to write its verdict in a fenced block we can grep
# for. Resilient JSON extraction handles minor formatting drift.
HYPOTHESIS_PROMPT_TEMPLATE = """You are auditing a Phase 19 benchmark question that did not grade A.

Question id: {qid}
Category: {category}
Complexity: {complexity}
Question text: "{question_text}"
expected_outcome: {expected_outcome}
expected_path: {expected_path}
floor_active_after_slice: {floor_active_after_slice}

Latest graded result (truncated):
- baselineGrade: {grade}
- generationSource: {gen}
- rowCount: {row_count}
- adequacyReason: {adequacy_reason}
- sql (first 800 chars): {sql_preview}
- answer (first 400 chars): {answer_preview}

Failure-mode classifier output:
- failureMode: {failure_mode}
- fixVector: {fix_vector}
- primaryFiles: {primary_files}

Reference docs (read before responding):
- diagnostic/phase_19_outcome_fix_plan_2026-05-03.md
- diagnostic/phase_24_per_question_iteration_roadmap_2026-05-04.md

Output STRICT JSON between <verdict-json> and </verdict-json>. No prose
outside the tags.

<verdict-json>
{{
  "verdict": "PROCEED" | "REVISE" | "SKIP",
  "skipReason": "<set when verdict=SKIP>",
  "hypothesis": "<one-sentence summary of the proposed change>",
  "files": [{{"path": "<repo-relative>", "changeKind": "extend|patch|new", "details": "<one line>"}}],
  "validationCommand": "<single shell command>",
  "regressionRisk": "low" | "medium" | "high",
  "codexConfidence": 0.0
}}
</verdict-json>

PROCEED = a code change is well-defined and likely to lift this question to A.
REVISE = the suggested fix vector doesn't apply OR the failure-mode classification is wrong.
SKIP = the underlying data does not support an A-grade answer (e.g. requires Phase 21 matview, or proven_data_unavailable).
"""

IMPL_PROMPT_TEMPLATE = """Implement the following hypothesis to lift Phase 19 question {qid} to A-grade.

Question text: "{question_text}"
Hypothesis: {hypothesis}
Files to touch: {files_json}

Constraints:
- Preserve all existing tests (npx tsc --noEmit must stay clean; node --test scripts/tests/*.test.mjs must not regress).
- If you add a new test for this hypothesis, place it in web/scripts/tests/ following existing patterns.
- Make the smallest change that addresses the hypothesis.
- After making changes, run `npx tsc --noEmit` from the web/ directory to confirm typecheck.

Apply the changes directly to the working tree. Do NOT commit.
"""

SKIP_DECISION_PROMPT_TEMPLATE = """A Phase 19 benchmark question failed to reach A-grade after {iteration_count} attempts.

Question id: {qid}
Question text: "{question_text}"
Failure mode (latest classification): {failure_mode}

Attempt history:
{attempt_history}

Decide what to do next. Output STRICT JSON between <verdict-json> tags:

<verdict-json>
{{
  "decision": "SKIP" | "CONTINUE" | "ESCALATE",
  "rationale": "<one paragraph>",
  "newHypothesis": "<set when decision=CONTINUE; what to try differently>"
}}
</verdict-json>

SKIP = the underlying data / system does not support an A-grade answer; mark merged_skipped.
CONTINUE = a meaningfully different approach hasn't been tried yet; cap extends by 5 more attempts.
ESCALATE = operator review required; halt this slice.
"""


@dataclass
class SliceState:
    slice_id: str
    question_id: int
    status: str = "pending"  # pending|hypothesis_pending|impl_in_flight|validation_pending|merged|merged_skipped|escalated|validation_failed_regression
    iteration_count: int = 0
    last_grade: Optional[str] = None
    last_attempt_at: Optional[str] = None
    cap_extended_to: Optional[int] = None
    history: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class Progress:
    started_at: str
    base_url: str
    max_iterations: int
    slices: Dict[str, SliceState] = field(default_factory=dict)


def log(msg: str) -> None:
    sys.stdout.write(f"[phase24_loop] {datetime.now().isoformat(timespec='seconds')}  {msg}\n")
    sys.stdout.flush()


def err(msg: str) -> None:
    sys.stderr.write(f"[phase24_loop] ERROR: {datetime.now().isoformat(timespec='seconds')}  {msg}\n")
    sys.stderr.flush()


def load_progress() -> Optional[Progress]:
    if not PROGRESS_PATH.exists():
        return None
    blob = json.loads(PROGRESS_PATH.read_text(encoding="utf8"))
    slices = {sid: SliceState(**s) for sid, s in blob.get("slices", {}).items()}
    return Progress(
        started_at=blob.get("started_at"),
        base_url=blob.get("base_url"),
        max_iterations=blob.get("max_iterations", 10),
        slices=slices
    )


def save_progress(progress: Progress) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    PROGRESS_PATH.write_text(
        json.dumps(
            {
                "started_at": progress.started_at,
                "base_url": progress.base_url,
                "max_iterations": progress.max_iterations,
                "slices": {sid: asdict(s) for sid, s in progress.slices.items()}
            },
            indent=2
        ),
        encoding="utf8"
    )


def classify_question(baseline_path: Path, qid: int) -> Dict[str, Any]:
    rc = subprocess.run(
        [
            "python3", str(REPO_ROOT / "scripts" / "phase24_classify_failure.py"),
            "--baseline", str(baseline_path),
            "--question", str(qid)
        ],
        capture_output=True, text=True, cwd=REPO_ROOT
    )
    if rc.returncode != 0:
        return {"failureMode": "unknown", "rationale": rc.stderr.strip(), "fixVector": "", "primaryFiles": []}
    return json.loads(rc.stdout)


def extract_verdict_json(text: str) -> Optional[Dict[str, Any]]:
    # Try fenced block first.
    m = re.search(r"<verdict-json>(.*?)</verdict-json>", text, re.DOTALL | re.IGNORECASE)
    candidate = m.group(1).strip() if m else None
    if candidate is None:
        # Fall back: first { ... } block.
        m2 = re.search(r"\{[\s\S]*\}", text)
        candidate = m2.group(0) if m2 else None
    if candidate is None:
        return None
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def codex_exec(prompt: str, timeout_s: int = 600) -> Optional[str]:
    """Invoke codex non-interactively. Returns stdout or None on failure."""
    try:
        rc = subprocess.run(
            [CODEX_BIN, "exec", prompt],
            capture_output=True, text=True, cwd=REPO_ROOT, timeout=timeout_s
        )
    except subprocess.TimeoutExpired:
        err(f"codex exec timed out after {timeout_s}s")
        return None
    except FileNotFoundError:
        err(f"{CODEX_BIN} not found in PATH")
        return None
    if rc.returncode != 0:
        err(f"codex exec exited {rc.returncode}: {rc.stderr[:500]}")
    return rc.stdout


def find_question_in_baseline(baseline_path: Path, qid: int) -> Optional[Dict[str, Any]]:
    blob = json.loads(baseline_path.read_text(encoding="utf8"))
    for r in blob.get("results", []):
        if r.get("id") == qid:
            return r
    return None


def run_question_iteration(qid: int, base_url: str, retries: int = 2, snapshot_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Run a single question via the per-question runner. Returns the BEST graded row across retries, or None on failure."""
    out_path = LOG_DIR / f"question_iteration_{qid}_{int(time.time())}.json"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        NODE_BIN, "scripts/run_category_benchmarks.mjs",
        "--question", str(qid),
        "--retries", str(retries),
        "--out", str(out_path)
    ]
    if snapshot_path is not None:
        cmd.extend(["--completeness-snapshot", str(snapshot_path)])
    env = os.environ.copy()
    env["OPENF1_CHAT_BASE_URL"] = base_url
    rc = subprocess.run(cmd, cwd=WEB_DIR, env=env, capture_output=True, text=True)
    if rc.returncode != 0 or not out_path.exists():
        err(f"runner failed for q{qid}: rc={rc.returncode}, stderr={rc.stderr[:300]}")
        return None
    blob = json.loads(out_path.read_text(encoding="utf8"))
    attempts = blob.get("attempts", [])
    if not attempts:
        return None
    # Best grade across attempts.
    grade_rank = {"A": 3, "B": 2, "C": 1}
    best = max(attempts, key=lambda a: grade_rank.get(a.get("baselineGrade", ""), 0))
    return best


def grade_to_letter(g: Optional[str]) -> str:
    return g or "?"


def revert_worktree() -> None:
    """Discard uncommitted changes in the working tree. Used when a fix
    causes a regression."""
    subprocess.run(["git", "stash", "push", "-u", "-m", "phase24-loop-revert"], cwd=REPO_ROOT)
    subprocess.run(["git", "stash", "drop"], cwd=REPO_ROOT, capture_output=True)


def commit_slice(slice_id: str, qid: int, hypothesis: str) -> bool:
    """Commit any uncommitted changes with a slice-tagged message."""
    rc = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO_ROOT)
    rc_un = subprocess.run(["git", "diff", "--quiet"], cwd=REPO_ROOT)
    if rc.returncode == 0 and rc_un.returncode == 0:
        return False  # nothing to commit
    subprocess.run(["git", "add", "-A"], cwd=REPO_ROOT)
    msg = f"phase24({slice_id}): lift q{qid} to A — {hypothesis[:80]}"
    rc2 = subprocess.run(["git", "commit", "-m", msg], cwd=REPO_ROOT, capture_output=True, text=True)
    if rc2.returncode != 0:
        err(f"commit failed: {rc2.stderr[:300]}")
        return False
    return True


def update_slice_status(slice_id: str, status: str) -> None:
    if not SLICES_STATUS_PATH.exists():
        return
    blob = json.loads(SLICES_STATUS_PATH.read_text(encoding="utf8"))
    found = False
    for s in blob.get("slices", []):
        if s.get("slice_id") == slice_id:
            s["status"] = status
            if status in ("merged", "merged_skipped"):
                s["merged_at"] = datetime.now(timezone.utc).isoformat()
            found = True
            break
    if not found:
        blob.setdefault("slices", []).append(
            {"slice_id": slice_id, "status": status,
             "merged_at": datetime.now(timezone.utc).isoformat() if status in ("merged", "merged_skipped") else None,
             "depends_on": []}
        )
    SLICES_STATUS_PATH.write_text(json.dumps(blob, indent=2), encoding="utf8")


def process_slice(slice_state: SliceState, baseline_path: Path, base_url: str, max_iterations: int, snapshot_path: Optional[Path]) -> SliceState:
    qid = slice_state.question_id
    log(f"=== {slice_state.slice_id} (q{qid}) — iteration {slice_state.iteration_count + 1}/{max_iterations} ===")

    # Step 1: classify failure (re-classify each iteration to capture
    # state changes from prior attempts).
    cls = classify_question(baseline_path, qid)
    failure_mode = cls.get("failureMode", "unknown")
    fix_vector = cls.get("fixVector", "")
    primary_files = cls.get("primaryFiles", [])
    log(f"  failureMode={failure_mode}")

    question_row = find_question_in_baseline(baseline_path, qid)
    if not question_row:
        err(f"  q{qid} not found in baseline; marking escalated")
        slice_state.status = "escalated"
        return slice_state

    # Step 2: ask codex for hypothesis.
    prompt = HYPOTHESIS_PROMPT_TEMPLATE.format(
        qid=qid,
        category=question_row.get("category", "?"),
        complexity=question_row.get("complexity", "?"),
        question_text=question_row.get("question", "?"),
        expected_outcome=question_row.get("expected_outcome", "?"),
        expected_path=question_row.get("expected_path", "?"),
        floor_active_after_slice=question_row.get("floor_active_after_slice"),
        grade=question_row.get("baselineGrade", "?"),
        gen=question_row.get("generationSource", "?"),
        row_count=question_row.get("rowCount", 0),
        adequacy_reason=str(question_row.get("adequacyReason", ""))[:200],
        sql_preview=str(question_row.get("sql", ""))[:800],
        answer_preview=str(question_row.get("answer", ""))[:400],
        failure_mode=failure_mode,
        fix_vector=fix_vector,
        primary_files=json.dumps(primary_files)
    )
    log("  asking codex for hypothesis...")
    response = codex_exec(prompt, timeout_s=600)
    if not response:
        err("  codex hypothesis dispatch failed; escalating slice")
        slice_state.status = "escalated"
        slice_state.history.append({"step": "hypothesis", "result": "codex_failed", "ts": datetime.now().isoformat()})
        return slice_state
    verdict = extract_verdict_json(response)
    if not verdict:
        err("  could not parse verdict JSON; escalating")
        slice_state.status = "escalated"
        slice_state.history.append({"step": "hypothesis", "result": "parse_failed", "raw_preview": response[:400], "ts": datetime.now().isoformat()})
        return slice_state
    log(f"  codex verdict={verdict.get('verdict')}")
    slice_state.history.append({"step": "hypothesis", "verdict": verdict, "ts": datetime.now().isoformat()})

    if verdict.get("verdict") == "SKIP":
        log(f"  SKIP: {verdict.get('skipReason')}")
        slice_state.status = "merged_skipped"
        update_slice_status(slice_state.slice_id, "merged_skipped")
        return slice_state

    if verdict.get("verdict") != "PROCEED":
        # REVISE — bump iteration count and let the outer loop re-run.
        slice_state.iteration_count += 1
        return slice_state

    # Step 3: dispatch impl via codex (it can edit files in the
    # current worktree).
    hypothesis = verdict.get("hypothesis", "")
    files = verdict.get("files", [])
    impl_prompt = IMPL_PROMPT_TEMPLATE.format(
        qid=qid,
        question_text=question_row.get("question", "?"),
        hypothesis=hypothesis,
        files_json=json.dumps(files)
    )
    log("  asking codex to implement...")
    impl_response = codex_exec(impl_prompt, timeout_s=900)
    if not impl_response:
        err("  impl dispatch failed; reverting and escalating")
        revert_worktree()
        slice_state.status = "escalated"
        slice_state.iteration_count += 1
        return slice_state

    # Step 4: validate by re-running the question.
    log("  validating...")
    best = run_question_iteration(qid, base_url, retries=2, snapshot_path=snapshot_path)
    if not best:
        err("  validation runner failed; reverting iteration")
        revert_worktree()
        slice_state.iteration_count += 1
        return slice_state
    new_grade = best.get("baselineGrade")
    log(f"  validation grade: {new_grade}")
    slice_state.last_grade = new_grade
    slice_state.last_attempt_at = datetime.now().isoformat()
    slice_state.history.append({"step": "validation", "grade": new_grade, "ts": datetime.now().isoformat()})

    if new_grade == "A":
        log(f"  A-grade achieved on attempt {slice_state.iteration_count + 1}")
        if commit_slice(slice_state.slice_id, qid, hypothesis):
            log(f"  committed slice {slice_state.slice_id}")
        slice_state.status = "merged"
        update_slice_status(slice_state.slice_id, "merged")
        return slice_state

    # Step 5: not A — increment, revert, and let the outer loop iterate.
    slice_state.iteration_count += 1
    log(f"  not-A; reverting worktree and continuing (attempt {slice_state.iteration_count}/{max_iterations})")
    revert_worktree()

    if slice_state.iteration_count >= max_iterations:
        # Step 6: skip-decision audit.
        cap = slice_state.cap_extended_to or max_iterations
        if slice_state.iteration_count < cap:
            return slice_state  # cap was extended, keep going
        log("  iteration cap hit; asking codex for skip-decision")
        history_str = "\n".join(
            f"  attempt {i+1}: grade={h.get('grade','?')}"
            for i, h in enumerate(slice_state.history) if h.get("step") == "validation"
        )
        skip_prompt = SKIP_DECISION_PROMPT_TEMPLATE.format(
            iteration_count=slice_state.iteration_count,
            qid=qid,
            question_text=question_row.get("question", "?"),
            failure_mode=failure_mode,
            attempt_history=history_str
        )
        skip_response = codex_exec(skip_prompt, timeout_s=300)
        skip_verdict = extract_verdict_json(skip_response or "")
        decision = (skip_verdict or {}).get("decision", "SKIP")
        log(f"  skip-decision: {decision}")
        if decision == "SKIP":
            slice_state.status = "merged_skipped"
            update_slice_status(slice_state.slice_id, "merged_skipped")
        elif decision == "CONTINUE":
            slice_state.cap_extended_to = max_iterations + 5
        else:  # ESCALATE
            slice_state.status = "escalated"

    return slice_state


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--baseline", required=True, type=Path)
    p.add_argument("--base-url", default="http://127.0.0.1:3000")
    p.add_argument("--max-iterations", type=int, default=10)
    p.add_argument("--max-runtime-hours", type=float, default=24.0)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--snapshot", type=Path, default=None,
                   help="Path to a session_completeness snapshot JSON (Fix 6 input).")
    p.add_argument("--question", type=int, default=None,
                   help="Process ONLY this question id (smoke-test mode).")
    p.add_argument("--limit", type=int, default=None,
                   help="Process at most N slices (smoke-test mode).")
    args = p.parse_args()

    deadline = time.time() + args.max_runtime_hours * 3600.0

    # Load or initialize progress.
    progress: Optional[Progress] = None
    if args.resume:
        progress = load_progress()
        if progress:
            log(f"resuming from {PROGRESS_PATH} (started {progress.started_at})")
    if progress is None:
        # Build slice list from baseline: active-floor non-A questions.
        baseline = json.loads(args.baseline.read_text(encoding="utf8"))
        slices: Dict[str, SliceState] = {}
        for r in baseline.get("results", []):
            if r.get("baselineGrade") == "A":
                continue
            if r.get("floor_active_after_slice") is not None:
                continue  # deferred to a Phase 21 lift
            qid = r.get("id")
            if qid is None:
                continue
            sid = f"iter-19-q{qid}"
            slices[sid] = SliceState(slice_id=sid, question_id=qid)
        progress = Progress(
            started_at=datetime.now(timezone.utc).isoformat(),
            base_url=args.base_url,
            max_iterations=args.max_iterations,
            slices=slices
        )
        save_progress(progress)
        log(f"initialized progress with {len(slices)} active-floor non-A slices")

    # Graceful shutdown handler.
    def _on_signal(signum, _frame):
        log(f"received signal {signum}; checkpointing and exiting")
        save_progress(progress)
        sys.exit(0)
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    processed = 0
    for slice_id, slice_state in progress.slices.items():
        if time.time() > deadline:
            log("max runtime reached; checkpointing")
            break
        if args.question is not None and slice_state.question_id != args.question:
            continue
        if slice_state.status in ("merged", "merged_skipped", "escalated"):
            continue

        # Iterate this slice until it terminates or we exceed the cap.
        while slice_state.status not in ("merged", "merged_skipped", "escalated"):
            slice_state = process_slice(slice_state, args.baseline, args.base_url, args.max_iterations, args.snapshot)
            progress.slices[slice_id] = slice_state
            save_progress(progress)
            if time.time() > deadline:
                break

        processed += 1
        if args.limit is not None and processed >= args.limit:
            log(f"--limit {args.limit} reached; stopping")
            break

    # Summary.
    counts = {}
    for s in progress.slices.values():
        counts[s.status] = counts.get(s.status, 0) + 1
    log(f"DONE. status counts: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
