#!/usr/bin/env bash
# scripts/loop/post_dispatch_cost.sh
# Post-dispatch cost estimator. Parses the most recent agent session log
# for token usage and appends a real cost_usd row to the ledger, replacing
# any prior placeholder for this dispatch.
#
# Best-effort: if the log can't be found or parsed, leaves the existing
# placeholder row untouched and logs a warning. Every emitted row carries
# `estimated: true` until the user runs the validation slice and flips it.
#
# Usage: post_dispatch_cost.sh <slice_id> <agent> [model]
#   <agent>  is one of: claude, codex, claude-fallback
#   [model]  defaults from agent + LOOP_*_MODEL env vars

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be set}"

slice_id="${1:?slice_id required}"
agent="${2:?agent required}"
model="${3:-}"

# Billing source classification (round-12 follow-up):
#   plan = subscription quota (Claude Code CLI on Max plan, Codex CLI on
#          ChatGPT plan). NOT counted against LOOP_DAILY_USD_CAP because
#          subscription throttles itself.
#   api  = metered API key (any dispatch using ANTHROPIC_API_KEY directly
#          via SDK). Counted against the daily cap.
# CLI-based dispatchers default to "plan"; an env override lets a future
# direct-SDK dispatcher self-declare as "api".
billing_source="${LOOP_BILLING_SOURCE:-}"
if [[ -z "$billing_source" ]]; then
  case "$agent" in
    claude|claude-revise|claude-repair|codex|codex-native|codex-claude-fallback|codex-slice-audit|codex-slice-audit-claude-fallback)
      billing_source="plan" ;;
    *)
      billing_source="plan" ;;  # conservative default
  esac
fi

LEDGER="$LOOP_STATE_DIR/cost_ledger.jsonl"
PRICING_FILE="${LOOP_PRICING_FILE:-$LOOP_MAIN_WORKTREE/scripts/loop/pricing.json}"
LOG="$LOOP_STATE_DIR/runner.log"
mkdir -p "$(dirname "$LEDGER")"

# Default model resolution from agent + env vars.
if [[ -z "$model" ]]; then
  case "$agent" in
    claude)              model="${LOOP_CLAUDE_IMPL_MODEL:-claude-opus-4-7}" ;;
    claude-revise)       model="${LOOP_CLAUDE_REVISE_MODEL:-claude-opus-4-7}" ;;
    claude-repair)       model="${LOOP_CLAUDE_REPAIR_MODEL:-claude-opus-4-7}" ;;
    codex|codex-native)  model="gpt-5" ;;
    codex-claude-fallback) model="${LOOP_CLAUDE_IMPL_MODEL:-claude-opus-4-7}" ;;
    *)                   model="claude-cli" ;;  # placeholder
  esac
fi

logmsg() { printf '[%s] post_dispatch_cost %s %s\n' "$(date -Iseconds)" "$slice_id" "$*" >> "$LOG"; }

# ---------------- Token discovery ----------------
# Best-effort scan for the most recently modified Claude / Codex session log.
# Both CLIs leave breadcrumbs:
#   ~/.claude/logs/*.jsonl                   (Claude Code SDK style)
#   ~/.claude/projects/<repo>/<sess>.jsonl   (Claude Code project session)
#   ~/.codex/sessions/<date>/rollout-*.jsonl (Codex CLI rollouts)
# Token counts live in `usage` blocks per assistant turn (Claude) or
# `token_usage` events (Codex). We sum across the whole session.
#
# This is a best-effort estimator — both formats are not stable APIs.
# When the parser fails, we still write a row with token_count_source=unknown
# so check_budget.sh has SOMETHING to read.

discover_log() {
  local agent_kind="$1" cutoff_secs="${2:-300}"
  local cutoff_ts
  cutoff_ts=$(( $(date +%s) - cutoff_secs ))

  case "$agent_kind" in
    claude*)
      # Look in ~/.claude/projects/ and ~/.claude/logs/ for the newest file.
      find "$HOME/.claude" -type f \( -name "*.jsonl" -o -name "*.json" \) \
        -newer /dev/null 2>/dev/null \
        | while IFS= read -r f; do
            local mt; mt=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
            [[ "$mt" -ge "$cutoff_ts" ]] && echo "$mt $f"
          done \
        | sort -rn | head -1 | awk '{print $2}'
      ;;
    codex*)
      find "$HOME/.codex" -type f -name "*.jsonl" 2>/dev/null \
        | while IFS= read -r f; do
            local mt; mt=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
            [[ "$mt" -ge "$cutoff_ts" ]] && echo "$mt $f"
          done \
        | sort -rn | head -1 | awk '{print $2}'
      ;;
  esac
}

session_log=$(discover_log "$agent" 600)

input_tokens=0
output_tokens=0
cache_read_tokens=0
cache_write_tokens=0
token_source="unknown"

if [[ -n "$session_log" && -f "$session_log" ]]; then
  # Try to parse usage blocks via python — handles both Claude and Codex shapes.
  read -r input_tokens output_tokens cache_read_tokens cache_write_tokens token_source < <(
    python3 - "$session_log" <<'PY'
import sys, json
path = sys.argv[1]
in_tok = out_tok = cache_r = cache_w = 0
src = "unknown"
try:
    with open(path) as fh:
        lines = fh.readlines()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        # Claude: top-level "usage" or nested in "message.usage"
        for path_to_usage in [
            obj.get("usage"),
            (obj.get("message") or {}).get("usage") if isinstance(obj.get("message"), dict) else None,
            obj.get("token_usage"),
        ]:
            if isinstance(path_to_usage, dict):
                in_tok    += int(path_to_usage.get("input_tokens",  path_to_usage.get("prompt_tokens", 0)) or 0)
                out_tok   += int(path_to_usage.get("output_tokens", path_to_usage.get("completion_tokens", 0)) or 0)
                cache_r   += int(path_to_usage.get("cache_read_input_tokens",  path_to_usage.get("cache_read_tokens", 0)) or 0)
                cache_w   += int(path_to_usage.get("cache_creation_input_tokens", path_to_usage.get("cache_write_tokens", 0)) or 0)
                src = "session-log"
except Exception:
    pass
print(in_tok, out_tok, cache_r, cache_w, src)
PY
  )
fi

# ---------------- Cost computation ----------------
cost_usd=$(python3 - "$PRICING_FILE" "$model" "$input_tokens" "$output_tokens" "$cache_read_tokens" "$cache_write_tokens" <<'PY'
import sys, json, os, datetime
pricing_path, model, in_tok, out_tok, cache_r, cache_w = sys.argv[1:7]
in_tok, out_tok, cache_r, cache_w = (int(x or 0) for x in (in_tok, out_tok, cache_r, cache_w))
try:
    with open(pricing_path) as fh:
        p = json.load(fh)
    m = (p.get("models") or {}).get(model) or (p.get("models") or {}).get("claude-cli") or {}
    in_rate    = float(m.get("input_per_mtok", 0))
    out_rate   = float(m.get("output_per_mtok", 0))
    cache_r_rate = float(m.get("cache_read_per_mtok", 0))
    cache_w_rate = float(m.get("cache_write_per_mtok", 0))
    cost = (in_tok * in_rate + out_tok * out_rate + cache_r * cache_r_rate + cache_w * cache_w_rate) / 1_000_000.0
    # Stale-pricing warning
    updated = p.get("_updated")
    if updated:
        try:
            d = datetime.date.fromisoformat(updated)
            if (datetime.date.today() - d).days > 30:
                print(f"# WARN: pricing stale ({updated}); cost may drift", file=sys.stderr)
        except Exception:
            pass
    print(f"{cost:.6f}")
except Exception as e:
    print(f"# ERR: pricing compute failed: {e}", file=sys.stderr)
    print("0")
PY
)

# ---------------- Ledger write ----------------
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"ts":"%s","slice":"%s","agent":"%s","billing_source":"%s","model":"%s","input_tokens":%s,"output_tokens":%s,"cache_read_tokens":%s,"cache_write_tokens":%s,"cost_usd":%s,"source":"%s","estimated":true}\n' \
  "$ts" "$slice_id" "$agent" "$billing_source" "$model" "$input_tokens" "$output_tokens" "$cache_read_tokens" "$cache_write_tokens" "$cost_usd" "$token_source" \
  >> "$LEDGER"

logmsg "agent=$agent billing=$billing_source model=$model in=$input_tokens out=$output_tokens cache_r=$cache_read_tokens cost=\$$cost_usd source=$token_source"
