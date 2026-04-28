---
slice_id: 06-cu-rightsize
phase: 6
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28
---

## Goal
Right-size the Neon production endpoint's autoscaling compute-unit window (`autoscaling_limit_min_cu` / `autoscaling_limit_max_cu`, plus `suspend_timeout_seconds` if it changes) based on observed peak concurrent connections and query latency from the existing perf baselines. Record the chosen window and the cost/perf tradeoff in `diagnostic/notes/06-cu-rightsize.md` and capture before/after Neon endpoint settings as JSON artifacts.

## Inputs
- `web/src/lib/db/driver.ts` (only to confirm pooler usage; no code edits expected)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6
- `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` (latest perf baseline; source of latency evidence)
- `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` (peak connection / latency reference)

## Prior context
- `diagnostic/_state.md`

## Required services / env
- Production `DATABASE_URL` (Neon pooler) — used only to smoke-test connectivity post-change.
- `NEON_API_KEY` — Neon API token (project-scoped, rights to read/update endpoint settings).
- `NEON_PROJECT_ID` — Neon project id for the production project.
- `NEON_ENDPOINT_ID` — id of the production compute endpoint to be resized.
- User-approved sentinel (see Risk / rollback) — required before any `PATCH` to the Neon endpoint.

## Decisions
- Implementation surface is a **Neon-config-only** change applied through the Neon API; no application or repo code is modified. The only repo artifacts produced are the decision note and the before/after settings JSON. This is consistent with the auditor note in `_state.md` that non-code slices must gate against the configuration system itself, not `web/` build/test gates.
- The chosen `min_cu` / `max_cu` values, the per-month cost delta estimate, and the latency budget that justifies them MUST be filled into `diagnostic/notes/06-cu-rightsize.md` before the gate is run; the gate asserts the live endpoint matches those values exactly.

## Steps
1. Read `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` and `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` to extract: peak concurrent connection count, p50 / p95 / p99 query latency, and which stages (resolver / template / DB) dominate. Record the extracted numbers verbatim in `diagnostic/notes/06-cu-rightsize.md` under an "Evidence" subsection so reviewers can audit the decision.
2. Capture the current Neon endpoint settings into `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` via the Neon API (`GET /projects/{NEON_PROJECT_ID}/endpoints/{NEON_ENDPOINT_ID}`); record at minimum `autoscaling_limit_min_cu`, `autoscaling_limit_max_cu`, `suspend_timeout_seconds`, and the timestamp.
3. In `diagnostic/notes/06-cu-rightsize.md`, document: chosen `min_cu`, chosen `max_cu`, retained or changed `suspend_timeout_seconds`, the cost-per-month delta estimate (Neon list price × CU-hours), and the latency budget (e.g. "p95 ≤ X ms at observed peak load") that the new window must preserve.
4. After user-approved sentinel, apply the new window via the Neon API (`PATCH /projects/{NEON_PROJECT_ID}/endpoints/{NEON_ENDPOINT_ID}`) and capture the post-apply endpoint payload into `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json`.
5. Run the smoke-test query against `DATABASE_URL` to confirm the endpoint is still routable post-resize, and record its wall-clock latency in the decision note.

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

# 3. Live Neon endpoint matches the documented chosen window (post-apply verification).
LIVE=$(curl -fsS -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/endpoints/$NEON_ENDPOINT_ID")
DOC_MIN=$(grep -E '^chosen_min_cu:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
DOC_MAX=$(grep -E '^chosen_max_cu:' diagnostic/notes/06-cu-rightsize.md | awk '{print $2}')
test "$(echo "$LIVE" | jq -r '.endpoint.autoscaling_limit_min_cu')" = "$DOC_MIN"
test "$(echo "$LIVE" | jq -r '.endpoint.autoscaling_limit_max_cu')" = "$DOC_MAX"

# 4. Post-change artifact exists and matches the live endpoint.
test -f diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json
test "$(jq -r '.endpoint.autoscaling_limit_min_cu' diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)" = "$DOC_MIN"
test "$(jq -r '.endpoint.autoscaling_limit_max_cu' diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json)" = "$DOC_MAX"

# 5. Endpoint is still routable from the application pooler URL after resize.
psql "$DATABASE_URL" -At -c "SELECT 1" | grep -qx 1
```

## Acceptance criteria
- [ ] `diagnostic/notes/06-cu-rightsize.md` declares `chosen_min_cu`, `chosen_max_cu`, `suspend_timeout_seconds`, the per-month cost-delta estimate (USD), and the latency budget the chosen window must preserve.
- [ ] `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json` captures the production Neon endpoint settings as they existed before the change.
- [ ] `diagnostic/artifacts/perf/06-cu-rightsize-after_2026-04-28.json` captures the production Neon endpoint settings after the change and its `autoscaling_limit_min_cu` / `autoscaling_limit_max_cu` equal the values declared in the decision note.
- [ ] A live `GET` of the production Neon endpoint at gate time returns `autoscaling_limit_min_cu` and `autoscaling_limit_max_cu` equal to the values declared in the decision note (no staging environment is involved).
- [ ] `psql "$DATABASE_URL" -c "SELECT 1"` succeeds post-change, confirming the pooler still routes through the resized endpoint.

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
- [ ] Make `suspend_timeout_seconds` auditable end-to-end: either declare it fixed/out of scope for this slice, or add gate and acceptance checks that compare the documented value, the live Neon endpoint, and the post-change artifact when it is allowed to change.
- [ ] Fix gate 4 so it actually proves `06-cu-rightsize-after_2026-04-28.json` matches the live Neon endpoint, not just the note; compare the artifact fields directly to the `LIVE` payload for every in-scope setting.

### Low
- [ ] Add a measurable gate or acceptance check for the smoke-test wall-clock latency recorded in `diagnostic/notes/06-cu-rightsize.md`, or drop that recording requirement from step 5 so the plan only promises verifiable outputs.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.
