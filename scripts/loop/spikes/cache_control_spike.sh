#!/usr/bin/env bash
# scripts/loop/spikes/cache_control_spike.sh
#
# §4.0 Tier 0 — cache-control feasibility spike.
# Answers three questions empirically before §4.2.1 is scheduled:
#   Q1. Does the Claude Code CLI accept `cache_control: ephemeral` markers in
#       user messages, or auto-cache only system+tools?
#   Q2. What's the actual cache-hit rate on revision spirals?
#   Q3. Does post_dispatch_cost.sh surface cache-hit metrics?
#
# Output:
#   diagnostic/cache_control_spike_<YYYY-MM-DD>.md
#   diagnostic/cache_control_spike_<YYYY-MM-DD>.json (raw per-turn ledger)
#
# Cost: this spike makes ~10 live `claude -p` calls (5 with markers, 5 without).
# Budget roughly $0.50-$2.00 depending on model. Refuses to run without the
# `LOOP_SPIKE_BUDGET_OK=1` env var so accidental invocation is harmless.
set -euo pipefail

if [ "${LOOP_SPIKE_BUDGET_OK:-0}" != "1" ]; then
  echo "Refusing to run: this spike calls the live Claude API (~\$0.50-\$2.00)." >&2
  echo "  Re-run with: LOOP_SPIKE_BUDGET_OK=1 $0" >&2
  exit 2
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: 'claude' CLI not found on PATH." >&2
  exit 3
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: 'jq' not found on PATH." >&2
  exit 3
fi

today="$(date +%Y-%m-%d)"
report_md="diagnostic/cache_control_spike_${today}.md"
report_json="diagnostic/cache_control_spike_${today}.json"
mkdir -p diagnostic

fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

# --- Build the revision-spiral fixture --------------------------------------
# 5-turn fixture: same shared prefix + escalating user follow-ups, mirroring a
# typical plan→audit→revise loop.
shared_prefix="You are helping audit a small chart-rendering component. The component is in TypeScript and uses Recharts. The relevant file is web/src/components/f1-chat/charts/radar-chart.tsx. Treat the file content below as the only source of truth.

\`\`\`tsx
import { Radar, RadarChart as RechartsRadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from \"recharts\"
import type { ChartSpec } from \"@/lib/chart-types\"
import { cn } from \"@/lib/utils\"
import { ChartTooltip } from \"./chart-tooltip\"

export function RadarChart({ chart, className }: { chart: ChartSpec; className?: string }) {
  if (!chart.axes || !chart.series) return null
  const data = chart.axes.map((axis, index) => {
    const point: Record<string, string | number> = { axis }
    chart.series?.forEach((series) => { point[series.name] = series.values[index] })
    return point
  })
  return (
    <div className={cn(\"w-full\", className)}>
      <RechartsRadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey=\"axis\" />
        <PolarRadiusAxis />
        {chart.series.map((s) => <Radar key={s.name} dataKey={s.name} stroke={s.color} />)}
      </RechartsRadarChart>
    </div>
  )
}
\`\`\`
"

turns=(
  "Briefly: what does this component render?"
  "What happens if chart.series is undefined?"
  "Is there any handling for axes whose values are NaN?"
  "If chart.series has length 0, what would be rendered?"
  "Summarize the three smallest robustness improvements you'd recommend."
)

call_claude() {
  # $1 = label, $2 = use_markers (true|false)
  local label="$1" use_markers="$2"
  local turn_idx=0 acc_in=0 acc_out=0 acc_cache_create=0 acc_cache_read=0
  local entries=()
  for prompt in "${turns[@]}"; do
    turn_idx=$((turn_idx + 1))
    local full_prompt
    if [ "$use_markers" = "true" ]; then
      # Inject a (hypothetical) ephemeral marker hint. The CLI may or may not
      # honor this — that's the Q1 answer.
      full_prompt="<!-- cache_control: ephemeral -->
$shared_prefix

Question $turn_idx: $prompt"
    else
      full_prompt="$shared_prefix

Question $turn_idx: $prompt"
    fi

    local resp
    resp="$(claude -p "$full_prompt" --output-format json 2>/dev/null || echo '{}')"

    local in_tok out_tok cache_create cache_read
    in_tok="$(jq -r '.usage.input_tokens // 0' <<< "$resp")"
    out_tok="$(jq -r '.usage.output_tokens // 0' <<< "$resp")"
    cache_create="$(jq -r '.usage.cache_creation_input_tokens // 0' <<< "$resp")"
    cache_read="$(jq -r '.usage.cache_read_input_tokens // 0' <<< "$resp")"

    acc_in=$((acc_in + in_tok))
    acc_out=$((acc_out + out_tok))
    acc_cache_create=$((acc_cache_create + cache_create))
    acc_cache_read=$((acc_cache_read + cache_read))

    entries+=("$(jq -nc \
      --arg label "$label" \
      --argjson turn "$turn_idx" \
      --argjson in "$in_tok" \
      --argjson out "$out_tok" \
      --argjson cc "$cache_create" \
      --argjson cr "$cache_read" \
      '{label:$label, turn:$turn, input_tokens:$in, output_tokens:$out, cache_creation:$cc, cache_read:$cr}')")
    echo "  turn $turn_idx [$label]  in=$in_tok out=$out_tok cache_create=$cache_create cache_read=$cache_read"
  done
  printf '%s\n' "${entries[@]}"
  return 0
}

echo "Running run A (no markers) ..."
mapfile -t entries_a < <(call_claude "no_markers" false)

echo ""
echo "Running run B (with markers) ..."
mapfile -t entries_b < <(call_claude "with_markers" true)

# --- Aggregate & write reports -----------------------------------------------
all_entries="[$(IFS=,; echo "${entries_a[*]},${entries_b[*]}")]"
echo "$all_entries" | jq '.' > "$report_json"

agg() {
  local label="$1" key="$2"
  jq --arg label "$label" --arg key "$key" '[ .[] | select(.label == $label) | .[$key] ] | add' "$report_json"
}

in_a=$(agg no_markers input_tokens)
in_b=$(agg with_markers input_tokens)
cr_a=$(agg no_markers cache_read)
cr_b=$(agg with_markers cache_read)
cc_a=$(agg no_markers cache_creation)
cc_b=$(agg with_markers cache_creation)

# Decide branch.
branch="B"  # default to auto-cache only
if [ "$cr_b" -gt "$cr_a" ] && [ "$cr_b" -gt 0 ]; then
  branch="A"
elif [ "$cr_a" -gt 0 ]; then
  branch="B"
else
  branch="C"   # no observable cache hits at all → SDK fallback territory
fi

cat > "$report_md" <<EOF
# §4.0 Cache-control feasibility spike — ${today}

Spike script: \`scripts/loop/spikes/cache_control_spike.sh\`
Raw ledger:   \`${report_json#./}\`

## Configuration

- Turns per run: ${#turns[@]}
- Shared prefix size: $(printf '%s' "$shared_prefix" | wc -c | tr -d ' ') chars
- CLI: \`claude -p ... --output-format json\`

## Aggregated metrics

| run | input_tokens | cache_creation | cache_read |
|---|---:|---:|---:|
| no markers    | $in_a | $cc_a | $cr_a |
| with markers  | $in_b | $cc_b | $cr_b |

## Q1 — Does Claude Code CLI honor explicit cache_control markers?

cache_read with markers ($cr_b) vs without ($cr_a):
$(if [ "$cr_b" -gt "$cr_a" ]; then echo "  YES — explicit markers measurably increase cache reads."; else echo "  NO observable effect from explicit markers — the CLI appears to auto-cache only."; fi)

## Q2 — Cache-hit rate on revision spirals

Across ${#turns[@]} turns:
  no_markers:    cache_read/input = $(echo "scale=2; $cr_a / ($in_a + 1)" | bc 2>/dev/null || echo "?")
  with_markers:  cache_read/input = $(echo "scale=2; $cr_b / ($in_b + 1)" | bc 2>/dev/null || echo "?")

## Q3 — Does cost ledger surface cache metrics?

\`cache_creation_input_tokens\` and \`cache_read_input_tokens\` were present in the JSON
response: $(if [ "$cc_b$cc_a$cr_b$cr_a" != "0000" ]; then echo "YES (at least one non-zero observed)."; else echo "NO — all zero. \`post_dispatch_cost.sh\` likely needs extending."; fi)

## Branch decision

**Selected: Branch ${branch}.**

| Branch | Trigger | §4.2.1 form | §7.4 target |
|---|---|---|---|
| A | markers honored + cache visible | bash+jq history_processor with explicit cache_control insertion | \$50 |
| B | auto-cache only | bash+jq history_processor that reorders for stable-prefix-first | \$75 |
| C | no observable cache effect at all | Node SDK helper for Claude roles | \$60 |

## Next steps

1. Update §4.2.1 implementation to match Branch ${branch}.
2. Update §7.4 acceptance criterion to match the corresponding budget.
3. If Branch C: schedule the Node helper work (+2 days to total).
EOF

echo ""
echo "Spike done."
echo "  report (md):   $report_md"
echo "  report (json): $report_json"
echo "  branch:        $branch"
