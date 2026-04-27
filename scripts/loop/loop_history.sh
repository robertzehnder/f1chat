#!/usr/bin/env bash
# scripts/loop/loop_history.sh
# Queryable summary of the autonomous loop's run history. Aggregates from
# git log + cost_ledger.jsonl + slice frontmatter. Pure read-only.
#
# Sections:
#   - Per-slice: phase, plan-iter rounds, repair attempts, time-to-merge,
#     fail-count peaks, did-it-circuit-break.
#   - Phase: total wall-clock, total LLM cost, slice count.
#   - Loop-wide: top 5 by plan-revise rounds, top 5 by repair attempts,
#     blocked-then-merged-via-repair list.
#
# Usage: scripts/loop/loop_history.sh [--phase N] [--slice <id>] [--csv]

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REPO="$(git rev-parse --show-toplevel)"
LEDGER="$REPO/scripts/loop/state/cost_ledger.jsonl"
SLICES_DIR="$REPO/diagnostic/slices"

phase_filter=""
slice_filter=""
output=table
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase) phase_filter="$2"; shift 2 ;;
    --slice) slice_filter="$2"; shift 2 ;;
    --csv)   output=csv; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

python3 - "$REPO" "$LEDGER" "$phase_filter" "$slice_filter" "$output" <<'PY'
import sys, os, json, re, subprocess, glob

repo, ledger_path, phase_filter, slice_filter, output = sys.argv[1:6]
slices_dir = os.path.join(repo, "diagnostic", "slices")

def read_frontmatter(path):
    fm = {}
    try:
        with open(path) as fh:
            text = fh.read()
        m = re.match(r'^---\n(.*?)\n---', text, flags=re.S)
        if not m:
            return fm
        for line in m.group(1).splitlines():
            mm = re.match(r'^(\w+):\s*(.*)$', line)
            if mm:
                fm[mm.group(1)] = mm.group(2).strip()
    except Exception:
        pass
    return fm

# ---- collect slice records ----
records = []
for path in sorted(glob.glob(os.path.join(slices_dir, "*.md"))):
    name = os.path.basename(path)
    if name.startswith("_"):
        continue
    sid = name[:-3]
    fm = read_frontmatter(path)
    phase = fm.get("phase", "?")
    if phase_filter and phase != phase_filter:
        continue
    if slice_filter and sid != slice_filter:
        continue
    records.append({
        "slice_id": sid,
        "phase": phase,
        "status": fm.get("status", "?"),
        "owner": fm.get("owner", "?"),
        "user_approval_required": fm.get("user_approval_required", "?"),
    })

# ---- git log → plan-revise rounds, repair attempts, time-to-merge, regressions ----
def git_log_lines(extra_args):
    out = subprocess.run(
        ["git", "log", "--pretty=format:%H|%ct|%s", "integration/perf-roadmap"] + extra_args,
        cwd=repo, capture_output=True, text=True, check=False,
    )
    return [line for line in out.stdout.splitlines() if line]

per_slice = {}  # sid -> stats
for line in git_log_lines([]):
    sha, ct, subj = line.split("|", 2)
    ct = int(ct)
    m = re.search(r'\[slice:([^\]]+)\]', subj)
    if not m:
        continue
    sid = m.group(1)
    s = per_slice.setdefault(sid, {
        "plan_revise": 0, "repair": 0, "regression": 0,
        "merged_at": None, "first_seen_at": None, "circuit": False,
        "loop_infra_attempts": 0,
    })
    if s["first_seen_at"] is None or ct < s["first_seen_at"]:
        s["first_seen_at"] = ct
    if "[plan-revise]" in subj:
        s["plan_revise"] += 1
    if "[repair-retry]" in subj or "[protocol-repair]" in subj:
        s["repair"] += 1
    if "[loop-infra-repair]" in subj:
        s["loop_infra_attempts"] += 1
    if "[regression-revert]" in subj or "[regression]" in subj:
        s["regression"] += 1
    if subj.startswith("merge:") and "[pass]" in subj:
        s["merged_at"] = ct

# ---- cost ledger ----
cost_by_slice = {}
cost_by_phase = {}
total_cost = 0.0
if os.path.isfile(ledger_path):
    for line in open(ledger_path):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        sid = obj.get("slice", "?")
        c = float(obj.get("cost_usd") or 0)
        cost_by_slice[sid] = cost_by_slice.get(sid, 0.0) + c
        total_cost += c

for r in records:
    sid = r["slice_id"]
    s = per_slice.get(sid, {})
    r["plan_revise_rounds"] = s.get("plan_revise", 0)
    r["repair_attempts"] = s.get("repair", 0)
    r["loop_infra_attempts"] = s.get("loop_infra_attempts", 0)
    r["regressions"] = s.get("regression", 0)
    if s.get("merged_at") and s.get("first_seen_at"):
        r["time_to_merge_h"] = round((s["merged_at"] - s["first_seen_at"]) / 3600.0, 2)
    else:
        r["time_to_merge_h"] = None
    r["cost_usd"] = round(cost_by_slice.get(sid, 0.0), 4)
    cost_by_phase[r["phase"]] = cost_by_phase.get(r["phase"], 0.0) + r["cost_usd"]

# ---- output ----
if output == "csv":
    print("slice_id,phase,status,owner,plan_revise_rounds,repair_attempts,loop_infra_attempts,regressions,time_to_merge_h,cost_usd")
    for r in records:
        print(f'{r["slice_id"]},{r["phase"]},{r["status"]},{r["owner"]},{r["plan_revise_rounds"]},{r["repair_attempts"]},{r["loop_infra_attempts"]},{r["regressions"]},{r["time_to_merge_h"] if r["time_to_merge_h"] is not None else ""},{r["cost_usd"]}')
    sys.exit(0)

# Table format
def w(s, n):
    s = str(s)
    return s + " " * (n - len(s)) if len(s) < n else s[:n]

print(f"# Loop history report — generated {os.popen('date -u +%Y-%m-%dT%H:%M:%SZ').read().strip()}")
print()
print(f"## Per-slice summary ({len(records)} slices)")
print()
hdr = f"| {w('slice', 36)} | ph | {w('status', 18)} | rv | rp | li | rg | ttm(h) | cost($) |"
sep = "|" + "-" * 38 + "|----|" + "-" * 20 + "|----|----|----|----|--------|---------|"
print(hdr); print(sep)
for r in sorted(records, key=lambda x: (x["phase"], x["slice_id"])):
    ttm = f"{r['time_to_merge_h']:.2f}" if r["time_to_merge_h"] is not None else ""
    print(f"| {w(r['slice_id'], 36)} | {w(r['phase'], 2)} | {w(r['status'], 18)} | {w(r['plan_revise_rounds'], 2)} | {w(r['repair_attempts'], 2)} | {w(r['loop_infra_attempts'], 2)} | {w(r['regressions'], 2)} | {w(ttm, 6)} | {w(f'{r['cost_usd']:.3f}', 7)} |")

print()
print("## Phase rollup")
print()
print("| phase | slices | total_cost($) |")
print("|-------|--------|---------------|")
phase_counts = {}
for r in records:
    phase_counts[r["phase"]] = phase_counts.get(r["phase"], 0) + 1
for p in sorted(phase_counts.keys()):
    print(f"| {p:5} | {phase_counts[p]:6} | {cost_by_phase.get(p, 0.0):13.3f} |")
print(f"| TOTAL | {len(records):6} | {total_cost:13.3f} |")

# Top-5 lists
print()
print("## Top 5 by plan-revise rounds")
for r in sorted(records, key=lambda x: -x["plan_revise_rounds"])[:5]:
    print(f"- `{r['slice_id']}` (phase {r['phase']}): {r['plan_revise_rounds']} rounds")

print()
print("## Top 5 by repair attempts")
for r in sorted(records, key=lambda x: -x["repair_attempts"])[:5]:
    print(f"- `{r['slice_id']}` (phase {r['phase']}): {r['repair_attempts']} attempts")

print()
print("## Slices that needed loop-infra repair")
for r in records:
    if r["loop_infra_attempts"] > 0:
        print(f"- `{r['slice_id']}` (phase {r['phase']}): {r['loop_infra_attempts']} loop-infra repair commits")

print()
print("## Slices with regressions caught at merge")
for r in records:
    if r["regressions"] > 0:
        print(f"- `{r['slice_id']}` (phase {r['phase']}): {r['regressions']} regression-reverts")
PY
