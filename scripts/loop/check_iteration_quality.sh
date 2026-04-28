#!/usr/bin/env bash
# scripts/loop/check_iteration_quality.sh
#
# Pre-dispatch quality check. Scans the slice file's `## Plan-audit verdict
# (round N)` blocks for action items that have repeated across multiple
# rounds without substantive resolution — i.e., the auditor keeps flagging
# the same issue and the reviser keeps not fixing it (the calibration-
# mismatch oscillation we saw in 06-pooled-url-assertion: 7 rounds, 3
# items recycled, 1 box ticked per round).
#
# Exit codes:
#   0 — no persistence detected; OK to dispatch the auditor normally.
#   2 — persistence threshold breached; the dispatcher should auto-REJECT
#       (write a final verdict block, set status=blocked owner=user, and
#       skip the audit dispatch entirely).
#   1 — usage error.
#
# Stdout (only on rc=2): a single line summary suitable for the auto-REJECT
# verdict body, e.g.:
#   "High item persisted 4 rounds: <fingerprint>; Medium item persisted 5 rounds: ..."
#
# Tunable thresholds (env):
#   LOOP_PERSISTENCE_HIGH_ROUNDS    (default 3) — High item across N rounds
#   LOOP_PERSISTENCE_MEDIUM_ROUNDS  (default 4) — Medium item across N rounds
#   LOOP_PERSISTENCE_LOW_ROUNDS     (default 0) — disabled by default
#
# Usage: check_iteration_quality.sh <slice_file_path>

set -euo pipefail

slice_file="${1:?slice_file_path required}"
[[ -f "$slice_file" ]] || { echo "missing slice file: $slice_file" >&2; exit 1; }

python3 - "$slice_file" \
  "${LOOP_PERSISTENCE_HIGH_ROUNDS:-3}" \
  "${LOOP_PERSISTENCE_MEDIUM_ROUNDS:-4}" \
  "${LOOP_PERSISTENCE_LOW_ROUNDS:-0}" <<'PY'
import re, sys
from collections import defaultdict

path, h_thresh, m_thresh, l_thresh = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
text = open(path).read()

# Split into per-round verdict blocks.
blocks = re.split(r'^## Plan-audit verdict \(round (\d+)\)', text, flags=re.M)
# blocks[0] is the pre-verdict portion; thereafter alternates [round_num, body, ...]

def section_items(body, section):
    """Return list of item-text fingerprints for a given section. Only
    captures the text on the SAME line as the `- [ ]` / `- [x]` checkbox;
    continuation lines and `_None._` placeholders do not match."""
    m = re.search(rf'^### {section}\s*\n(.*?)(?=^###|\Z)', body, re.M | re.S)
    if not m:
        return []
    chunk = m.group(1)
    items = []
    for line in chunk.splitlines():
        m2 = re.match(r'^- \[[x ]\]\s+(.+?)\s*$', line)
        if not m2:
            continue
        txt = re.sub(r'\s+', ' ', m2.group(1)).strip()
        # Skip degenerate placeholders.
        if not txt or txt in ('_None._', '_none_', 'None.', 'None'):
            continue
        items.append(txt[:100])
    return items

# section -> fingerprint -> set of round numbers it appeared in
seen = {"High": defaultdict(set), "Medium": defaultdict(set), "Low": defaultdict(set)}

for i in range(1, len(blocks)-1, 2):
    n = int(blocks[i])
    body = blocks[i+1]
    end = re.search(r'^## (?!Plan-audit)', body, re.M)
    if end: body = body[:end.start()]
    for section in ("High", "Medium", "Low"):
        for fp in section_items(body, section):
            seen[section][fp].add(n)

# Detect persistence: a fingerprint appearing in N or more distinct rounds.
violations = []
threshold = {"High": h_thresh, "Medium": m_thresh, "Low": l_thresh}
for section, items in seen.items():
    t = threshold[section]
    if t <= 0:
        continue  # disabled
    for fp, rounds in items.items():
        if len(rounds) >= t:
            violations.append((section, len(rounds), fp))

if not violations:
    sys.exit(0)

# Sort: most persistent first, then by severity weight.
sev_w = {"High": 3, "Medium": 2, "Low": 1}
violations.sort(key=lambda v: (-v[1], -sev_w[v[0]]))

# Compose a single-line summary; cap length so the verdict body stays
# readable even with many violations.
parts = []
for section, n_rounds, fp in violations[:5]:
    parts.append(f"{section} item persisted {n_rounds} rounds: \"{fp}\"")
print("; ".join(parts))
sys.exit(2)
PY
