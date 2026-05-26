#!/usr/bin/env bash
# scripts/loop/setup_host_project.sh
#
# Idempotent + self-healing host-project setup. Run from the host project root
# AFTER mounting the loop submodule at .loop/. Pre-migration (during in-place
# development inside the OpenF1 host) this script is not meaningfully runnable —
# its paths assume the .loop/ mountpoint exists. Use directly post-migration.
#
# Usage:
#   ./.loop/setup_host_project.sh                  # idempotent setup
#   ./.loop/setup_host_project.sh --reset-references-dir
#                                                   # clear persisted loop_references_dir
set -euo pipefail

# --- Flag parsing ------------------------------------------------------------
reset_refs=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reset-references-dir) reset_refs=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--reset-references-dir]"
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- Helper sourcing (bootstrap-safe) ----------------------------------------
# Run BEFORE any filesystem mutation. If the .loop submodule is old/partial, fail
# loud here with a friendly diagnostic so the host repo isn't half-mutated when we
# discover the problem. Note: setup does NOT use the helper's host-root resolver
# (`_loop_refs_dir__host_root`) because that resolver prefers
# `--show-superproject-working-tree` — correct for the helper's normal caller
# (scripts running from inside `.loop/`, where the superproject IS the host), but
# WRONG when the host project is itself a Git submodule of an outer superproject
# (the helper would return the outer superproject, not the host). For setup,
# the host project IS the cwd; we validate that directly below. The helper is
# still sourced (rather than skipped) so we can reuse `_loop_refs_dir__has_canaries`
# for the references-dir preflight further down.
helper_path=".loop/scripts/loop/lib/loop_refs_dir.sh"
if [ ! -f "$helper_path" ]; then
  echo "ERROR: $helper_path missing." >&2
  echo "  The .loop submodule is present but missing required helpers." >&2
  echo "  Try: git -C .loop pull origin main   (or check loop version compatibility)" >&2
  exit 3
fi
# shellcheck source=scripts/loop/lib/loop_refs_dir.sh
# shellcheck disable=SC1091
source "$helper_path"

# --- Setup-specific host-root resolution -------------------------------------
# Setup's contract: invoked from the host project root. We validate that contract
# explicitly rather than discovering the root via git, because git discovery cannot
# distinguish "host project that is a submodule" from "submodule inside a host
# project."
#
# Resolution:
#   - LOOP_HOST_ROOT set: must exist (fail loud on bad path); canonicalize via cd+pwd -P.
#   - LOOP_HOST_ROOT unset: use pwd -P (canonical cwd, symlink-resolved).
# Then assert it equals our canonical pwd. The assertion catches both:
#   - user cd'd into a subdirectory (would write defaults to the wrong place)
#   - LOOP_HOST_ROOT points elsewhere than pwd (silent two-repo drift)
if [ -n "${LOOP_HOST_ROOT:-}" ]; then
  if [ ! -d "$LOOP_HOST_ROOT" ]; then
    echo "ERROR: LOOP_HOST_ROOT='$LOOP_HOST_ROOT' is set but does not exist." >&2
    echo "  Fix the env var or unset it." >&2
    exit 4
  fi
  loop_host_root="$(cd "$LOOP_HOST_ROOT" && pwd -P)"
else
  loop_host_root="$(pwd -P)"
fi

pwd_canonical="$(pwd -P)"
if [ "$loop_host_root" != "$pwd_canonical" ]; then
  echo "ERROR: resolved host root differs from current directory." >&2
  echo "  resolved host root: $loop_host_root" >&2
  echo "  current directory:  $pwd_canonical" >&2
  echo "  Setup writes defaults/state/gitignore/slices relative to PWD, but downstream" >&2
  echo "  helpers read config from the resolved host root. Mismatch would create silent" >&2
  echo "  two-repo drift. Fix: cd '$loop_host_root' && ./.loop/setup_host_project.sh" >&2
  echo "  OR: unset LOOP_HOST_ROOT and re-run from the desired host root." >&2
  exit 4
fi

# --- Required defaults catalog -----------------------------------------------
# Each entry: relative-path-in-host : relative-path-in-defaults
# Per-file enumeration (not `cp -rn dir dir`) ensures missing files get healed
# even if the parent directory already exists.
required_files=(
  ".loop-rules/global.md:.loop-defaults/.loop-rules/global.md"
  ".loop-rules/migrations-safety.md:.loop-defaults/.loop-rules/migrations-safety.md"
  ".loop-rules/approval-policy.yaml:.loop-defaults/.loop-rules/approval-policy.yaml"
  ".loop-packs.yaml:.loop-defaults/.loop-packs.yaml"
  ".loop-config.yaml:.loop-defaults/.loop-config.yaml"
)

# 1. Per-file copy with explicit presence check.
mkdir -p .loop-rules
for pair in "${required_files[@]}"; do
  host_path="${pair%%:*}"
  src_path=".loop/${pair#*:}"
  if [ ! -f "$host_path" ]; then
    if [ ! -f "$src_path" ]; then
      echo "ERROR: default missing from submodule: $src_path" >&2
      exit 2
    fi
    mkdir -p "$(dirname "$host_path")"
    cp "$src_path" "$host_path"
    echo "  copied: $host_path"
  fi
done

# 2. Create runtime state tree (NEVER inside .loop/).
mkdir -p .loop-state/{pending_approvals,dispatches,locks}

# 3. Append .loop-state/ and .loop-worktrees/ to host .gitignore (idempotent).
touch .gitignore
for entry in '.loop-state/' '.loop-worktrees/'; do
  grep -qxF "$entry" .gitignore || echo "$entry" >> .gitignore
done

# 4. Slice queue directory.
mkdir -p diagnostic/slices

# 5. Reference-repos preflight (warning, not fatal — references are docs, not runtime deps).
#    Resolution order: explicit env override → default <host-parent-parent>/loop-references.
#    From host repo root (cwd), going up two levels reaches the coding/ grandparent;
#    /loop-references is its sibling-of-host-parent.
if [ -n "${LOOP_REFERENCES_DIR:-}" ]; then
  ref_root="$LOOP_REFERENCES_DIR"
else
  # Use the canonical pwd computed above (pwd -P) so a host invoked via a
  # symlinked path still produces a canonical ref_root; trailing `pwd -P` keeps
  # the resolved path symlink-free.
  ref_root="$(cd "$pwd_canonical/../.." && pwd -P)/loop-references"
fi

# Persist the resolved location so downstream scripts can read it without recomputing.
# Behavior (canary-gated; persistence happens only if 2-canary check passes):
#   - First run + path EXISTS: append `loop_references_dir: <value>` to .loop-config.yaml.
#   - First run + path MISSING: emit warning; do NOT persist (downstream falls through to
#     env-var or default-with-existence-check via lib/loop_refs_dir.sh).
#   - Existing key present (no --reset): DO NOT overwrite (config is canonical).
#   - --reset-references-dir + path EXISTS: clear the existing key and re-add with new value.
#   - --reset-references-dir + path MISSING: clear the existing key and DO NOT re-add; emit
#     loud warning. Downstream then falls through to env-var or default. This prevents the
#     reset path from persisting a known-bad value that would mislead downstream resolvers.
ref_root_exists=false
if _loop_refs_dir__has_canaries "$ref_root"; then
  ref_root_exists=true
fi

if [ -f .loop-config.yaml ]; then
  has_key=$(grep -c '^loop_references_dir:' .loop-config.yaml || true)

  if [ "$reset_refs" = "1" ]; then
    # Clear existing key (idempotent) regardless of new path validity.
    if [ "$has_key" -gt 0 ]; then
      sed -i.bak '/^loop_references_dir:/d' .loop-config.yaml && rm -f .loop-config.yaml.bak
      echo "  cleared: loop_references_dir from .loop-config.yaml"
    fi
    if [ "$ref_root_exists" = "true" ]; then
      echo "loop_references_dir: $ref_root" >> .loop-config.yaml
      echo "  persisted: loop_references_dir = $ref_root"
    else
      echo "  WARN: --reset-references-dir but new path '$ref_root' lacks canaries (plandex/, swe-agent/)" >&2
      echo "        not persisting; downstream falls through to env-var or default" >&2
    fi
  else
    if [ "$has_key" = "0" ] && [ "$ref_root_exists" = "true" ]; then
      echo "loop_references_dir: $ref_root" >> .loop-config.yaml
      echo "  persisted: loop_references_dir = $ref_root"
    fi
  fi
fi

# 6. Final warnings (split: canary fail = WARNING; complete fail = NOTE).
if [ "$ref_root_exists" != "true" ]; then
  echo "" >&2
  echo "WARNING: loop-references directory not found or missing canaries (plandex/, swe-agent/)" >&2
  echo "  expected: $ref_root" >&2
  echo "  References are documentation (not runtime deps), so this is non-fatal." >&2
  echo "  To populate:" >&2
  echo "    mkdir -p \"$(dirname "$ref_root")\" && cd \"$(dirname "$ref_root")\"" >&2
  echo "    git clone --depth=1 https://github.com/plandex-ai/plandex.git" >&2
  echo "    git clone --depth=1 https://github.com/swe-agent/SWE-agent.git swe-agent" >&2
  echo "    git clone --depth=1 https://github.com/cline/cline.git" >&2
  echo "    git clone --depth=1 https://github.com/Aider-AI/aider.git" >&2
  echo "    git clone --depth=1 https://github.com/gsd-redux/gsd-redux.git" >&2
elif [ ! -d "$ref_root/cline" ] || [ ! -d "$ref_root/aider" ]; then
  echo "" >&2
  echo "NOTE: loop-references has the 2-canary minimum but is missing cline/ and/or aider/" >&2
  echo "  Tier 2/3 docs reference cline; Tier 4 docs reference aider. Add to get full coverage." >&2
fi

# 7. Verification.
echo ""
echo "Setup complete."
echo "  host root:    $loop_host_root"
echo "  state dir:    $loop_host_root/.loop-state"
echo "  rules dir:    $loop_host_root/.loop-rules"
echo "  references:   $ref_root (exists=$ref_root_exists)"
