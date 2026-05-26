#!/usr/bin/env bash
# scripts/loop/lib/pack_resolver.sh
# §A.3 — Model pack resolver. Reads .loop-packs.yaml + active pack name,
# exports LOOP_MODEL_PLANNER/IMPLEMENTER/AUDITOR/SUMMARIZER. Fallback-on-unset
# is the Plandex GetCoder() pattern: missing roles inherit the planner.
#
# Source this script from runner.sh (or any dispatcher) BEFORE invoking the
# agent CLI. The exported vars are consumed by dispatch_claude.sh,
# dispatch_codex.sh, dispatch_plan_revise.sh.
#
# Precedence for active pack name:
#   1. LOOP_PACK env var (explicit per-run override)
#   2. .loop-config.yaml `active_pack:` field
#   3. `default_pack:` field in .loop-packs.yaml
#   4. Hardcoded fallback: nightly-cost-optimized
#
# Backward compat: LOOP_CLAUDE_IMPL_MODEL and CODEX_AUDIT_MODEL are still
# honored if the pack-derived vars are absent (one-cycle migration window).

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"

_packs_yaml() {
  local p="$LOOP_MAIN_WORKTREE/.loop-packs.yaml"
  if [[ ! -f "$p" ]]; then
    # Fallback to .loop-defaults/ if host-level file missing (pre-setup state).
    p="$LOOP_MAIN_WORKTREE/scripts/loop/.loop-defaults/.loop-packs.yaml"
  fi
  [[ -f "$p" ]] || { echo "pack_resolver: no .loop-packs.yaml found" >&2; return 1; }
  echo "$p"
}

_config_yaml() {
  local p="$LOOP_MAIN_WORKTREE/.loop-config.yaml"
  [[ -f "$p" ]] && echo "$p"
}

# Resolve the active pack name using the precedence above.
resolve_active_pack() {
  if [[ -n "${LOOP_PACK:-}" ]]; then
    echo "$LOOP_PACK"; return
  fi
  local cfg
  cfg="$(_config_yaml || true)"
  if [[ -n "$cfg" ]]; then
    local from_cfg
    from_cfg="$(awk '/^active_pack:/ { sub(/^[^:]+: */, ""); print; exit }' "$cfg")"
    if [[ -n "$from_cfg" ]]; then
      echo "$from_cfg"; return
    fi
  fi
  local packs
  packs="$(_packs_yaml)" || return 1
  local from_packs
  from_packs="$(awk '/^default_pack:/ { sub(/^[^:]+: */, ""); print; exit }' "$packs")"
  if [[ -n "$from_packs" ]]; then
    echo "$from_packs"; return
  fi
  echo "nightly-cost-optimized"
}

# Resolve one role's model from a pack. Returns "provider:model" or empty if absent.
# Args: <pack-name> <role>
resolve_pack_role() {
  local pack="$1" role="$2"
  local packs
  packs="$(_packs_yaml)" || return 1

  # Minimal YAML walker — find `<pack>:` block, then `<role>:` line within it.
  python3 - "$packs" "$pack" "$role" <<'PY'
import sys, re
path, pack, role = sys.argv[1:4]
with open(path) as fh: text = fh.read()
# Find the pack block. Pack names are at `  <name>:` indentation under `packs:`.
m = re.search(r'^packs:\s*\n(.*?)(?=\n\S|\Z)', text, flags=re.M | re.S)
if not m: sys.exit("no packs: section")
packs_body = m.group(1)
# Each pack starts at `  <name>:` (2 spaces indent).
pack_blocks = re.split(r'(?m)^(  [a-z][\w-]*:)', packs_body)
# split gives [..., '  packname:', body, '  next:', body, ...]
found = None
for i in range(1, len(pack_blocks), 2):
  if pack_blocks[i].strip().rstrip(':') == pack:
    found = pack_blocks[i+1] if i+1 < len(pack_blocks) else ''
    break
if found is None:
  sys.exit(f"pack {pack!r} not found")
# Find `    <role>: { provider: X, model: Y }`
rm = re.search(rf'^    {role}:\s*\{{\s*provider:\s*([\w-]+)\s*,\s*model:\s*([\w.-]+)\s*\}}\s*$', found, flags=re.M)
if rm:
  print(f"{rm.group(1)}:{rm.group(2)}")
PY
}

# Resolve a role with fallback to planner (Plandex GetCoder pattern).
# Sets PROVIDER and MODEL bash vars (caller reads).
# Args: <pack-name> <role>
_resolve_role_with_fallback() {
  local pack="$1" role="$2"
  local pm
  pm="$(resolve_pack_role "$pack" "$role" 2>/dev/null || true)"
  if [[ -z "$pm" ]] && [[ "$role" != "planner" ]]; then
    pm="$(resolve_pack_role "$pack" planner 2>/dev/null || true)"
  fi
  if [[ -z "$pm" ]]; then
    return 1
  fi
  PROVIDER="${pm%%:*}"
  MODEL="${pm#*:}"
}

# Main entry: resolve all four roles, export env vars.
loop_export_pack_models() {
  local pack
  pack="$(resolve_active_pack)" || return 1

  local role
  for role in planner implementer auditor summarizer; do
    if _resolve_role_with_fallback "$pack" "$role"; then
      case "$role" in
        planner)     export LOOP_MODEL_PLANNER="$MODEL"     LOOP_PROVIDER_PLANNER="$PROVIDER" ;;
        implementer) export LOOP_MODEL_IMPLEMENTER="$MODEL" LOOP_PROVIDER_IMPLEMENTER="$PROVIDER" ;;
        auditor)     export LOOP_MODEL_AUDITOR="$MODEL"     LOOP_PROVIDER_AUDITOR="$PROVIDER" ;;
        summarizer)  export LOOP_MODEL_SUMMARIZER="$MODEL"  LOOP_PROVIDER_SUMMARIZER="$PROVIDER" ;;
      esac
    fi
  done

  export LOOP_ACTIVE_PACK="$pack"
}

# --- Dispatch ---------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  cmd="${1:-}"
  shift || true
  case "$cmd" in
    resolve_active_pack)  resolve_active_pack ;;
    resolve_pack_role)    resolve_pack_role "$@" ;;
    export_models)
      loop_export_pack_models
      echo "LOOP_ACTIVE_PACK=$LOOP_ACTIVE_PACK"
      echo "LOOP_MODEL_PLANNER=${LOOP_MODEL_PLANNER:-(unset)}"
      echo "LOOP_MODEL_IMPLEMENTER=${LOOP_MODEL_IMPLEMENTER:-(unset)}"
      echo "LOOP_MODEL_AUDITOR=${LOOP_MODEL_AUDITOR:-(unset)}"
      echo "LOOP_MODEL_SUMMARIZER=${LOOP_MODEL_SUMMARIZER:-(unset)}"
      ;;
    "") echo "Usage: $0 {resolve_active_pack|resolve_pack_role <pack> <role>|export_models}" >&2; exit 2 ;;
    *)  echo "pack_resolver: unknown subcommand: $cmd" >&2; exit 2 ;;
  esac
fi
