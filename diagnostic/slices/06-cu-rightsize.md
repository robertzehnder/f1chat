---
slice_id: 06-cu-rightsize
phase: 6
status: awaiting_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-29T10:20:06-04:00
---

## Goal
Right-size the Neon production endpoint's autoscaling compute-unit window (`autoscaling_limit_min_cu` / `autoscaling_limit_max_cu`, plus `suspend_timeout_seconds` if it changes) based on the query-latency evidence the existing perf baselines actually expose: the `stages.total.p95_ms` and `stages.execute_db.p95_ms` values from `01-baseline-snapshot_2026-04-26.json` plus the post-index aggregate DB latency floor `aggregate.post_p95_ms` from `04-explain-before-after_2026-04-28.json`. Concurrent-connection and `p99` metrics, plus other stage timings (`stages.resolve_db.*`, `stages.sqlgen_llm.*`, etc.), are explicitly out of scope for the sizing rationale. Record the chosen window and the cost/perf tradeoff in `diagnostic/notes/06-cu-rightsize.md` and capture before/after Neon endpoint settings as JSON artifacts.

## Inputs
- `web/src/lib/db/driver.ts` (only to confirm pooler usage; no code edits expected)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6
- `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` — source of per-stage latency evidence; exposes `stages.{total,execute_db,resolve_db,sqlgen_llm,synthesize_llm,template_match,...}` each with `count`, `p50_ms`, `p95_ms`, `max_ms`. (No `p99_ms` and no concurrent-connection counts are present; the plan must not cite metrics this artifact does not expose.)
- `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` — DB-level pre/post-index aggregate latency (`aggregate.{pre_p50_ms, pre_p95_ms, post_p50_ms, post_p95_ms}`); used as the post-index DB latency floor the resized compute window must preserve.

## Prior context
- `diagnostic/_state.md`

## Required services / env
- Production `DATABASE_URL` (Neon pooler) — used only to smoke-test connectivity post-change.
- `NEON_API_KEY` — Neon API token (project-scoped, rights to read/update endpoint settings).
- `NEON_PROJECT_ID` — Neon project id for the production project.
- `NEON_ENDPOINT_ID` — id of the production compute endpoint to be resized.
- User-approval sentinel (see "User approval mechanism" below and Risk / rollback) — required before any `PATCH` to the Neon endpoint.

### User approval mechanism (exact, no ad hoc interpretation)
Before step 4 may run, the implementer MUST:
1. Receive a chat message from the user (rjzehnder@gmail.com, the slice owner) containing the literal sentinel token `APPROVE-CU-RIGHTSIZE` followed by a single space and an ISO-8601 UTC timestamp of approval, e.g. `APPROVE-CU-RIGHTSIZE 2026-04-28T19:30:00Z`. No other phrasing is accepted.
2. Copy that exact line verbatim into `diagnostic/notes/06-cu-rightsize.md` under a `## User approval` heading, on a line by itself. (The gate verifies the heading and the line.)
3. Only after both 1 and 2 are recorded may the Neon `PATCH` in step 4 be issued. If the chat sentinel is missing or malformed, step 4 is blocked.

## Decisions
- Implementation surface is a **Neon-config-only** change applied through the Neon API; no application or repo code is modified. The only repo artifacts produced are the decision note and the before/after settings JSON. This is consistent with the auditor note in `_state.md` that non-code slices must gate against the configuration system itself, not `web/` build/test gates.
- The chosen `min_cu` / `max_cu` values, the chosen `suspend_timeout_seconds`, the per-month cost delta estimate, and the latency budget that justifies them MUST be filled into `diagnostic/notes/06-cu-rightsize.md` before the gate is run; the gate asserts the live endpoint AND the post-change artifact match those values exactly for every in-scope setting.
- In-scope mutable settings for this slice are exactly: `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds`. Per the `_state.md` lesson on config-only infra slices, gate live-system parity and artifact parity for **every** mutable setting the plan may change, not just the primary CU pair. If `suspend_timeout_seconds` is intentionally unchanged, the decision note must declare the retained value and the gate still asserts parity (note ↔ live ↔ after artifact).

## Steps
1. Read `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` and `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` and extract exactly the three metrics the gates and acceptance criteria audit (no others):
   - From `01-baseline-snapshot.json` (no concurrent-connection or p99 fields exist in this artifact, so do not cite them):
     - `stages.total.p95_ms` — overall request p95 the CU window must preserve.
     - `stages.execute_db.p95_ms` — the DB stage p95 (the one the CU window most directly affects); also feeds the latency-budget derivation in step 3.
   - From `04-explain-before-after.json`:
     - `aggregate.post_p95_ms` — post-index DB latency floor the new CU window must preserve; also feeds the latency-budget derivation in step 3.
   Per-stage `count`/`p50_ms`/`max_ms` fields, additional stage `p95_ms` values (`stages.resolve_db`, `stages.sqlgen_llm`, `stages.synthesize_llm`, `stages.template_match`, etc.), and the pre-index/p50 fields from the explain artifact are not required by this slice and should not be cited as evidence (citing them invites unaudited claims about which stage dominates or how pre-index latency compares — neither is in scope here).
   Record each of the three required fields under a `## Evidence` heading in `diagnostic/notes/06-cu-rightsize.md`, one per line, in the exact form `<field path> = <numeric value>` — e.g. `stages.total.p95_ms = 1234.5`. Each of the three required field-path lines MUST appear exactly once inside the `## Evidence` section (the section ends at the next `## ` heading); occurrences elsewhere in the note do not satisfy the gate. Gate 2a (below) parses the section and asserts each required field-path line is present in that exact format and only once.
2. Capture the current Neon endpoint settings into `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` via the Neon API (`GET /projects/{NEON_PROJECT_ID}/endpoints/{NEON_ENDPOINT_ID}`); record at minimum `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, `suspend_timeout_seconds`, and a top-level `captured_at` field set to the ISO-8601 UTC timestamp at which the `GET` was issued (e.g. `"captured_at":"2026-04-28T19:25:00Z"`).
3. In `diagnostic/notes/06-cu-rightsize.md`, document on their own grep-able lines:
   - `chosen_min_cu:` `<value>`
   - `chosen_max_cu:` `<value>`
   - `suspend_timeout_seconds:` `<retained or changed value>`
   - `cu_hour_rate_usd:` `<rate>` — the per-CU-hour USD price taken from the project's current Neon billing plan. The decision note must record the source on a separate `cu_hour_rate_source:` line as the public URL the rate was copied from (e.g. `https://neon.tech/pricing`); it must begin with `http://` or `https://`. Saved pricing artifacts are out of scope for this slice. The rate MUST be a fixed constant in the note; it must not be left as a parameter for the implementer to vary at gate time.
   - `cost_delta_usd_per_month_max:` `<value>` — computed as `(chosen_max_cu - prior_max_cu) * cu_hour_rate_usd * 730` (730 ≈ hours per average month, treated as an upper bound assuming the endpoint runs at `max_cu` continuously).
   - `cost_delta_usd_per_month_min:` `<value>` — computed as `(chosen_min_cu - prior_min_cu) * cu_hour_rate_usd * 730` (lower bound assuming the endpoint runs at `min_cu` continuously).
   - `latency_budget_p95_ms:` `<value>` — the p95 latency (in milliseconds) the resized window must preserve, derived from `stages.execute_db.p95_ms` (baseline) and `aggregate.post_p95_ms` (post-index floor).
   - `latency_budget_p95_ms_basis:` `<basis>` — exactly one of the following grep-able strings, declaring how `latency_budget_p95_ms` relates to the cited evidence:
     - `equals stages.execute_db.p95_ms`
     - `equals aggregate.post_p95_ms`
     - `bounded_by stages.execute_db.p95_ms,aggregate.post_p95_ms` (used when the budget is set to the larger — i.e., looser — of the two values, so it preserves both)
     The gate (2c below) re-derives `stages.execute_db.p95_ms` from `01-baseline-snapshot_2026-04-26.json` and `aggregate.post_p95_ms` from `04-explain-before-after_2026-04-28.json` and asserts: for `equals X`, `latency_budget_p95_ms` matches `X` within ±0.01 ms; for `bounded_by …`, `latency_budget_p95_ms` ≥ `max(stages.execute_db.p95_ms, aggregate.post_p95_ms)`.
   The `prior_min_cu` / `prior_max_cu` values used in the cost formulas MUST equal the values captured in `06-cu-rightsize-before_2026-04-28.json` (gate 4 enforces parity below by recomputing the deltas).
4. **Only after** the user-approval sentinel line (see "User approval mechanism" in Required services / env) is recorded under `## User approval` in `diagnostic/notes/06-cu-rightsize.md`, apply the new window via the Neon API (`PATCH /projects/{NEON_PROJECT_ID}/endpoints/{NEON_ENDPOINT_ID}`) — patch `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds` to the documented values — and capture the post-apply endpoint payload into `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json`. The post-change artifact MUST include all of the following top-level fields:
   - The full Neon endpoint payload under `.endpoint`, which includes `endpoint.updated_at` (the Neon-server mutation timestamp set when the `PATCH` was processed).
   - `patch_applied_at` — set to `endpoint.updated_at` returned by the post-apply `GET`. This is the **mutation-time** timestamp from Neon's server clock, not the implementer's wall clock; it cannot be backfilled because gate 2b' asserts `patch_applied_at == endpoint.updated_at` byte-for-byte.
   - `captured_at` — the ISO-8601 UTC timestamp at which the post-apply `GET` was issued.
   Gate 2b' (below) asserts the chain `APPROVAL_TS < patch_applied_at <= captured_at`. The `patch_applied_at <= captured_at` bound is structural (the GET cannot read a `updated_at` later than the GET itself), but is gated explicitly so that an artifact constructed from inconsistent sources fails. The `APPROVAL_TS < patch_applied_at` bound is the audit signal that user approval was recorded **before** Neon applied the mutation, not backfilled afterward against a later post-apply capture.
5. Run the smoke-test query `psql "$DATABASE_URL" -At -c "SELECT 1"` post-resize. The gate (below) checks the command exits 0 and prints `1`; no latency recording is required, so the plan only promises verifiable outputs.

## Changed files expected
- `diagnostic/notes/06-cu-rightsize.md` (new — the decision document, including Evidence + Cost/perf tradeoff sections)
- `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` (new — Neon endpoint payload pre-change)
- `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json` (new — Neon endpoint payload post-change)

No `web/` source files are expected to change; if any do, the slice is out of scope and must be reworked.

## Artifact paths
- `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json`
- `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json`

## Gate commands
```bash
# 1. Pre-change capture exists and parses, with the fields the decision relies on.
test -f diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json
jq -e '.endpoint | (.autoscaling_limit_min_cu and .autoscaling_limit_max_cu and .suspend_timeout_seconds != null)' \
  diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json
jq -er '.captured_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$")' \
  diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json

# 2. Decision note exists and declares the chosen window + auditable cost/perf tradeoff.
test -f diagnostic/notes/06-cu-rightsize.md
grep -E '^chosen_min_cu:[[:space:]]*[0-9.]+' diagnostic/notes/06-cu-rightsize.md
grep -E '^chosen_max_cu:[[:space:]]*[0-9.]+' diagnostic/notes/06-cu-rightsize.md
grep -E '^suspend_timeout_seconds:[[:space:]]*[0-9]+' diagnostic/notes/06-cu-rightsize.md
grep -E '^cu_hour_rate_usd:[[:space:]]*[0-9]+(\.[0-9]+)?' diagnostic/notes/06-cu-rightsize.md
grep -E '^cu_hour_rate_source:[[:space:]]*https?://\S+' diagnostic/notes/06-cu-rightsize.md
grep -E '^cost_delta_usd_per_month_max:[[:space:]]*-?[0-9]+(\.[0-9]+)?' diagnostic/notes/06-cu-rightsize.md
grep -E '^cost_delta_usd_per_month_min:[[:space:]]*-?[0-9]+(\.[0-9]+)?' diagnostic/notes/06-cu-rightsize.md
grep -E '^latency_budget_p95_ms:[[:space:]]*[0-9]+(\.[0-9]+)?' diagnostic/notes/06-cu-rightsize.md

# 2-recompute. Verify the documented cost-deltas equal the formula
# (chosen_*_cu - prior_*_cu) * cu_hour_rate_usd * 730 within $0.01,
# using prior_*_cu from 06-cu-rightsize-before_2026-04-28.json.
RATE=$(grep -E '^cu_hour_rate_usd:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
CHOSEN_MIN=$(grep -E '^chosen_min_cu:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
CHOSEN_MAX=$(grep -E '^chosen_max_cu:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
PRIOR_MIN=$(jq -r '.endpoint.autoscaling_limit_min_cu' diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json)
PRIOR_MAX=$(jq -r '.endpoint.autoscaling_limit_max_cu' diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json)
DOC_DELTA_MAX=$(grep -E '^cost_delta_usd_per_month_max:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
DOC_DELTA_MIN=$(grep -E '^cost_delta_usd_per_month_min:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
EXP_DELTA_MAX=$(echo "($CHOSEN_MAX - $PRIOR_MAX) * $RATE * 730" | bc -l)
EXP_DELTA_MIN=$(echo "($CHOSEN_MIN - $PRIOR_MIN) * $RATE * 730" | bc -l)
# Absolute difference must be < $0.01 for both bounds.
awk -v a="$DOC_DELTA_MAX" -v b="$EXP_DELTA_MAX" 'BEGIN{d=a-b; if(d<0)d=-d; exit !(d<0.01)}'
awk -v a="$DOC_DELTA_MIN" -v b="$EXP_DELTA_MIN" 'BEGIN{d=a-b; if(d<0)d=-d; exit !(d<0.01)}'

# 2a. Evidence capture from the listed perf inputs is recorded UNDER the "## Evidence"
# heading in the declared `<field path> = <numeric value>` format, one line per required
# field, each appearing exactly once inside the section (the section ends at the next
# `## ` heading). Lines that look like the right field paths but appear outside the
# `## Evidence` section, or under it but not in the required format, do NOT satisfy
# this gate. The numeric value must be an unsigned decimal (integer or float).
awk '
  /^##[[:space:]]+Evidence[[:space:]]*$/  { in_section=1; next }
  /^##[[:space:]]/                          { if (in_section) in_section=0 }
  in_section && /^stages\.total\.p95_ms[[:space:]]*=[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]*$/      { total++ }
  in_section && /^stages\.execute_db\.p95_ms[[:space:]]*=[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]*$/ { execdb++ }
  in_section && /^aggregate\.post_p95_ms[[:space:]]*=[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]*$/      { post++ }
  END { exit !(total==1 && execdb==1 && post==1) }
' diagnostic/notes/06-cu-rightsize.md

# 2b. User approval sentinel is recorded as the FIRST non-blank line under "## User approval"
# AND is the only APPROVE-CU-RIGHTSIZE line in the file. This blocks the alternative of
# stashing a sentinel anywhere in the document with a heading present elsewhere.
test "$(grep -Ec '^APPROVE-CU-RIGHTSIZE' diagnostic/notes/06-cu-rightsize.md)" = 1
awk '
  /^##[[:space:]]+User approval[[:space:]]*$/ { in_section=1; next }
  in_section && /^[[:space:]]*$/ { next }
  in_section {
    if ($0 ~ /^APPROVE-CU-RIGHTSIZE[[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/) found=1
    exit
  }
  END { exit !found }
' diagnostic/notes/06-cu-rightsize.md

# 2b'. Approval recorded BEFORE the Neon PATCH, anchored to a Neon-server
# mutation timestamp (not just the post-apply GET wall-clock).
#   * APPROVAL_TS         = chat-recorded approval timestamp (under `## User approval`).
#   * PATCH_APPLIED_AT    = top-level `patch_applied_at` from the post-change artifact.
#   * ENDPOINT_UPDATED_AT = `endpoint.updated_at` from the same artifact (Neon's
#                           server-side mutation timestamp). Required to equal
#                           PATCH_APPLIED_AT so the implementer cannot supply an
#                           arbitrary "apply time" decoupled from Neon's record.
#   * AFTER_TS            = top-level `captured_at` (post-apply GET wall-clock).
# ISO-8601 UTC strings ending in 'Z' do NOT sort lexicographically as
# chronologically when fractional seconds are optionally present: e.g.
# "2026-04-28T19:30:00Z" sorts AFTER "2026-04-28T19:30:00.1Z" because the
# byte '.' (0x2E) is less than 'Z' (0x5A). The gate therefore normalizes
# each timestamp to a canonical form (fractional seconds padded/truncated
# to exactly 9 digits) before comparing, so string compare is chronological.
# Asserts: APPROVAL_TS < PATCH_APPLIED_AT <= AFTER_TS, and
#          PATCH_APPLIED_AT == ENDPOINT_UPDATED_AT (raw, byte-for-byte).
APPROVAL_TS=$(awk '
  /^##[[:space:]]+User approval[[:space:]]*$/ { in_section=1; next }
  in_section && /^[[:space:]]*$/ { next }
  in_section && /^APPROVE-CU-RIGHTSIZE[[:space:]]+/ { print $2; exit }
' diagnostic/notes/06-cu-rightsize.md)
PATCH_APPLIED_AT=$(jq -r '.patch_applied_at'      diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)
ENDPOINT_UPDATED_AT=$(jq -r '.endpoint.updated_at' diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)
AFTER_TS=$(jq -r '.captured_at'                    diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)
test -n "$APPROVAL_TS"
test -n "$PATCH_APPLIED_AT"    && test "$PATCH_APPLIED_AT"    != "null"
test -n "$ENDPOINT_UPDATED_AT" && test "$ENDPOINT_UPDATED_AT" != "null"
test -n "$AFTER_TS"            && test "$AFTER_TS"            != "null"
# All four must be ISO-8601 UTC ending in 'Z'.
echo "$APPROVAL_TS"         | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
echo "$PATCH_APPLIED_AT"    | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
echo "$ENDPOINT_UPDATED_AT" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
echo "$AFTER_TS"            | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
# patch_applied_at must equal Neon's endpoint.updated_at byte-for-byte
# (anchors apply-time to Neon's record). Both come from the same JSON artifact,
# so the implementer is required to copy `endpoint.updated_at` verbatim.
test "$PATCH_APPLIED_AT" = "$ENDPOINT_UPDATED_AT"
# Normalize each timestamp by padding fractional seconds to exactly 9 digits,
# so the subsequent string comparisons are chronologically correct regardless
# of whether a given timestamp included a fractional component.
#   "2026-04-28T19:30:00Z"           -> "2026-04-28T19:30:00.000000000Z"
#   "2026-04-28T19:30:00.1Z"         -> "2026-04-28T19:30:00.100000000Z"
#   "2026-04-28T19:30:00.123456789Z" -> "2026-04-28T19:30:00.123456789Z"
norm_ts() {
  awk -v ts="$1" 'BEGIN{
    sub(/Z$/, "", ts)
    n = index(ts, ".")
    if (n == 0) {
      print ts ".000000000Z"
    } else {
      base = substr(ts, 1, n-1)
      frac = substr(ts, n+1)
      frac = substr(frac "000000000", 1, 9)
      print base "." frac "Z"
    }
  }'
}
APPROVAL_NORM=$(norm_ts "$APPROVAL_TS")
PATCH_NORM=$(norm_ts    "$PATCH_APPLIED_AT")
AFTER_NORM=$(norm_ts    "$AFTER_TS")
# APPROVAL_TS strictly < patch_applied_at (approval recorded before the mutation).
awk -v a="$APPROVAL_NORM" -v p="$PATCH_NORM" 'BEGIN{ exit !(a < p) }'
# patch_applied_at <= captured_at (the GET cannot read a future updated_at).
awk -v p="$PATCH_NORM"    -v c="$AFTER_NORM" 'BEGIN{ exit !(p <= c) }'

# 2c. latency_budget_p95_ms basis is declared on a grep-able line, and the documented
# numeric value matches the cited basis when re-derived from the perf input artifacts.
grep -Eq '^latency_budget_p95_ms_basis:[[:space:]]*(equals[[:space:]]+(stages\.execute_db\.p95_ms|aggregate\.post_p95_ms)|bounded_by[[:space:]]+stages\.execute_db\.p95_ms,aggregate\.post_p95_ms)[[:space:]]*$' diagnostic/notes/06-cu-rightsize.md
DOC_BUDGET=$(grep -E '^latency_budget_p95_ms:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
BASIS=$(grep -E '^latency_budget_p95_ms_basis:' diagnostic/notes/06-cu-rightsize.md | sed -E 's/^latency_budget_p95_ms_basis:[[:space:]]*//' | sed -E 's/[[:space:]]+$//')
EXEC_DB_P95=$(jq -r '.stages.execute_db.p95_ms' diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json)
POST_P95=$(jq -r '.aggregate.post_p95_ms' diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json)
case "$BASIS" in
  "equals stages.execute_db.p95_ms")
    awk -v a="$DOC_BUDGET" -v b="$EXEC_DB_P95" 'BEGIN{d=a-b; if(d<0)d=-d; exit !(d<0.01)}'
    ;;
  "equals aggregate.post_p95_ms")
    awk -v a="$DOC_BUDGET" -v b="$POST_P95" 'BEGIN{d=a-b; if(d<0)d=-d; exit !(d<0.01)}'
    ;;
  "bounded_by stages.execute_db.p95_ms,aggregate.post_p95_ms")
    awk -v b="$DOC_BUDGET" -v e="$EXEC_DB_P95" -v p="$POST_P95" 'BEGIN{m=(e>p)?e:p; exit !(b>=m)}'
    ;;
  *)
    exit 1
    ;;
esac

# 3. Live Neon endpoint matches the documented chosen window for every in-scope mutable setting.
LIVE=$(curl -fsS -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/endpoints/$NEON_ENDPOINT_ID")
DOC_MIN=$(grep -E '^chosen_min_cu:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
DOC_MAX=$(grep -E '^chosen_max_cu:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
DOC_SUS=$(grep -E '^suspend_timeout_seconds:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
LIVE_MIN=$(echo "$LIVE" | jq -r '.endpoint.autoscaling_limit_min_cu')
LIVE_MAX=$(echo "$LIVE" | jq -r '.endpoint.autoscaling_limit_max_cu')
LIVE_SUS=$(echo "$LIVE" | jq -r '.endpoint.suspend_timeout_seconds')
test "$LIVE_MIN" = "$DOC_MIN"
test "$LIVE_MAX" = "$DOC_MAX"
test "$LIVE_SUS" = "$DOC_SUS"

# 4. Post-change artifact exists and matches BOTH the live endpoint AND the note for every in-scope setting.
test -f diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json
jq -er '.captured_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$")' \
  diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json
AFTER_MIN=$(jq -r '.endpoint.autoscaling_limit_min_cu' diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)
AFTER_MAX=$(jq -r '.endpoint.autoscaling_limit_max_cu' diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)
AFTER_SUS=$(jq -r '.endpoint.suspend_timeout_seconds' diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)
# artifact ↔ live parity
test "$AFTER_MIN" = "$LIVE_MIN"
test "$AFTER_MAX" = "$LIVE_MAX"
test "$AFTER_SUS" = "$LIVE_SUS"
# artifact ↔ note parity
test "$AFTER_MIN" = "$DOC_MIN"
test "$AFTER_MAX" = "$DOC_MAX"
test "$AFTER_SUS" = "$DOC_SUS"

# 5. Endpoint is still routable from the application pooler URL after resize.
psql "$DATABASE_URL" -At -c "SELECT 1" | grep -qx 1
```

## Acceptance criteria
- [ ] `diagnostic/notes/06-cu-rightsize.md` declares, on grep-able lines, `chosen_min_cu`, `chosen_max_cu`, `suspend_timeout_seconds`, `cu_hour_rate_usd` (a fixed numeric constant), `cu_hour_rate_source` (a public URL beginning with `http://` or `https://`), `cost_delta_usd_per_month_max`, `cost_delta_usd_per_month_min`, `latency_budget_p95_ms`, and `latency_budget_p95_ms_basis` (exactly one of `equals stages.execute_db.p95_ms`, `equals aggregate.post_p95_ms`, or `bounded_by stages.execute_db.p95_ms,aggregate.post_p95_ms`). The two `cost_delta_*` values equal `(chosen_*_cu − prior_*_cu) × cu_hour_rate_usd × 730` (within $0.01) where the `prior_*_cu` values are read from `06-cu-rightsize-before_2026-04-28.json`, and `latency_budget_p95_ms` matches `latency_budget_p95_ms_basis` when re-derived from the perf input artifacts (within ±0.01 ms for `equals …`, or ≥ `max(stages.execute_db.p95_ms, aggregate.post_p95_ms)` for `bounded_by …`); the gate recomputes and asserts both.
- [ ] `diagnostic/notes/06-cu-rightsize.md` contains a `## Evidence` section that records the `stages.total.p95_ms` and `stages.execute_db.p95_ms` values from `01-baseline-snapshot_2026-04-26.json` and the `aggregate.post_p95_ms` value from `04-explain-before-after_2026-04-28.json`. Each required field-path line MUST appear inside the `## Evidence` section in the exact form `<field path> = <numeric value>` (one line each, exactly once per field; the section ends at the next `## ` heading). Gate 2a parses the section and enforces this format-and-uniqueness contract.
- [ ] `diagnostic/notes/06-cu-rightsize.md` contains a `## User approval` section whose first non-blank line under the heading matches `^APPROVE-CU-RIGHTSIZE <ISO-8601 UTC timestamp>$`, and that sentinel appears exactly once in the file. The recorded approval timestamp is strictly earlier than the **Neon-server mutation timestamp** `patch_applied_at` recorded in `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json`, where `patch_applied_at` MUST equal `endpoint.updated_at` from the same artifact (the timestamp Neon set when it processed the `PATCH`); the gate asserts the chain `APPROVAL_TS < patch_applied_at <= captured_at` and the parity `patch_applied_at == endpoint.updated_at`. This is the audit signal that approval was recorded before the Neon mutation was applied, not backfilled against a later post-apply capture.
- [ ] `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` captures the production Neon endpoint settings as they existed before the change, including `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds`, plus a top-level `captured_at` field set to the ISO-8601 UTC timestamp of the pre-change `GET`.
- [ ] `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json` captures the production Neon endpoint settings after the change; its `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds` equal the values declared in the decision note **and** equal the values returned by a live `GET` of the production Neon endpoint at gate time. It also includes top-level `captured_at` (ISO-8601 UTC, the post-apply `GET` wall-clock) and `patch_applied_at` (ISO-8601 UTC) fields, where `patch_applied_at` equals `endpoint.updated_at` in the same artifact (the Neon-server mutation timestamp), and the chain `APPROVAL_TS < patch_applied_at <= captured_at` holds.
- [ ] A live `GET` of the production Neon endpoint at gate time returns `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds` equal to the values declared in the decision note (no staging environment is involved).
- [ ] `psql "$DATABASE_URL" -At -c "SELECT 1" | grep -qx 1` succeeds post-change (the pipeline exits 0, confirming `psql` printed exactly `1`), confirming the pooler still routes through the resized endpoint.

## Out of scope
- Application code changes in `web/` (driver, pooling, retry strategy). If those are needed, raise a separate slice.
- Changes to the Neon project (branches, roles, databases) other than the production compute endpoint's autoscaling window.
- Re-running the full perf benchmark suite; this slice consumes the existing baselines listed under Inputs.

## Risk / rollback
Production-touching: a `PATCH` to the live Neon endpoint immediately changes the autoscaling window for production traffic. Require user-approved sentinel before step 4 (the Neon `PATCH`). Rollback: `PATCH` the endpoint back to the values captured in `06-cu-rightsize-before_2026-04-28.json` and `git revert` the slice's commit; capture the rollback's resulting endpoint payload as an addendum so the audit trail stays consistent.

## Slice-completion note

**Status: AWAITING AUDIT (owner: codex)** — both blockers resolved (Neon credentials in env, chat-approval sentinel pre-recorded under `## User approval` at `2026-04-28T20:35:00Z`). All steps executed, all gates pass.

### Branch

`slice/06-cu-rightsize`

### Decisions

- **chosen_min_cu = 0.25** (retained). Idle minimum unchanged; no concurrency or cold-start evidence in the cited inputs justifies raising it.
- **chosen_max_cu = 1** (down from 2). Post-index DB-level p95 is 0.34 ms (`aggregate.post_p95_ms` from `04-explain-before-after_2026-04-28.json`); 1 CU (1 vCPU, 4 GB RAM) is more than sufficient for sub-millisecond queries. Caps monthly upper-bound compute spend reduction at $116.80/month (continuous-at-max).
- **suspend_timeout_seconds = 0** (retained, Neon default auto-suspend). No evidence in the cited inputs supports changing this.
- **cu_hour_rate_usd = 0.16** (source: https://neon.tech/pricing). Used in the cost-delta formula only.
- **latency_budget_p95_ms = 5629.55**, basis `bounded_by stages.execute_db.p95_ms,aggregate.post_p95_ms` — set to the larger (looser) of the two cited p95 latencies so both observations are preserved.

### Commits

- One commit on `slice/06-cu-rightsize` titled "slice 06-cu-rightsize: rightsize Neon endpoint to 0.25/1 CU" (tagged `[slice:06-cu-rightsize][awaiting-audit]`); the exact hash is recorded by `git log -1` on the pushed branch and printed in the operator log on push.

### Gate results (exit code 0 for every gate)

| Gate | Result | Notes |
|---|---|---|
| 1 — pre-change artifact + `captured_at` | PASS | `06-cu-rightsize-before_2026-04-28.json`, `captured_at = 2026-04-28T23:33:47Z` |
| 2 — note declares all required fields | PASS | grep matches every required line |
| 2-recompute — cost-delta math | PASS | doc max −116.80, computed −116.80; doc min 0, computed 0 (within $0.01) |
| 2a — Evidence section format/uniqueness | PASS | three required field-path lines, each appearing exactly once under `## Evidence` |
| 2b — single approval sentinel under `## User approval` | PASS | first non-blank line under heading; only occurrence in file |
| 2b' — APPROVAL_TS < patch_applied_at <= captured_at, patch_applied_at == endpoint.updated_at | PASS | 2026-04-28T20:35:00Z < 2026-04-28T23:36:27Z <= 2026-04-28T23:36:35Z; patch_applied_at == endpoint.updated_at byte-for-byte |
| 2c — latency-budget basis re-derivation | PASS | `bounded_by`, doc 5629.55 ≥ max(5629.55, 0.34) |
| 3 — live endpoint matches note | PASS | LIVE 0.25/1/0 == DOC 0.25/1/0 |
| 4 — after artifact matches live AND note | PASS | AFTER 0.25/1/0 == LIVE 0.25/1/0 == DOC 0.25/1/0; `captured_at = 2026-04-28T23:36:35Z` |
| 5 — `psql "$DATABASE_URL" -At -c "SELECT 1" \| grep -qx 1` | PASS | pooler still routes through resized endpoint |

### Self-check

- Frontmatter: `status=awaiting_audit, owner=codex, updated=2026-04-29T09:25:06-04:00`.
- Branch: `slice/06-cu-rightsize`. No files modified outside `Changed files expected` (verified via `git status` — only the three declared artifacts plus this slice file's frontmatter+completion-note are in the diff).
- All ten gate commands ran in slice-declared order; every exit code was 0.
- Approval-before-mutation chain holds against Neon's server-side `endpoint.updated_at`: APPROVAL_TS=2026-04-28T20:35:00Z is strictly earlier than PATCH_APPLIED_AT=ENDPOINT_UPDATED_AT=2026-04-28T23:36:27Z (~3 hours), which is ≤ post-apply GET captured_at=2026-04-28T23:36:35Z.
- Production smoke test (`SELECT 1`) succeeded post-resize, confirming pooler still routes through the resized endpoint.

### Re-verification (2026-04-29, post-revise)

The previous audit (`e41427b`) returned REVISE because `psql` was unavailable in the auditor's shell, so gate 5 could not be reproduced (`bash: psql: command not found`). All other gates passed. No artifacts, decision-document content, or live Neon endpoint settings were changed during this revise iteration — the resized endpoint remains at `0.25/1/0`, matching `06-cu-rightsize-after_2026-04-28.json` and the decision note. Gates were re-run in this implementer worktree with `psql` made available on `PATH` (Homebrew `postgresql@16` install at `/opt/homebrew/opt/postgresql@16/bin/psql`); every gate exit code was 0, including gate 5. The auditor must run gate 5 with a `psql` client on `PATH` to verify the smoke test (or skip gate 5 with rationale if the audit environment cannot install one).

### Re-verification (2026-04-29, post-revise round 2 — jq escape fix)

The most recent audit (`547ede1`) returned REVISE because the gate-1 and gate-4 `jq` `captured_at` regex tests used the escape sequence `\\.[0-9]+` inside a `jq` string, which the audit environment's `jq` rejected with `Invalid escape at line 1, column 4 (while parsing '"\."')`. The fix is gate-text only and follows the `_state.md` lesson "Validate `jq` regex escapes in gate commands under the repo's actual `jq`": `\\.` was replaced with the regex character class `[.]`, which matches a literal dot without requiring any string-level escape and therefore compiles under any `jq` version. No artifacts, decision-document content, or live Neon endpoint settings were changed during this revise iteration — the resized endpoint remains at `0.25/1/0`, matching `06-cu-rightsize-after_2026-04-28.json` and the decision note. All ten gates were re-run in this implementer worktree (jq 1.8.1, `psql` on `PATH` via Homebrew `postgresql@16`); every gate exit code was 0.

| Gate | Result | Notes |
|---|---|---|
| 1 — pre-change artifact + `captured_at` (jq `[.]` form) | PASS | parses + regex compiles; `captured_at = 2026-04-28T23:33:47Z` |
| 2 — note declares all required fields | PASS | grep matches every required line |
| 2-recompute — cost-delta math | PASS | doc max −116.80, computed −116.80; doc min 0, computed 0 |
| 2a — Evidence section format/uniqueness | PASS | three required field-path lines, each appearing exactly once under `## Evidence` |
| 2b — single approval sentinel under `## User approval` | PASS | first non-blank line under heading; only occurrence in file |
| 2b' — APPROVAL_TS < patch_applied_at <= captured_at, patch_applied_at == endpoint.updated_at | PASS | 2026-04-28T20:35:00Z < 2026-04-28T23:36:27Z <= 2026-04-28T23:36:35Z |
| 2c — latency-budget basis re-derivation | PASS | `bounded_by`, doc 5629.55 ≥ max(5629.55, 0.34) |
| 3 — live endpoint matches note | PASS | LIVE 0.25/1/0 == DOC 0.25/1/0 |
| 4 — after artifact matches live AND note (jq `[.]` form) | PASS | regex compiles; AFTER 0.25/1/0 == LIVE 0.25/1/0 == DOC 0.25/1/0 |
| 5 — `psql "$DATABASE_URL" -At -c "SELECT 1" \| grep -qx 1` | PASS | pooler still routes through resized endpoint |

## Audit verdict
**Status: REVISE**

- Gate 1 `test -f diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` -> exit `0`
- Gate 1 `jq -e '.endpoint | (.autoscaling_limit_min_cu and .autoscaling_limit_max_cu and .suspend_timeout_seconds != null)' diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` -> exit `0`
- Gate 1 `jq -er '.captured_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")' diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` -> exit `3`
- Gate 1 failure context -> `jq: error: Invalid escape at line 1, column 4 (while parsing '"\."')`
- Gate 2 note declares required fields -> exit `0`
- Gate 2-recompute cost-delta math -> exit `0`
- Gate 2a evidence section format/uniqueness -> exit `0`
- Gate 2b approval sentinel placement/uniqueness -> exit `0`
- Gate 2b' approval-before-mutation timestamp chain -> exit `0`
- Gate 2c latency-budget basis re-derivation -> exit `0`
- Gate 3 live Neon endpoint matches note -> exit `0`
- Gate 4 `test -f diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json` -> exit `0`
- Gate 4 `jq -er '.captured_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")' diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json` -> exit `3`
- Gate 4 failure context -> `jq: error: Invalid escape at line 1, column 4 (while parsing '"\."')`
- Gate 4 artifact/live/note parity checks -> exit `0`
- Gate 5 `psql "$DATABASE_URL" -At -c "SELECT 1" | grep -qx 1` -> exit `0`
- Scope-diff -> PASS. `git diff --name-only integration/perf-roadmap...HEAD` stays within declared scope plus the implicit allow-list; `diagnostic/_state.md` remains append-only under `## Notes for auditors`, and the section stays within the 10-entry cap.
- Acceptance 1 required grep-able fields, cost deltas, and latency-budget basis -> PASS
- Acceptance 2 `## Evidence` section exact lines/uniqueness -> PASS
- Acceptance 3 `## User approval` section and approval-before-mutation chain -> PASS
- Acceptance 4 pre-change artifact contents and timestamp field -> PASS
- Acceptance 5 post-change artifact/live/note parity and timestamps -> PASS
- Acceptance 6 live Neon endpoint settings equal documented values -> PASS
- Acceptance 7 post-change pooler smoke test -> PASS
- Decision -> REVISE
- Rationale -> [diagnostic/slices/06-cu-rightsize.md] declares two `jq` timestamp gates that do not compile under the audit environment's `jq`, so the gate block does not pass as written even though the underlying artifacts and live settings are consistent.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the web-only gate commands with Neon-config validation gates that prove the chosen compute-unit value was applied and verified against a real Neon environment, because `build`/`typecheck`/`test:grading` can all pass without touching the compute allocation.

### Medium
- [x] Specify the concrete implementation surface for the compute-unit change and include it in `Changed files expected`, because the current plan only expects `diagnostic/notes/06-cu-rightsize.md` even though the goal requires an actual Neon allocation decision plus recorded cost/perf tradeoff.
- [x] Rewrite the acceptance criteria as measurable checks and remove the environment contradiction in “Production-side behavior verified in the staging environment before merge.”

### Low
- [x] Tighten the step list so it names the evidence to inspect and the artifact to produce, instead of generic placeholders like “Apply the change per the slice goal” and “Add tests / docs as appropriate.”

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make `suspend_timeout_seconds` auditable end-to-end: either declare it fixed/out of scope for this slice, or add gate and acceptance checks that compare the documented value, the live Neon endpoint, and the post-change artifact when it is allowed to change.
- [x] Fix gate 4 so it actually proves `06-cu-rightsize-after_2026-04-28.json` matches the live Neon endpoint, not just the note; compare the artifact fields directly to the `LIVE` payload for every in-scope setting.

### Low
- [x] Add a measurable gate or acceptance check for the smoke-test wall-clock latency recorded in `diagnostic/notes/06-cu-rightsize.md`, or drop that recording requirement from step 5 so the plan only promises verifiable outputs.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Replace the step-1 requirement to extract peak concurrent connections and p99 latency from the cited perf baselines, or add a concrete additional input artifact that actually exposes those metrics; the current listed inputs do not contain them, so the decision cannot be audited as written.

### Medium
- [x] Narrow the "which stages dominate" evidence requirement to a cited artifact that actually contains stage timing data, or add that artifact to Inputs; `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` does not expose per-stage timings.
- [x] Add a measurable gate or acceptance check for the required "Evidence" subsection from step 1, or drop the requirement to record the extracted numbers verbatim; the current gates never verify that evidence capture happened.
- [x] Specify the exact user-approval sentinel text or approval mechanism required before the live Neon `PATCH`, so step 4 is executable without ad hoc interpretation.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Resolve the contradiction between the Goal and the cited Inputs/Steps: either add a listed input artifact that actually exposes observed peak concurrent connections, or rewrite the goal/sizing rationale so this slice no longer claims the CU window is based on concurrency evidence that the plan explicitly says does not exist.

### Medium
- [x] Make the cost-delta requirement auditable by naming the exact Neon pricing source or fixed unit-rate formula the implementer must use; as written, `cost-per-month delta estimate` can vary arbitrarily and the gate only proves that some number was written down.

### Low
- [x] Tighten gate 2b so it proves the approval sentinel is recorded immediately under `## User approval` as the only approval line, instead of separately grepping for a heading and a matching token anywhere in the file.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Either require `cu_hour_rate_source` to be a URL only, or add the optional saved pricing artifact path under `diagnostic/artifacts/perf/` to `Changed files expected` and `Artifact paths`; the current plan allows an extra artifact that is outside the declared slice scope.

### Low
- [x] Make the final acceptance bullet match the gated smoke test exactly: it currently cites `psql "$DATABASE_URL" -c "SELECT 1"` even though the gate and step both require `psql "$DATABASE_URL" -At -c "SELECT 1" | grep -qx 1`.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High
- [x] Make the "approval recorded before the Neon PATCH" requirement auditable, or narrow the acceptance claim: as written, the gate only proves the sentinel line exists at gate time, so an implementer could patch first and add the approval line afterward without failing the plan.

### Medium
- [x] Add a measurable gate/acceptance check for the required latency-budget rationale in step 3, or drop the requirement that the note state whether `latency_budget_p95_ms` equals `stages.execute_db.p95_ms`, equals `aggregate.post_p95_ms`, or is otherwise bounded by them; the current gate only verifies that some numeric `latency_budget_p95_ms` line exists.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 7)

**Status: REVISE**

### High
- [x] Make the "approval recorded before the Neon PATCH" claim actually auditable: record a mutation-time `patch_applied_at` timestamp (or equivalent apply-time artifact) and gate `APPROVAL_TS < patch_applied_at <= captured_at`, because comparing approval only to `06-cu-rightsize-after_2026-04-28.json`'s `captured_at` still allows the PATCH to happen before approval and be backfilled later.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 8)

**Status: REVISE**

### High
- [x] Fix gate `2b'` so the approval/mutation ordering check is time-safe when timestamps include optional fractional seconds: the current `awk` lexicographic comparisons on raw ISO-8601 strings can misorder `...00Z` versus `...00.1Z`, causing valid implementations to fail or invalid ones to pass.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 9)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make the full step-1 evidence requirement auditable, or narrow step 1 to the evidence the gates and acceptance criteria actually verify: the current plan still requires extra per-stage fields (`count`/`p50_ms`/`max_ms` and multiple other stage `p95_ms` values plus an explicit dominant-stage callout) that no gate or acceptance check enforces.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 10)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Tighten gate `2a` so it verifies the three required evidence lines are recorded in the declared `<field path> = <value>` format under `## Evidence`, not merely that the field-path strings appear somewhere in the note.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 11)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Make the `bounded_by stages.execute_db.p95_ms,aggregate.post_p95_ms` contract auditable as written: either require `latency_budget_p95_ms` to equal `max(stages.execute_db.p95_ms, aggregate.post_p95_ms)` within tolerance, or relax the step/acceptance prose so it no longer says that basis is "used when the budget is set to the larger" while the gate currently accepts any larger value. DEFER: contract is acceptable as-currently-written for first-implementation; precision can be tightened in a follow-up slice if gate flakiness is observed.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.

## Plan-audit verdict (round 12)

**Status: APPROVED**
**Auditor: user-manual-unblock (issued by operator after iter cap; round-11 Medium accepted as deferred)**

### High
_None._

### Medium
_None._

### Low
_None._

### Notes (informational only — no action)
- Round-11 Medium item (latency-budget contract precision) was ticked with `DEFER:` rationale by the operator at unblock time. The slice is pre-approved (`user_approval_required: yes`) and the operator created the `.approved` sentinel to permit dispatch.
