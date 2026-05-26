#!/usr/bin/env python3
"""
shell_parser.py — §B.2 shell-aware command parser for the approval-policy gate.

Usage:
  shell_parser.py check-shell <policy-yaml> <command-string>

Exit codes (encoded into stdout for the bash caller):
  prints one of:
    pass
    require_approval:<reason>
    forbidden:<reason>

The parser MUST walk command segments — naive substring matching on the raw
string misses `cmd1 && rm -rf /` where the second segment is the dangerous one
(documented anti-pattern; see plan §B.2 implementation reference, Cline parser).

Strategy:
  1. If `bashlex` is importable: use its full AST. Walk each CommandNode and
     each segment of compound commands.
  2. Otherwise: fall back to a conservative tokenizer that detects shell
     metacharacters and returns require_approval if the command contains any
     of: && || ; | $( ) ` > < >>. Naive but fail-safe — refuses to authorize
     compound commands without the AST.

Both paths check shell_prefixes (require_approval) and forbidden.patterns
against the parsed segments.
"""
import re
import sys
from pathlib import Path

try:
    import yaml as _yaml
except ImportError:
    _yaml = None


def _read_policy(policy_path: str) -> dict:
    text = Path(policy_path).read_text()
    if _yaml is not None:
        return _yaml.safe_load(text) or {}
    # Minimal YAML reader fallback — only supports the shapes we use.
    # Returns a dict with require_approval{paths,patch_patterns,shell_prefixes}
    # and forbidden{paths,patterns} as lists of strings.
    out: dict = {"require_approval": {}, "forbidden": {}}
    section = None
    subsection = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.endswith(":") and not line.startswith(" "):
            section = line[:-1]
            out.setdefault(section, {})
            subsection = None
            continue
        if line.endswith(":") and line.startswith("  ") and not line.startswith("    "):
            subsection = line.strip()[:-1]
            out[section].setdefault(subsection, [])
            continue
        if line.startswith("    - "):
            val = line[6:].strip()
            # Strip outer quotes + interpret YAML double-quote escapes (\\, \", \n, \t).
            if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
                inner = val[1:-1]
                # Translate common escapes.
                inner = inner.encode().decode("unicode_escape")
                val = inner
            elif len(val) >= 2 and val[0] == "'" and val[-1] == "'":
                val = val[1:-1]  # single-quoted: literal, no escapes
            if section and subsection is not None:
                out[section][subsection].append(val)
    return out


def _split_segments_bashlex(cmd: str) -> list[str]:
    """Use bashlex AST to extract individual command segments."""
    import bashlex  # type: ignore

    trees = bashlex.parse(cmd)
    segments: list[str] = []

    def visit(node):
        kind = node.kind
        if kind == "command":
            # Reconstruct the command's source text from its position.
            segments.append(cmd[node.pos[0] : node.pos[1]])
        elif kind in ("list", "compound", "if", "for", "while", "case", "pipeline"):
            for child in getattr(node, "parts", []) or []:
                visit(child)
        elif kind == "commandsubstitution":
            # $(...) — the inner command is a separate segment.
            for child in getattr(node, "command", node).parts or []:
                visit(child)
        elif kind == "operator":
            pass  # &&, ||, ;, | — separators, not commands themselves
        else:
            # Walk children defensively.
            for child in getattr(node, "parts", []) or []:
                visit(child)

    for t in trees:
        visit(t)
    return segments


def _has_shell_metachars(cmd: str) -> bool:
    """Conservative fallback detector for shell composition."""
    # & (without surrounding char checks), &&, ||, ;, |, $(, `, >, >>, <
    # Skip detection of shell operators inside single-quoted strings.
    in_squote = False
    in_dquote = False
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if c == "'" and not in_dquote:
            in_squote = not in_squote
        elif c == '"' and not in_squote:
            in_dquote = not in_dquote
        elif not in_squote and not in_dquote:
            if c in ";|&`" or (c == "$" and i + 1 < len(cmd) and cmd[i + 1] == "("):
                return True
            if c in "<>":
                return True
        i += 1
    return False


def check_shell(policy_path: str, cmd: str) -> str:
    policy = _read_policy(policy_path)
    ra = policy.get("require_approval", {}) or {}
    fb = policy.get("forbidden", {}) or {}
    shell_prefixes: list[str] = ra.get("shell_prefixes") or []
    forbidden_patterns: list[str] = fb.get("patterns") or []

    # Try AST-based segmentation first.
    try:
        segments = _split_segments_bashlex(cmd)
    except ImportError:
        if _has_shell_metachars(cmd):
            return "require_approval:bashlex_unavailable_and_command_contains_shell_operators"
        segments = [cmd]
    except Exception as e:  # noqa: BLE001
        # bashlex parse error — treat as suspicious.
        return f"require_approval:shell_parse_error:{e}"

    if not segments:
        segments = [cmd]

    # Check each segment against forbidden first (most restrictive), then prefixes.
    for seg in segments:
        seg_stripped = seg.strip()
        for pat in forbidden_patterns:
            if re.search(pat, seg_stripped):
                return f"forbidden:pattern={pat!r} matched segment={seg_stripped!r}"
        for prefix in shell_prefixes:
            if seg_stripped.startswith(prefix):
                return f"require_approval:prefix={prefix!r} matched segment={seg_stripped!r}"

    return "pass"


def main() -> None:
    if len(sys.argv) < 4 or sys.argv[1] != "check-shell":
        print("Usage: shell_parser.py check-shell <policy-yaml> <command-string>", file=sys.stderr)
        sys.exit(2)
    policy_path = sys.argv[2]
    cmd = sys.argv[3]
    print(check_shell(policy_path, cmd))


if __name__ == "__main__":
    main()
