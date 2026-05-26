# scripts/loop/lib/loop_refs_dir.sh
# Source from any reference-aware script:
#   source "$(dirname "$0")/lib/loop_refs_dir.sh"
# Then call:
#   refs=$(resolve_loop_refs_dir) || { echo "no refs"; exit 1; }
#
# Resolves where the documentation-reference repos (plandex, swe-agent, cline,
# aider, gsd-redux) live. The references are docs only — no runtime dependency.
# Precedence: LOOP_REFERENCES_DIR env → host-root config (.loop-config.yaml) →
# default <host-grandparent>/loop-references.
#
# Per the rev15 plan: setup does NOT use _loop_refs_dir__host_root (it would
# return the outer superproject when the host itself is a submodule). Setup
# does its own pwd-based host-root resolution. This helper's resolver IS used
# by downstream callers running from inside .loop/, where
# --show-superproject-working-tree correctly returns the host.

_loop_refs_dir__has_canaries() {
  # Returns 0 iff "$1" exists AND contains plandex/ AND swe-agent/.
  # These two are the minimum-usable set (the resolver's gate); the four-canary
  # check (+ cline + aider) is the full-docs gate used by the setup warning.
  [ -d "$1" ] && [ -d "$1/plandex" ] && [ -d "$1/swe-agent" ]
}

_loop_refs_dir__host_root() {
  # Resolution order for the helper's host root (downstream callers only):
  #   1. LOOP_HOST_ROOT env override — if SET but invalid, FAIL LOUD.
  #   2. git rev-parse --show-superproject-working-tree (correct when called
  #      from inside .loop/ submodule — returns the parent host working tree).
  #   3. git rev-parse --show-toplevel (correct when called from a non-submodule
  #      host repo).
  #   4. pwd as last resort.
  if [ -n "${LOOP_HOST_ROOT:-}" ]; then
    if [ -d "$LOOP_HOST_ROOT" ]; then
      printf '%s' "$LOOP_HOST_ROOT"
      return 0
    fi
    echo "loop_refs_dir: LOOP_HOST_ROOT='$LOOP_HOST_ROOT' is set but does not exist." >&2
    echo "  Refusing to fall through to git discovery — fix the env var or unset it." >&2
    return 1
  fi
  local super
  super="$(git rev-parse --show-superproject-working-tree 2>/dev/null)"
  if [ -n "$super" ]; then
    printf '%s' "$super"
    return 0
  fi
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$top" ]; then
    printf '%s' "$top"
    return 0
  fi
  pwd
}

resolve_loop_refs_dir() {
  local candidate=""

  # 1. Env override.
  if [ -n "${LOOP_REFERENCES_DIR:-}" ] && _loop_refs_dir__has_canaries "$LOOP_REFERENCES_DIR"; then
    printf '%s' "$LOOP_REFERENCES_DIR"
    return 0
  fi

  # 2. Persisted config.
  local host_root
  host_root="$(_loop_refs_dir__host_root)" || return 1   # propagate LOOP_HOST_ROOT fail-loud
  if [ -f "$host_root/.loop-config.yaml" ]; then
    candidate="$(grep '^loop_references_dir:' "$host_root/.loop-config.yaml" \
      | head -n1 | sed 's/^loop_references_dir:[[:space:]]*//' | tr -d '"')"
    if [ -n "$candidate" ] && _loop_refs_dir__has_canaries "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  fi

  # 3. Default.
  candidate="$(cd "$host_root/../.." && pwd -P)/loop-references"
  if _loop_refs_dir__has_canaries "$candidate"; then
    printf '%s' "$candidate"
    return 0
  fi

  # 4. Unresolved.
  echo "loop_refs_dir: unable to resolve — set LOOP_REFERENCES_DIR or run .loop/setup_host_project.sh" >&2
  return 1
}
