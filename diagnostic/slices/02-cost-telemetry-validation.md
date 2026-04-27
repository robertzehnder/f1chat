---
slice_id: 02-cost-telemetry-validation
phase: 2
status: blocked
owner: user
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T01:23:01-04:00
---

## Goal
Validate the post_dispatch_cost.sh estimator against actual billing console totals. After ~10 slices have run with cost telemetry, compare ledger sum vs Anthropic+OpenAI billing dashboard for the same period; if within 5%, flip `estimated:true` → `estimated:false` on backfilled rows.

## Inputs
- `scripts/loop/state/cost_ledger.jsonl` (gitignored runtime ledger; lives outside the branch)
- Anthropic billing console CSV export saved to `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv`
- OpenAI billing console CSV export saved to `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv`

## Prior context
- `diagnostic/_state.md`
- `scripts/loop/post_dispatch_cost.sh`
- `scripts/loop/pricing.json`

## Required services / env
- Anthropic billing console access (https://console.anthropic.com/settings/usage) — CSV export for the validation window.
- OpenAI billing console access (https://platform.openai.com/usage) — CSV export for the validation window.
- `LOOP_STATE_DIR` exported (same value the runner uses) so the implementer reads the same `cost_ledger.jsonl` the loop wrote to.

## Validation window selection rule
- **Window-start (UTC):** the `ts` of the first ledger row whose `slice` is one of the ten most recent merges in `diagnostic/_state.md` "Recent slice merges" table at the time the slice begins.
- **Window-end (UTC):** the `ts` of the most recent ledger row at the time the slice begins (i.e. `tail -1 cost_ledger.jsonl | jq -r .ts`).
- Record both timestamps verbatim (ISO-8601, second precision) at the top of the validation note. Both billing-console exports MUST be requested for the same `[window-start, window-end]` range; if a console only supports day-granularity, round window-start down and window-end up to whole UTC days and document the rounding in the note.

## Ledger-to-vendor grouping rule
Each ledger row carries both an `agent` field and a `model` field (see `scripts/loop/post_dispatch_cost.sh:161`). For per-vendor delta computation, group rows by **the `model` field's prefix**, not the `agent` field, because some `agent` values fall back across vendors:

- `model` starts with `claude-` → **Anthropic**
- `model` starts with `gpt-` or `o` (digit) → **OpenAI**
- any other `model` value → fail loud (the slice notes the row and stops; this should not happen)

For traceability, the note must also list the count of rows by `agent` value, covering at minimum:

| `agent` value | model resolved by `post_dispatch_cost.sh` | vendor |
|---|---|---|
| `claude` | `$LOOP_CLAUDE_IMPL_MODEL` (default `claude-opus-4-7`) | Anthropic |
| `claude-revise` | `$LOOP_CLAUDE_REVISE_MODEL` (default `claude-opus-4-7`) | Anthropic |
| `claude-repair` | `$LOOP_CLAUDE_REPAIR_MODEL` (default `claude-opus-4-7`) | Anthropic |
| `codex` / `codex-native` | `gpt-5` | OpenAI |
| `codex-claude-fallback` | `$LOOP_CLAUDE_IMPL_MODEL` (default `claude-opus-4-7`) | Anthropic |
| `codex-slice-audit` | `gpt-5` | OpenAI |
| `codex-slice-audit-claude-fallback` | `$LOOP_CLAUDE_IMPL_MODEL` (default `claude-opus-4-7`) | Anthropic |

If the ledger contains an `agent` value not in this table, the implementer adds it to the table (with the resolved model and vendor) before computing deltas.

## Steps
1. Compute the validation window per the rule above. Record `window-start`, `window-end`, and the slice IDs the window covers in the validation note.
2. Sum `cost_usd` from the ledger for rows whose `ts` is within `[window-start, window-end]`. Group by vendor using the rule in "Ledger-to-vendor grouping rule" above (i.e. by the row's `model` prefix). Also report a per-`agent`-value count in the note for traceability.
3. Export the Anthropic billing CSV for the window into `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv`. Sum the `cost` column.
4. Export the OpenAI billing CSV for the window into `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv`. Sum the `cost` column.
5. Compute `delta_pct = (ledger_sum - billing_sum) / billing_sum * 100` per vendor and overall. Write `diagnostic/notes/02-cost-telemetry-validation.md` containing: window timestamps, per-vendor ledger sums, per-vendor billing sums, deltas, and pass/fail against the 5% threshold.
6. If overall delta within ±5%: write a one-time script `scripts/loop/one_time/02_flip_estimated_false.sh` that rewrites `cost_ledger.jsonl` in place, setting `"estimated":false` ONLY on rows whose `ts` is within the window. The script MUST:
   - (a) accept required flags `--window-start <iso8601>` and `--window-end <iso8601>`;
   - (b) accept optional flag `--dry-run`, which prints what it would do but does NOT mutate the ledger;
   - (c) on every invocation (dry-run or not) emit EXACTLY one stdout line matching the regex `^rows_in_window=[0-9]+ rows_outside_window_unchanged=[0-9]+$` (this exact format is what the gate greps for);
   - (d) when not in `--dry-run`, write the rewritten ledger to a temp file in the same directory then `mv` atomically over the original.
   First run it with `--dry-run` and record the reported counts in the note. Then run it for real, capture the new counts, and record before/after `estimated:true` totals in the note. Commit the script (the ledger itself is gitignored).
7. If overall delta outside ±5%: identify the parser gap (most likely log-file discovery cutoff, missing usage path in the python parser, or pricing rate mismatch in `scripts/loop/pricing.json`). Patch `scripts/loop/post_dispatch_cost.sh` and/or `scripts/loop/pricing.json`. Then produce a before/after computed-cost comparison artifact at `diagnostic/artifacts/cost/02-parser-fix-before-after.json` containing the keys `ledger_sum_before_usd`, `ledger_sum_after_usd`, `billing_sum_usd`, `delta_pct_before`, `delta_pct_after` (and a free-text `root_cause` string). The fix is accepted iff `|delta_pct_after| < |delta_pct_before|`. Document the root cause and the fix in the note. Do NOT flip `estimated:false` until a follow-up slice re-validates.

## Changed files expected
- `diagnostic/notes/02-cost-telemetry-validation.md` (always)
- `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv` (always)
- `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv` (always)
- `scripts/loop/one_time/02_flip_estimated_false.sh` (only on within-5% path)
- `scripts/loop/post_dispatch_cost.sh` (only on outside-5% path, when parser gap is in the parser)
- `scripts/loop/pricing.json` (only on outside-5% path, when parser gap is a stale rate)
- `diagnostic/artifacts/cost/02-parser-fix-before-after.json` (only on outside-5% path)

> Note: `scripts/loop/state/cost_ledger.jsonl` is gitignored and not committed; mutation of it is recorded in the note via row counts, not by checking it in.

## Artifact paths
- `diagnostic/notes/02-cost-telemetry-validation.md` — validation note (comparison numbers, deltas, decision).
- `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv`
- `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv`

## Gate commands
```bash
# Run from repo root. Each line uses `npm --prefix web` so cwd is unchanged.
# Build runs first because `web/next-env.d.ts` references `.next/types/routes.d.ts`
# which only exists after a build; running typecheck before build will fail.
npm --prefix web run build
npm --prefix web run typecheck
npm --prefix web run test:grading

# Validation-specific gates (run from repo root):
test -f diagnostic/notes/02-cost-telemetry-validation.md
ls diagnostic/artifacts/cost/anthropic_*.csv diagnostic/artifacts/cost/openai_*.csv

# Within-5% path only — verify the flip script touched only window rows.
# Skip this gate if the outside-5% path was taken; the note will state which path applies.
bash scripts/loop/one_time/02_flip_estimated_false.sh \
     --window-start "$WINDOW_START" --window-end "$WINDOW_END" --dry-run \
  | grep -E '^rows_in_window=[0-9]+ rows_outside_window_unchanged=[0-9]+$'

# Outside-5% path only — verify the before/after computed-cost comparison artifact
# exists and demonstrates the fix moved the result toward the billing total.
# Skip this gate if the within-5% path was taken.
test -f diagnostic/artifacts/cost/02-parser-fix-before-after.json
python3 -c '
import json, sys
d = json.load(open("diagnostic/artifacts/cost/02-parser-fix-before-after.json"))
for k in ("ledger_sum_before_usd","ledger_sum_after_usd","billing_sum_usd","delta_pct_before","delta_pct_after"):
    assert k in d, f"missing key: {k}"
assert abs(d["delta_pct_after"]) < abs(d["delta_pct_before"]), "fix did not reduce |delta_pct|"
print("parser-fix before/after gate: PASS")
'
```

## Acceptance criteria
- [ ] Validation note `diagnostic/notes/02-cost-telemetry-validation.md` committed with: window-start, window-end, per-vendor ledger sums, per-vendor billing sums, deltas, decision.
- [ ] Both billing-console CSVs committed under `diagnostic/artifacts/cost/`.
- [ ] **Within-5% path:** `scripts/loop/one_time/02_flip_estimated_false.sh` committed; running it with `--dry-run` reports `rows_in_window` > 0 and `rows_outside_window_unchanged` equal to the count of out-of-window ledger rows; note records before/after `estimated:true` counts.
- [ ] **Outside-5% path:** parser-gap root cause documented in note; fix landed in `scripts/loop/post_dispatch_cost.sh` and/or `scripts/loop/pricing.json`; before/after artifact `diagnostic/artifacts/cost/02-parser-fix-before-after.json` committed with keys `ledger_sum_before_usd`, `ledger_sum_after_usd`, `billing_sum_usd`, `delta_pct_before`, `delta_pct_after`, `root_cause`, and satisfying `|delta_pct_after| < |delta_pct_before|`.

## Out of scope
- Backfilling cost rows for runs prior to Item 9 landing — those rows stay 0 with `estimated:true`.
- Re-validating after an outside-5% fix — that is a follow-up slice.

## Risk / rollback
Rollback: `git revert <commit>`. The flip script edits a gitignored file; if it mis-flips rows, restore `cost_ledger.jsonl` from the most recent runner backup or hand-edit (acceptable because the ledger is append-only telemetry, not load-bearing data).

## Slice-completion note

**Status: BLOCKED — owner=user.** Branch `slice/02-cost-telemetry-validation`.

This dispatch could not complete the validation comparison because two
required artifacts can only be produced by the user (Required services /
env section already calls them out as prerequisites):

- `diagnostic/artifacts/cost/anthropic_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv`
  (export from https://console.anthropic.com/settings/usage)
- `diagnostic/artifacts/cost/openai_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv`
  (export from https://platform.openai.com/usage)

Without these, no billing total exists to compute the per-vendor or overall
delta, so neither the within-5% path (Step 6) nor the outside-5% path
(Step 7) can be entered and the corresponding conditional gates are
unreachable. Producing a fabricated comparison would be worse than blocking,
so neither the flip script nor the parser-fix before/after artifact was
authored.

### What was done in scope
- Computed the validation window per the slice rule:
  `window-start=2026-04-26T02:03:14Z`, `window-end=2026-04-27T05:20:50Z`
  (covered slices = the ten most recent merges in `_state.md` plus the
  in-progress `02-cost-telemetry-validation` rows).
- Sumed `cost_usd` for in-window rows of
  `$LOOP_STATE_DIR/cost_ledger.jsonl`: **41 in-window rows, total
  $0.000000.** Per-(`agent`,`model`) and per-vendor breakdowns are recorded
  in `diagnostic/notes/02-cost-telemetry-validation.md`.
- Captured ledger health observations that point at `discover_log` in
  `scripts/loop/post_dispatch_cost.sh` as the most likely root cause to
  investigate when the slice is unblocked (the embedded python parser
  correctly extracts `usage` blocks when handed a known-good session log;
  the failure is upstream of the parser).

### Decisions
- **Path:** undetermined; strong a-priori expectation: outside-5% (ledger
  is $0.00 over a ~27-hour, 41-row window; any nonzero billing total puts
  delta at -100%).
- **Within-5% flip script** (`scripts/loop/one_time/02_flip_estimated_false.sh`):
  **NOT** authored — slice spec restricts it to the within-5% path and the
  "Changed files expected" list scopes it conditionally.
- **Parser fix** (`scripts/loop/post_dispatch_cost.sh`,
  `scripts/loop/pricing.json`,
  `diagnostic/artifacts/cost/02-parser-fix-before-after.json`): **NOT**
  attempted — the outside-5% gate requires a real `billing_sum_usd` that
  the loop cannot obtain. Deferred to the unblocking pass.

### Self-check vs. acceptance criteria
- [x] Validation note committed with window timestamps, per-vendor ledger
      sums, deltas placeholder explaining unavailability, decision.
- [ ] Both billing-console CSVs committed — **blocker**.
- [n/a] Within-5% path artifacts — path not selected.
- [n/a] Outside-5% path artifacts — path not selected.

### Gate-command exit codes (this dispatch)
- `npm --prefix web run build`           — exit 0
- `npm --prefix web run typecheck`       — exit 0
- `npm --prefix web run test:grading`    — exit 0 (21 pass / 10 skip / 0 fail)
- `test -f diagnostic/notes/02-cost-telemetry-validation.md` — exit 0
- `ls diagnostic/artifacts/cost/anthropic_*.csv diagnostic/artifacts/cost/openai_*.csv`
  — exit 1 (`no matches found`) — **the blocker**
- within-5% conditional gate — n/a (path not selected)
- outside-5% conditional gate — n/a (path not selected)

### Files changed in this dispatch
- `diagnostic/notes/02-cost-telemetry-validation.md` — created.
- `diagnostic/slices/02-cost-telemetry-validation.md` — frontmatter
  (`status`, `owner`, `updated`) and this Slice-completion note section.

### Branch + commit
- Branch: `slice/02-cost-telemetry-validation`
- Commit hash: `f58bd79` (`slice 02-cost-telemetry-validation: blocked on
  billing-console CSV exports`,
  `[slice:02-cost-telemetry-validation][blocked]`). Pushed to `origin`.

### To unblock
1. Export the two CSVs above to the listed paths and commit them.
2. Re-dispatch this slice. The unblocking pass will: re-run the always-on
   web gates and the existence checks, compute deltas (Step 5), select the
   within-5% or outside-5% path, produce the conditional artifacts, run the
   conditional gate, and flip frontmatter to `status=awaiting_audit`.

## Audit verdict
(filled by Codex)

### Repair-agent diagnosis (repair attempt 1 — escalate)

The slice was not rejected by Codex; this section was never filled. The implementer self-blocked after correctly completing all automatable work (window computation, ledger summation, note creation, all web gates passing). The sole blocker is two billing-console CSV exports that require manual browser download by the user:

- `diagnostic/artifacts/cost/anthropic_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv` — from https://console.anthropic.com/settings/usage
- `diagnostic/artifacts/cost/openai_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv` — from https://platform.openai.com/usage

No protocol fix or implementation retry can supply these. Status remains `blocked`, `owner: user`. Action required: export both CSVs for the window `2026-04-26T02:03:14Z → 2026-04-27T05:20:50Z`, commit them to the paths above, then re-dispatch the slice.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Rewrite the gate command block so it is paste-safe from repo root; as written, consecutive `cd web && ...` lines will leave the shell in `web/` after the first command and make the next `cd web` fail.
- [x] Specify concrete Anthropic and OpenAI billing export paths and the exact validation-window selection rule so the implementer can reproduce "same window" without guessing.

### Medium
- [x] Add every conditionally touched implementation file to Changed files expected, including `scripts/loop/post_dispatch_cost.sh` when the delta is outside 5% and any committed one-time script if Step 4 requires one.
- [x] Add a testable verification step for the ledger mutation or parser-gap path, such as a command/check that proves only rows in the validation window were flipped or that the parser fix changes the computed comparison.

### Low
- [x] Clarify whether `diagnostic/notes/02-cost-telemetry-validation.md` is the validation artifact despite `## Artifact paths` saying `None`.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state concern was found.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Reorder the web gate commands so `npm --prefix web run build` runs before `npm --prefix web run typecheck`, because `web/next-env.d.ts` references `.next/types/routes.d.ts` generated by the build.
- [x] Make the within-5% flip-script requirements match the gate by explicitly requiring `--dry-run` support and the exact `rows_in_window=... rows_outside_window_unchanged=...` stdout format used by the gate.
- [x] Fix the outside-5% gate so it is satisfiable for both parser fixes and pricing-only fixes; either require implementing `scripts/loop/post_dispatch_cost.sh --self-test` on every outside-5% path or replace the gate with the accepted before/after computed-cost comparison artifact.

### Medium
- [x] Define the ledger-to-vendor grouping rule for all expected agent values, including `claude-revise`, `claude-repair`, `codex-native`, and `codex-claude-fallback`, so per-vendor deltas cannot be computed inconsistently.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state concern was found.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state concern was found.
