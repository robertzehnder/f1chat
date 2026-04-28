---
slice_id: 06-cu-rightsize
phase: 6
status: pending_plan_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28T19:45:00Z
---

## Goal
Right-size the Neon production endpoint's autoscaling compute-unit window (`autoscaling_limit_min_cu` / `autoscaling_limit_max_cu`, plus `suspend_timeout_seconds` if it changes) based on observed peak concurrent connections and query latency from the existing perf baselines. Record the chosen window and the cost/perf tradeoff in `diagnostic/notes/06-cu-rightsize.md` and capture before/after Neon endpoint settings as JSON artifacts.

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
1. Read `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` and `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` and extract ONLY metrics the artifacts actually expose:
   - From `01-baseline-snapshot.json` (per-stage latencies — no concurrent-connection or p99 fields exist in this artifact, so do not cite them):
     - `stages.total.{count, p50_ms, p95_ms, max_ms}`
     - `stages.execute_db.{count, p50_ms, p95_ms, max_ms}` (the DB stage — the one the CU window most directly affects)
     - For the "which stage dominates" determination, also record `p95_ms` for `stages.resolve_db`, `stages.sqlgen_llm`, `stages.synthesize_llm`, `stages.template_match`. Pick the dominant stage as the one with the largest `p95_ms` and name it explicitly.
   - From `04-explain-before-after.json`:
     - `aggregate.{pre_p50_ms, pre_p95_ms, post_p50_ms, post_p95_ms}` — post-index DB latency floor the new CU window must preserve.
   Record every extracted field under a `## Evidence` heading in `diagnostic/notes/06-cu-rightsize.md` as `<field path> = <value>` (one line each). The gate below greps for the `## Evidence` heading and for the literal field-path strings `stages.total.p95_ms`, `stages.execute_db.p95_ms`, and `aggregate.post_p95_ms` to verify evidence capture happened.
2. Capture the current Neon endpoint settings into `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` via the Neon API (`GET /projects/{NEON_PROJECT_ID}/endpoints/{NEON_ENDPOINT_ID}`); record at minimum `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, `suspend_timeout_seconds`, and the timestamp.
3. In `diagnostic/notes/06-cu-rightsize.md`, document on their own grep-able lines: `chosen_min_cu:`, `chosen_max_cu:`, `suspend_timeout_seconds:` (the retained or changed value), the cost-per-month delta estimate (Neon list price × CU-hours), and the latency budget (e.g. "p95 ≤ X ms at observed peak load") that the new window must preserve.
4. **Only after** the user-approval sentinel line (see "User approval mechanism" in Required services / env) is recorded under `## User approval` in `diagnostic/notes/06-cu-rightsize.md`, apply the new window via the Neon API (`PATCH /projects/{NEON_PROJECT_ID}/endpoints/{NEON_ENDPOINT_ID}`) — patch `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds` to the documented values — and capture the post-apply endpoint payload into `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json`.
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

# 2. Decision note exists and declares the chosen window + cost/perf tradeoff.
test -f diagnostic/notes/06-cu-rightsize.md
grep -E '^chosen_min_cu:[[:space:]]*[0-9.]+' diagnostic/notes/06-cu-rightsize.md
grep -E '^chosen_max_cu:[[:space:]]*[0-9.]+' diagnostic/notes/06-cu-rightsize.md
grep -E '^suspend_timeout_seconds:[[:space:]]*[0-9]+' diagnostic/notes/06-cu-rightsize.md
grep -Eq '(Cost/perf tradeoff|cost_delta_usd_per_month)' diagnostic/notes/06-cu-rightsize.md

# 2a. Evidence capture from the listed perf inputs is recorded under a "## Evidence" heading.
grep -Eq '^##[[:space:]]+Evidence' diagnostic/notes/06-cu-rightsize.md
grep -Fq 'stages.total.p95_ms' diagnostic/notes/06-cu-rightsize.md
grep -Fq 'stages.execute_db.p95_ms' diagnostic/notes/06-cu-rightsize.md
grep -Fq 'aggregate.post_p95_ms' diagnostic/notes/06-cu-rightsize.md

# 2b. User approval sentinel is recorded under a "## User approval" heading with the exact token + ISO-8601 timestamp.
grep -Eq '^##[[:space:]]+User approval' diagnostic/notes/06-cu-rightsize.md
grep -Eq '^APPROVE-CU-RIGHTSIZE[[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' diagnostic/notes/06-cu-rightsize.md

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
- [ ] `diagnostic/notes/06-cu-rightsize.md` declares `chosen_min_cu`, `chosen_max_cu`, `suspend_timeout_seconds`, the per-month cost-delta estimate (USD), and the latency budget the chosen window must preserve.
- [ ] `diagnostic/notes/06-cu-rightsize.md` contains a `## Evidence` section that records, at minimum, the `stages.total.p95_ms` and `stages.execute_db.p95_ms` values from `01-baseline-snapshot_2026-04-26.json` and the `aggregate.post_p95_ms` value from `04-explain-before-after_2026-04-28.json` as `<field path> = <value>` lines.
- [ ] `diagnostic/notes/06-cu-rightsize.md` contains a `## User approval` section with a single line matching `^APPROVE-CU-RIGHTSIZE <ISO-8601 UTC timestamp>$`, copied verbatim from a chat message authored by the slice owner; this line was recorded **before** the Neon `PATCH` was issued.
- [ ] `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` captures the production Neon endpoint settings as they existed before the change, including `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds`.
- [ ] `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json` captures the production Neon endpoint settings after the change; its `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds` equal the values declared in the decision note **and** equal the values returned by a live `GET` of the production Neon endpoint at gate time.
- [ ] A live `GET` of the production Neon endpoint at gate time returns `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, and `suspend_timeout_seconds` equal to the values declared in the decision note (no staging environment is involved).
- [ ] `psql "$DATABASE_URL" -c "SELECT 1"` succeeds post-change (exits 0 and prints `1`), confirming the pooler still routes through the resized endpoint.

## Out of scope
- Application code changes in `web/` (driver, pooling, retry strategy). If those are needed, raise a separate slice.
- Changes to the Neon project (branches, roles, databases) other than the production compute endpoint's autoscaling window.
- Re-running the full perf benchmark suite; this slice consumes the existing baselines listed under Inputs.

## Risk / rollback
Production-touching: a `PATCH` to the live Neon endpoint immediately changes the autoscaling window for production traffic. Require user-approved sentinel before step 4 (the Neon `PATCH`). Rollback: `PATCH` the endpoint back to the values captured in `06-cu-rightsize-before_2026-04-28.json` and `git revert` the slice's commit; capture the rollback's resulting endpoint payload as an addendum so the audit trail stays consistent.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

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
