# Slice 02-cost-telemetry-validation — validation note

**Status: BLOCKED — owner=user.** This slice cannot proceed end-to-end from
within the autonomous loop. Two external inputs are required from the user
before the comparison and decision steps can run.

## Validation window (computed per slice rule)

The slice's window-selection rule sets `window-start` to the `ts` of the first
ledger row whose `slice` is one of the ten most recent merges in
`diagnostic/_state.md`, and `window-end` to the most recent ledger `ts` at the
time the slice begins.

- **Recent slice merges (top 10 from `_state.md` at slice start):**
  `02-cache-hit-assertion`, `02-cache-control-markers`,
  `02-prompt-static-prefix-split`, `01-perf-trace-fix-spans`,
  `01-baseline-snapshot`, `01-perf-summary-route`,
  `01-route-stage-timings`, `01-perf-trace-helpers`,
  `00-fresh-benchmark`, `00-verify-script`.
- **Window-start (UTC):** `2026-04-26T02:03:14Z` — first ledger row whose
  slice is `00-verify-script` (the earliest of the ten covered slices).
- **Window-end (UTC):** `2026-04-27T05:20:50Z` — `tail -1 cost_ledger.jsonl`
  at slice start (a `02-cost-telemetry-validation` row).
- **Slice IDs covered by the window:** all ten "recent merges" slices listed
  above, plus the in-progress `02-cost-telemetry-validation` rows (which
  fall inside `[window-start, window-end]` by timestamp and are not excluded
  by the slice spec).

If the user must round to whole UTC days for a console that only supports
day granularity:
- Anthropic / OpenAI rounded window: `[2026-04-26 00:00 UTC,
  2026-04-28 00:00 UTC)` (window-start rounded down to 2026-04-26 00:00 UTC,
  window-end rounded up to 2026-04-28 00:00 UTC). Document the rounding
  alongside the export.

## Ledger sum (within window) — observed

Source: `$LOOP_STATE_DIR/cost_ledger.jsonl`
(`/Users/robertzehnder/Documents/coding/f1/openf1/scripts/loop/state/cost_ledger.jsonl`).

- **Rows in window:** 41 (39 from the ten recent-merge slices + 2 from the
  in-progress `02-cost-telemetry-validation` slice itself).
- **Rows outside window:** 8 (older rows before `00-verify-script`).
- **`cost_usd` sum across in-window rows:** **$0.000000.**

### Per-(`agent`, `model`) breakdown for in-window rows

| `agent`             | `model`            | rows | sum `cost_usd` |
|---|---|---:|---:|
| `claude`            | `claude-cli`       |   10 | $0.000000 |
| `claude`            | `claude-opus-4-7`  |    4 | $0.000000 |
| `claude-revise`     | `claude-opus-4-7`  |   11 | $0.000000 |
| `codex-slice-audit` | *(field missing)*  |   16 | $0.000000 |

### Per-vendor split (per slice's "Ledger-to-vendor grouping rule")

Vendor is determined by the row's `model` prefix; rows whose `model` is
missing entirely cannot be classified by that rule.

| Vendor    | Rule applied                       | rows | sum `cost_usd` |
|---|---|---:|---:|
| Anthropic | `model` starts with `claude-`      |   25 | $0.000000 |
| OpenAI    | `model` starts with `gpt-`/`o<d>`  |    0 | $0.000000 |
| *unclassified* | `model` field absent          |   16 | $0.000000 |

> **Note on the 16 unclassified rows.** The slice's grouping rule says any
> non-conforming `model` value should "fail loud", but it also documents in
> "Out of scope" that runs prior to Item 9 stay $0 with `estimated:true`.
> All 16 unclassified rows here are `agent=codex-slice-audit`, all carry
> `cost_usd=0`, all pre-date the Item 9 schema change (no `model` /
> `estimated` / `source` / `cache_write_tokens` fields), and per the
> agent→vendor table in the slice would route to OpenAI/`gpt-5` if a model
> field were present. Because they sum to $0, including or excluding them
> does not move the headline ledger total. Flagging here so the auditor and
> the unblocking pass can decide whether to (a) treat them as
> OpenAI-vendor / pre-Item-9 zero rows, or (b) "fail loud" and re-scope the
> validation window to only post-Item-9 rows. Recommendation: (a), with the
> rule clarification folded into a follow-up slice.

### Per-`agent` row counts (in-window, for traceability)

- `claude`             — 14
- `claude-revise`      — 11
- `codex-slice-audit`  — 16

All `agent` values present in-window appear in the slice's
"Ledger-to-vendor grouping rule" table; no new rows had to be added.

> No per-vendor delta can be computed yet because both billing-console totals
> are unavailable to the autonomous loop (see "Why this slice is blocked"
> below). However, the ledger sum being **exactly $0** across 41 dispatches
> over a ~27-hour window is a strong a-priori signal that the ledger and the
> billing totals will diverge by far more than ±5%, i.e. the outside-5%
> branch (slice Step 7) will apply once the comparison can be run.

## Ledger health observations

These are diagnostic context to help the unblocking pass; they are not a fix
attempt.

1. **All 49 ledger rows have `cost_usd == 0`.** Of these:
   - 15 rows carry `estimated:true` and `model:"claude-opus-4-7"` (i.e. the
     post-Item-9 estimator is firing) but their `input_tokens` /
     `output_tokens` / `cache_*_tokens` are all `0` and `source` is
     `unknown`.
   - 34 older rows lack the `estimated`, `cache_write_tokens`, and `source`
     fields entirely (i.e. pre-date the current `post_dispatch_cost.sh`
     shape) — these are the per-`_state.md` "rows prior to Item 9 landing"
     that the slice's "Out of scope" section explicitly leaves at $0.
2. The 15 newer `estimated:true` rows DO correspond to dispatches whose
   Claude session logs are parseable. Sample probe of one such session
   (`02-cache-control-markers/95f0678b-…jsonl`) shows
   `input_tokens=27`, `output_tokens=20849`,
   `cache_read_input_tokens=488932`, `cache_creation_input_tokens=94138`
   across 15 `usage` blocks. The python parser embedded in
   `post_dispatch_cost.sh` correctly extracts those numbers when invoked
   directly on the same file. This means the parser logic is fine; the
   failure is upstream — the `discover_log` step is not selecting a session
   log that matches the just-finished dispatch (most plausible cause: the
   600-second mtime cutoff plus mtime races for nested project sessions;
   possible alternative: `find -newer /dev/null` on a path that contains
   directories whose mtime updates while the file mtimes do not). Pinning
   down the exact root cause is the work of slice Step 7 (the outside-5%
   path), and is deferred until the comparison can be run.

## Why this slice is blocked

The slice's Step 3 and Step 4 each require a CSV that only the user can
produce, because they live behind authenticated billing dashboards:

- `diagnostic/artifacts/cost/anthropic_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv`
  — must be exported from
  https://console.anthropic.com/settings/usage for the validation window.
- `diagnostic/artifacts/cost/openai_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv`
  — must be exported from
  https://platform.openai.com/usage for the validation window.

The autonomous loop has no browser session for either console, so neither
artifact can be produced from inside the loop. The slice's
"Required services / env" section already enumerates these two as
prerequisites; the implementation agent simply does not satisfy them.

Once both CSVs are committed under `diagnostic/artifacts/cost/`, the rest of
the slice (Step 5 delta computation, Step 6 within-5% flip script, or Step 7
parser fix + before/after artifact, and all gates) can be completed in a
follow-up implementation pass without further user interaction. Given the
ledger is currently `$0.00` overall, the follow-up will almost certainly
take Step 7 (parser fix); the ledger-health observations above point at
`discover_log` in `scripts/loop/post_dispatch_cost.sh` as the most likely
root cause to investigate.

## Decision

- **Path:** undetermined (cannot decide without billing totals). Strong
  a-priori expectation: outside-5% / Step 7.
- **Within-5% flip script:** **NOT** authored — slice spec restricts it to
  the within-5% path, and `scripts/loop/one_time/02_flip_estimated_false.sh`
  is conditionally listed under "Changed files expected" precisely so it is
  not committed when the path does not apply.
- **Parser fix:** **NOT** attempted — without `billing_sum_usd` from the
  console exports there is no way to populate the
  `diagnostic/artifacts/cost/02-parser-fix-before-after.json` artifact in a
  way that satisfies the outside-5% gate
  (`abs(delta_pct_after) < abs(delta_pct_before)` requires a real
  `billing_sum_usd`). Doing it now would either produce a fabricated
  comparison or a partial fix that the gate would reject — both are worse
  than blocking.

## What the user must hand back to unblock

1. Export the Anthropic billing CSV for `[2026-04-26T02:03:14Z,
   2026-04-27T05:20:50Z]` (or the rounded `[2026-04-26 00:00 UTC,
   2026-04-28 00:00 UTC)` UTC day range, noted on export) and commit it as
   `diagnostic/artifacts/cost/anthropic_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv`.
2. Export the OpenAI billing CSV for the same window and commit it as
   `diagnostic/artifacts/cost/openai_2026-04-26T02-03-14Z_2026-04-27T05-20-50Z.csv`.
3. Re-dispatch this slice. The implementer will then run Step 5 (compute
   per-vendor and overall deltas), pick the within-5% or outside-5% path,
   and finish.

## Gate-command results (this dispatch — blocked)

The slice's "Gate commands" block includes always-on web build/typecheck/test
gates, an existence check for the validation note, and an existence check
for the two billing CSVs. The note exists; the two CSVs cannot be produced
from inside the loop, so the second existence-check gate fails. The within-5%
and outside-5% conditional gates are not run because no path is selected.

All three always-on web gates were run from this worktree at slice time and
pass on the diff being submitted (the diff is note-only, so no code-quality
gate is at risk).

| Gate | Exit | Notes |
|---|---:|---|
| `npm --prefix web run build`                                                                | 0  | next build succeeds; static + dynamic routes generate cleanly. |
| `npm --prefix web run typecheck`                                                            | 0  | `tsc --noEmit` clean. |
| `npm --prefix web run test:grading`                                                         | 0  | 21 pass / 10 skip / 0 fail (skips are integration tests gated on `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`). |
| `test -f diagnostic/notes/02-cost-telemetry-validation.md`                                  | 0  | this file. |
| `ls diagnostic/artifacts/cost/anthropic_*.csv diagnostic/artifacts/cost/openai_*.csv`       | 1  | "no matches found" — CSVs unavailable; **this is the blocker**. |
| within-5% gate (`02_flip_estimated_false.sh --dry-run \| grep -E '^rows_in_window=…$'`)     | n/a | path not selected. |
| outside-5% gate (`02-parser-fix-before-after.json` keys + `\|delta_pct_after\| < \|delta_pct_before\|`) | n/a | path not selected. |

When the user returns the two CSVs, the unblocking pass will re-run all
three web gates, the two existence checks, and whichever conditional gate
the selected path requires.
