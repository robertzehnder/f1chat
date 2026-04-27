#!/usr/bin/env bash
# scripts/loop/check_budget.sh
# Sums today's cost ledger entries from API-keyed agents only and exits
# non-zero if over the daily cap.
#
# IMPORTANT: this cap targets billing_source="api" rows ONLY (i.e. dispatches
# that consumed Anthropic/OpenAI API credits via a key in .env). It IGNORES
# rows where billing_source="plan" (Claude Code CLI under your Max plan
# session, Codex CLI under your ChatGPT plan session) — those flow through
# subscription quotas, not metered billing, so a parser overcount can't
# translate into a surprise charge there.
#
# Older rows without billing_source default to "plan" (the historical
# dispatcher behavior), so this cap is conservative-by-default: it ONLY
# counts rows the loop has explicitly tagged as API-billed.
#
# Default cap: $100/day. Override via LOOP_DAILY_USD_CAP=N.
#
# Ledger format (one JSON object per line, no spaces around colons):
#   {"ts":"2026-04-27T13:16:42Z","slice":"00-foo","agent":"claude-cli",
#    "billing_source":"plan","model":"claude-opus-4-7",
#    "input_tokens":42000,"output_tokens":3100,"cost_usd":0.847,
#    "source":"session-log","estimated":true}

set -e
cd "$(git rev-parse --show-toplevel)"

LEDGER="scripts/loop/state/cost_ledger.jsonl"
CAP="${LOOP_DAILY_USD_CAP:-100}"

[[ -f "$LEDGER" ]] || { exit 0; }

today=$(date -u +%Y-%m-%d)

# Sum cost_usd for today's API-billed entries only. Uses POSIX-awk-
# compatible string ops (no gawk-only match() with array capture).
# Tolerates ledger rows with or without spaces around the JSON colons.
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
    if (substr(ts, 1, length(today)) != today) next

    # Only count API-billed rows. Missing field defaults to "plan" so a
    # bare ledger from an older dispatcher build is not counted.
    billing = get_field($0, "billing_source")
    if (billing == "") billing = "plan"
    if (billing != "api") next

    cost = get_field($0, "cost_usd")
    if (cost ~ /^[0-9.+-eE]+$/) sum += cost + 0
  }
  END { printf "%.4f", sum + 0 }
' "$LEDGER")

awk -v t="$total" -v c="$CAP" 'BEGIN { exit !(t < c) }'
