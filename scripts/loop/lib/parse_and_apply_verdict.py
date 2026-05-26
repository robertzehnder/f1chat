#!/usr/bin/env python3
"""
parse_and_apply_verdict.py — §A.4 runner-side auditor verdict parser + writer.

Usage:
  parse_and_apply_verdict.py <capture_file> <slice_id> <slice_worktree>

Exit codes:
  0 — verdict applied (slice file mutated + commit landed on proposal branch)
  2 — no/malformed verdict block (slice stays awaiting_audit; runner retries)
  3 — parse OK but transaction (append/flip/commit) failed

The parser counts delimiter lines BEFORE extraction. Requires EXACTLY ONE each
of `===VERDICT-START===`, `===BODY===`, `===VERDICT-END===` lines, anchored as
full lines. Closes v2.8 audit HIGH #1 (regex-based extraction silently truncated
on body-embedded END markers).

The whole transaction runs in this Python process — kind/body never traverse a
bash variable boundary, eliminating shell-quoting attack surface (closes v2.8
HIGH #2 / v2.7 HIGH). Body is passed to bash helpers via env var, not shell arg.

Required env: LOOP_MAIN_WORKTREE (path to slice_helpers.sh).
"""
import os
import re
import subprocess
import sys
from pathlib import Path

START = "===VERDICT-START==="
BODY_DEL = "===BODY==="
END = "===VERDICT-END==="

VERDICT_TO_STATUS = {
    "pass":   ("ready_to_merge", "user"),
    "revise": ("revising",       "claude"),
    "reject": ("blocked",        "user"),
}


def _fail(msg: str, exit_code: int = 2) -> "NoReturn":
    print(msg, file=sys.stderr)
    sys.exit(exit_code)


def parse_verdict(capture_path: str) -> tuple[str, str]:
    """Return (kind, body) or fail with exit 2."""
    text = Path(capture_path).read_text()
    lines = text.splitlines()

    # Count delimiter lines BEFORE extraction. Each must appear EXACTLY ONCE,
    # as its own full line (counting via .count is exact-line match because
    # splitlines() drops the trailing newline).
    counts = (lines.count(START), lines.count(BODY_DEL), lines.count(END))
    if counts != (1, 1, 1):
        _fail(
            f"malformed_verdict_block: expected exactly one each of "
            f"{START!r}, {BODY_DEL!r}, {END!r}; got counts {counts}"
        )

    i_start = lines.index(START)
    i_body = lines.index(BODY_DEL)
    i_end = lines.index(END)
    if not (i_start < i_body < i_end):
        _fail(
            f"malformed_verdict_block: delimiter order wrong "
            f"(START@{i_start}, BODY@{i_body}, END@{i_end}; "
            f"expected START < BODY < END)"
        )

    header_lines = lines[i_start + 1 : i_body]
    body_lines = lines[i_body + 1 : i_end]

    if len(header_lines) != 1:
        _fail(
            f"malformed_verdict_block: header must be exactly one line, "
            f"got {len(header_lines)}"
        )

    km = re.fullmatch(r"kind:\s*(pass|revise|reject)\s*", header_lines[0])
    if not km:
        _fail(f"bad_verdict_kind: {header_lines[0]!r}")

    kind = km.group(1)
    body = "\n".join(body_lines)
    return kind, body


def apply_verdict(slice_id: str, slice_worktree: str, kind: str, body: str) -> None:
    """Append audit section + flip status + commit. Exits 3 on failure."""
    loop_root = os.environ.get("LOOP_MAIN_WORKTREE")
    if not loop_root:
        _fail("LOOP_MAIN_WORKTREE env not set", 3)

    helpers = f"{loop_root}/scripts/loop/slice_helpers.sh"
    if not os.path.isfile(helpers):
        _fail(f"slice_helpers.sh not found at {helpers}", 3)

    new_status, new_owner = VERDICT_TO_STATUS[kind]

    # Compose a bash one-liner that sources helpers and runs the transaction.
    # Body goes through env (VERDICT_BODY), not shell argv — no quoting hazard.
    env = {
        **os.environ,
        "WORKING_DIR": slice_worktree,
        "VERDICT_BODY": body,
        "LOOP_MAIN_WORKTREE": loop_root,
    }

    bash_cmd = (
        f'source "{helpers}" && '
        f'append_slice_section "{slice_id}" "## Audit verdict" "$VERDICT_BODY" && '
        f'flip_slice_status "{slice_id}" "{new_status}" "{new_owner}"'
    )

    try:
        subprocess.run(
            ["bash", "-c", bash_cmd],
            cwd=slice_worktree,
            env=env,
            check=True,
        )
        subprocess.run(
            ["git", "add", f"diagnostic/slices/{slice_id}.md"],
            cwd=slice_worktree,
            check=True,
        )
        subprocess.run(
            [
                "git",
                "commit",
                "-m",
                f"audit: {slice_id} → {kind} [slice:{slice_id}][audit:{kind}]",
            ],
            cwd=slice_worktree,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        _fail(f"transaction_failed: {e}", 3)


def main() -> None:
    if len(sys.argv) != 4:
        print(
            "Usage: parse_and_apply_verdict.py <capture_file> <slice_id> <slice_worktree>",
            file=sys.stderr,
        )
        sys.exit(2)

    capture_path, slice_id, slice_worktree = sys.argv[1:4]
    kind, body = parse_verdict(capture_path)
    apply_verdict(slice_id, slice_worktree, kind, body)
    print(kind)


if __name__ == "__main__":
    main()
