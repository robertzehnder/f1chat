#!/usr/bin/env bash
# scripts/loop/lib/tool_registry.sh
# §A.2 — Tool bundle registry. Enumerates wrapper bundles under the active
# tool root, emits docstrings + Claude Code --allowed-tools flag values.
#
# Active tool root resolution: prefers `.loop/tools/` (post-§5.4 migration);
# falls back to `scripts/loop/tools/` (pre-migration). One directory wins
# per invocation. Both must NOT coexist at runtime (would indicate a botched
# migration in progress).
#
# Subcommands:
#   list_bundles
#       Print one bundle name per line.
#
#   bundle_docstrings [--role=implementer|auditor]
#       Emit a markdown block of `<signature>\n<docstring>` pairs, one per bundle.
#       --role=implementer (default): all bundles EXCEPT slice_write_verdict.
#       --role=auditor: only read-only bundles (slice_view_history, slice_read_state).
#
#   bundle_allowed_tools_flag [--role=implementer|auditor]
#       Emit the value for --allowed-tools (comma-separated string).
#       Reads-prefix differs by role:
#         implementer: Read,Grep,Glob,<bundle-prefixes>
#         auditor:     Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),<read-only bundle-prefixes>
#
#   tool_root
#       Print the absolute path to the active tool root.
#
# All paths emitted are relative to LOOP_MAIN_WORKTREE (the host project root),
# which matches the dispatcher's CWD when invoking claude/codex.

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"

# --- Active tool-root resolution ---------------------------------------------
_tool_root_relative() {
  if [[ -d "$LOOP_MAIN_WORKTREE/.loop/tools" ]]; then
    echo ".loop/tools"
  elif [[ -d "$LOOP_MAIN_WORKTREE/scripts/loop/tools" ]]; then
    echo "scripts/loop/tools"
  else
    echo "tool_registry: no tool root found (neither .loop/tools/ nor scripts/loop/tools/ exists)" >&2
    return 1
  fi
}

# Auditor's restricted bundle set (no writes; only viewing).
# Per §A.4: only slice_view_history is exposed. slice_read_state would be a read tool
# but the auditor already has Read+Grep+Glob; the additional wrapper would be redundant
# and broaden the surface unnecessarily.
_auditor_bundles() {
  printf '%s\n' slice_view_history
}

list_bundles() {
  local root
  root="$(_tool_root_relative)" || return 1
  # Bundle is a directory containing config.yaml + bin/<same-name>.
  ( cd "$LOOP_MAIN_WORKTREE/$root" 2>/dev/null && \
      for d in */; do
        d="${d%/}"
        [[ -f "$d/config.yaml" && -x "$d/bin/$d" ]] && echo "$d"
      done
  )
}

bundle_docstrings() {
  local role="implementer" root
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --role=*) role="${1#--role=}"; shift ;;
      *) echo "bundle_docstrings: unknown arg $1" >&2; return 2 ;;
    esac
  done
  root="$(_tool_root_relative)" || return 1

  local bundles
  case "$role" in
    auditor)     bundles="$(_auditor_bundles)" ;;
    implementer) bundles="$(list_bundles)" ;;
    *) echo "bundle_docstrings: --role must be implementer|auditor" >&2; return 2 ;;
  esac

  # Concatenate signature + docstring from each bundle's config.yaml.
  # Minimal YAML reader (we control the schema — no need for yq runtime dep).
  while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    local cfg="$LOOP_MAIN_WORKTREE/$root/$b/config.yaml"
    [[ -f "$cfg" ]] || continue
    awk '
      /^tools:/ { in_tools = 1; next }
      in_tools && /^  [a-z_]+:/ {
        cmd = $1; sub(/:$/, "", cmd); in_cmd = 1; next
      }
      in_cmd && /^    signature:/ {
        sub(/^    signature: */, ""); gsub(/^"|"$/, "");
        sig = $0
      }
      in_cmd && /^    docstring:/ {
        sub(/^    docstring: */, ""); gsub(/^"|"$/, "");
        printf "- **%s**\n  %s\n\n", sig, $0;
      }
      /^[a-z]/ && !/^tools:/ { in_tools = 0; in_cmd = 0 }
    ' "$cfg"
  done <<< "$bundles"
}

bundle_allowed_tools_flag() {
  local role="implementer" root
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --role=*) role="${1#--role=}"; shift ;;
      *) echo "bundle_allowed_tools_flag: unknown arg $1" >&2; return 2 ;;
    esac
  done
  root="$(_tool_root_relative)" || return 1

  local prefix bundles entries=()
  case "$role" in
    implementer)
      prefix="Read,Grep,Glob"
      bundles="$(list_bundles)"
      ;;
    auditor)
      prefix="Read,Grep,Glob,Bash(git diff:*),Bash(git log:*)"
      bundles="$(_auditor_bundles)"
      ;;
    *) echo "bundle_allowed_tools_flag: --role must be implementer|auditor" >&2; return 2 ;;
  esac

  while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    # Pattern verified by §A.2-pre: Bash(./path/to/wrapper *) — space-wildcard form
    # accepts positional args. Pre-migration uses `./scripts/loop/tools/`; post-§5.4
    # uses `./.loop/tools/`. tool_root_relative picks the right one.
    entries+=("Bash(./$root/$b/bin/$b *)")
  done <<< "$bundles"

  # Join: prefix + each bundle entry, comma-separated.
  local joined="$prefix"
  for e in "${entries[@]}"; do
    joined="$joined,$e"
  done
  printf '%s' "$joined"
}

tool_root() {
  _tool_root_relative
}

# --- Dispatch ---------------------------------------------------------------
# When invoked as a script (not sourced), dispatch to the requested subcommand.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  cmd="${1:-}"
  shift || true
  case "$cmd" in
    list_bundles)             list_bundles "$@" ;;
    bundle_docstrings)        bundle_docstrings "$@" ;;
    bundle_allowed_tools_flag) bundle_allowed_tools_flag "$@" ;;
    tool_root)                tool_root ;;
    "") echo "Usage: $0 {list_bundles|bundle_docstrings|bundle_allowed_tools_flag|tool_root} [--role=implementer|auditor]" >&2; exit 2 ;;
    *)  echo "tool_registry: unknown subcommand: $cmd" >&2; exit 2 ;;
  esac
fi
