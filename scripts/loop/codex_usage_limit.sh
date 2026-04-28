#!/usr/bin/env bash
# scripts/loop/codex_usage_limit.sh
#
# Detect Codex CLI usage-limit errors in a captured combined stdout+stderr file.
# When detected:
#   - Parses the "try again at HH:MM (AM|PM)" timestamp the CLI prints.
#   - Writes the absolute epoch into $LOOP_STATE_DIR/codex_not_before.
#   - Logs a USER ATTENTION line to runner.log.
#   - Exits 0 (true: usage-limit hit).
# Otherwise exits 1.
#
# Detection is an exact match on the documented error string format; this
# avoids false positives from slice content that legitimately mentions
# rate limits or usage limits.
#
# Usage: codex_usage_limit.sh <capture_file>

set -euo pipefail

: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be set}"

capture="${1:?capture file required}"
LOG="$LOOP_STATE_DIR/runner.log"
NOT_BEFORE_FILE="$LOOP_STATE_DIR/codex_not_before"

[[ -f "$capture" ]] || exit 1

# Pinned to the exact codex 0.125+ error string. Tightened to avoid matching
# the same phrase if it appears inside slice contents echoed back by codex.
if ! grep -qE "^ERROR: You've hit your usage limit\." "$capture"; then
  exit 1
fi

retry_epoch=$(python3 - "$capture" <<'PY'
import re, sys
from datetime import datetime, timedelta

text = open(sys.argv[1]).read()

# Tight pattern: "try again at HH:MM AM" or "try again at HH:MM PM".
m = re.search(r'try again at (\d{1,2}:\d{2}\s*[AP]M)\b', text, re.IGNORECASE)
if not m:
    # Conservative fallback: 1 hour from now.
    print(int(datetime.now().timestamp()) + 3600)
    sys.exit(0)

target_str = re.sub(r'\s+', '', m.group(1)).upper()
try:
    target_t = datetime.strptime(target_str, '%I:%M%p').time()
except ValueError:
    print(int(datetime.now().timestamp()) + 3600)
    sys.exit(0)

now = datetime.now()
target_dt = datetime.combine(now.date(), target_t)
# If the parsed local time has already passed today, the CLI is referring
# to tomorrow at that clock time.
if target_dt <= now:
    target_dt += timedelta(days=1)
print(int(target_dt.timestamp()))
PY
)

# Sanity: epoch must be a positive integer in the future (within 48h).
if ! [[ "$retry_epoch" =~ ^[0-9]+$ ]]; then
  retry_epoch=$(( $(date +%s) + 3600 ))
fi

echo "$retry_epoch" > "$NOT_BEFORE_FILE"

retry_iso=$(python3 -c "from datetime import datetime; print(datetime.fromtimestamp($retry_epoch).isoformat(timespec='seconds'))")
printf '[%s] USER ATTENTION: codex usage limit; retry-not-before=%s\n' "$(date -Iseconds)" "$retry_iso" >> "$LOG"
exit 0
