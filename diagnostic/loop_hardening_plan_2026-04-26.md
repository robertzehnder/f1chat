# Loop Hardening Plan — Pre-Flight for End-to-End Roadmap Run

**Date:** 2026-04-26
**Author:** Claude (Opus 4.7, 1M context), drafted for OpenAI Codex audit
**Companion docs:**
- [roadmap_2026-04_performance_and_upgrade.md](roadmap_2026-04_performance_and_upgrade.md) — the 13-phase roadmap the loop is executing
- [automation_2026-04_loop_runner.md](automation_2026-04_loop_runner.md) — control-loop architecture
- [_state.md](_state.md) — current rolling project state

---

## 1. Context — what I'm trying to achieve

I'm running an autonomous Claude-implements / Codex-audits loop against a 13-phase performance + quality roadmap (`diagnostic/roadmap_2026-04_performance_and_upgrade.md`). The loop architecture is described in `diagnostic/automation_2026-04_loop_runner.md` and the slice queue in `diagnostic/slices/_index.md` (85 slices total).

**Current state:**
- Phase 0 (10 slices) and Phase 1 (4 slices) are **done** — 14/85.
- 71 slice files remain unstubbed.
- The loop produced its first real perf baseline at `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` showing overall p50=12.6s, p95=26.3s.
- `_state.md` carries-forward project context across slices.

**What I want to do next:** kick off an end-to-end run that takes the loop through all remaining 71 slices (Phases 2–12) without me babysitting it. Realistically that's a 2–4 day autonomous run.

**Why now:** Phase 1 closeout exposed several rough edges. Some are tolerable (annoying log lines); some would break or substantially degrade an unattended multi-day run. I want to fix the load-bearing ones before committing to the full run, and have Codex sanity-check the priority list.

**Outcome I'm aiming for:** by the end of this hardening pass, the loop should be able to run unattended through Phases 2–12 with these properties:
- No silent worktree corruption from race conditions.
- Cost telemetry that actually constrains spend.
- Latency baseline I can trust as the "before" number for Phase 2+ measurements.
- Auto-merger that doesn't flake on phase-3/9 conflicts.
- Visibility (logs / queryable history / alerting) into what the loop did overnight.

---

## 2. Inventory of known issues

I observed these during the conversation that built the loop and during the Phase 0–1 run. They fall into four severity buckets.

### 2.1 Critical — will block or substantially degrade an end-to-end run

| # | Issue | Evidence | Impact on full run |
|---|---|---|---|
| C-1 | **71 of 85 slice files don't exist** | `loop_status.sh` shows MISSING for Phases 2–12 | Loop idles on "no actionable slice" after `01-baseline-snapshot`. Cannot run end-to-end without these. |
| C-2 | **Span-boundary bug in `01-route-stage-timings`** | `runtime_classify` and `resolve_db` show identical p50/p95 (7190.91ms each) in `01-baseline-snapshot_2026-04-26.json`. `runtime_classify` is local-only logic in `chatRuntime.ts:516`; can't take 7s. | Phase 2 (prompt caching) and Phase 3 (matview) measure improvement against a misleading baseline. |
| C-3 | **Single-worktree race when user operates during runner** | Hit twice — commits landed on slice branch instead of integration when runner had checked out a slice branch under our feet | A multi-day run will have many human interventions for blocked slices. Each one is a race opportunity. |
| C-4 | **`LOOP_MAX_PLAN_ITERATIONS=4` too low for complex slices** | `01-perf-summary-route` hit cap; auto-repair saved it. Phase 9 (21 refactor splits), Phase 8 (synthesis hardening) likely hit cap too | Expected ≥30% of remaining slices will need cap bump or auto-repair to converge |
| C-5 | **Codex CLI exits rc=1 even on successful audits** | Observed multiple times; verdict still lands but `consecutive_failures` increments. Could trip the cap-of-5 circuit breaker on a slow phase | Spurious circuit-breaker exits stop the loop in the middle of a phase |
| C-6 | **Mirror-onto-integration race during dispatch** | Codex audits on slice branch; mirror commit may not land if Codex exits rc=1 before the mirror step completes | Slice file shows stale state on integration → runner re-dispatches the implementer on already-audited work |

### 2.2 Important — produces noisy results or wastes compute

| # | Issue | Effect |
|---|---|---|
| I-1 | Cost telemetry stub (`cost_usd=0` in ledger) | Daily cap is advisory only. No real spending visibility for an overnight run. |
| I-2 | No CI verification on integration pushes | `00-ci-workflow` shipped but workflow not confirmed firing on actual pushes |
| I-3 | No regression gate between slices | Slice N+1 can break what slice N established; audit only checks N+1's gates |
| I-4 | `LOOP_AUTO_APPROVE` is binary | Lumps security (`00-dep-patches`), production (`06-*`), cost (Neon CU sizing) waivers into one flag |
| I-5 | `web/logs/chat_query_trace.jsonl` grows unbounded | After Phase 8 (thousands of test runs) could be MB+; perf-summary route would slow |
| I-6 | Stale `fail_count_*` files | `repair_count_*` and `plan_iter_count_*` reset on merge, but `fail_count_*` does not |
| I-7 | Auto-merger conflict policy is opinionated | Bails on `sql/*`, `src/*`, `scripts/loop/*` — Phase 3 (SQL) and Phase 9 (refactor) likely produce these |
| I-8 | No history queryability | Can't ask "which slices needed repair?" without grepping git log |
| I-9 | No webhook / alerting for blocked-stuck slices | Runner exits cleanly on USER ATTENTION; if user isn't checking, loop idles |

### 2.3 Nice-to-have — cosmetic or future polish

| # | Issue | Effect |
|---|---|---|
| N-1 | State machine has two `revising` states (`revising` impl, `revising_plan`) | Cognitive load |
| N-2 | Slice files accumulate audit verdict rounds | After 5 rounds of plan-audit, slice file gets long |
| N-3 | Sequential slice queue — can't parallelize | Phase 9's 21 refactor splits could run concurrently |
| N-4 | 500+ commits expected for 85 slices on integration | Hard to read history |
| N-5 | No prompt-effectiveness audit | We added "read `_state.md` first" but no test confirms agents actually do it |
| N-6 | Mixed model selection across roles | Implementer Opus 4.7, plan-reviser Opus 4.7, Codex auditor GPT-5, fallbacks Sonnet 4.6 default. Ad hoc. |
| N-7 | Env vars for benchmark slices not documented | Newcomer can't run them without copying secrets |

### 2.4 Decisions deferred (no fix yet, but will need to be made)

| # | Decision | When forced |
|---|---|---|
| D-1 | Production trace sink (Logflare / Axiom / Datadog / Postgres) | Phase 6 or 12 |
| D-2 | Migration runner choice (sqitch / Atlas / Python) | Phase 12 |
| D-3 | Matview refresh strategy (full / per-session / hybrid) | Phase 3 prototype |
| D-4 | Read-replica trigger condition | Phase 12 |
| D-5 | Product direction (chat-first vs analyst console) | Phase 10 |

---

## 3. Recommended pre-run hardening — scope and order

I want Codex to audit **what** I'm planning to fix, **what** I'm explicitly not fixing, and the **order**. The full list above is for transparency; the actual pre-run scope is narrower.

### 3.1 Scoped IN — must land before kickoff (~2 days)

1. **C-2: Fix span-boundary bug in `01-route-stage-timings`.** Verify that `runtime_classify` and `resolve_db` aren't sharing/double-counting time. Re-run `01-baseline-snapshot` to produce a clean baseline. **~30 min.** *Note: this is a one-off slice (`01-perf-trace-fix-spans`), not a protocol change.*

2. **C-3: Git worktree isolation.** Migrate `dispatch_claude.sh`, `dispatch_codex.sh`, `dispatch_repair.sh`, `dispatch_plan_revise.sh` to use `git worktree add` per dispatch instead of `git checkout` in the shared worktree. The runner stays on `integration/perf-roadmap`; agents work in `~/.openf1-loop-worktrees/<slice-id>/`. **~1 day.**

3. **C-4: Bump `LOOP_MAX_PLAN_ITERATIONS` to 6.** Plus add a "give up gracefully" path: after iteration 5, the auditor gets a special prompt instruction to either approve with deferred Mediums OR explicitly REJECT, instead of running another round. **~30 min.**

4. **C-5: Detect verdict-landed-by-status, not by exit code.** In `runner.sh`'s `dispatch_with_guards`, after the dispatcher returns, check if the slice file's frontmatter status changed. If yes, treat as success regardless of rc. **~1 hour.**

5. **C-6: Move mirror step out of agent prompt into dispatcher post-step.** `dispatch_codex.sh` (after `codex exec` returns) reads slice branch's slice file via `git show` and commits the mirror on integration deterministically. Remove the mirror instructions from the agent prompt. **~1 hour.**

6. **C-1: Stub the remaining 71 slice files.** Heaviest-but-most-mechanical work. Convert each `_index.md` entry into a proper slice file with frontmatter (status: `pending_plan_audit`, owner: `codex`), Goal, Inputs, Required services / env, Steps, Changed files expected, Gate commands, Acceptance criteria, Out of scope, Prior context (where relevant). **~3–6 hours.** I'll do these in batches by phase, leaning on the iterative plan-audit to tighten any rough drafts during the run.

### 3.2 Scoped IN — observability quick wins (~2 hours)

7. **I-1: Real cost telemetry.** Parse `~/.claude/logs/` and `~/.codex/sessions/<date>/rollout-*.jsonl` post-dispatch to extract token counts; multiply by current pricing. Append real `cost_usd` to ledger. **~1 hour.**

8. **I-9: Webhook alerting on key events.** ~10 lines in `runner.sh` to POST a Telegram/Slack message on `CIRCUIT BREAKER`, `USER ATTENTION`, `merged and pushed`, `runner exit`. Configurable via `LOOP_NOTIFY_WEBHOOK`. **~15 min.**

9. **I-8: `loop_history.sh` — queryable history.** Aggregates from git log + state files: per-slice plan-iter rounds, repair attempts, time-to-merge. Useful for the post-run review. **~30 min.**

### 3.3 Scoped OUT — explicitly NOT fixing pre-run

| # | Reason for deferring |
|---|---|
| I-2 (CI verification) | One-time check after kickoff; not blocking |
| I-3 (regression gate) | Adds non-trivial gate cost; will surface failures organically |
| I-4 (granular approval) | `LOOP_AUTO_APPROVE=1` is a known knob I'm OK with |
| I-5 (trace rotation) | Will get to it if perf-summary becomes slow during run |
| I-6 (stale fail counters) | Cosmetic; resets on next failure |
| I-7 (auto-merger conflict policy) | Will hit organically on Phase 3 / 9 — fix when it bites |
| All N-* items | Cosmetic / future |
| All D-* items | Will surface organically when the corresponding phase runs |

I want Codex to push back on this scoping if any of the deferred items would actually break the run.

---

## 4. Detailed work plan — per-item recipe

### Item 1 — C-2 (span-boundary fix)

**Files to inspect:**
- `web/src/lib/perfTrace.ts` (span helpers)
- `web/src/app/api/chat/route.ts` (where spans wrap stages)

**What's wrong:** `runtime_classify` p50 = `resolve_db` p50 = 7190.91ms. Local logic shouldn't take 7s. Either spans share a parent that bleeds time, or `Span.end()` is called twice for the same data, or stage names are aliased.

**Fix recipe:** create slice `01-perf-trace-fix-spans`. Audit the span boundaries in `route.ts`. Confirm each stage span starts and ends at distinct points in the request lifecycle. Re-run `01-baseline-snapshot` (or write a `01-baseline-snapshot-v2` slice that re-captures the artifact under the same naming convention).

### Item 2 — C-3 (git worktree isolation)

**Files to modify:**
- `scripts/loop/dispatch_claude.sh`
- `scripts/loop/dispatch_codex.sh`
- `scripts/loop/dispatch_repair.sh`
- `scripts/loop/dispatch_plan_revise.sh`
- `scripts/loop/runner.sh` (preconditions check needs to know worktree paths)
- `scripts/loop/dispatch_merger.sh` (clean up worktree after merge)
- New file: `scripts/loop/worktree_helpers.sh`

**Pattern:**
```bash
WORKTREE_BASE="${LOOP_WORKTREE_BASE:-$HOME/.openf1-loop-worktrees}"
slice_worktree="$WORKTREE_BASE/$slice_id"

# Create worktree on demand
if [[ ! -d "$slice_worktree" ]]; then
  git worktree add "$slice_worktree" -b "slice/$slice_id" integration/perf-roadmap
fi

# Run agent in worktree
( cd "$slice_worktree" && claude --print ... )

# Worktree gets cleaned up on merge
git worktree remove "$slice_worktree" --force
```

**Risks:** disk usage (~50MB per slice; up to 4 concurrent worktrees realistically = 200MB cap). Mitigation: prune on merge.

**Verification:** start runner, kick off a slice, verify the runner's main worktree HEAD doesn't move. Run a manual `git status` in the main worktree mid-dispatch — must show clean.

### Item 3 — C-4 (raise plan-iteration cap)

**Files to modify:**
- `scripts/loop/dispatch_plan_revise.sh` — change default `MAX_ITERATIONS` from 4 to 6
- `scripts/loop/prompts/codex_slice_auditor.md` — add: "After round 5, if items remain, you have two choices: (a) APPROVED with explicit list of deferred Mediums and Lows that the implementer judgment-calls; (b) REJECT for genuine architectural ambiguity. Do NOT continue to round 6+ generating new triage."

**Rationale:** the loop currently keeps tightening spec until cap. For complex slices, "good enough now" beats "perfectly specified eventually." The auditor needs explicit permission to stop.

### Item 4 — C-5 (status-based success detection)

**Files to modify:**
- `scripts/loop/runner.sh` — `dispatch_with_guards()` function

**Pattern:** before incrementing fail counter, check if the slice frontmatter status changed since dispatch began. If status moved from `awaiting_audit` → `ready_to_merge`/`revising`/`blocked`, treat as success regardless of rc.

**Pseudocode:**
```bash
dispatch_with_guards() {
  local sid="$1"; shift
  local status_before status_after
  status_before=$(read_field "diagnostic/slices/${sid}.md" status)
  if "$@"; then rc=0; else rc=$?; fi
  status_after=$(read_field "diagnostic/slices/${sid}.md" status)
  if [[ "$status_before" != "$status_after" ]]; then
    # Verdict landed; treat as success regardless of rc
    slice_fail_reset "$sid"
  elif [[ $rc -ne 0 ]]; then
    slice_fail_increment "$sid"
  else
    slice_fail_reset "$sid"
  fi
}
```

### Item 5 — C-6 (deterministic mirror step)

**Files to modify:**
- `scripts/loop/dispatch_codex.sh` — add post-step after `codex exec` returns
- `scripts/loop/prompts/codex_auditor.md` — remove mirror instructions

**Pattern:**
```bash
# After codex exec, regardless of rc
if [[ -n "$(git show "slice/${slice_id}:diagnostic/slices/${slice_id}.md" 2>/dev/null)" ]]; then
  # Slice branch has its own version; mirror onto integration
  git show "slice/${slice_id}:diagnostic/slices/${slice_id}.md" > "diagnostic/slices/${slice_id}.md"
  if ! git diff --quiet -- "diagnostic/slices/${slice_id}.md"; then
    git add "diagnostic/slices/${slice_id}.md"
    git commit -m "audit: mirror verdict for ${slice_id} onto integration

[slice:${slice_id}][protocol-mirror][dispatcher]"
    git push
  fi
fi
```

### Item 6 — C-1 (stub 71 slice files)

**Source of truth for queue order:** `diagnostic/slices/_index.md`

**Per-phase stubbing approach:**
1. Phase 2 (3 slices): Anthropic prompt caching. Specs largely covered in roadmap §4 Phase 2.
2. Phase 3 (13 slices): Materialized contracts. Roadmap §4 Phase 3 has the prototype + scale-out list. Each scale-out is essentially the same template with a different contract name.
3. Phase 4 (2 slices): Indexes. Roadmap §4 Phase 4 enumerates the index list.
4. Phase 5 (3 slices): App-layer caches. Roadmap §4 Phase 5.
5. Phase 6 (5 slices): Neon plumbing. Roadmap §4 Phase 6. **All have `user_approval_required: yes`.**
6. Phase 7 (3 slices): LLM path tightening + streaming.
7. Phase 8 (7 slices): Synthesis hardening. Phase-8 slices need `## Prior context` pointing at the latest healthcheck artifact and the specific question IDs still failing.
8. Phase 9 (21 slices): Runtime refactor. Each is a small mechanical split.
9. Phase 10 (6 slices): Product surfaces.
10. Phase 11 (5 slices): Quality cleanup. Like Phase 8, needs benchmark-aware Prior context.
11. Phase 12 (3 slices): Production deployment. **All `user_approval_required: yes`.**

**Mechanical template per slice (already used for Phase 1 stubs):**
```
---
slice_id: <id>
phase: <n>
status: pending_plan_audit
owner: codex
user_approval_required: <yes|no>
created: 2026-04-26
updated: 2026-04-26
---

## Goal
<one sentence>

## Inputs
- <files / docs the implementer reads>

## Prior context
- `diagnostic/_state.md`
- <slice-specific artifact paths>

## Required services / env
- <or "None at author time">

## Steps
1. ...

## Changed files expected
- ...
- `diagnostic/slices/<id>.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
- (or "None")

## Gate commands
\`\`\`bash
...
\`\`\`

## Acceptance criteria
- [ ] ...

## Out of scope
- ...

## Risk / rollback
- ...

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
```

### Items 7–9 — observability quick wins

**Item 7 (cost telemetry):** new `scripts/loop/post_dispatch_cost.sh` invoked from `dispatch_claude.sh` and `dispatch_codex.sh` after the agent returns. Reads the latest session JSONL for that agent, sums `input_tokens + output_tokens × pricing`, appends real `cost_usd` to `cost_ledger.jsonl` (replacing the `0` placeholder).

**Item 8 (webhook):** in `runner.sh`'s `log()` function, match on key event strings; if matched and `LOOP_NOTIFY_WEBHOOK` is set, POST to it.

**Item 9 (loop history):** new `scripts/loop/loop_history.sh`. Aggregates:
- Per-slice: plan-iter rounds, repair attempts, time-to-merge, did-it-circuit-breaker
- Phase: total wall-clock, total LLM cost (once Item 7 lands)

---

## 5. Sequencing and dependencies

```
[Item 1 (span fix)] ─→ slice; standalone
[Item 2 (worktree isolation)] ─→ touches dispatchers; do BEFORE other dispatcher changes
[Item 3 (cap+graceful-stop)] ─→ touches plan-revise dispatcher + auditor prompt
[Item 4 (status-based success)] ─→ touches runner.sh
[Item 5 (deterministic mirror)] ─→ touches dispatch_codex.sh + auditor prompt
[Item 6 (stub 71 slices)] ─→ touches diagnostic/slices/ only; can run in parallel with 2–5
[Items 7–9 (observability)] ─→ each is independent; nice to land before kickoff
```

**Critical-path order:**
1. Item 2 first (worktree isolation) — biggest correctness fix, prerequisite for safely doing items 3–5 without race risk.
2. Items 3, 4, 5 in parallel after item 2 lands.
3. Item 1 (span fix) — can run as a slice through the loop itself once the loop is hardened.
4. Item 6 (stub slices) — pure documentation; can run in parallel with everything.
5. Items 7–9 last — observability is nice but doesn't change correctness.

**Realistic wall-clock for full prep:** 2 days if focused.

---

## 6. Critical files referenced

**Code under change:**
- `scripts/loop/dispatch_claude.sh`
- `scripts/loop/dispatch_codex.sh`
- `scripts/loop/dispatch_repair.sh`
- `scripts/loop/dispatch_plan_revise.sh`
- `scripts/loop/dispatch_merger.sh`
- `scripts/loop/runner.sh`
- `scripts/loop/prompts/codex_slice_auditor.md`
- `scripts/loop/prompts/codex_auditor.md`

**Code being added:**
- `scripts/loop/worktree_helpers.sh`
- `scripts/loop/post_dispatch_cost.sh`
- `scripts/loop/loop_history.sh`

**Slice file authoring (item 6):**
- `diagnostic/slices/02-*.md` (3 files)
- `diagnostic/slices/03-*.md` (13 files)
- `diagnostic/slices/04-*.md` (2 files)
- `diagnostic/slices/05-*.md` (3 files)
- `diagnostic/slices/06-*.md` (5 files)
- `diagnostic/slices/07-*.md` (3 files)
- `diagnostic/slices/08-*.md` (7 files)
- `diagnostic/slices/09-*.md` (21 files)
- `diagnostic/slices/10-*.md` (6 files)
- `diagnostic/slices/11-*.md` (5 files)
- `diagnostic/slices/12-*.md` (3 files)

**Reference / read-only:**
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` — source for slice content
- `diagnostic/slices/_index.md` — queue order
- `diagnostic/_state.md` — current loop state
- `diagnostic/automation_2026-04_loop_runner.md` — loop architecture

---

## 7. Verification

After landing items 1–9 and stubbing the 71 slice files:

1. **Bash syntax sweep:** `for s in scripts/loop/*.sh; do bash -n "$s"; done` — must all pass.
2. **Worktree isolation:** start the runner in dry-run mode (`LOOP_DRY_RUN=1`), verify each tick logs the worktree path it would have used and the main worktree's `git status` stays clean.
3. **Status-based success detection:** trigger a dispatch where the agent edits the slice file but exits non-zero (simulate Codex rc=1). Verify `consecutive_failures` does not increment.
4. **Mirror determinism:** verify dispatch_codex.sh, after agent returns, always commits the mirror if the slice branch and integration have divergent slice files.
5. **Plan-iter cap behavior:** synthetically set `plan_iter_count_<slice>` to 5 and trigger a dispatch. Verify the auditor's prompt now instructs it to approve-with-deferred or reject.
6. **Slice file count:** `find diagnostic/slices -name '*.md' -not -name '_*' | wc -l` should be 85.
7. **`loop_status.sh`:** zero `MISSING` rows; all 85 slices show a real status.
8. **Cost telemetry:** dispatch one slice, verify `cost_ledger.jsonl` has a real non-zero `cost_usd` for that dispatch.
9. **Webhook:** trigger a `CIRCUIT BREAKER` synthetically and verify the webhook POSTs.
10. **Smoke run:** kick off the runner in real mode against a single Phase-2 slice; verify it goes plan-audit → implement → audit → merge cleanly and post-merge `_state.md` updates.

After all 10 verifications pass, the loop is ready for end-to-end kickoff.

---

## 8. Risks

1. **Worktree migration introduces new bugs.** Most-load-bearing change in the plan. Mitigation: keep the old shared-worktree code path under an env-var flag (`LOOP_WORKTREE_MODE=shared`) for one cycle so we can fall back if the new path explodes.
2. **Stubbing 71 slices ahead of time means we commit to the roadmap structure as written.** If a phase reveals we should restructure, those stubs become wasted work. Mitigation: write the stubs *thin* — Goal + Steps + Gate commands + Acceptance — and let the iterative plan-audit fill in the rest.
3. **Plan-iter cap of 6 may still be too low for the worst slices.** Mitigation: the cap is an env var; raise per-slice if needed via dispatch wrapper.
4. **Cost telemetry parser may not handle all session JSONL shapes.** The Claude and Codex log formats are not documented as stable APIs. Mitigation: best-effort; if parsing fails, fall back to placeholder.
5. **Webhook leaks repo info to a third-party service.** Mitigation: webhook payloads contain only event type + slice id + commit hash; no code or audit content.

---

## 9. Open questions for Codex

1. **Worktree disk usage.** 71 remaining slices × 50MB worktree ≈ 3.5GB peak if all coexisted (won't, since most are sequential). Acceptable?
2. **Plan-iter cap policy after raising to 6.** Right now: hard cap, then auto-repair takes over. Should the auditor's "approve with deferred Mediums" be allowed at any iteration, or only after iteration 5?
3. **Stub-thin vs stub-fat.** Phase-9 refactor slices (21 of them) are mechanical. Should I stub them with explicit per-file mappings or trust the iterative plan-audit to fill in details from the roadmap text?
4. **Cost telemetry — token pricing source.** Should I hardcode current Anthropic / OpenAI pricing in a table, or pull from a config file the user can update? If the model changes mid-run, do we recompute backfill or accept the price drift?
5. **Webhook channel.** I assumed Telegram/Slack. Is there a preferred channel, or should I make the webhook generic (just POST a JSON payload to whatever URL) and let the user wire any service?
6. **Worktree fallback.** Should `LOOP_WORKTREE_MODE=shared` (legacy) stay as a permanent escape hatch, or be removed after one stable run?
7. **Anything in the deferred list (§2.3 / §2.4) that Codex thinks I'm wrongly punting?**
8. **Should Item 6 (stub 71 slices) happen before or after Items 2–5?** Stubbing first means the loop has work queued and can self-test the harden fixes against real slices. Stubbing after means the loop is fully hardened first, then loaded. I'm leaning before, but Codex may have a different read.

---

## 10. What "ready to kick off" means

A single command runs unattended for 2–4 days, processes Phases 2–12 (71 slices), and produces:

- `diagnostic/_state.md` showing all 85 slices done.
- A series of `[state-update]` commits on integration after each merge.
- Phase-by-phase perf baselines under `diagnostic/artifacts/perf/`.
- Phase 11 quality cleanup baseline under `diagnostic/artifacts/healthcheck/` showing semantic-conformance ≥ 40 A/B out of 50.
- A loop-history report (`scripts/loop/loop_history.sh`) summarizing per-slice cost, plan-iter rounds, repair attempts.
- A clean `git log` showing the merge story.

Webhook events fire on every blocked / repaired / phase-boundary state for visibility. If the loop hits a circuit breaker, I get pinged and can intervene; otherwise it runs to completion.

---

## 11. Codex audit ask

Please review:
- Severity classification in §2 (anything mis-bucketed?)
- Scoping in §3 (anything in §3.3 that should be in §3.1?)
- Sequencing in §5 (any wrong-order dependencies?)
- Recipes in §4 (any of the proposed mechanisms wrong / fragile?)
- Open questions in §9

Triage as `High` / `Medium` / `Low` per the existing iterative-plan-audit format. I'll resolve and re-submit until APPROVED before kicking off the run.

---

End of plan.
