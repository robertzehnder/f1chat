#!/usr/bin/env bash
# scripts/loop/spikes/tool_surface_preflight.sh
#
# §4.1.2-pre — four-case `--allowed-tools` pattern preflight.
#
# Goal: empirically determine which `--allowed-tools` pattern form Claude Code
# accepts for prefix-matching bash invocations against `.loop/tools/<name>/bin/<name>`.
#
# Verification uses deterministic filesystem markers (PREFLIGHT_MARKER_FILE /
# PREFLIGHT_SIBLING_MARKER_FILE), not model readback — so model paraphrasing,
# omission, and hallucination are out of the verification loop.
#
# Output:
#   diagnostic/cli_preflight_<YYYY-MM-DD>.md  (winning pattern + per-case results)
#
# Cost: ~4 cases × N candidate patterns × ~1 short `claude -p` call each.
# Budget roughly $0.20-$0.50. Refuses without LOOP_SPIKE_BUDGET_OK=1.
set -euo pipefail

if [ "${LOOP_SPIKE_BUDGET_OK:-0}" != "1" ]; then
  echo "Refusing to run: this preflight calls the live Claude API (~\$0.20-\$0.50)." >&2
  echo "  Re-run with: LOOP_SPIKE_BUDGET_OK=1 $0" >&2
  exit 2
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: 'claude' CLI not found on PATH." >&2
  exit 3
fi

today="$(date +%Y-%m-%d)"
report="diagnostic/cli_preflight_${today}.md"
mkdir -p diagnostic

# --- Stand up production-shaped fixtures -------------------------------------
# Per the plan, fixtures must use the EXACT path shape `.loop/tools/<name>/bin/<name>`
# so the verified pattern maps directly to runtime.
#
# Pre-migration adjustment: if `.loop/` doesn't exist (we're not yet a submodule),
# stand fixtures under `scripts/loop/tools/` and report a "PRE-MIGRATION" caveat.
if [ -d .loop ]; then
  fixture_root=".loop/tools"
  path_prefix="./.loop/tools"
else
  fixture_root="scripts/loop/tools"
  path_prefix="./scripts/loop/tools"
  echo "NOTE: .loop/ submodule not present; using $fixture_root. Re-run AFTER submodule migration to validate the production path."
fi

mkdir -p "$fixture_root/preflight_test/bin" "$fixture_root/preflight_test_other/bin"

cat > "$fixture_root/preflight_test/config.yaml" <<'YAML'
tools:
  preflight_test:
    signature: "preflight_test <arg1> <arg2>"
    docstring: "Test fixture for §4.1.2-pre. Writes its args to PREFLIGHT_MARKER_FILE."
YAML

cat > "$fixture_root/preflight_test/bin/preflight_test" <<'BASH'
#!/usr/bin/env bash
if [ -z "${PREFLIGHT_MARKER_FILE:-}" ]; then
  echo "ERROR: PREFLIGHT_MARKER_FILE not set" >&2
  exit 1
fi
printf '%s|%s' "$1" "$2" > "$PREFLIGHT_MARKER_FILE"
echo "ok arg1=$1 arg2=$2 (marker: $PREFLIGHT_MARKER_FILE)"
BASH
chmod +x "$fixture_root/preflight_test/bin/preflight_test"

cat > "$fixture_root/preflight_test_other/config.yaml" <<'YAML'
tools:
  preflight_test_other:
    signature: "preflight_test_other <arg1> <arg2>"
    docstring: "Sibling fixture for Case (d) — should NOT run under any narrow pattern."
YAML

cat > "$fixture_root/preflight_test_other/bin/preflight_test_other" <<'BASH'
#!/usr/bin/env bash
if [ -z "${PREFLIGHT_SIBLING_MARKER_FILE:-}" ]; then
  echo "ERROR: PREFLIGHT_SIBLING_MARKER_FILE not set" >&2
  exit 1
fi
printf 'sibling_ran' > "$PREFLIGHT_SIBLING_MARKER_FILE"
BASH
chmod +x "$fixture_root/preflight_test_other/bin/preflight_test_other"

# Edit fixture for Case (b): a file we can verify did NOT change.
mkdir -p tmp
edit_fixture="tmp/preflight_case_b_fixture.txt"
echo "foo" > "$edit_fixture"
edit_baseline_hash="$(shasum "$edit_fixture" | awk '{print $1}')"

# Private tmpdir for markers — survives the whole run, cleaned on exit.
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir" "$edit_fixture" "$fixture_root/preflight_test" "$fixture_root/preflight_test_other"' EXIT

# --- Candidate patterns ------------------------------------------------------
# In order of simplicity. EXCLUDED ones are commented out per the plan's selection
# rules (must permit arg passthrough, must reject siblings).
candidates=(
  "Bash(${path_prefix}/preflight_test/bin/preflight_test *)"
  "Bash(${path_prefix}/preflight_test/*)"
  "Bash(${path_prefix#./}/preflight_test/bin/preflight_test *)"
)

deny_list="Edit,Write,MultiEdit"

run_case() {
  # $1 = candidate pattern, $2 = case label, $3 = prompt
  local pattern="$1" label="$2" prompt="$3"
  echo "    [$label] pattern: $pattern"
  claude -p "$prompt" \
    --allowed-tools "$pattern" \
    --disallowed-tools "$deny_list" \
    >"$tmpdir/last_stdout" 2>"$tmpdir/last_stderr" || true
  return 0
}

results_md=()
winning_pattern=""

for pattern in "${candidates[@]}"; do
  echo ""
  echo "=== Testing pattern: $pattern ==="

  # Reset markers + edit fixture before each pattern.
  marker_file="$tmpdir/main_marker"
  sibling_marker="$tmpdir/sibling_marker"
  rm -f "$marker_file" "$sibling_marker"
  echo "foo" > "$edit_fixture"

  export PREFLIGHT_MARKER_FILE="$marker_file"
  export PREFLIGHT_SIBLING_MARKER_FILE="$sibling_marker"

  pass_a=false; pass_b=false; pass_c=false; pass_d=false

  # Case (a): allowed wrapper succeeds with arguments
  run_case "$pattern" "(a)" \
    "Run ${path_prefix}/preflight_test/bin/preflight_test with arguments SLICE-001 sample-input.patch"
  if [ -f "$marker_file" ] && [ "$(cat "$marker_file")" = "SLICE-001|sample-input.patch" ]; then
    pass_a=true
  fi

  # Case (b): disallowed Edit fails
  run_case "$pattern" "(b)" \
    "Edit ./$edit_fixture to change 'foo' to 'bar' using the Edit tool"
  current_hash="$(shasum "$edit_fixture" | awk '{print $1}')"
  if [ "$current_hash" = "$edit_baseline_hash" ]; then
    pass_b=true
  fi

  # Case (c): disallowed Bash(ls) fails (allowlist must NOT match ls)
  run_case "$pattern" "(c)" \
    "List the files in the current directory by running ls"
  if ! grep -qE '\b(loop|node_modules|package\.json|web)\b' "$tmpdir/last_stdout" 2>/dev/null; then
    pass_c=true
  fi

  # Case (d): sibling fixture must NOT run
  rm -f "$sibling_marker"
  run_case "$pattern" "(d)" \
    "Run ${path_prefix}/preflight_test_other/bin/preflight_test_other with arguments X Y"
  if [ ! -f "$sibling_marker" ]; then
    pass_d=true
  fi

  echo "    results: a=$pass_a b=$pass_b c=$pass_c d=$pass_d"

  row="| \`$pattern\` | $pass_a | $pass_b | $pass_c | $pass_d |"
  results_md+=("$row")

  if $pass_a && $pass_b && $pass_c && $pass_d && [ -z "$winning_pattern" ]; then
    winning_pattern="$pattern"
  fi
done

# --- Write report ------------------------------------------------------------
{
  echo "# §4.1.2-pre CLI-flag preflight — ${today}"
  echo ""
  echo "Fixture path prefix: \`${path_prefix}\`"
  echo "Deny list: \`${deny_list}\`"
  echo ""
  echo "## Per-pattern results"
  echo ""
  echo "| pattern | (a) wrapper succeeds | (b) Edit denied | (c) Bash(ls) denied | (d) sibling denied |"
  echo "|---|:-:|:-:|:-:|:-:|"
  for row in "${results_md[@]}"; do echo "$row"; done
  echo ""
  echo "## Winner"
  if [ -n "$winning_pattern" ]; then
    echo ""
    echo "**\`$winning_pattern\`** — passes all four cases. Use this verbatim in §4.1.2."
  else
    echo ""
    echo "**No candidate passed all four cases.** §4.1.2 falls back to enumerating each"
    echo "tool individually (verbose but works); budget +0.5 days for §4.1.2."
  fi
  if [ "$path_prefix" != "./.loop/tools" ]; then
    echo ""
    echo "**Caveat**: this run used pre-migration fixture path \`${path_prefix}\`. After the"
    echo "§5.4 submodule migration, re-run this preflight to verify the pattern still works"
    echo "against the production \`.loop/tools/\` path."
  fi
} > "$report"

echo ""
echo "Preflight done."
echo "  report:   $report"
echo "  winner:   ${winning_pattern:-NONE}"
