#!/usr/bin/env bash
set -euo pipefail

SCAN_ROOT="web/src/lib"
BASELINE_FILE="scripts/loop/state/line_count_baseline.txt"
DEFAULT_MAX=500

if [[ ! -d "$SCAN_ROOT" ]]; then
  echo "line_count_gate: scan root not found: $SCAN_ROOT" >&2
  exit 2
fi

baseline_paths=()
baseline_ceilings=()
if [[ -f "$BASELINE_FILE" ]]; then
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    path="${line%%:*}"
    ceiling="${line##*:}"
    if [[ -z "$path" || -z "$ceiling" || "$path" == "$line" ]]; then
      echo "line_count_gate: malformed baseline entry: $raw_line" >&2
      exit 2
    fi
    if ! [[ "$ceiling" =~ ^[0-9]+$ ]]; then
      echo "line_count_gate: non-numeric ceiling for $path: $ceiling" >&2
      exit 2
    fi
    baseline_paths+=("$path")
    baseline_ceilings+=("$ceiling")
  done < "$BASELINE_FILE"
fi

lookup_ceiling() {
  local target="$1"
  local i=0
  local n=${#baseline_paths[@]}
  while (( i < n )); do
    if [[ "${baseline_paths[$i]}" == "$target" ]]; then
      printf '%s' "${baseline_ceilings[$i]}"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

failed=0
failures=()

while IFS= read -r -d '' file; do
  count=$(wc -l < "$file" | tr -d ' ')
  if ceiling=$(lookup_ceiling "$file"); then
    if (( count > ceiling )); then
      failures+=("$file: $count lines exceeds baseline ceiling $ceiling")
      failed=1
    fi
  else
    if (( count > DEFAULT_MAX )); then
      failures+=("$file: $count lines exceeds default cap $DEFAULT_MAX")
      failed=1
    fi
  fi
done < <(find "$SCAN_ROOT" -type f -name '*.ts' -print0)

if (( failed != 0 )); then
  echo "line_count_gate: FAIL" >&2
  for msg in "${failures[@]}"; do
    echo "  $msg" >&2
  done
  exit 1
fi

echo "line_count_gate: OK"
exit 0
