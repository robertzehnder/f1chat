#!/usr/bin/env bash
# scripts/loop/check_budget.sh
# Sums today's cost ledger entries and exits non-zero if over the daily cap.
#
# Cost telemetry is now wired (round-12 Item 9): post_dispatch_cost.sh parses
# the most recently modified Claude/Codex session log and writes real
# cost_usd rows per dispatch. Until the validation slice runs, all rows are
# tagged `estimated: true` and the daily cap remains advisory in spirit.
#
# Default cap raised to $100/day (round-12) for the multi-day autonomous run.
# 86 slices × ~25 dispatches × ~$0.50 = ~$1,000 total; cap enforces a sane
# per-day rate without blocking long sessions.
#
# Ledger format (one JSON object per line, no spaces around colons):
#   {"ts":"2026-04-25T13:16:42Z","slice":"00-foo","agent":"claude",
#    "model":"claude-opus-4-7","input_tokens":42000,"output_tokens":3100,
#    "cache_read_tokens":18000,"cost_usd":0.847,"source":"session-log",
#    "estimated":true}

set -e
cd "$(git rev-parse --show-toplevel)"

LEDGER="scripts/loop/state/cost_ledger.jsonl"
CAP="${LOOP_DAILY_USD_CAP:-100}"

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
