#!/usr/bin/env bash
# scripts/loop/check_budget.sh
# Sums today's cost ledger entries and exits non-zero if over the daily cap.
#
# Cost capture is currently SCAFFOLDING: dispatchers append rows with
# cost_usd=0 because the Claude / Codex CLIs do not expose token usage in
# their non-interactive modes. Until real cost capture is wired, this script
# only enforces the cap when external tooling backfills real cost values.
# Until then, treat the daily cap as advisory.
#
# Ledger format (one JSON object per line, no spaces around colons):
#   {"ts":"2026-04-25T13:16:42Z","slice":"00-foo","agent":"claude",
#    "model":"claude-cli","input_tokens":0,"output_tokens":0,
#    "cache_read_tokens":0,"cost_usd":0}

set -e
cd "$(git rev-parse --show-toplevel)"

LEDGER="scripts/loop/state/cost_ledger.jsonl"
CAP="${LOOP_DAILY_USD_CAP:-20}"

[[ -f "$LEDGER" ]] || { exit 0; }

today=$(date -u +%Y-%m-%d)

# Sum cost_usd for today's entries. Uses POSIX-awk-compatible string ops
# (no gawk-only match() with array capture). Tolerates ledger rows with or
# without spaces around the JSON colons.
total=$(awk -v today="$today" '
  function get_field(line, key,    s, e, val) {
    s = index(line, "\"" key "\"")
    if (s == 0) return ""
    s += length("\"" key "\"")
    while (s <= length(line) && (substr(line, s, 1) == ":" || substr(line, s, 1) == " ")) s++
    if (substr(line, s, 1) == "\"") {
      s++
      e = index(substr(line, s), "\"")
      if (e == 0) return ""
      return substr(line, s, e - 1)
    } else {
      e = s
      while (e <= length(line) && index("0123456789.-eE+", substr(line, e, 1)) > 0) e++
      return substr(line, s, e - s)
    }
  }
  {
    ts = get_field($0, "ts")
    if (substr(ts, 1, length(today)) == today) {
      cost = get_field($0, "cost_usd")
      if (cost ~ /^[0-9.+-eE]+$/) sum += cost + 0
    }
  }
  END { printf "%.4f", sum + 0 }
' "$LEDGER")

awk -v t="$total" -v c="$CAP" 'BEGIN { exit !(t < c) }'
