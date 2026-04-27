# Loop Hardening Plan — Pre-Flight for End-to-End Roadmap Run

**Date:** 2026-04-26
**Author:** Claude (Opus 4.7, 1M context), drafted for OpenAI Codex audit
**Companion docs:**
- [roadmap_2026-04_performance_and_upgrade.md](roadmap_2026-04_performance_and_upgrade.md) — the 13-phase roadmap the loop is executing
- [automation_2026-04_loop_runner.md](automation_2026-04_loop_runner.md) — control-loop architecture
- [_state.md](_state.md) — current rolling project state

---

## 1. Context — what I'm trying to achieve

I'm running an autonomous Claude-implements / Codex-audits loop against a 13-phase performance + quality roadmap (`diagnostic/roadmap_2026-04_performance_and_upgrade.md`). The loop architecture is described in `diagnostic/automation_2026-04_loop_runner.md` and the slice queue in `diagnostic/slices/_index.md` (86 slices total — 85 from the original roadmap + `02-cost-telemetry-validation` added in round-4).

**Current state:**
- Phase 0 (10 slices) and Phase 1 (4 slices) are **done** — 14/86.
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
| C-1 | **72 of 86 slice files don't exist** (was 71/85 in round-1; +1 with `02-cost-telemetry-validation` added in round-4) | `loop_status.sh` shows MISSING for Phases 2–12 | Loop idles on "no actionable slice" after `01-baseline-snapshot`. Cannot run end-to-end without these. |
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
| N-4 | 500+ commits expected for 86 slices on integration | Hard to read history |
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

### 3.1 Scoped IN — must land before kickoff (~2.5 days, revised post-Codex-audit)

1. **C-2: Fix span-boundary bug in `01-route-stage-timings`.** Verify that `runtime_classify` and `resolve_db` aren't sharing/double-counting time. Re-run `01-baseline-snapshot` to produce a clean baseline. **~30 min.** *Note: this is a one-off slice (`01-perf-trace-fix-spans`), not a protocol change.*

2. **C-3 + repo-level mutation lock: Git worktree isolation with serialized repo mutations.** Migrate dispatchers to `git worktree add` per dispatch. Add a portable `with_repo_lock` helper (mkdir-based, NOT `flock` — macOS lacks it) wrapping ALL repo-mutating operations: `git worktree add`/`remove`, mirror commits, merge, push, state-update commits. The lock prevents two dispatchers (or a dispatcher + the merger) from racing on `.git/index.lock` or simultaneous pushes. See §4 Item 2 for the full pattern. **~1.5 days.**

3. **C-4: Bump `LOOP_MAX_PLAN_ITERATIONS` to 6 + tightened approve-with-deferred policy.** After iteration 5 (not before), the auditor gets explicit permission to APPROVE with deferred Mediums and Lows ONLY. Items in the High bucket can never be deferred — High at iteration 6 → REJECT. **~30 min.**

4. **C-5: Tightened verdict-landed-by-status detection.** In `runner.sh`'s `dispatch_with_guards`, treat the dispatch as successful only if the slice's frontmatter `status` transitioned from the dispatch's expected entry state to a known terminal state for that dispatch type AND the new state is observable on the branch the runner reads (integration). Specifically:
   - Plan-audit dispatch: `pending_plan_audit` → {`pending`, `revising_plan`, `blocked`}
   - Plan-revise dispatch: `revising_plan` → `pending_plan_audit`
   - Implementation dispatch: `pending`/`revising` → `awaiting_audit`
   - Implementation-audit dispatch: `awaiting_audit` → {`ready_to_merge`, `revising`, `blocked`}
   - Merger: `ready_to_merge` → `done`
   Any other transition (including stuck on `in_progress`, no transition at all, or transition only on slice branch but not mirrored) → fail counter increments. **~1.5 hours.**

5. **C-6: Deterministic mirror with explicit checkout, lock, validation, and conflict handling.** `dispatch_codex.sh`'s post-step now:
   - Acquires the repo lock.
   - Pulls integration with `--ff-only`.
   - Reads the slice branch's slice-file via `git show slice/<id>:diagnostic/slices/<id>.md`.
   - Validates the new frontmatter status is in the expected terminal-state set (item 4 above) — if not, abort the mirror and increment the fail counter (the agent didn't actually finish).
   - Diff-and-commit only if content changed.
   - Push integration; on push failure, log + retry once with a fresh pull-rebase, then surface as failure.
   - Release the lock.
   Removes mirror instructions from the agent prompt entirely. **~2 hours.**

6. **NEW C-7 (was deferred I-7): Auto-merger conflict policy hardened pre-run.** The current merger bails on any non-`web/` conflict; Phase 3 (SQL) and Phase 9 (refactor) WILL produce these. New written policy in `scripts/loop/dispatch_merger.sh`:
   - Auto-resolve with **slice-branch's version**: `web/*`, `sql/*`, `src/*`, `diagnostic/slices/<this-slice>.md`. These are the slice's expected work surfaces.
   - Auto-resolve with **integration's version**: `scripts/loop/*`, `scripts/loop/prompts/*`, `diagnostic/_state.md`, `diagnostic/_index.md`. The slice should never be modifying loop infrastructure; if it did, integration wins by default.
   - **Block** (set `status: blocked, owner: user`) on any conflict outside both lists. The merger logs which paths conflicted and which rule applied, then exits 1.
   The policy is encoded as two bash arrays in `dispatch_merger.sh` so future phases can extend without code change. **~1 hour.**

7. **NEW C-8 (was deferred I-2): CI verification before kickoff.** Make one push to `integration/perf-roadmap` with a trivial change, then immediately `gh run list --branch integration/perf-roadmap --limit 1 --json status,conclusion`. Fail the pre-flight if no run was triggered or it concluded `failure`. The `00-ci-workflow` slice merged but never confirmed firing. **~10 min.**

8. **C-1: Stub the remaining 71 slice files.** Heaviest-but-most-mechanical work. Convert each `_index.md` entry into a proper slice file with frontmatter (status: `pending_plan_audit`, owner: `codex`), Goal, Inputs, Required services / env, Steps, Changed files expected, Gate commands, Acceptance criteria, Out of scope, Prior context. **Phase 9 stubs use explicit per-file mappings (per Codex Q3); other phases use thin stubs.** Stubs land **after** Items 2–6 are merged so the hardening mechanics are validated against early Phase-2 slices first (per Codex Q8 final answer). **~3–6 hours.**

### 3.2 Scoped IN — observability quick wins (~2.5 hours)

9. **I-1: Cost telemetry — config-driven, best-effort, advisory.** Parse `~/.claude/logs/` and `~/.codex/sessions/<date>/rollout-*.jsonl` post-dispatch to extract token counts. Pricing comes from `scripts/loop/pricing.json` (env-overridable via `LOOP_PRICING_FILE`). Each ledger row records `{model, source: "session-log-parse", input_tokens, output_tokens, cache_read_tokens, cost_usd, estimated: true}`. The `estimated: true` flag is non-negotiable — parser coverage is unproven. The daily cap stays advisory until the flag flips to `false` (post-validation). **~1.5 hours.**

10. **NEW I-3-min (was deferred I-3): Minimal post-merge regression gate.** After every auto-merge, before regenerating `_state.md`, run a fast invariant check: `bash -n scripts/loop/*.sh`, `loop_status.sh` returns 0, and at phase boundaries (last slice of a phase), the phase's quality gate (`npm run typecheck` + `npm run test:grading` if available, or healthcheck if Phase 8 / 11). Fail → log `REGRESSION` + exit cleanly via the circuit breaker so the user sees it on next attendance. Full regression gating (every slice runs all gates) is still deferred. **~1 hour.**

11. **I-9: Webhook alerting on key events — generic JSON payload.** ~10 lines in `runner.sh` to POST a JSON object `{ts, event, slice_id, commit, message}` on `CIRCUIT BREAKER`, `USER ATTENTION`, `merged and pushed`, `runner exit`, `REGRESSION`. Configurable via `LOOP_NOTIFY_WEBHOOK`. User wires Telegram/Slack/Discord/anything to that URL. **~15 min.**

12. **I-8: `loop_history.sh` — queryable history.** Aggregates from git log + state files: per-slice plan-iter rounds, repair attempts, time-to-merge. **~30 min.**

### 3.3 Scoped OUT — still explicitly NOT fixing pre-run (post-audit)

| # | Reason for deferring |
|---|---|
| I-4 (granular approval) | `LOOP_AUTO_APPROVE=1` is a known knob I'm OK with |
| I-5 (trace rotation) | Will get to it if perf-summary becomes slow during run |
| I-6 (stale fail counters) | Cosmetic; resets on next failure |
| All N-* items | Cosmetic / future |
| All D-* items | Will surface organically when the corresponding phase runs |

**Moved IN (was OUT):** I-7 (now C-7 in §3.1), I-2 (now C-8 in §3.1), I-3 (minimal version now in §3.2 as Item 10) — per Codex audit High-4 / Medium-5 / Medium-7.

---

## 4. Detailed work plan — per-item recipe

### Item 1 — C-2 (span-boundary fix)

**Files to inspect:**
- `web/src/lib/perfTrace.ts` (span helpers)
- `web/src/app/api/chat/route.ts` (where spans wrap stages)

**What's wrong:** `runtime_classify` p50 = `resolve_db` p50 = 7190.91ms. Local logic shouldn't take 7s. Either spans share a parent that bleeds time, or `Span.end()` is called twice for the same data, or stage names are aliased.

**Fix recipe:** create slice `01-perf-trace-fix-spans`. Audit the span boundaries in `route.ts`. Confirm each stage span starts and ends at distinct points in the request lifecycle. Re-run `01-baseline-snapshot` (or write a `01-baseline-snapshot-v2` slice that re-captures the artifact under the same naming convention).

### Item 2 — C-3 + repo-level mutation lock (revised post-round-2 audit)

**Uniform worktree model (per round-2 H-1, with repair carve-out per round-3 H-3):** EVERY agent dispatch that produces *slice work* runs in a slice worktree on a slice branch — including plan-audit and plan-revise (which previously edited integration directly). Every state change mirrors back to integration through `mirror_helper`.

**Repair-agent two modes (round-3 H-3 + round-5 H-3 explicit-classification + round-5 H-2 lifecycle):**

The repair agent operates in one of two modes, **classified BEFORE dispatch** (not inferred from the diff after the fact). The dispatcher inspects the parent slice's audit verdict to decide:

- **Slice-state-only repair (`MODE=slice-state`)** — used when the verdict's items are scoped to the slice file itself (gate ordering, scope rules, plan content). Runs in slice worktree on slice branch; mirror via `mirror_helper`. Routine pushes.
- **Loop-infrastructure repair (`MODE=loop-infra`)** — used when the verdict identifies a protocol bug in `scripts/loop/*`, `scripts/loop/prompts/*`, or `.github/workflows/*`. Runs on main worktree under repo lock. **Push gated by user-approval sentinel.** Self-modifying loop code never auto-pushes.

**How the dispatcher classifies (round-5 H-3 + round-6 M-3 action-item-only):** before invoking the repair agent, the dispatcher parses the latest plan-audit verdict block and **looks ONLY at unchecked items in the High and Medium severity buckets** for protocol-fix keywords (`scripts/loop/`, `prompts/`, `.github/`, `dispatch_*.sh`, `runner.sh`, `mirror_helper`, `repo_lock`). Quotes, file references in Notes, resolved (`- [x]`) checkboxes, and audit-verdict prose discussion are EXPLICITLY ignored.

**Why action-item-only:** an audit verdict often references protocol files in passing — e.g. "the existing `runner.sh` circuit breaker is sufficient — no change needed" — which would falsely classify as `loop-infra` under naive keyword matching. Only items the agent is being asked to ACT ON should drive mode classification.

```bash
classify_repair_mode() {
  local slice_file="$1"
  # Extract the most recent (highest-N) `## Plan-audit verdict (round N)` block.
  local latest_verdict
  latest_verdict=$(awk '
    /^## Plan-audit verdict \(round/ { capture = $0; in_block = 1; buf = ""; next }
    /^## / && in_block { in_block = 0 }
    in_block { buf = buf "\n" $0 }
    END { print buf }
  ' "$slice_file")

  # Within that block, extract only the High and Medium subsections.
  # Stop at "### Low" or "### Notes" or end-of-block.
  local actionable
  actionable=$(echo "$latest_verdict" | awk '
    /^### High/   { sect = "high"; next }
    /^### Medium/ { sect = "medium"; next }
    /^### Low/    { sect = "low"; next }
    /^### Notes/  { sect = "notes"; next }
    /^### / { sect = ""; next }
    sect == "high" || sect == "medium" { print }
  ')

  # Within High/Medium, only count UNCHECKED items (`- [ ]`).
  # Resolved items (`- [x]`) and other lines are ignored.
  # Round-7 M-3: append `|| true` so set -e doesn't abort when there are
  # zero unchecked items (the legitimate "everything resolved" case).
  local unchecked
  unchecked=$(echo "$actionable" | grep -E '^- \[ \]' || true)

  if [[ -n "$unchecked" ]] && echo "$unchecked" | grep -qE '(scripts/loop/|scripts/loop/prompts/|\.github/workflows/|dispatch_[a-z_]+\.sh|runner\.sh|mirror_helper|repo_lock|state_transitions|update_state\.sh|loop_history\.sh|post_dispatch_cost\.sh|worktree_helpers|reject_loop_infra_repair)'; then
    echo "loop-infra"
  else
    echo "slice-state"
  fi
}

LOOP_REPAIR_MODE=$(classify_repair_mode "diagnostic/slices/${slice_id}.md")
export LOOP_REPAIR_MODE
log "dispatch_repair $slice_id mode=$LOOP_REPAIR_MODE (classified from latest unchecked High/Medium items)"
```

If the agent in `slice-state` mode tries to modify `scripts/loop/*` or `.github/workflows/*` anyway, the dispatcher's post-step REJECTS the diff (force-resets the worktree, sets the slice to blocked with "repair-mode-violation" note). The mode is enforced, not inferred.

**Dispatch flow (round-5 H-2 explicit lifecycle + round-7 H-1 single classifier):**

```bash
# In dispatch_repair.sh, BEFORE invoking the agent.
# Round-7 H-1: use classify_repair_mode (defined in slice_helpers.sh) which
# parses ONLY unchecked High/Medium action items. The prior broad keyword
# scan over the whole verdict text has been removed.
LOOP_REPAIR_MODE=$(classify_repair_mode "diagnostic/slices/${slice_id}.md")
export LOOP_REPAIR_MODE
log "dispatch_repair $slice_id mode=$LOOP_REPAIR_MODE (via slice_helpers.classify_repair_mode)"

# Invoke agent with mode-aware prompt
( cd "$work_dir" && claude --print --model "$LOOP_CLAUDE_REPAIR_MODEL" ... )

# Post-step depends on mode:
case "$LOOP_REPAIR_MODE" in
  slice-state)
    # Verify diff stayed within slice files — if it touched loop infra, reject.
    diff_files=$(git -C "$work_dir" diff --name-only HEAD~1 HEAD 2>/dev/null || true)
    if echo "$diff_files" | grep -qE '^(scripts/loop/|\.github/workflows/)'; then
      log "REPAIR MODE VIOLATION slice=$slice_id mode=slice-state touched=$diff_files"
      ( cd "$work_dir" && git reset --hard HEAD~1 )   # reverts the agent's commit
      flip_slice_status "$slice_id" "blocked" "user"
      append_slice_section "$slice_id" "## Repair mode violation" \
        "Agent classified as slice-state but modified protocol files. Reset locally."
      return 1
    fi
    mirror_slice_to_integration "$slice_id" "repair"
    ;;

  loop-infra)
    # Two commits land locally on integration:
    #   1. The agent's loop-infra repair commit ([loop-infra-repair][attempt:N])
    #   2. A blocked-state slice-file flip ([loop-infra-pending][attempt:N])
    # Neither is pushed without user approval.
    #
    # All four state markers (sentinel filename, repair commit subject,
    # pending commit subject, resumed commit subject) carry the same
    # [attempt:N] tag (round-10 H-1) so resume decisions can match the
    # exact attempt instead of any historical attempt for the slice.
    #
    # The attempt counter is the same as the existing repair_count_<id>
    # (post-increment, after dispatch_repair has bumped it).

    local attempt_n
    attempt_n=$(cat "$LOOP_STATE_DIR/repair_count_${slice_id}" 2>/dev/null || echo "1")

    # Step 1: amend the agent's [loop-infra-repair] commit to include the
    # attempt tag in the subject AND a dispatcher-injected `Resume-as:`
    # trailer (round-10 M-2). The agent's commit message is replaced with
    # a deterministic one — agent-authored Resume-as: trailers and missing
    # tags are no longer possible.
    #
    # The Resume-as: target comes from the slice's pre-block status BEFORE
    # the repair was triggered, captured up-front in dispatch_repair.sh:
    #   resume_target=$(read_field "$slice_file" status_before_block)
    # Default to revising_plan if no status_before_block field; revising
    # if the slice was in awaiting_audit (impl-side repair).
    local resume_target
    resume_target=$(determine_resume_target "$slice_id")   # in slice_helpers.sh

    local agent_summary
    agent_summary=$(git -C "$LOOP_MAIN_WORKTREE" log -1 --pretty=%s HEAD | sed 's/^\[loop-infra-repair\][^ ]* *//; s/^\[slice:[^]]*\] *//')

    git -C "$LOOP_MAIN_WORKTREE" commit --amend \
      -m "[loop-infra-repair][slice:${slice_id}][attempt:${attempt_n}] ${agent_summary:-protocol repair}

Resume-as: ${resume_target}
" >/dev/null

    # Round-8 H-2: compute diff_files HERE, since this case branch doesn't
    # share scope with the slice-state branch. Under set -u, referencing an
    # unset $diff_files would abort. We diff the (now-amended) [loop-infra-repair]
    # commit the agent just made (HEAD vs HEAD~1).
    local diff_files
    diff_files=$(git -C "$LOOP_MAIN_WORKTREE" diff --name-only HEAD~1 HEAD 2>/dev/null || echo "(could not compute diff)")

    # Agent already committed its loop-infra change. Now flip the slice file
    # locally to blocked + append explanation. Same lock as the agent's commit.
    flip_slice_status "$slice_id" "blocked" "user"
    append_slice_section "$slice_id" "## Loop-infrastructure repair pending approval" \
"The repair agent proposed protocol changes touching:
$(printf '%s\n' "$diff_files" | sed 's/^/  - /')

Two local commits on integration (not pushed). Note the order — the
[loop-infra-pending] flip is committed AFTER the dispatcher amends the
[loop-infra-repair] commit, so HEAD is the pending flip:
  HEAD     [loop-infra-pending][slice:$slice_id][attempt:$attempt_n] — this blocked-state flip
  HEAD~1   [loop-infra-repair][slice:$slice_id][attempt:$attempt_n] — the protocol change (round-11 M-4 fix)

LIFECYCLE — runner has exited cleanly via circuit breaker. To resume:

  Approve (push both commits, slice unblocks):
    touch diagnostic/slices/.approved-loop-infra-repair/${slice_id}__attempt-${attempt_n}
    # Restart runner. The runner's loop-infra-approval-resume hook detects
    # the sentinel, pushes both original commits, flips the slice status,
    # commits the flip, pushes the [loop-infra-resumed] commit, then ONLY
    # removes the sentinel after the final push succeeds (round-8 H-1+L-5), and
    # flips the slice back to revising_plan or revising as the agent intended.

  Reject (drop both commits, slice unblocks back to its prior state):
    scripts/loop/reject_loop_infra_repair.sh $slice_id
    # The script verifies HEAD and HEAD~1 are the expected loop-infra pair
    # for this slice before the destructive reset, removes any sentinel,
    # and prints next steps. Restart runner afterwards.
    # Round-6 H-2 — replaces raw 'git reset --hard' instruction."
    git -C "$LOOP_MAIN_WORKTREE" add diagnostic/slices/${slice_id}.md
    git -C "$LOOP_MAIN_WORKTREE" commit -m "[loop-infra-pending][slice:${slice_id}][attempt:${attempt_n}] block pending user approval" >/dev/null

    # IMPORTANT: do NOT push. Both local commits stay until the user approves.
    # Worktree is now CLEAN (both commits made) — preconditions pass on next
    # tick. Runner will exit via circuit breaker because the slice is blocked.
    log "loop-infra-repair pending approval for $slice_id (2 local commits, no push)"
    return 4   # signal: needs human; runner exits cleanly
    ;;
esac
```

**Resume hook (new in `runner.sh`, round-6 H-1 placement clarified):** at startup, **BEFORE `preconditions.sh` is invoked and before any worktree-clean / branch-ahead checks**, the runner checks for pending loop-infra repairs. The resume hook is the FIRST thing the runner does after parsing env vars and exporting `LOOP_MAIN_WORKTREE`/`LOOP_STATE_DIR`. This ordering is critical: integration being ahead of origin or a sentinel file existing would otherwise cause `preconditions.sh` to refuse to start.

Pseudocode of `runner.sh` startup order:

```bash
# 1. Env exports (LOOP_MAIN_WORKTREE, LOOP_STATE_DIR, etc.)
# 2. Resume hook — runs BEFORE preconditions.sh
resume_pending_loop_infra_repair() {
  cd "$LOOP_MAIN_WORKTREE"
  # Round-8 H-1: scan for resumable work via approval sentinels, NOT local
  # commits. The previous version only scanned local-only [loop-infra-pending]
  # commits — but if the FIRST push succeeded and the SECOND (post-flip) push
  # failed, the [loop-infra-pending] commit is now on origin (not local-only)
  # and the resume hook would never re-fire. Sentinels are the durable marker;
  # local commit state is just an idempotency hint inside _do_resume_loop_infra.
  local sentinel_dir="diagnostic/slices/.approved-loop-infra-repair"
  [[ -d "$sentinel_dir" ]] || return 0

  # Iterate every sentinel file; ignore .gitkeep.
  #
  # Round-10 H-1: every loop-infra-repair attempt has an `[attempt:N]`
  # tag baked into all four state markers (sentinel filename, the
  # [loop-infra-repair] commit subject, the [loop-infra-pending] commit
  # subject, the [loop-infra-resumed] commit subject). Resume decisions
  # MUST match the exact attempt number, not just the slice id, so a
  # historical reverted attempt for the same slice cannot false-match
  # the current one.
  #
  # Sentinel filename format: <slice_id>__attempt-<N>
  # Commit subject format:    [<tag>][slice:<id>][attempt:<N>] <summary>
  for sentinel in "$sentinel_dir"/*; do
    [[ -f "$sentinel" ]] || continue
    local sentinel_basename slice_id attempt_n
    sentinel_basename=$(basename "$sentinel")
    [[ "$sentinel_basename" == ".gitkeep" ]] && continue

    # Round-11 H-1 fix: the prior parse set slice_id=<full filename>, so
    # downstream greps looked for [slice:my-slice__attempt-2][attempt:2]
    # and never matched. Now slice_id strips the suffix; attempt_n is
    # extracted separately and validated to be numeric.
    if [[ "$sentinel_basename" != *__attempt-* ]]; then
      log "resume: sentinel '$sentinel_basename' missing __attempt-N suffix; skipping (legacy/malformed)"
      continue
    fi
    slice_id="${sentinel_basename%__attempt-*}"
    attempt_n="${sentinel_basename##*__attempt-}"
    if ! [[ "$attempt_n" =~ ^[0-9]+$ ]]; then
      log "resume: sentinel '$sentinel_basename' has non-numeric attempt '$attempt_n'; skipping"
      continue
    fi

    # Round-10 L-4: stale-cleanup decisions depend on a fresh origin view.
    # If fetch fails, refuse to make ANY stale/cleanup decisions for this
    # slice — preserve the sentinel and continue to next runner start.
    if ! git fetch origin integration/perf-roadmap >/dev/null 2>&1; then
      log "resume: git fetch failed for $slice_id (attempt $attempt_n); sentinel preserved (cannot reason about stale state without origin view)"
      continue
    fi

    # Round-10 H-1: detection greps must include the attempt-N tag so we
    # only match THIS attempt, not historical ones for the same slice.
    local attempt_tag="\\[loop-infra-pending\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
    local resumed_attempt_tag="\\[loop-infra-resumed\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
    local pending_anywhere resumed_anywhere
    pending_anywhere=$( {
      git log "origin/integration/perf-roadmap..HEAD" --grep="$attempt_tag" --pretty=format:%H 2>/dev/null
      git log "origin/integration/perf-roadmap"       --grep="$attempt_tag" --pretty=format:%H 2>/dev/null
    } | grep -m1 . || true)
    resumed_anywhere=$( {
      git log "origin/integration/perf-roadmap..HEAD" --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null
      git log "origin/integration/perf-roadmap"       --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null
    } | grep -m1 . || true)

    if [[ -n "$pending_anywhere" || -n "$resumed_anywhere" ]]; then
      # There's work to do (or to verify-and-clean). _do_resume_loop_infra is
      # idempotent: it'll detect existing [loop-infra-resumed][attempt:N] and
      # skip recreation; it'll skip the first push if origin already has the
      # matching pending commit.
      with_repo_lock "resume:loop-infra:$slice_id:$attempt_n" \
        _do_resume_loop_infra "$slice_id" "$sentinel" "$attempt_n"
      continue
    fi

    # No pending/resumed for THIS attempt anywhere. Stronger stale rule:
    # preserve when slice is blocked (user pre-approved a future attempt,
    # which would write a fresh attempt-N+1 marker pair).
    local current_status
    current_status=$(awk '
      /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
      fm && $1 == "status:" { sub(/^[^:]+: */, ""); print; exit }
    ' "diagnostic/slices/${slice_id}.md" 2>/dev/null)

    if [[ "$current_status" == "blocked" ]]; then
      log "resume: sentinel preserved for $slice_id attempt $attempt_n (slice blocked, awaiting repair)"
      continue
    fi

    rm -f "$sentinel"
    log "resume: stale sentinel removed for $slice_id attempt $attempt_n (no pending/resumed for this attempt; status=$current_status)"
  done
}

_do_resume_loop_infra() {
  local slice_id="$1" sentinel="$2" attempt_n="$3"
  cd "$LOOP_MAIN_WORKTREE"

  # The sentinel is the durable retry marker (round-7 H-2). It is retained
  # across runner restarts until ALL pushes succeed AND the [loop-infra-
  # resumed][attempt:N] commit lands on origin. The hook is idempotent: it
  # can re-run safely from any partial-failure state.
  #
  # All commit-grep lookups MUST include [attempt:${attempt_n}] (round-10 H-1)
  # so historical reverted attempts cannot false-match.

  local repair_attempt_tag="\\[loop-infra-repair\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
  local pending_attempt_tag="\\[loop-infra-pending\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
  local resumed_attempt_tag="\\[loop-infra-resumed\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"

  # 1. Idempotency check 1 — has [loop-infra-resumed][attempt:N] already been
  #    committed locally OR landed on origin? Three sub-states:
  #      a. local-only resumed commit → just retry the final push
  #      b. resumed commit on origin → fully resolved; remove sentinel
  #      c. no resumed commit anywhere → need to create it
  local resumed_local resumed_on_origin
  resumed_local=$(git log "origin/integration/perf-roadmap..HEAD" --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null | head -c1)
  resumed_on_origin=$(git log "origin/integration/perf-roadmap" --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null | head -c1)

  if [[ -n "$resumed_on_origin" ]]; then
    # Fully resolved; sentinel just needs cleanup.
    rm -f "$sentinel"
    log "resume: [loop-infra-resumed][attempt:$attempt_n] already on origin for $slice_id; sentinel cleaned up"
    return 0
  fi

  if [[ -n "$resumed_local" ]]; then
    log "resume: [loop-infra-resumed][attempt:$attempt_n] commit already exists locally for $slice_id; retrying push"
  else
    # 2. Idempotency check 2 — has the FIRST push (of pending+repair)
    #    already happened? If origin contains [loop-infra-pending][attempt:N]
    #    for this slice, the push step is already done; skip it.
    local pending_on_origin
    pending_on_origin=$(git log "origin/integration/perf-roadmap" --grep="$pending_attempt_tag" --pretty=format:%H 2>/dev/null | head -c1)

    if [[ -z "$pending_on_origin" ]]; then
      if ! git push >/dev/null 2>&1; then
        log "resume: initial push failed for $slice_id attempt $attempt_n; sentinel retained for retry"
        return 1
      fi
    else
      log "resume: [loop-infra-pending][attempt:$attempt_n] already on origin for $slice_id; skipping initial push"
    fi

    # FAULT INJECTION POINT (round-11 M-2): after_initial_push_before_resumed_commit
    # Only fires when both LOOP_TEST_MODE=1 (defense-in-depth gate, round-11 L)
    # AND LOOP_TEST_INJECT_FAULT matches this site name. Used by verification
    # step 26b to deterministically reproduce the "first push succeeded but
    # crashed before flip+resumed-commit" recovery path.
    if [[ "${LOOP_TEST_MODE:-0}" == "1" && "${LOOP_TEST_INJECT_FAULT:-}" == "after_initial_push_before_resumed_commit" ]]; then
      log "TEST FAULT: injecting exit 137 at after_initial_push_before_resumed_commit"
      exit 137
    fi

    # 3. Flip slice file back to its pre-block state. The Resume-as: trailer
    #    is dispatcher-injected (round-10 M-2): dispatch_repair amended the
    #    [loop-infra-repair] commit to include `Resume-as: revising_plan` or
    #    `Resume-as: revising` per the parent slice's pre-block status. The
    #    trailer is REQUIRED — agent-authored or missing trailers fail this
    #    function rather than silently defaulting to revising_plan.
    local repair_commit resume_status
    repair_commit=$(git log "origin/integration/perf-roadmap" --grep="$repair_attempt_tag" --pretty=format:%H 2>/dev/null | head -1)
    [[ -z "$repair_commit" ]] && repair_commit=$(git log --grep="$repair_attempt_tag" --pretty=format:%H 2>/dev/null | head -1)
    if [[ -z "$repair_commit" ]]; then
      log "resume: FAIL — no [loop-infra-repair][attempt:$attempt_n] commit found for $slice_id; sentinel retained"
      return 1
    fi
    resume_status=$(git log -1 --pretty=%B "$repair_commit" 2>/dev/null | sed -nE 's/^Resume-as: (.+)$/\1/p' | head -1)
    if [[ -z "$resume_status" ]]; then
      log "resume: FAIL — Resume-as: trailer missing on repair commit $repair_commit for $slice_id; sentinel retained (dispatcher must inject)"
      return 1
    fi
    case "$resume_status" in
      revising_plan|revising) ;;
      *)
        log "resume: FAIL — Resume-as: '$resume_status' is not a valid resume target; sentinel retained"
        return 1
        ;;
    esac
    flip_slice_status "$slice_id" "$resume_status" "claude"
    git add "diagnostic/slices/${slice_id}.md"
    git commit -m "[loop-infra-resumed][slice:${slice_id}][attempt:${attempt_n}] resume after user-approved repair" >/dev/null
  fi

  # FAULT INJECTION POINT (round-11 M-2): after_resumed_commit_before_final_push
  # Only fires when both LOOP_TEST_MODE=1 AND LOOP_TEST_INJECT_FAULT matches.
  # Used by verification step 26a to deterministically reproduce the
  # "[loop-infra-resumed] commit exists locally but final push didn't happen"
  # recovery path. The sentinel is retained on this exit (it's only removed
  # at step 5 after the final push succeeds), which is exactly what we want.
  if [[ "${LOOP_TEST_MODE:-0}" == "1" && "${LOOP_TEST_INJECT_FAULT:-}" == "after_resumed_commit_before_final_push" ]]; then
    log "TEST FAULT: injecting exit 137 at after_resumed_commit_before_final_push"
    exit 137
  fi

  # 4. Push (the resumed commit, plus any catch-up if origin moved).
  #    ONLY remove the sentinel after this succeeds.
  if ! git push >/dev/null 2>&1; then
    log "resume: post-flip push failed for $slice_id; sentinel retained for retry on next runner start"
    return 1
  fi

  # 5. All pushes succeeded. Now safe to remove the sentinel.
  rm -f "$sentinel"
  log "resume: loop-infra repair approved and pushed for $slice_id"
}

# 3. NOW preconditions.sh runs. By this point:
#    - Either the sentinel was processed and pushed (worktree clean, integration synced)
#    - Or no sentinel was ever created (worktree clean from initial state)
#    - Or push failed and the runner will retry on next start (logged warning)
#    Ahead-of-origin state has been resolved one way or another before preconditions check.
```

**The resume hook explicitly tolerates:**
- Integration ahead of origin (two local commits awaiting approval)
- Existence of `diagnostic/slices/.approved-loop-infra-repair/<id>` sentinel file
- Worktree being on `integration/perf-roadmap` (it should be — runner always returns there)

**`preconditions.sh` runs AFTER the resume hook** and uses normal rules. By then, either the resume succeeded (clean state) or the sentinel hasn't been touched yet (still pending; runner exits via circuit breaker per existing flow).

**Why two commits, both local:** if the user rejects via `scripts/loop/reject_loop_infra_repair.sh`, a single safe reset undoes everything cleanly. If the user approves, a single push sends both. The pair is atomic from the user's POV.

**Round-6 H-2: dedicated rejection script.** `git reset --hard origin/integration/perf-roadmap` is destructive and easy to aim wrong (e.g. `--hard` without specifying the ref). Replace the manual instruction with:

```bash
# scripts/loop/reject_loop_infra_repair.sh
# Safely rejects a pending loop-infra repair by verifying the top commits
# are the expected [loop-infra-pending] / [loop-infra-repair] pair for the
# given slice, then resetting to origin only if both checks pass.
#
# Usage: scripts/loop/reject_loop_infra_repair.sh <slice_id>

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"
# Round-10 H-1: HEAD must include the [attempt:N] tag so we don't false-match
# a historical reverted attempt. The attempt number is taken from HEAD's
# subject (single source of truth at this point).
head_attempt=$(git log -1 --pretty=%s HEAD | sed -nE 's/.*\[attempt:([0-9]+)\].*/\1/p' | head -1)
if [[ -z "$head_attempt" ]]; then
  echo "FAIL: HEAD subject does not contain [attempt:N] tag — cannot identify the repair attempt." >&2
  echo "  HEAD subject: $(git log -1 --pretty=%s HEAD)" >&2
  exit 1
fi
expected_top="\\[loop-infra-pending\\]\\[slice:${slice_id}\\]\\[attempt:${head_attempt}\\]"
expected_below="\\[loop-infra-repair\\]\\[slice:${slice_id}\\]\\[attempt:${head_attempt}\\]"

# 1. Verify HEAD is on integration/perf-roadmap (won't reset other branches).
current=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current" != "integration/perf-roadmap" ]]; then
  echo "FAIL: not on integration/perf-roadmap (current: $current)"
  exit 1
fi

# 1b. Round-7 L-answer + round-8 M-3: refuse if the bad commits are already
#     on origin. If they're pushed, a destructive local reset doesn't undo
#     origin — and it would silently re-push as a no-op when integration syncs.
#     This check requires a fresh view of origin; fail closed if `git fetch`
#     fails. The whole point of this script is to be a safety rail, and
#     stale origin state defeats that. Override only via explicit
#     --offline-local-only flag.
OFFLINE_OVERRIDE=0
if [[ "${2:-}" == "--offline-local-only" ]]; then
  OFFLINE_OVERRIDE=1
  echo "WARNING: --offline-local-only set; skipping origin fetch. Reset will" >&2
  echo "         be local-only; bad commits already pushed will REMAIN on origin." >&2
fi

if [[ $OFFLINE_OVERRIDE -eq 0 ]]; then
  if ! git fetch origin integration/perf-roadmap >/dev/null 2>&1; then
    cat <<EOF >&2
FAIL: git fetch origin integration/perf-roadmap failed.

This script's safety check requires a fresh origin view to confirm the
[loop-infra-pending][slice:${slice_id}] commits have NOT already been
pushed. Stale origin state could mask a push that already happened.

Resolve the network issue and re-run. If you absolutely cannot reach
origin and have verified locally that nothing was pushed, override with:

  $0 ${slice_id} --offline-local-only

(Only safe when you are certain no push has occurred since the local
commits were made.)
EOF
    exit 2
  fi
fi
# Round-9 M-2: use HEAD's actual SHA to detect "already pushed", NOT a
# message-grep over origin's full history. A grep-by-message would also
# match historical pushed-and-reverted attempts for the same slice
# (revert leaves the original commit in history). Instead: verify HEAD
# is the [loop-infra-pending] commit for this slice, then check if HEAD
# is an ancestor of origin/integration/perf-roadmap. If yes, it's already
# pushed (or its content was pushed at some point and is reachable).
head_sha=$(git rev-parse HEAD)
head_subject=$(git log -1 --pretty=%s HEAD)
if ! echo "$head_subject" | grep -qE "\\[loop-infra-pending\\]\\[slice:${slice_id}\\]\\[attempt:${head_attempt}\\]"; then
  echo "FAIL: HEAD is not the [loop-infra-pending][slice:${slice_id}][attempt:${head_attempt}] commit." >&2
  echo "  HEAD subject: $head_subject" >&2
  exit 1
fi
# Also clean up the matching sentinel after a successful reset.
sentinel_to_clean="diagnostic/slices/.approved-loop-infra-repair/${slice_id}__attempt-${head_attempt}"
if git merge-base --is-ancestor "$head_sha" origin/integration/perf-roadmap 2>/dev/null; then
  cat <<EOF
FAIL: HEAD ($head_sha, [loop-infra-pending][slice:${slice_id}]) is an
ancestor of origin/integration/perf-roadmap — meaning this exact commit
is already on origin.

A local reset cannot undo it. Use git revert instead:

  cd "\$LOOP_MAIN_WORKTREE"
  pending_sha=$head_sha
  repair_sha=\$(git rev-parse HEAD~1)
  git revert --no-edit "\$pending_sha" "\$repair_sha"
  git push

After the revert lands on origin, the runner's resume hook will see no
pending state. The slice's repair_count is preserved; auto-repair will
attempt again if budget allows.
EOF
  exit 1
fi

# 2. Verify integration is exactly 2 commits ahead of origin.
ahead=$(git rev-list --count "origin/integration/perf-roadmap..HEAD")
if [[ "$ahead" != "2" ]]; then
  echo "FAIL: expected 2 local commits, found $ahead"
  echo "Manual review needed:"
  git log "origin/integration/perf-roadmap..HEAD" --oneline
  exit 1
fi

# 3. Verify HEAD and HEAD~1 are the expected loop-infra commits for THIS slice.
top_msg=$(git log -1 --pretty=%s HEAD)
below_msg=$(git log -1 --pretty=%s HEAD~1)
if ! echo "$top_msg" | grep -qE "$expected_top"; then
  echo "FAIL: HEAD commit is not [loop-infra-pending][slice:${slice_id}]"
  echo "  HEAD subject: $top_msg"
  exit 1
fi
if ! echo "$below_msg" | grep -qE "$expected_below"; then
  echo "FAIL: HEAD~1 commit is not [loop-infra-repair][slice:${slice_id}]"
  echo "  HEAD~1 subject: $below_msg"
  exit 1
fi

# 4. Safe to reset.
echo "Verified: 2 local commits match [loop-infra-pending|repair][slice:${slice_id}][attempt:${head_attempt}]"
echo "Resetting to origin/integration/perf-roadmap..."
git reset --hard origin/integration/perf-roadmap

# 5. Clean up the matching attempt's sentinel if it exists (round-10 H-1).
[[ -f "$sentinel_to_clean" ]] && rm -f "$sentinel_to_clean" && echo "Removed sentinel $sentinel_to_clean"

echo "Rejection complete. Slice ${slice_id} attempt ${head_attempt} returned to its pre-repair status."
echo "Restart the runner; auto-repair will attempt again per LOOP_MAX_REPAIRS budget (next attempt would be ${head_attempt}+1)."
```

This script refuses to do the destructive reset unless every precondition is met. The user-facing instruction in the slice file becomes:

```
To reject and revert:
  scripts/loop/reject_loop_infra_repair.sh <slice_id>
```

instead of the raw `git reset --hard ...` command. Round-6 H-2 fix.

**Why this matters:** without explicit mode classification, an agent in slice-state mode could "accidentally" edit `scripts/loop/*` and the dispatcher's after-the-fact diff inspection might misclassify the situation. Pre-dispatch classification + post-step enforcement makes the rules unambiguous: the runner knows what mode it's in BEFORE the agent runs, and the agent's prompt is constrained accordingly.

**Sentinel directory:** `diagnostic/slices/.approved-loop-infra-repair/` is added to `.gitignore` exception rules same as `.approved/` and `.approved-merge/` — track only `.gitkeep`, ignore the touched-by-user sentinels.

No agent ever writes to the main worktree EXCEPT the repair agent (in `loop-infra` mode, gated on push) and the runner-side mirror/merger steps.

**Shared runner state stays in absolute paths (per round-2 H-3):** all dispatchers and helpers receive `LOOP_MAIN_WORKTREE` and `LOOP_STATE_DIR` env vars with **absolute** paths to the runner's main worktree and state dir. Relative writes inside slice worktrees would write to the slice worktree's filesystem; we want the runner's view. Pattern below.

**Files to modify:**
- `scripts/loop/dispatch_claude.sh`
- `scripts/loop/dispatch_codex.sh`
- `scripts/loop/dispatch_repair.sh`
- `scripts/loop/dispatch_plan_revise.sh`
- `scripts/loop/dispatch_slice_audit.sh` (also moves into a slice worktree even though it's "just" reading the slice file — still appends a verdict + mutates frontmatter)
- `scripts/loop/runner.sh` (export `LOOP_MAIN_WORKTREE`, `LOOP_STATE_DIR`; preconditions check)
- `scripts/loop/dispatch_merger.sh` (uses absolute state paths; lock around merge+push+regression+state-update)
- `scripts/loop/update_state.sh` (uses `LOOP_MAIN_WORKTREE` to find slice files / artifacts when invoked from a worktree context)
- New file: `scripts/loop/worktree_helpers.sh`
- New file: `scripts/loop/repo_lock.sh` (the lock primitive)

**Repo lock (mkdir-based, portable; round-2 audit fixes for `set -e` and EXIT-trap stacking):**
```bash
# scripts/loop/repo_lock.sh
# Lock dir lives under the MAIN worktree's .git/, regardless of which
# worktree's shell is calling us. This means every dispatcher (running in
# a slice worktree) coordinates through one shared lock.
: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"
# Use Git's common-dir with --path-format=absolute so the result is always an
# absolute path regardless of the caller's cwd (round-4 M-4 fix).
# Without --path-format=absolute, rev-parse can return ".git" (relative) which
# resolves against whatever worktree's shell happened to be calling us.
LOCK_DIR="$(git -C "$LOOP_MAIN_WORKTREE" rev-parse --path-format=absolute --git-common-dir)/openf1-loop.lock"
LOCK_TIMEOUT="${LOOP_LOCK_TIMEOUT:-300}"
LOCK_POLL="${LOOP_LOCK_POLL:-1}"

# Stack EXIT traps instead of clobbering pre-existing ones (round-2 M-5).
_REPO_LOCK_PRIOR_TRAP=""
# Reentrant-lock counter for the current PID (round-4 H-1).
# When a helper invoked from an already-locked merger calls with_repo_lock,
# the counter increments; release only happens when it returns to zero.
_REPO_LOCK_DEPTH=0

# Bash 4+ required (round-6 M-5). BASHPID was added in bash 4.0; macOS ships
# bash 3.2 by default. The runner's preconditions.sh asserts this at startup;
# this primitive also asserts it defensively in case it's sourced from a
# non-standard caller.
if [[ -z "${BASH_VERSINFO[0]:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "FATAL: repo_lock.sh requires bash 4+ (found bash ${BASH_VERSION:-unknown}). On macOS, install Homebrew bash." >&2
  return 1 2>/dev/null || exit 1
fi

# Use BASHPID (the actual current shell PID, including subshells) instead
# of $$ (parent shell PID, which is identical in subshells under bash).
# Without this, a subshell that calls with_repo_lock would see the parent's
# stored PID and incorrectly reenter the lock. Round-5 H-1 fix.
_lock_owner_pid() {
  if [[ -n "${BASHPID:-}" ]]; then
    echo "$BASHPID"
  else
    echo "$$"   # legacy fallback (won't fire under bash 4+ assertion above)
  fi
}

acquire_repo_lock() {
  local owner="$1"
  local self_pid
  self_pid=$(_lock_owner_pid)
  # Reentrant: if THIS shell PID already owns the lock, just bump the depth
  # counter. Subshells get their own BASHPID, so they will not falsely
  # reenter the parent's lock — they will block normally.
  if [[ -d "$LOCK_DIR" ]]; then
    local stored_pid
    stored_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
    if [[ "$stored_pid" == "$self_pid" ]]; then
      _REPO_LOCK_DEPTH=$((_REPO_LOCK_DEPTH + 1))
      return 0
    fi
  fi

  local started elapsed
  started=$(date +%s)
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    elapsed=$(( $(date +%s) - started ))
    if [[ $elapsed -ge $LOCK_TIMEOUT ]]; then
      # Stale-lock detection (PID-based, but also handle malformed/empty pid file).
      local stored_pid stored_owner
      stored_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
      stored_owner=$(cat "$LOCK_DIR/owner" 2>/dev/null || echo "?")
      if [[ -z "$stored_pid" || ! "$stored_pid" =~ ^[0-9]+$ ]]; then
        echo "force-releasing malformed lock (owner=$stored_owner)" >&2
        rm -rf "$LOCK_DIR"
        continue
      fi
      if ! kill -0 "$stored_pid" 2>/dev/null; then
        echo "force-releasing stale lock from $stored_owner (pid $stored_pid dead)" >&2
        rm -rf "$LOCK_DIR"
        continue
      fi
      echo "lock timeout: held by $stored_owner (pid $stored_pid)" >&2
      return 1
    fi
    sleep "$LOCK_POLL"
  done
  echo "$owner"    > "$LOCK_DIR/owner"
  echo "$self_pid" > "$LOCK_DIR/pid"
  _REPO_LOCK_DEPTH=1

  # Stack any pre-existing EXIT trap so we don't clobber callers'.
  _REPO_LOCK_PRIOR_TRAP=$(trap -p EXIT | sed -E "s/^trap -- '(.*)' EXIT$/\1/" || true)
  trap '_repo_lock_on_exit' EXIT
  return 0
}

_repo_lock_on_exit() {
  # On EXIT, force-release regardless of depth (process is dying anyway).
  _REPO_LOCK_DEPTH=0
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  if [[ -n "$_REPO_LOCK_PRIOR_TRAP" ]]; then
    eval "$_REPO_LOCK_PRIOR_TRAP"
  fi
}

release_repo_lock() {
  # Reentrant: only actually release when depth returns to 0.
  if [[ $_REPO_LOCK_DEPTH -gt 1 ]]; then
    _REPO_LOCK_DEPTH=$((_REPO_LOCK_DEPTH - 1))
    return 0
  fi
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  _REPO_LOCK_DEPTH=0
  if [[ -n "$_REPO_LOCK_PRIOR_TRAP" ]]; then
    trap "$_REPO_LOCK_PRIOR_TRAP" EXIT
  else
    trap - EXIT
  fi
  _REPO_LOCK_PRIOR_TRAP=""
}

# Run a command under the lock with set -e safety:
# Disable errexit around the call, capture rc, restore.
# Reentrant: if the caller already holds the lock, this is a no-op acquire;
# the matching release decrements the depth counter, doesn't actually unlock.
with_repo_lock() {
  local owner="$1"; shift
  acquire_repo_lock "$owner" || return 1
  local saved_errexit=0
  case "$-" in *e*) saved_errexit=1 ;; esac
  set +e
  "$@"
  local rc=$?
  [[ "$saved_errexit" == "1" ]] && set -e
  release_repo_lock
  return $rc
}
```

**Worktree pattern (post-round-2 audit: stale-branch + stale-worktree handling):**
```bash
# scripts/loop/worktree_helpers.sh
WORKTREE_BASE="${LOOP_WORKTREE_BASE:-$HOME/.openf1-loop-worktrees}"

ensure_slice_worktree() {
  local slice_id="$1"
  local slice_worktree="$WORKTREE_BASE/$slice_id"
  local slice_branch="slice/$slice_id"

  mkdir -p "$WORKTREE_BASE"

  # Step 1: handle stale worktree dirs from prior interrupted runs.
  # `git worktree list --porcelain` is the source of truth.
  local known_worktrees
  known_worktrees=$(cd "$LOOP_MAIN_WORKTREE" && git worktree list --porcelain | awk '/^worktree / {print $2}')
  if [[ -d "$slice_worktree" ]] && ! echo "$known_worktrees" | grep -qx "$slice_worktree"; then
    # Directory exists but git doesn't know about it — orphan from a prior run
    rm -rf "$slice_worktree"
  fi

  # Step 2: prune any worktree records git knows about but whose dir is gone.
  ( cd "$LOOP_MAIN_WORKTREE" && git worktree prune ) 2>/dev/null || true

  if [[ -d "$slice_worktree" ]]; then
    # Worktree exists and is git-known. Ensure it's on the right branch.
    ( cd "$slice_worktree" && git checkout "$slice_branch" 2>/dev/null ) || true
    echo "$slice_worktree"
    return 0
  fi

  # Step 3: handle pre-existing slice branch (from a prior interrupted run).
  if ( cd "$LOOP_MAIN_WORKTREE" && git rev-parse --verify "$slice_branch" >/dev/null 2>&1 ); then
    # Branch exists — attach the worktree to it (no -b flag).
    ( cd "$LOOP_MAIN_WORKTREE" && git worktree add "$slice_worktree" "$slice_branch" )
  else
    # Fresh slice: create branch and worktree together.
    ( cd "$LOOP_MAIN_WORKTREE" && git worktree add "$slice_worktree" -b "$slice_branch" integration/perf-roadmap )
  fi

  echo "$slice_worktree"
}

cleanup_slice_worktree() {
  local slice_id="$1"
  local slice_worktree="$WORKTREE_BASE/$slice_id"
  if [[ -d "$slice_worktree" ]]; then
    ( cd "$LOOP_MAIN_WORKTREE" && git worktree remove "$slice_worktree" --force ) 2>/dev/null || rm -rf "$slice_worktree"
  fi
  ( cd "$LOOP_MAIN_WORKTREE" && git worktree prune ) 2>/dev/null || true
}

# Round-11 L (merger sentinel cleanup): on slice merge, the merger calls
# cleanup_slice_state which resets repair_count_<id>, plan_iter_count_<id>,
# fail_count_<id>, and ALSO purges any leftover loop-infra-repair sentinels
# for this slice id (across all attempt-N suffixes). Without this, a slice
# that merged after a prior repair cycle could leave behind stale sentinel
# files that would re-trigger the resume hook on the next runner start.
# The sentinel format is `<slice_id>__attempt-<N>` so we glob all attempts.
cleanup_slice_state() {
  local slice_id="$1"
  rm -f "$LOOP_STATE_DIR/repair_count_${slice_id}" \
        "$LOOP_STATE_DIR/plan_iter_count_${slice_id}" \
        "$LOOP_STATE_DIR/fail_count_${slice_id}"
  # Glob all attempt-N sentinels for this slice id.
  rm -f "$LOOP_MAIN_WORKTREE/diagnostic/slices/.approved-loop-infra-repair/${slice_id}__attempt-"*
}
```

**Dispatcher pattern (round-3 H-1 fix: single locked call to `ensure_slice_worktree`):**

The prior pattern had TWO calls to `ensure_slice_worktree` — one outside the lock to capture the returned path, and one inside the lock to do the actual mutation. The unlocked first call mutates `.git/worktrees/` already, defeating the lock. Fixed: one call only, under lock, with the path stashed via a temp file (since `with_repo_lock` returns rc, not stdout).

```bash
# Top of every dispatcher script:
: "${LOOP_MAIN_WORKTREE:?must be set by runner}"
: "${LOOP_STATE_DIR:?must be set by runner}"

# Anything that writes to runner state uses absolute paths.
LEDGER="$LOOP_STATE_DIR/cost_ledger.jsonl"
LOG="$LOOP_STATE_DIR/runner.log"

# Single, locked call to ensure_slice_worktree. The helper writes the path
# to a known temp file so the caller can read it after the lock releases.
worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.$$"
trap "rm -f '$worktree_path_file'" EXIT

with_repo_lock "dispatch:$slice_id:worktree-prep" \
  _ensure_slice_worktree_to_file "$slice_id" "$worktree_path_file" \
  || { log "worktree prep failed for $slice_id"; return 1; }

slice_worktree=$(cat "$worktree_path_file")
[[ -n "$slice_worktree" && -d "$slice_worktree" ]] || { log "worktree path empty/missing"; return 1; }

# Run the agent INSIDE the worktree. Agent commits go to slice/$slice_id naturally.
# The lock is RELEASED while the agent runs (could be minutes); other dispatchers
# can do their own worktree work concurrently. Locking only happens around git
# mutations, not around agent work.
( cd "$slice_worktree" && claude --print ... )
agent_rc=$?

# Mirror back to integration's main worktree (under lock, with retry).
mirror_slice_to_integration "$slice_id" "<dispatch_type>" || agent_rc=1

return $agent_rc
```

**Helper variant that writes path to file:**
```bash
# In worktree_helpers.sh — the "to_file" form is what dispatchers call under
# lock. It does the mutation AND writes the resulting path to a file the
# unlocked caller can read.
_ensure_slice_worktree_to_file() {
  local slice_id="$1" out_file="$2"
  local path
  path=$(ensure_slice_worktree "$slice_id") || return 1
  printf '%s' "$path" > "$out_file"
  return 0
}
```

**Runner-side env export (in `runner.sh` startup):**
```bash
export LOOP_MAIN_WORKTREE
LOOP_MAIN_WORKTREE=$(git rev-parse --show-toplevel)
export LOOP_STATE_DIR
LOOP_STATE_DIR="$LOOP_MAIN_WORKTREE/scripts/loop/state"
```

These two vars are what every dispatcher and helper reads to find the runner's state files, regardless of which slice worktree's shell is currently active.

**Operations that MUST run under lock:**
- `git worktree add` / `git worktree remove`
- mirror commit on integration
- `git merge` for auto-merge
- `git push` to origin (any branch)
- `update_state.sh` commit+push
- merger's "mark slice done" commit
- repair agent's commits to integration

**Operations that do NOT need lock:**
- Agent dispatches (Claude/Codex working in their own worktree)
- Reads (`git show`, `git log`, frontmatter parsing)
- Local file inspection in slice worktrees

**Risks:** disk usage (~50MB per slice × 4 concurrent worktrees max = 200MB peak; auto-pruned on merge). Lock contention if a stuck operation holds the lock — mitigated by `LOCK_TIMEOUT=300s` plus stale-PID detection.

**Verification:** see §7 items 2 and 11.

### Item 3 — C-4 (raise plan-iteration cap)

**Files to modify:**
- `scripts/loop/dispatch_plan_revise.sh` — change default `MAX_ITERATIONS` from 4 to 6
- `scripts/loop/prompts/codex_slice_auditor.md` — add: "After round 5, if items remain, you have two choices: (a) APPROVED with explicit list of deferred Mediums and Lows that the implementer judgment-calls; (b) REJECT for genuine architectural ambiguity. Do NOT continue to round 6+ generating new triage."

**Rationale:** the loop currently keeps tightening spec until cap. For complex slices, "good enough now" beats "perfectly specified eventually." The auditor needs explicit permission to stop.

### Item 4 — C-5 (tightened terminal-state success detection)

**Files to modify:**
- `scripts/loop/runner.sh` — `dispatch_with_guards()` function
- New file: `scripts/loop/state_transitions.sh` (the allow-list)

**Allow-list of valid terminal transitions per dispatch type:**
```bash
# scripts/loop/state_transitions.sh
# Returns 0 if (dispatch_type, status_before, status_after) is a known terminal transition.
is_valid_terminal_transition() {
  local dispatch_type="$1" before="$2" after="$3"
  case "$dispatch_type" in
    plan_audit)
      [[ "$before" == "pending_plan_audit" ]] || return 1
      case "$after" in pending|revising_plan|blocked) return 0 ;; *) return 1 ;; esac ;;
    plan_revise)
      [[ "$before" == "revising_plan" ]] || return 1
      [[ "$after" == "pending_plan_audit" ]] || [[ "$after" == "blocked" ]] ;;
    impl)
      [[ "$before" == "pending" || "$before" == "revising" ]] || return 1
      [[ "$after" == "awaiting_audit" ]] || [[ "$after" == "blocked" ]] ;;
    impl_audit)
      [[ "$before" == "awaiting_audit" ]] || return 1
      case "$after" in ready_to_merge|revising|blocked) return 0 ;; *) return 1 ;; esac ;;
    merger)
      [[ "$before" == "ready_to_merge" ]] || return 1
      # round-4 M-6: merger may transition ready_to_merge → blocked when
      # the regression gate detects a failure between merge and push.
      case "$after" in done|blocked) return 0 ;; *) return 1 ;; esac ;;
    repair)
      [[ "$before" == "blocked" ]] || return 1
      case "$after" in revising|revising_plan|blocked) return 0 ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}
```

**`dispatch_with_guards` (revised):**
```bash
dispatch_with_guards() {
  local sid="$1" dispatch_type="$2"; shift 2
  local status_before status_after
  # Read from integration's worktree (the runner's checkout) — that's what the
  # runner's selector reads each tick, so success must be observable there.
  status_before=$(read_field "diagnostic/slices/${sid}.md" status)
  if "$@"; then rc=0; else rc=$?; fi
  status_after=$(read_field "diagnostic/slices/${sid}.md" status)

  if is_valid_terminal_transition "$dispatch_type" "$status_before" "$status_after"; then
    # Verdict landed and is observable on the runner's branch. Success.
    slice_fail_reset "$sid"
  else
    # Either no transition, stuck on in_progress, or transition only on slice
    # branch (mirror failed). Whatever rc was, this is a failure for guard purposes.
    slice_fail_increment "$sid"
    log "dispatch did not produce expected terminal transition slice=$sid type=$dispatch_type before=$status_before after=$status_after rc=$rc"
  fi
}
```

**Why "any change → success" was wrong:** an agent crash mid-edit could leave the slice file at `in_progress` (started writing, never finished). Plain "status changed" treats that as success and resets the fail counter; the runner re-dispatches forever. The allow-list rejects `in_progress` because it's never a terminal state.

**Why this requires the mirror step (Item 5) to be reliable:** if the mirror fails to land integration's slice file with the new status, even a successful audit looks like a failure here. The lock + retry policy in Item 5 makes this safe.

### Item 5 — C-6 (deterministic mirror step, full pattern post-round-2 audit)

**Per round-2 H-1 + H-2:** every dispatcher mirrors. The implementation dispatcher (`dispatch_claude.sh`) was missing from the prior file list — it now mirrors the `pending|revising → awaiting_audit` handoff back to integration so the runner observes implementation completion. With the uniform-worktree model (Item 2), there is **always** a slice branch by the time mirror runs; the "no slice branch" branch in the prior code is removed.

**Files to modify:**
- `scripts/loop/dispatch_claude.sh` — add post-step after `claude --print` returns (NEW per round-2 H-2)
- `scripts/loop/dispatch_codex.sh` — add post-step after `codex exec` returns
- `scripts/loop/dispatch_slice_audit.sh` — add post-step (plan-audit mirror)
- `scripts/loop/dispatch_plan_revise.sh` — add post-step (plan-revise mirror)
- `scripts/loop/dispatch_repair.sh` — add post-step (repair commits also need mirroring)
- `scripts/loop/prompts/codex_auditor.md` — remove mirror instructions
- `scripts/loop/prompts/codex_slice_auditor.md` — remove mirror instructions
- `scripts/loop/prompts/claude_plan_reviser.md` — remove mirror instructions
- `scripts/loop/prompts/claude_implementer.md` — confirm no push-to-integration directive (it stays slice-branch-only)
- `scripts/loop/prompts/claude_repair.md` — remove "push integration" directive (now done by dispatcher post-step)
- New file: `scripts/loop/mirror_helper.sh` (shared post-step)

**Full pattern (mirror_helper.sh):**
```bash
# scripts/loop/mirror_helper.sh
# Usage: mirror_slice_to_integration <slice_id> <dispatch_type>
# Returns 0 on success (or no-op if slice branch has no new content).
# Returns 1 on validation failure or push failure (caller increments fail counter).

source "$LOOP_DIR/repo_lock.sh"
source "$LOOP_DIR/state_transitions.sh"

mirror_slice_to_integration() {
  local sid="$1" dispatch_type="$2"
  local slice_path="diagnostic/slices/${sid}.md"
  local slice_branch="slice/${sid}"

  with_repo_lock "mirror:$sid:$dispatch_type" _do_mirror "$sid" "$dispatch_type"
}

_do_mirror() {
  local sid="$1" dispatch_type="$2"
  local slice_path="diagnostic/slices/${sid}.md"
  local slice_branch="slice/${sid}"

  # All git operations target the runner's main worktree, regardless of which
  # worktree's shell called us. (Round-2 H-3 fix.)
  cd "$LOOP_MAIN_WORKTREE" || return 1

  # 1. Ensure runner is on integration and synced.
  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$current_branch" != "integration/perf-roadmap" ]]; then
    git checkout integration/perf-roadmap || return 1
  fi
  git pull --ff-only origin integration/perf-roadmap 2>/dev/null || true

  # 2. Slice branch must exist (per uniform-worktree model in Item 2).
  if ! git rev-parse --verify "$slice_branch" >/dev/null 2>&1; then
    # Should never happen under the uniform model. If it does, the dispatch
    # is corrupt — refuse the mirror (no-op-as-success would mask the bug).
    log "mirror: slice branch $slice_branch does not exist for $sid"
    return 1
  fi

  # 3. Read the slice's slice-file version from the slice branch.
  local slice_branch_content
  slice_branch_content=$(git show "${slice_branch}:${slice_path}" 2>/dev/null) || return 1

  # 4. Validate the new status is a known terminal state for this dispatch.
  local new_status
  new_status=$(printf '%s' "$slice_branch_content" \
    | awk '/^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
           fm && $1 == "status:" { sub(/^[^:]+: */, ""); print; exit }')
  local before_status
  before_status=$(read_field "$slice_path" status)
  if ! is_valid_terminal_transition "$dispatch_type" "$before_status" "$new_status"; then
    log "mirror: refusing to mirror invalid transition for $sid (type=$dispatch_type before=$before_status after=$new_status)"
    return 1
  fi

  # 5. Write the new content; commit only if it actually differs.
  printf '%s' "$slice_branch_content" > "$slice_path"
  if git diff --quiet -- "$slice_path"; then
    return 0  # no-op, already mirrored
  fi
  git add "$slice_path"
  git commit -m "audit: mirror verdict for ${sid} onto integration

[slice:${sid}][protocol-mirror][dispatcher]" >/dev/null 2>&1 || return 1

  # 6. Push with one retry on failure (rebase against latest origin and retry).
  if ! git push >/dev/null 2>&1; then
    git pull --rebase origin integration/perf-roadmap || return 1
    git push >/dev/null 2>&1 || { log "mirror: push failed twice for $sid"; return 1; }
  fi

  return 0
}
```

**Caller pattern (in `dispatch_codex.sh` and friends), AFTER `codex exec` returns:**
```bash
codex_rc=$?
if ! mirror_slice_to_integration "$slice_id" "impl_audit"; then
  log "[$(date -Iseconds)] dispatch_codex $slice_id mirror failed"
  exit 1   # dispatch_with_guards in runner will see no terminal transition + non-zero rc → fail counter
fi
```

**What this fixes from the prior recipe:**
- Lock prevents two dispatchers racing on the same mirror commit.
- Explicit `git checkout integration/perf-roadmap` before mirroring (no more "the runner happened to be on the right branch by coincidence").
- `git pull --ff-only` guarantees we're not mirroring onto a stale local integration.
- Terminal-state validation rejects `in_progress` and other non-terminal mirror attempts (the agent didn't actually finish).
- Push-failure retry once (handles the common case where another dispatcher just pushed; a second attempt with `--rebase` succeeds).
- No commit if content didn't change (idempotent re-runs).

### Item 6 — C-7 (auto-merger conflict policy, hardened pre-run, round-2 M-7 tightened)

**Files to modify:**
- `scripts/loop/dispatch_merger.sh`

**Per round-2 M-7:** broad prefix matching alone is too permissive. Phase 9 might modify `src/foo.ts` while integration concurrently fixed an unrelated bug in `src/bar.ts`; the prior policy would auto-take the slice's tree for `src/*` and silently lose the integration fix. New policy: a conflict in path P auto-resolves with slice version **only if** P appears in the slice's `Changed files expected` list. Broad prefixes are fallback categories for *unexpected-but-plausibly-slice-owned* conflicts that go to user instead of merging silently.

**Strict path-format requirement (round-3 M-5):** the conflict resolver parses `## Changed files expected` for backticked paths. To be machine-parseable, the slice template requires each entry to be EITHER a single backticked path on its own bullet (e.g. `` - `web/foo.ts` ``) OR a backticked path followed by a free-form parenthetical comment (e.g. `` - `web/foo.ts` (new file) ``). Globs, plain-text descriptions, and notes-only bullets are NOT honored. The parser:

```bash
path_in_changed_files_expected() {
  local p="$1" slice_file="$2"
  awk '
    /^## Changed files expected$/ { in_section = 1; next }
    /^## / && in_section { exit }
    in_section && /^- `[^`]+`/ {
      # Extract the first backticked path on the line; ignore anything after.
      match($0, /`[^`]+`/);
      path = substr($0, RSTART+1, RLENGTH-2);
      print path;
    }
  ' "$slice_file" | grep -Fxq "$p"
}
```

This is conservative on purpose: a slice that wants to claim a path for auto-resolve has to declare it precisely. Loose entries fall through to user.

**Decision tree per conflicted path P:**

```
1. P ∈ slice's "Changed files expected" (parsed via path_in_changed_files_expected)?
   YES → auto-take slice version (the slice authored its own work; trust it)
   NO  → step 2

2. P matches an INTEGRATION_OWNED prefix?
   YES → auto-take integration version + log loudly (slice touched protected path)
   NO  → step 3

3. P matches a SLICE_PLAUSIBLE prefix (web/, src/, sql/, diagnostic/artifacts/)?
   YES → BLOCK with "ambiguous-slice-owned" reason. The slice didn't declare
         this file but it's under a slice-owned area; user judges intent.
   NO  → step 4

4. Block with "fully-unexpected" reason. User decides.
```

**Code shape:**
```bash
INTEGRATION_OWNED_PATHS=(
  "scripts/loop/"
  "scripts/loop/prompts/"
  "diagnostic/_state.md"
  "diagnostic/_index.md"
  "diagnostic/slices/_index.md"
  ".github/"
  ".gitignore"
)
SLICE_PLAUSIBLE_PATHS=(
  "web/"
  "src/"
  "sql/"
  "diagnostic/artifacts/"
)

resolve_conflict() {
  local p="$1" slice_file="$2"   # round-4 M-5: pass slice file explicitly
  if path_in_changed_files_expected "$p" "$slice_file"; then
    git checkout --theirs -- "$p"; git add "$p"
    return 0
  fi
  for prefix in "${INTEGRATION_OWNED_PATHS[@]}"; do
    if [[ "$p" == "$prefix"* || "$p" == "$prefix" ]]; then
      git checkout --ours -- "$p"; git add "$p"
      log "merger: auto-took integration version of $p (slice touched protected path)"
      return 0
    fi
  done
  for prefix in "${SLICE_PLAUSIBLE_PATHS[@]}"; do
    if [[ "$p" == "$prefix"* ]]; then
      log "merger: ambiguous-slice-owned conflict in $p (not in Changed files expected)"
      return 1
    fi
  done
  log "merger: fully-unexpected conflict in $p"
  return 1
}
```

The slice file's `Changed files expected` is implicitly always allowed (the existing convention). `path_in_changed_files_expected()` parses the slice file and tests P against the bullet-list paths.

**After all conflicts processed:** if any path returned 1 from `resolve_conflict`, abort the merge, set `status: blocked, owner: user`, append a "Merger escalation" section listing each unresolved path and its reason. Push abort. Exit 1.

### Item 7 — C-8 (CI verification before kickoff)

**Files / actions:**
- One-time pre-flight check, no script changes needed
- Verify GitHub Actions workflow at `.github/workflows/ci.yml` actually fires

**Procedure (round-2 M-8 + round-3 M-6: SHA-pinned + wait-for-completion):**
```bash
# Make a trivial change that touches no app code
echo "" >> diagnostic/_state.md
git add diagnostic/_state.md
git commit -m "ci: trigger workflow verification [no-op]"
git push
TRIGGER_SHA=$(git rev-parse HEAD)

# Poll until the run for this exact SHA reaches a terminal state.
# This is a kickoff gate; we want to know the workflow actually PASSED,
# not just that it registered. Round-3 M-6 fix.
DEADLINE=$(( $(date +%s) + 1800 ))   # 30 min total budget
while true; do
  status_line=$(gh run list --branch integration/perf-roadmap --limit 5 \
    --json status,conclusion,headSha \
    | python3 -c "
import json, sys
runs = json.load(sys.stdin)
target = '$TRIGGER_SHA'
matching = [r for r in runs if r['headSha'] == target]
if not matching: print('PENDING none'); sys.exit(0)
r = matching[0]
if r['status'] != 'completed':
  print(f'PENDING in_progress')
elif r.get('conclusion') == 'success':
  print('DONE success')
else:
  print(f'DONE failure conclusion={r.get(\"conclusion\")}')
")
  case "$status_line" in
    "DONE success")  echo "CI verification passed for $TRIGGER_SHA"; break ;;
    "DONE "*)        echo "FAIL: CI run for $TRIGGER_SHA: $status_line"; exit 1 ;;
    "PENDING"*)
      [[ $(date +%s) -ge $DEADLINE ]] && { echo "FAIL: CI run for $TRIGGER_SHA timed out after 30min"; exit 1; }
      sleep 30 ;;
  esac
done
```

If the workflow doesn't fire OR concludes anything other than success, fix `.github/workflows/ci.yml` (likely a trigger-paths or test issue) before kickoff. The SHA pin ensures we don't accidentally accept a stale run from a prior commit; the wait-for-completion ensures we don't accept an in-progress run that might still fail.

### Item 8 — C-1 (stub 71 slice files)

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

### Item 9 — I-1 (cost telemetry — config-driven, best-effort, advisory)

**Files to add:**
- `scripts/loop/pricing.json` — model → `{input_per_1m_usd, output_per_1m_usd, cache_read_per_1m_usd}`
- `scripts/loop/post_dispatch_cost.sh` — invoked from each dispatcher after the agent returns

**`pricing.json` shape (user-editable):**
```json
{
  "_comment": "USD per 1M tokens. Override path via LOOP_PRICING_FILE.",
  "_updated": "2026-04-26",
  "models": {
    "claude-opus-4-7":   { "input": 15.00, "output": 75.00, "cache_read": 1.50 },
    "claude-sonnet-4-6": { "input":  3.00, "output": 15.00, "cache_read": 0.30 },
    "gpt-5.4":           { "input":  2.50, "output": 10.00, "cache_read": 0.25 }
  }
}
```

**Ledger row format (replaces the `cost_usd: 0` placeholder):**
```json
{
  "ts": "2026-04-26T15:00:00Z",
  "slice": "02-prompt-static-prefix-split",
  "agent": "claude",
  "model": "claude-opus-4-7",
  "source": "session-log-parse",
  "input_tokens": 12340,
  "output_tokens": 1820,
  "cache_read_tokens": 9100,
  "cost_usd": 0.32,
  "estimated": true
}
```

**The `estimated: true` flag stays until parser coverage is proven** across both Claude and Codex session formats. Once we've validated against e.g. 50 dispatches and reconciled with billing console totals (within 5%), flip to `false` and the `check_budget.sh` cap becomes load-bearing. Until then the cap stays advisory.

**Parser fallback:** if the session JSONL is missing or unparsable, append a placeholder row with `estimated: true, source: "placeholder", cost_usd: 0` so the ledger is contiguous.

### Item 10 — I-3-min (post-merge regression gate, round-2 H-4 fixed)

**Files to modify:**
- `scripts/loop/dispatch_merger.sh` — regression gate runs in the **merge-staging** phase, BEFORE push and BEFORE `update_state.sh` and BEFORE marking the slice `done`.

**Per round-2 H-4:** the prior plan ran regression "before update_state.sh" — but state update happens AFTER push, so a regression detected then would already be on origin. The new ordering puts regression strictly between merge-into-local-integration and push:

**New merger flow (under one repo lock):**

```
acquire repo lock
  │
  ├─ git checkout integration/perf-roadmap
  ├─ git pull --ff-only
  ├─ git merge --no-ff slice/<id> [resolve conflicts per Item 6]
  ├─ ─── REGRESSION GATE ─── (new)
  │     • bash -n scripts/loop/*.sh
  │     • loop_status.sh exits 0
  │     • if phase-boundary: typecheck / test:grading / SQL parse / healthcheck
  │     • on FAILURE: git reset --hard ORIG_HEAD
  │                   set slice status=blocked, append "Regression detected" note
  │                   commit slice file revert; do NOT push
  │                   log REGRESSION event (webhook fires)
  │                   exit 1
  ├─ flip slice frontmatter status=done, owner=-
  ├─ commit "mark <id> done after auto-merge"
  ├─ git push integration  (single push includes merge + done commit)
  ├─ git branch -D slice/<id>; cleanup_slice_worktree
  ├─ cleanup_slice_state <id>   ← round-11 L: also purges stale attempt-N sentinels
  ├─ scripts/loop/update_state.sh  (regenerates _state.md, separate commit + push)
release repo lock
```

**Gates per merge (all must exit 0 or REGRESSION + revert):**
```bash
# Always-on (cheap):
bash -n scripts/loop/*.sh
./scripts/loop/loop_status.sh >/dev/null

# Conditional on slice's phase boundary (last slice of phase):
# Phase 0/1/2/4/5/6/7/9/10/12 boundary → typecheck + test:grading
( cd web && npm run typecheck && npm run test:grading )
# Phase 3 boundary → SQL parse over sql/*.sql via psql -X -v ON_ERROR_STOP=1 -f
# Phase 8/11 boundary → healthcheck:chat + healthcheck:grade
```

**Phase-boundary detection:** count `done` slices in the just-merged slice's phase **including the in-flight merge**; if equal to phase total, this is the boundary, run heavy gates.

**Critical property (round-2 H-4):** regression detection **before push** means rollback is local-only (`git reset --hard ORIG_HEAD`). Once pushed, rollback would require a force-push to integration — much riskier. By gating before push, the only side effect of a regression is one wasted Codex audit pass, not a corrupted shared branch.

**Round-3 H-2 fix — making the runner actually see `blocked` after rollback:**

The prior recipe reset local integration to `ORIG_HEAD` and committed the blocked note only on the slice branch. But the runner reads `diagnostic/slices/<id>.md` from the **integration** worktree. Post-rollback, integration's slice file still has the pre-merge `ready_to_merge` status, so the runner happily re-attempts the same bad merge on the next tick.

Fix: after rollback, also push a tiny integration-side commit that sets the slice file to `blocked`. This is safe because the merge itself was undone — we're committing a one-line frontmatter flip on top of pre-merge integration, not on top of the bad merge.

**On regression detection (corrected ordering):**
```bash
# All operations under the existing repo lock.

# 1. Local-only rollback of the bad merge.
git -C "$LOOP_MAIN_WORKTREE" reset --hard ORIG_HEAD

# 2. Update integration's slice file to blocked + regression note.
#    (Integration is at pre-merge state; we're adding a single tiny commit.)
local slice_path="diagnostic/slices/${sid}.md"
sed -i.bak 's/^status: ready_to_merge$/status: blocked/; s/^owner: user$/owner: user/' \
  "$LOOP_MAIN_WORKTREE/$slice_path"
rm -f "$LOOP_MAIN_WORKTREE/${slice_path}.bak"

# Append a regression-detected section.
cat >> "$LOOP_MAIN_WORKTREE/$slice_path" <<EOF

## Regression detected (auto-merger)
Slice merge produced a regression that failed phase-boundary gates.
Local merge has been reset; this status flip preserves visibility for the
runner. See git log on slice branch for the original audit verdict trail.
- Failed gate: ${failed_gate_name}
- Detected at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

git -C "$LOOP_MAIN_WORKTREE" add "$slice_path"
git -C "$LOOP_MAIN_WORKTREE" commit -m "regression: mark $sid blocked after merger gate failure

[slice:${sid}][regression-revert]" >/dev/null 2>&1

if ! git -C "$LOOP_MAIN_WORKTREE" push >/dev/null 2>&1; then
  # Push failed (origin moved between merge and our push, or transient
  # network failure). The local integration branch now has an unpushed
  # [regression-revert] commit. We do NOT want preconditions.sh to treat
  # this as a dirty worktree — the worktree itself is clean, integration
  # is just ahead of origin.
  #
  # Resume strategy (round-5 M-4):
  #   1. Mark this state with a sentinel: scripts/loop/state/regression_pending_push
  #      contains the commit hash that needs pushing.
  #   2. preconditions.sh checks this sentinel BEFORE the worktree-clean
  #      check. If present, it attempts `git pull --rebase + git push`
  #      under the lock; on success, deletes the sentinel and continues.
  #      On repeated failure (3 ticks), trips the circuit breaker.
  #   3. The runner does NOT dispatch the next slice until this sentinel
  #      is cleared. This avoids interleaving fresh slice work with an
  #      unpushed regression commit (which would compound history mess).
  echo "$(git rev-parse HEAD)" > "$LOOP_STATE_DIR/regression_pending_push"
  log "regression: push failed; pending sentinel set; runner will retry on next tick"
fi

# 3. Slice branch also gets the regression note for audit-trail completeness.
( cd "$WORKTREE_BASE/$sid" && \
    sed -i.bak 's/^status: ready_to_merge$/status: blocked/' "$slice_path" && \
    rm -f "${slice_path}.bak" && \
    git add "$slice_path" && \
    git commit -m "regression: blocked after auto-merger gate failure [slice:${sid}][regression]" \
    >/dev/null 2>&1 && \
    git push 2>/dev/null ) || true   # best-effort

# 4. Log REGRESSION event (webhook fires).
log "REGRESSION slice=$sid gate=${failed_gate_name}"
# DO NOT call release_repo_lock here — this handler is invoked from the
# merger's existing with_repo_lock wrapper, which owns the release. Returning
# rc=1 propagates up; with_repo_lock's wrapper releases the lock per its
# normal exit path. (Round-4 H-2 fix: prior version called release_repo_lock
# manually, double-releasing.)
return 1   # caller's with_repo_lock wrapper sees this rc and releases the lock
```

The runner's next tick sees `blocked` on integration and routes to auto-repair or USER ATTENTION per existing flow. **Without the integration-side commit, the runner would re-attempt the merge and re-fail in a loop.**

### Item 11 — I-9 (webhook — generic JSON payload)

**Files to modify:**
- `scripts/loop/runner.sh` — extend `log()` function

**Pattern:**
```bash
log() {
  local msg="$(date -Iseconds) $*"
  printf '%s\n' "$msg" | tee -a "$LOG"
  case "$msg" in
    *"CIRCUIT BREAKER"*|*"USER ATTENTION"*|*"merged and pushed"*|*"runner exit"*|*"REGRESSION"*)
      notify_webhook "$msg"
      ;;
  esac
}

notify_webhook() {
  [[ -z "${LOOP_NOTIFY_WEBHOOK:-}" ]] && return 0
  local payload
  payload=$(printf '{"ts":"%s","event":"%s","slice_id":"%s","commit":"%s","message":%s}' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(extract_event "$1")" \
    "$(extract_slice "$1")" \
    "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    "$(printf '%s' "$1" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')")
  curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$LOOP_NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}
```

User wires whatever they want to that URL — Telegram bot, Slack incoming webhook, Discord webhook, plain `webhook.site` for testing, or a custom endpoint. No tool-specific assumptions in the payload.

### Item 12 — I-8 (loop_history.sh)

**Files to add:** `scripts/loop/loop_history.sh`

**Output sections:**
- Per-slice: phase, plan-iter rounds, repair attempts, time-to-merge, fail-count peaks, did-it-circuit-break
- Phase: total wall-clock, total LLM cost (sum from `cost_ledger.jsonl`)
- Loop-wide: which slices needed the most plan-revise rounds (top 5), which slices required auto-repair (count), which slices blocked-then-merged via repair

Pure read-only over `cost_ledger.jsonl` + `git log` + slice frontmatter. No state mutation.

---

## 5. Sequencing and dependencies (revised post-audit)

```
[Item 1 (C-2 span fix)]            ─→ slice; standalone, can run last
[Item 2 (C-3 + repo lock)]         ─→ FOUNDATION — others depend on it
[Item 3 (C-4 cap + graceful)]      ─→ depends on Item 2's lock primitive
[Item 4 (C-5 terminal-state)]      ─→ depends on Item 5 (mirror reliability)
[Item 5 (C-6 deterministic mirror)]─→ depends on Item 2's lock primitive
[Item 6 (C-7 merger conflict)]     ─→ depends on Item 2's lock primitive
[Item 7 (C-8 CI verification)]     ─→ standalone, one-time check
[Item 8 (C-1 stub 71 slices)]      ─→ AFTER Items 2–7 are merged (per Codex Q8 final)
[Item 9 (cost telemetry)]          ─→ standalone
[Item 10 (regression gate)]        ─→ depends on Item 6 (lock around merger steps)
[Item 11 (webhook)]                ─→ standalone, ~15min
[Item 12 (loop_history)]           ─→ standalone, no run-time impact
```

**Critical-path order (revised):**

**Day 1 — foundation:**
1. Item 2 (worktree isolation + repo lock) — biggest correctness fix; everything mutating else depends on it.
2. Item 5 (deterministic mirror) — uses Item 2's lock; required before Item 4 makes sense.
3. Item 4 (terminal-state success detection) — uses Item 5's reliability guarantee.
4. Item 6 (merger conflict policy) — uses Item 2's lock.

**Day 2 — pre-flight + validation:**
5. Item 3 (cap + graceful-stop policy) — small but touches plan-revise + prompt.
6. Item 7 (CI verification) — one-time check; landing here ensures CI is firing before stub work.
7. Item 10 (minimal regression gate) — uses Item 6's lock.
8. Items 9, 11, 12 (cost / webhook / history) in parallel.

**Day 3 — single smoke slice + validation:**
9. Item 1 (span fix) — kicked off as a slice through the now-hardened loop. This is the first production slice through the hardened mechanics; it shakes out worktree/lock/mirror behavior on a small change.
10. Stub ONE smoke slice (`02-prompt-static-prefix-split`) and run it through the loop end-to-end. Confirm it goes plan-audit → revising_plan → pending → impl → awaiting_audit → ready_to_merge → merged → state-update without manual intervention.

**Day 4 — DB/service smoke + Phase-3 prototype (round-4 L):**
11. Stub `03-core-build-schema` and `03-driver-session-summary-prototype` (Phase 3's first two slices — schema setup + first matview prototype). Run them through the loop. This is a DB/service smoke — confirms Postgres connectivity, matview write, parity check, refresh hook all work end-to-end.
12. After Day 4 smoke is clean, mass-stub the remaining 69 slices (Item 8). Total grows to 86 with the new `02-cost-telemetry-validation` slice.
13. Stub `02-cost-telemetry-validation` and place it after `02-cache-hit-assertion` in `_index.md`.

**Day 5 — kickoff:**
14. Kick off the unattended end-to-end run for Phases 2–12 remaining slices.

**Realistic wall-clock for full prep:** 4–4.5 days if focused.

**Why two-stage smoke (round-4 L):** `02-prompt-static-prefix-split` is code-only — exercises plan-audit, plan-revise, mirror, merger, regression-gate-cheap-path. But it doesn't exercise DB connectivity or matview parity. The Phase-3 prototype is the first slice that actually writes to Postgres and runs parity SQL. Smoking that pair before mass-stubbing catches DB/service issues before 80+ slices commit to a faulty pattern.

---

## 6. Critical files referenced

**Code under change:**
- `scripts/loop/dispatch_claude.sh` — worktree, lock, post-dispatch mirror call
- `scripts/loop/dispatch_codex.sh` — same + remove mirror agent prompt fragment
- `scripts/loop/dispatch_repair.sh` — worktree, lock
- `scripts/loop/dispatch_plan_revise.sh` — worktree, lock, post-dispatch mirror, raise iter cap to 6
- `scripts/loop/dispatch_slice_audit.sh` — post-dispatch mirror call
- `scripts/loop/dispatch_merger.sh` — lock, hardened conflict policy, regression gate hook, worktree cleanup
- `scripts/loop/runner.sh` — `dispatch_with_guards` uses terminal-state allow-list, webhook in `log()`
- `scripts/loop/update_state.sh` — lock around commit+push
- `scripts/loop/prompts/codex_slice_auditor.md` — remove mirror; add iter-5 graceful-stop policy
- `scripts/loop/prompts/codex_auditor.md` — remove mirror
- `scripts/loop/prompts/claude_plan_reviser.md` — remove mirror

**Code being added:**
- `scripts/loop/repo_lock.sh` — mkdir-based portable lock primitive (BASHPID-aware, reentrant)
- `scripts/loop/worktree_helpers.sh` — worktree create/cleanup helpers
- `scripts/loop/state_transitions.sh` — terminal-state allow-list per dispatch type
- `scripts/loop/mirror_helper.sh` — deterministic mirror with lock + validation + retry
- `scripts/loop/slice_helpers.sh` — `flip_slice_status`, `append_slice_section`, `extract_latest_audit_verdict_text`, `classify_repair_mode` (round-6 M-4: previously referenced but unowned)
- `scripts/loop/reject_loop_infra_repair.sh` — guarded rejection script for loop-infra repairs (round-6 H-2)
- `scripts/loop/post_dispatch_cost.sh` — session-log cost parser
- `scripts/loop/pricing.json` — model pricing table (user-editable)
- `scripts/loop/loop_history.sh` — read-only aggregator

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

## 7. Verification (revised post-audit)

After landing Items 1–12 and stubbing the 71 slice files:

1. **Bash syntax sweep:** `for s in scripts/loop/*.sh; do bash -n "$s"; done` — must all pass.
2. **Worktree isolation — main HEAD stable:** start the runner in dry-run mode (`LOOP_DRY_RUN=1`); verify the main worktree's `HEAD` and `git status` stay on `integration/perf-roadmap` clean throughout the dispatch.
3. **Lock contention test:** run two dispatchers in parallel against synthetic slices; verify they serialize (one waits for the other, neither corrupts state). Verify stale-PID detection fires when one process is killed mid-lock.
4. **Terminal-state success detection — strict:**
   - Test (a): agent edits slice file `awaiting_audit → ready_to_merge`, exits rc=1. Verify success (no fail-counter increment).
   - Test (b): agent crashes, slice file stuck on `in_progress`, exits rc=139. Verify fail-counter increments.
   - Test (c): agent edits slice file on slice branch only, mirror fails. Verify fail-counter increments (status on integration didn't change).
5. **Mirror determinism end-to-end:** force a `codex exec` to exit rc=1 mid-mirror; verify mirror_helper retries with rebase and either succeeds or fails cleanly with logged reason.
6. **Plan-iter cap + graceful-stop:** synthetically set `plan_iter_count_<slice>` to 5; trigger an audit dispatch; verify Codex's prompt now allows APPROVE-with-deferred-Mediums-only (no Highs deferable).
7. **Merger conflict policy:** synthesize a slice branch that modifies `web/foo.ts` AND `scripts/loop/dispatch_codex.sh`. Verify merger auto-takes slice version of `web/foo.ts`, integration version of `scripts/loop/dispatch_codex.sh`, logs the integration-owned conflict loudly, and merges successfully. Then: synthesize a slice that modifies an unlisted path (e.g. `node_modules/foo.js`) — verify merger blocks the slice with "Merger escalation" note.
8. **CI verification:** run Item 7's procedure (one-push trigger). Verify `gh run list` shows a workflow registered for that commit.
9. **Slice file count:** `find diagnostic/slices -name '*.md' -not -name '_*' | wc -l` should be 86.
10. **`loop_status.sh`:** zero `MISSING` rows; all 86 slices show a real status.
11. **Repo lock under merger:** trigger a manual merge while the runner is mid-dispatch. Verify the merger waits, neither corrupts state.
12. **Cost telemetry shape:** dispatch one slice, verify `cost_ledger.jsonl` has a row with `model`, `source: "session-log-parse"`, real (or 0) `cost_usd`, and `estimated: true`.
13. **Webhook:** trigger a `CIRCUIT BREAKER` synthetically with `LOOP_NOTIFY_WEBHOOK=https://webhook.site/...` set; verify a JSON payload arrives with `event`, `slice_id`, `commit`, `message`.
14. **Regression gate at phase boundary:** synthesize a Phase-2 last-slice merge where `npm run typecheck` would fail. Verify merger logs `REGRESSION` event, sets slice to `blocked`, exits 1.
15. **Smoke run:** kick off the runner in real mode against a single Phase-2 slice; verify plan-audit → implement → audit → merge → state-update cleanly with all locks acquired and released.

16. **Loop-infra repair — no-sentinel path (round-5 M-6 + round-7 M-5).** Synthesize a slice in `blocked` state whose latest plan-audit verdict block contains an **unchecked High or Medium action item** explicitly naming `scripts/loop/dispatch_codex.sh` (e.g. `### High` `- [ ] Update scripts/loop/dispatch_codex.sh to ...`). The verdict's Notes section may also mention the file, but classification must come from the unchecked actionable item — not the Note. Trigger the repair agent. Verify:
    - Dispatcher classifies as `loop-infra` BEFORE invoking agent (log entry).
    - Two local commits land on integration: `[loop-infra-repair]` and `[loop-infra-pending]`.
    - Neither is pushed to origin.
    - Worktree is clean (`git status` empty).
    - Slice file frontmatter shows `status: blocked, owner: user`.
    - `runner.log` shows `loop-infra-repair pending approval` + `CIRCUIT BREAKER`.
    - Runner exits cleanly.

17. **Loop-infra repair — approval path.** From state at end of step 16, `touch diagnostic/slices/.approved-loop-infra-repair/<slice_id>`. Restart runner. Verify:
    - Runner's startup hook detects the sentinel.
    - Both local commits push to origin.
    - Sentinel file is removed.
    - Slice file flips back to `revising_plan` (or `revising`, whichever the agent intended).
    - Runner proceeds to dispatch the next actionable state.

18. **Loop-infra repair — rejection path (round-7 M-4).** From a fresh trigger of step 16, instead of touching the sentinel, run `scripts/loop/reject_loop_infra_repair.sh <slice_id>`. Verify:
    - Script confirms HEAD is on `integration/perf-roadmap`, distance is exactly 2, and HEAD/HEAD~1 message tags match expected pair.
    - Reset is performed; both local commits gone.
    - Sentinel cleaned up if it existed.
    - Slice file is back to its pre-repair status.
    - `repair_count_<slice_id>` still exists; loop knows it already attempted a repair (per existing `LOOP_MAX_REPAIRS=3` budget).
    Then run additional negative-test invocations:
    - `scripts/loop/reject_loop_infra_repair.sh <wrong_slice_id>` → script refuses (HEAD/HEAD~1 tags don't match).
    - With user on a slice branch instead of integration → script refuses (wrong branch).
    - With only 1 commit ahead of origin (manual reset to that state) → script refuses (distance check).

19. **Repair-mode-violation path.** Synthesize a parent slice whose verdict is purely about plan content (no protocol mention), so dispatcher classifies as `slice-state`. But the agent's prompt is intentionally pre-poisoned to make it edit `scripts/loop/dispatch_codex.sh`. Verify:
    - Post-step detects the protocol-file edit.
    - `git reset --hard HEAD~1` reverts the agent's commit.
    - Slice → `blocked` with "Repair mode violation" note.
    - No partial state landed.

20. **Regression-pending-push sentinel (round-5 M-4).** Synthesize a regression scenario where the integration push fails (e.g. simulate origin moving forward). Verify:
    - Sentinel file `scripts/loop/state/regression_pending_push` is created with the local HEAD hash.
    - Worktree is clean (`git status` empty), local branch is ahead of origin.
    - Next runner tick: preconditions detects sentinel, pulls --rebase, retries push, removes sentinel on success, continues normal dispatch.
    - On 3 consecutive tick failures: circuit breaker fires.

21. **Resume hook ordering (round-6 H-1).** Synthesize a state where two local `[loop-infra-pending]` + `[loop-infra-repair]` commits exist on integration (ahead of origin) and the approval sentinel is touched. Start the runner. Verify:
    - Resume hook runs BEFORE `preconditions.sh`.
    - Resume hook acquires lock, pushes both original commits, commits + pushes the slice-status flip ([loop-infra-resumed]), THEN removes the sentinel (sentinel is the last step, only after final push succeeds — round-8 L-5).
    - `preconditions.sh` then sees a clean worktree synced with origin and proceeds normally.

22. **Reject script (round-6 H-2).** With two local pending commits, run `scripts/loop/reject_loop_infra_repair.sh <slice_id>`. Verify:
    - Script refuses if not on `integration/perf-roadmap` (test by checking out a slice branch first).
    - Script refuses if local-vs-origin distance is not exactly 2 commits.
    - Script refuses if HEAD/HEAD~1 message tags don't match the slice id.
    - When all checks pass, reset is performed and sentinel cleaned up.

23. **`slice_helpers.sh` exports (round-6 M-4).** Verify the new helper file exports `flip_slice_status`, `append_slice_section`, `extract_latest_audit_verdict_text`, `classify_repair_mode`, and that they're sourced by `dispatch_repair.sh` and `dispatch_merger.sh`.

24. **Bash 4+ assertion (round-6 M-5).** Run the runner under bash 3.2 (e.g. `/bin/bash ./scripts/loop/runner.sh` on macOS); verify it fails fast with a clear "bash 4+ required" message. Run again under Homebrew bash (`/opt/homebrew/bin/bash`); verify normal startup.

25. **Mode-classification quote-vs-action (round-6 M-3).** Synthesize a slice file whose latest audit verdict has the word `runner.sh` in a Note ("the existing runner.sh circuit breaker is sufficient") but no protocol-fix items in High/Medium. Verify `classify_repair_mode` returns `slice-state`, NOT `loop-infra`.

26. **Partial-resume-failure recovery — two crash points (round-8 H-1 + M-4 + round-9 M-3 + round-10 M-3).** Two scenarios must both pass. Both use a deterministic fault injection point via `LOOP_TEST_INJECT_FAULT` env var. The runner reads this env var inside `_do_resume_loop_infra` at named fault sites and `exit 137` (simulating SIGKILL) when it matches. Supported values:

    - `LOOP_TEST_INJECT_FAULT=after_initial_push_before_resumed_commit` — after the first push succeeds (`[loop-infra-repair]` and `[loop-infra-pending]` are now on origin) but BEFORE the slice-status flip + `[loop-infra-resumed]` commit is made
    - `LOOP_TEST_INJECT_FAULT=after_resumed_commit_before_final_push` — after the `[loop-infra-resumed]` commit exists locally but BEFORE the final push to origin
    - (any other value) — disabled

    **26a. Failure AFTER `[loop-infra-resumed]` commit exists locally:**
    Set `LOOP_TEST_INJECT_FAULT=after_resumed_commit_before_final_push`. Trigger the resume hook with both repair commits local + sentinel touched. Verify mid-state:
    - Origin has `[loop-infra-repair]` + `[loop-infra-pending]`.
    - `[loop-infra-resumed]` commit exists locally on integration.
    - Sentinel STILL exists.
    Restart with the env var unset. Verify:
    - Resume hook re-enters via SENTINEL scan.
    - Idempotency check detects existing local `[loop-infra-resumed]` and skips recreation.
    - Final push succeeds; sentinel removed; loop continues.

    **26b. Failure BEFORE `[loop-infra-resumed]` commit exists (round-9 H-1 + round-10 M-3):**
    Set `LOOP_TEST_INJECT_FAULT=after_initial_push_before_resumed_commit`. Trigger the resume hook with both repair commits local + sentinel touched. Verify mid-state:
    - Origin has `[loop-infra-repair]` + `[loop-infra-pending]` (first push succeeded).
    - NO `[loop-infra-resumed]` commit (anywhere).
    - Sentinel STILL exists.
    Restart with the env var unset. Verify:
    - Resume hook re-enters via SENTINEL scan.
    - `pending_anywhere` detector sees pending on origin → routes into `_do_resume_loop_infra`.
    - `_do_resume_loop_infra` finds no resumed commit, sees pending on origin → skips first push, proceeds to flip + commit + push.
    - Final push succeeds; sentinel removed; loop continues.

    **Round-10 M-2 sub-case: `Resume-as: revising` path.** Synthesize a parent slice that was at `awaiting_audit` BEFORE the repair was triggered (impl-side repair). Trigger the loop-infra repair flow. Verify:
    - Dispatcher's `[loop-infra-repair]` commit (after amend) contains the trailer `Resume-as: revising` (NOT the default `revising_plan`).
    - On approval + restart, the resume hook reads the trailer and flips the slice to `revising`, not `revising_plan`.

    **Round-11 M-2 prerequisite for both 26a + 26b:** the runner must export
    `LOOP_TEST_MODE=1` in addition to `LOOP_TEST_INJECT_FAULT=...`. Without
    `LOOP_TEST_MODE=1` the injection block is dead code (round-11 L gate).

27. **Reject script offline behavior (round-8 M-3).** Run `reject_loop_infra_repair.sh <slice_id>` with `git fetch origin` mocked to fail. Verify:
    - Script refuses by default (exit 2 with clear network-failure message).
    - Override `reject_loop_infra_repair.sh <slice_id> --offline-local-only` proceeds with a loud warning.
    - Without the override, no destructive operation is performed.

28. **Merger sentinel cleanup (round-11 L).** Synthesize a slice that completed a loop-infra-repair cycle (attempts 1+2) and was eventually merged. After the merger runs:
    - Verify `diagnostic/slices/.approved-loop-infra-repair/<slice_id>__attempt-1` and `<slice_id>__attempt-2` are removed (both pruned by `cleanup_slice_state`).
    - Verify `repair_count_<slice_id>`, `plan_iter_count_<slice_id>`, and `fail_count_<slice_id>` state files are removed.
    - Restart the runner. Verify the resume hook does NOT re-fire for this slice (no leftover sentinels).

After all 28 verifications pass, the loop is ready for end-to-end kickoff.

---

## 8. Risks (revised post-audit)

1. **Worktree + lock migration introduces new bugs.** Most-load-bearing change. Mitigation: keep the old shared-worktree code path under `LOOP_WORKTREE_MODE=shared` for one stable run, then remove (per Codex Q6 final). Plus verification step 3 (lock contention test) catches the worst race scenarios pre-kickoff.
2. **Lock contention stalls the loop.** If a stuck process holds the lock past `LOCK_TIMEOUT=300s`, dispatchers fail. Mitigation: stale-PID detection in `acquire_repo_lock` force-releases when owner PID is dead. Real wedges (PID alive but blocked) trip the per-slice timeout in `run_with_timeout` and propagate as fail-counter increments.
3. **Stubbing 71 slices commits to the roadmap structure.** Mitigation: Phase 9 uses explicit per-file mappings (per Codex Q3); other phases use thin stubs and lean on iterative plan-audit. Stub authoring happens AFTER hardening so format changes from validation can be applied.
4. **Plan-iter cap of 6 may still be too low.** Mitigation: cap is env var; auto-repair has its own 3-attempt budget; circuit breaker exits cleanly if both exhaust.
5. **Cost telemetry parser may not handle all session JSONL shapes.** Mitigation: `estimated: true` flag on every row; daily cap stays advisory until validated.
6. **Webhook leaks repo info.** Mitigation: payload is event + slice id + short commit hash + log message — no code, no audit content.
7. **Hardened merger policy auto-resolves a conflict that should have been caught.** E.g. slice modifies `web/package.json` in a way that breaks integration's expected dependencies. Mitigation: regression gate (Item 10) catches this on the next merge; webhook fires `REGRESSION` event.
8. **CI verification (Item 7) requires `gh` CLI auth.** If not configured, the procedure errors. Mitigation: pre-flight script checks `gh auth status` first; user-resolves before kickoff.
9. **Cost-estimate drift if model pricing changes mid-run.** Mitigation: `pricing.json` has `_updated` field; agents log warning if stale > 30 days; ledger records `model` + `source` so re-computation is possible after the fact.

---

## 9. Codex round-1 + round-2 audit answers + remaining open questions

### Resolved by Codex round-2 audit (4 High + 4 Medium)

| Round-2 finding | How resolved |
|---|---|
| H-1: worktree conflicts with plan-audit semantics | Item 2 now uses **uniform worktree model** — every dispatcher (incl. plan-audit + plan-revise) runs in slice worktree on slice branch; every state change goes through `mirror_helper`. No more "edit on integration directly" branch. |
| H-2: implementation dispatch mirror was missing | Item 5 now lists `dispatch_claude.sh` as a mirror caller. The `pending|revising → awaiting_audit` transition is mirrored back to integration so the runner observes implementation handoff. |
| H-3: shared runner state under worktrees | Runner exports `LOOP_MAIN_WORKTREE` and `LOOP_STATE_DIR` (absolute paths). Every dispatcher and helper reads runner state from these vars regardless of which slice worktree's shell is active. Lock dir lives at `$LOOP_MAIN_WORKTREE/.git/openf1-loop.lock`. |
| H-4: regression gate timing dangerous | Item 10 reordered: regression gate runs strictly between `git merge` and `git push`. Failure → `git reset --hard ORIG_HEAD` (local-only rollback) + slice → blocked + slice-branch commit preserves audit trail. No force-pushes ever needed. |
| M-5: `with_repo_lock` unsafe under `set -e` | `with_repo_lock` now toggles `set +e` around the user command, captures rc, restores. Plus EXIT trap stacks the prior trap instead of clobbering. |
| M-6: stale branch / worktree handling | `ensure_slice_worktree` now: detects orphan dirs not in `git worktree list`, runs `git worktree prune`, attaches to existing slice branch instead of `-b`-erroring. |
| M-7: conflict policy too broad | Two-tier resolution: `Changed files expected` is the *primary* allow-list; broad prefixes are fallback categories that go to user, not silent merge. Slice version only auto-taken when path is explicitly in the slice's declared expected files. |
| M-8: CI verification not SHA-pinned | Procedure now captures `TRIGGER_SHA=$(git rev-parse HEAD)` post-push and matches against `headSha` in `gh run list`, so a stale run from a prior commit can't pass the gate. |

### Resolved by Codex round-1 (held; no changes needed in round 2)

1. ~~Worktree disk usage~~ — acceptable; cleanup verified.
2. ~~Plan-iter cap~~ — approve-with-deferred only after round 5, no Highs deferable.
3. ~~Stub-thin vs stub-fat~~ — Phase 9 explicit per-file mappings, others thin.
4. ~~Cost telemetry pricing~~ — `scripts/loop/pricing.json`, `estimated: true`.
5. ~~Webhook channel~~ — generic JSON payload.
6. ~~Worktree fallback~~ — keep `LOOP_WORKTREE_MODE=shared` for one cycle, then remove (round-2 L: "only if it actually works; otherwise fail fast" — interpreted as: keep for one cycle to prove out, then remove).
7. ~~Stub-before-or-after harden~~ — stub AFTER Items 2–7.
8. ~~Deferred list completeness~~ — pulled in I-2/I-3/I-7.

### Round-2 L answers also incorporated

- Single global lock fine for v1 (no per-path locks yet).
- `LOCK_TIMEOUT=300s` fine if stale handling robust — done in round-2 lock revision.
- Terminal-state read source is integration — already documented; reaffirmed.
- `web/package.json` slice-owned only if listed in `Changed files expected` — done in round-2 conflict policy.
- Cheap gates every merge + heavy at boundary — already in Item 10; reaffirmed.
- Cost validation as later slice or checklist item — captured in §9 below as `X-cost-telemetry-validation`.
- Fail-fast on `LOOP_WORKTREE_MODE=shared` if it doesn't work — added to §8 risk #1 mitigation.
- No-op mirror + no transition counts as failure — already encoded; reaffirmed.

### Resolved by Codex round-3 audit (3 High + 4 Medium + 6 L-answers)

| Round-3 finding | How resolved |
|---|---|
| H-1: ensure_slice_worktree called outside lock | Single call, under `with_repo_lock`, via `_ensure_slice_worktree_to_file` helper that writes path to a temp file the unlocked caller reads. Prior pattern's outside-then-inside double call eliminated. |
| H-2: regression rollback won't make runner see blocked | After `git reset --hard ORIG_HEAD`, merger now ALSO commits a `[regression-revert]` integration-side flip of slice file to `status: blocked`. Runner's next tick sees blocked instead of re-attempting the bad merge. |
| H-3: repair-agent semantics contradictory | Two-mode dispatcher: slice-state-only repair → slice worktree + mirror; loop-infrastructure repair → main worktree under lock. Resolved per Codex vote. |
| M-4: lock dir should use git common-dir | `LOCK_DIR="$(git -C "$LOOP_MAIN_WORKTREE" rev-parse --git-common-dir)/openf1-loop.lock"` — handles `.git`-as-file (worktrees, submodules, relocated git-dir). |
| M-5: conflict allow-list parsing fragile | Strict format requirement: each `Changed files expected` bullet must start with backticked path. `path_in_changed_files_expected()` parser rejects globs, plain text, notes-only bullets. |
| M-6: CI verification accepts in-progress | Procedure now polls until `status == completed`, requires `conclusion == success`. 30-min budget; in-progress counts as PENDING, not pass. |
| M-7: smoke-run ordering muddy | Day 3 stubs ONE smoke slice (`02-prompt-static-prefix-split`); Day 4 mass-stubs the rest. Catches format bugs on a single slice instead of all 71. |

### Round-3 L-answers incorporated

- Cost validation: explicit later slice, placed after Phase 2 has accumulated dispatches (NOT after Phase 1 — Phase 1 is already done with old pricing). Stub as `02-cost-telemetry-validation` after a few Phase-2 dispatches accumulate.
- Repo lock at git common-dir, unique name → confirmed in M-4.
- `02-prompt-static-prefix-split` confirmed as smoke slice → encoded in §5 Day 3.
- No backfill of old ledger rows; document the flip date and leave history intact.
- `ensure_slice_worktree` race resolved by H-1's single-locked-call fix.
- Stale round-2 appendix removed.

### Resolved by Codex round-4 audit (3 High + 3 Medium + L-answers)

| Round-4 finding | How resolved |
|---|---|
| H-1: lock not reentrant, but merger calls update_state.sh which also locks | Lock is now PID-reentrant. `acquire_repo_lock` checks if current PID already owns the lock; if so, just bumps `_REPO_LOCK_DEPTH`. `release_repo_lock` only actually unlocks when depth returns to 0. EXIT trap force-releases regardless. |
| H-2: regression handler manually releases lock owned by with_repo_lock | Removed the manual `release_repo_lock` call; handler returns rc=1 and the wrapper's existing release path handles cleanup. |
| H-3: loop-infra repair shouldn't auto-push without human gate | New approval-sentinel gate: loop-infra repairs commit LOCALLY only; push requires `diagnostic/slices/.approved-loop-infra-repair/<slice_id>` sentinel. Without sentinel, slice → blocked + USER ATTENTION with clear "to approve, touch X / to reject, reset" instructions. |
| M-4: LOCK_DIR may still be relative | Switched to `git -C ... rev-parse --path-format=absolute --git-common-dir`. Always returns absolute path regardless of caller's cwd. |
| M-5: conflict parser arg missing | `resolve_conflict` now passes `"$slice_file"` to `path_in_changed_files_expected`. Both callers updated. |
| M-6: regression transition not in merger allow-list | Merger's terminal-transition allow-list extended: `ready_to_merge → done OR blocked`. Regression's intentional `→ blocked` flip now passes the terminal-state success detector. |

### Round-4 L-answers incorporated

- `02-prompt-static-prefix-split` is fine for protocol smoke; **add a later DB/service smoke at the first Phase-3 slice** before its full execution. Captured in §5 sequencing.
- Regression push race closed for loop-owned pushes while lock held; external pushes may still race. Push retry/failure behavior in `mirror_helper` and merger explicit; documented.
- `02-cost-telemetry-validation` appended to Phase 2 (4 slices, not 3). Total slice count updated to **86 everywhere** (not 85). To be placed AFTER `02-cache-hit-assertion` so Phase-2 dispatches have produced telemetry.
- Stale appendix cleanup confirmed; only one `End of plan`.

### Resolved by Codex round-5 audit (3 High + 3 Medium + 4 L-answers)

| Round-5 finding | How resolved |
|---|---|
| H-1: lock should use BASHPID, not $$ | New `_lock_owner_pid` helper uses `BASHPID` (with `$$` fallback). Subshells get their own PID and won't falsely reenter parent's lock. |
| H-2: loop-infra approval flow leaves runner in unusable state | Lifecycle now explicit: TWO local commits (`[loop-infra-repair]` + `[loop-infra-pending]`), worktree clean. Approve = `touch sentinel` + restart → resume hook in runner.sh pushes both + flips slice. Reject = `git reset --hard origin/integration/perf-roadmap` + restart → drops both, slice back to pre-repair state. |
| H-3: repair mode auto-classified by diff after the fact | Mode classified BEFORE dispatch by parsing parent slice's audit verdict for protocol-fix keywords. Agent's prompt conditioned on `LOOP_REPAIR_MODE=slice-state\|loop-infra`. Post-step enforces mode (slice-state agent that touches `scripts/loop/*` → forced reset + slice blocked with "repair-mode-violation"). |
| M-4: regression push failure has no durable retry plan | New sentinel `scripts/loop/state/regression_pending_push` records the local HEAD hash. preconditions.sh checks this BEFORE worktree-clean check; on present, attempts `git pull --rebase + git push`; on 3 tick failures, circuit-break. Runner does NOT dispatch new slice work until sentinel cleared. |
| M-5: stale 85 references | All three remaining instances (lines 14, 43, 71) updated to 86 with explicit historical context (`72 of 86`, `+1 with 02-cost-telemetry-validation added in round-4`). |
| M-6: verification missing for repair approval/reject paths | Verification §7 adds steps 16 (no-sentinel path), 17 (approval path), 18 (rejection path), 19 (repair-mode-violation), 20 (regression-pending-push sentinel). 20 verification checks total. |

### Round-5 L-answers incorporated

- Phase-3 smoke pair confirmed.
- `.approved-loop-infra-repair/` directory kept separate from `.approved/`, `.approved-merge/` — explicit-is-better for a dangerous path.
- No backfill of old estimated ledger rows.
- `02-cost-telemetry-validation` in Phase 2; all count references updated.

### Resolved by Codex round-6 audit (2 High + 3 Medium + 4 L-answers)

| Round-6 finding | How resolved |
|---|---|
| H-1: approval flow can deadlock against preconditions | Resume hook ordering made explicit: runs BEFORE `preconditions.sh`, BEFORE worktree-clean / branch-ahead checks. Tolerates ahead-of-origin state and sentinel-file existence. New runner.sh startup pseudocode in §4 Item 2. |
| H-2: rejection needs first-class command | New `scripts/loop/reject_loop_infra_repair.sh <slice_id>` script: verifies branch is integration, distance is exactly 2, HEAD/HEAD~1 tags match slice id; refuses to reset otherwise. Replaces raw `git reset --hard` instruction in slice file. |
| M-3: mode classification keyword-based | Now action-item-based: `classify_repair_mode` parses ONLY unchecked items in High/Medium of the latest audit verdict. Notes, quotes, `- [x]` resolved items, and prose discussion are explicitly ignored. |
| M-4: `slice_helpers.sh` undefined | Added to "Code being added" list in §6. Exports `flip_slice_status`, `append_slice_section`, `extract_latest_audit_verdict_text`, `classify_repair_mode`. |
| M-5: bash version implicit | `repo_lock.sh` defensively asserts bash 4+ at source time. `preconditions.sh` checks bash 4+ at runner startup with clear failure message. Round-6 verification step 24 covers it. |

### Round-6 L-answers incorporated

- Phase-3 smoke pair confirmed.
- `.approved-loop-infra-repair/` separate dir confirmed.
- Child-crash depth-counter behavior with `BASHPID`: round-5 H-1 fix already addresses (depth counter is per-shell; child crashes don't corrupt parent counter).
- 86-count is settled; remaining "85" mentions are intentional historical context.

### Resolved by Codex round-7 audit (2 High + 3 Medium + 3 L-answers)

| Round-7 finding | How resolved |
|---|---|
| H-1: dispatch flow re-introduces broad keyword grep | Removed. Dispatch flow now calls `classify_repair_mode` (from `slice_helpers.sh`) directly. The old `parent_verdict | grep` logic is gone. |
| H-2: post-flip push failure has no durable retry | Sentinel is now retained until BOTH the initial push AND the post-flip push succeed. Resume hook is also idempotent: detects existing `[loop-infra-resumed]` commit and skips re-creation. Sentinel removal happens only after final-push success. |
| M-3: `unchecked=$(grep ...)` aborts under set -e | Added `|| true` and explicit `[[ -n "$unchecked" ]]` guard. "No unchecked items" cleanly returns `slice-state`. |
| M-4: verification step 18 used raw git reset | Now uses `scripts/loop/reject_loop_infra_repair.sh` and includes 3 negative-test invocations (wrong slice id, wrong branch, wrong distance). |
| M-5: verification step 16 audit verdict "mentions" was ambiguous | Now requires the verdict to have an UNCHECKED High/Medium action item explicitly naming the file. The Note section may also mention but classification must come from the actionable item. |

### Round-7 L-answers incorporated

- Concurrent runner instances: confirmed lock fail-safe is sufficient. (Could add PID guard later for better failure mode; not blocking.)
- Mode classification false negatives: confirmed over-blocking is acceptable; post-step violation path is the right backstop.
- Reject-after-push: implemented. `reject_loop_infra_repair.sh` now `git fetch`es and refuses if `origin/integration/perf-roadmap` already contains the `[loop-infra-pending]` commit for this slice. Prints a `git revert`-based recovery flow instead.

### Resolved by Codex round-8 audit (2 High + 2 Medium + 1 Low + 3 L-answers)

| Round-8 finding | How resolved |
|---|---|
| H-1: resume scan only finds local-only pending commits | Resume hook now scans `diagnostic/slices/.approved-loop-infra-repair/*` sentinels DIRECTLY, not local commits. Sentinels are the durable retry marker. Local commit state (pending vs resumed) is just an idempotency hint INSIDE `_do_resume_loop_infra`. Stale sentinels (no local-only commits, all pushes landed) are auto-removed. |
| H-2: `diff_files` undefined in loop-infra branch under set -u | Added explicit local computation inside the `loop-infra)` case branch via `git diff --name-only HEAD~1 HEAD`. Variable now has a value before `append_slice_section` references it. |
| M-3: reject script `git fetch` failure not fail-closed | Reject script now exits 2 by default if `git fetch` fails. Override via `--offline-local-only` flag with explicit warning. Stale origin view no longer silently proceeds. |
| M-4: verification missing partial-resume-failure scenario | Added verification step 26: first push succeeds, second push fails, sentinel retained, restart finds work via sentinel scan, idempotency detects existing `[loop-infra-resumed]` commit, finishes the resume cleanly. Step 27 covers reject script offline behavior. |
| L-5: prose ordering wrong | Updated `runner.sh` startup pseudocode comment AND verification step 17 to reflect: push original commits → commit slice-status flip → push resumed commit → THEN remove sentinel (sentinel removal is last). |

### Round-8 L-answers / open-question resolutions

- Simultaneous runner starts: confirmed safe once H-1 sentinel-driven scan is in place.
- `flip_slice_status` atomicity: confirmed — single sed call updates both `status:` and `owner:` lines, followed by one git commit. No intermediate state visible.
- `git fetch` failure: confirmed fail-closed with explicit override (M-3 fix).

### Resolved by Codex round-9 audit (1 High + 2 Medium + 3 L-answers)

| Round-9 finding | How resolved |
|---|---|
| H-1: stale-sentinel rule misses crash-before-resumed state | Sentinel scan now checks for pending/resumed commits in BOTH local-only AND origin. Stronger stale rule: only remove if (no commits anywhere) AND (slice not in `blocked` repair-pending state). `_do_resume_loop_infra` adds three idempotency sub-states: resumed-on-origin (cleanup only), resumed-local (retry final push), nothing-yet (skip-push-if-pending-already-on-origin then create resumed). |
| M-2: reject-after-push uses commit-message grep over all of origin | Now uses HEAD's actual SHA + `git merge-base --is-ancestor HEAD origin/integration/perf-roadmap`. Won't false-match historical pushed-and-reverted attempts for the same slice. Recovery instructions also use HEAD/HEAD~1 SHAs directly instead of re-greping origin. |
| M-3: verification 26 missing crash-before-resumed case | Step 26 is now 26a (failure AFTER resumed commit exists locally) + 26b (crash BEFORE resumed commit exists; only origin has pending). Both must pass. |

### Round-9 L-answers incorporated

- Preemptive sentinel guard: stronger rule applied. If sentinel exists and origin has pending repair state, resume it. If sentinel exists with no repair state anywhere AND slice is NOT blocked, remove as stale. If sentinel exists with no repair state anywhere AND slice IS blocked, preserve (user pre-approved a future repair).
- Offline reject + sentinel composition: SHA-based check (M-2 fix) ensures the rejection is symmetric with the resume hook's anywhere-scan.
- Smoke scope: step 26 with both crash sub-cases (a + b) is sufficient; no need for separate unit-style synthesis.

### Resolved by Codex round-10 audit (1 High + 2 Medium + 1 Low + 3 L-answers)

| Round-10 finding | How resolved |
|---|---|
| H-1: resume path uses slice-only message greps over all origin history | Every state marker (sentinel filename, `[loop-infra-repair]` commit, `[loop-infra-pending]` commit, `[loop-infra-resumed]` commit) now carries an `[attempt:N]` tag matching the slice's `repair_count_<id>`. All resume-decision greps include the attempt tag, so historical reverted attempts cannot false-match. Sentinel filename pattern: `<slice_id>__attempt-<N>`. |
| M-2: `Resume-as:` should be dispatcher-injected, not agent-authored | Dispatcher amends the agent's `[loop-infra-repair]` commit after the agent runs to inject the deterministic format: `[loop-infra-repair][slice:X][attempt:N] <summary>` body + `Resume-as: revising_plan|revising` trailer. `_do_resume_loop_infra` FAILS (sentinel retained) if the trailer is missing or has an invalid value — no silent default. Verification 26 includes a `Resume-as: revising` sub-case. |
| M-3: kill-point precision in step 26 | New env var `LOOP_TEST_INJECT_FAULT` with two named fault sites: `after_initial_push_before_resumed_commit` and `after_resumed_commit_before_final_push`. Step 26a + 26b each use a specific value for reproducible recovery testing. |
| L-4: resume scan `git fetch ... || true` made stale decisions silently | Resume scan now FAILS the sentinel-decision branch if `git fetch` fails — preserves the sentinel and continues to next slice/runner-start. No stale/cleanup decisions made from an unverified origin view. |

### Round-10 L-answers + open-question resolutions

- `pending_on_origin` false positives: resolved via `[attempt:N]` tags throughout (H-1).
- `Resume-as:` fragility: resolved by dispatcher-injection (M-2).
- 26b kill-point precision: resolved by `LOOP_TEST_INJECT_FAULT` env var (M-3).

### Resolved by Codex round-11 audit (1 High + 3 Medium + 2 L-answers)

| Round-11 finding | How resolved |
|---|---|
| H-1: sentinel filename parsing bug — `slice_id="$fname"` left the `__attempt-N` suffix on slice_id, so all downstream greps for `[slice:...]` would never match | Resume hook now strips the suffix: `slice_id="${sentinel_basename%__attempt-*}"`; `attempt_n="${sentinel_basename##*__attempt-}"`; numeric validation rejects malformed names with a logged skip. See §4 Item 2 for the new for-sentinel-loop body. |
| M-2: `LOOP_TEST_INJECT_FAULT` injection blocks were missing from the implementation pseudocode (only mentioned in verification) | Two explicit `if [[ ${LOOP_TEST_MODE:-0} == 1 && ${LOOP_TEST_INJECT_FAULT:-} == ... ]]; exit 137; fi` blocks now appear inside `_do_resume_loop_infra` at the named fault sites: after the initial push (before `[loop-infra-resumed]` commit) and after the resumed commit (before final push). |
| M-3: duplicate/stale older 26a/26b verification block | Removed. Step 26 now has exactly one authoritative pair (26a + 26b) using the `LOOP_TEST_INJECT_FAULT` env var, plus the `Resume-as: revising` sub-case + a `LOOP_TEST_MODE=1` prerequisite note. |
| M-4: approval prose `HEAD [loop-infra-repair]` / `HEAD~? [loop-infra-pending]` ordering wrong — pending is committed AFTER the dispatcher amends the repair commit, so HEAD is pending | Prose now reads `HEAD [loop-infra-pending]...` / `HEAD~1 [loop-infra-repair]...` with explicit note about the commit order. |
| L-answer: gate `LOOP_TEST_INJECT_FAULT` behind `LOOP_TEST_MODE=1` | Both fault-injection blocks now require `LOOP_TEST_MODE=1` AND the matching `LOOP_TEST_INJECT_FAULT` value. Production env (without `LOOP_TEST_MODE`) treats the var as dead code. |
| L-answer: merger should clean up stale attempt-N sentinels on slice merge | New `cleanup_slice_state <slice_id>` helper in `worktree_helpers.sh` removes `repair_count_<id>` + `plan_iter_count_<id>` + `fail_count_<id>` AND globs `.approved-loop-infra-repair/<slice_id>__attempt-*`. Wired into the merger flow after `cleanup_slice_worktree`. New verification step 28 covers this. |

### Round-11 L-answer + open-question resolutions

- Attempt-tag plumbing sync (round-11 §9 Q1): confirmed — dispatcher writes the attempt-N sentinel filename when creating it; resume hook reads it back. The state file `repair_count_<id>` is the single source of truth read by both paths at their respective moments. No further change needed.
- Stale sentinel cleanup on merge (round-11 §9 Q2): added `cleanup_slice_state` to merger flow.
- `LOOP_TEST_MODE=1` gate (round-11 §9 Q3): added; production env cannot accidentally fault-inject.

### Remaining open for Codex round 12

1. **Final pass on the integrated recipe.** All round-11 items are surgical fixes (parse bug, prose ordering, fault-injection wiring, merger cleanup). After round-11 fixes land, request a final read-through to confirm nothing else regressed during the surface-level edits. Particularly: did removing the duplicate 26a/26b block leave any cross-references (e.g. §9 round-9/10 entries that pointed at the old text) stale? My read: cross-refs all reference the verification step number (`26a`, `26b`), not the prose, so they remain valid. Confirm?

2. **Smoke / verification step 28.** Step 28 (merger sentinel cleanup, round-11 L) is new and depends on a slice that has actually completed a loop-infra-repair cycle. Practically this means stage 28 cannot be run until at least one such cycle has occurred — likely Day 3 of the kickoff. Acceptable to run step 28 as a post-kickoff check (recorded as a verification action with synthetic input) rather than gating the whole pre-kickoff run on synthesizing a multi-attempt repair? My read: yes, verification 28 can be a synthetic test using `touch` to fake the sentinels + a manual `cleanup_slice_state` invocation; no need to drive it through a real repair cycle.

3. **Final approval bar.** Are there any remaining concerns Codex would want addressed before APPROVED-for-implementation? If round-12 returns clean, I'll begin implementing the actual scripts (Item 2 first per §5 sequencing) and stub Phase 9 with explicit per-file mappings.

### Resolved by Codex round-1 audit
1. ~~Worktree disk usage~~ — **Acceptable** if cleanup/prune verified. Verification step 11 added.
2. ~~Plan-iter cap policy~~ — **Approve-with-deferred only after round 5, never with High items.** Encoded in Item 3.
3. ~~Stub-thin vs stub-fat~~ — **Phase 9 stubs use explicit per-file mappings; other phases use thin stubs.** Encoded in Item 8.
4. ~~Cost telemetry pricing~~ — **`scripts/loop/pricing.json`, env-overridable, all rows tagged `estimated: true` until validated.** Encoded in Item 9.
5. ~~Webhook channel~~ — **Generic JSON payload to `LOOP_NOTIFY_WEBHOOK`.** Encoded in Item 11.
6. ~~Worktree fallback~~ — **Keep `LOOP_WORKTREE_MODE=shared` for one stable run, then remove or mark emergency-only.** Captured in §8 risk #1 mitigation.
7. ~~Stub-before-or-after harden~~ — **Stub AFTER Items 2–7 land.** Encoded in §5 sequencing.
8. ~~Deferred list completeness~~ — Codex pulled I-7 (now C-7), I-2 (now C-8), I-3 (now Item 10 minimal version) into pre-run scope.

### Remaining open for Codex round 2

1. **Repo-lock granularity.** Single global lock covers all mutating operations. Is that too coarse? Phase 9's 21 refactor slices could in principle run in parallel if they don't touch overlapping files, but the lock serializes them. Worth a per-slice or per-path lock instead? My read: stay single-global for v1, revisit if Phase 9 wall-clock becomes painful.

2. **Lock timeout default.** `LOCK_TIMEOUT=300s`. Long enough for a Codex audit to complete its repo-mutating section (currently <30s) but not so long that a wedged process holds up the whole loop. Codex thoughts?

3. **Terminal-state validation source-of-truth.** I'm reading the slice file from integration's worktree to validate the new status. But for plan-audit and plan-revise, the agent only ever edits integration directly (no slice branch). For impl audit, the agent edits on the slice branch and we mirror. The validation logic in `dispatch_with_guards` reads integration. Is that the right read for both phases? My read: yes, because the runner's selector reads from integration regardless.

4. **Merger conflict policy — what about `package.json` / `package-lock.json` / `tsconfig.json`?** These are technically slice-owned (the slice may have updated deps) but technically also touched by Item 9 (cost telemetry config in `pricing.json` lives in `scripts/loop/`, separate). The `web/` rule covers package.json since it's `web/package.json`. Confirm this is fine?

5. **Regression gate model — phase-boundary only or every merge?** Current Item 10 design: cheap gates every merge, full gates at phase boundary. Codex thoughts on this trade-off? Worried about cost of full gates (typecheck + test + build = ~30s/run × 71 slices = ~35 min added wall-clock).

6. **Cost-estimate validation procedure.** Item 9 says `estimated: true` until "validated against billing console totals within 5%." Should I write that as an explicit slice (`X-cost-telemetry-validation`) post-Phase-1 once we have ~10 slices of data, or just leave it manual?

7. **Should `LOOP_WORKTREE_MODE=shared` actually function** (i.e. preserve all the old code paths), or be a fail-fast "this mode is removed, exit"? Latter is simpler but eliminates the fallback.

8. **One concern in Item 5 (mirror) the audit didn't surface:** if the slice branch's slice-file content is *identical* to integration's already (e.g. agent did nothing), the mirror is a no-op and we return success. But that's also indistinguishable from "agent crashed before doing anything." Both produce no transition. Item 4's terminal-state check catches this — it'd see no transition and increment fail counter. Confirming this is the right behavior?

---

## 10. What "ready to kick off" means

A single command runs unattended for 2–4 days, processes Phases 2–12 (71 slices), and produces:

- `diagnostic/_state.md` showing all 86 slices done.
- A series of `[state-update]` commits on integration after each merge.
- Phase-by-phase perf baselines under `diagnostic/artifacts/perf/`.
- Phase 11 quality cleanup baseline under `diagnostic/artifacts/healthcheck/` showing semantic-conformance ≥ 40 A/B out of 50.
- A loop-history report (`scripts/loop/loop_history.sh`) summarizing per-slice cost, plan-iter rounds, repair attempts.
- A clean `git log` showing the merge story.

Webhook events fire on every blocked / repaired / phase-boundary state for visibility. If the loop hits a circuit breaker, I get pinged and can intervene; otherwise it runs to completion.

---

## 11. Codex round-12 audit ask

This is round-12 (round-11 returned 1 High + 3 Medium + 2 L-answers; all addressed):

| Round-11 finding | How resolved |
|---|---|
| H-1: sentinel filename parse bug — `slice_id` retained the `__attempt-N` suffix, so all downstream `[slice:...]` greps would never match | Resume hook strips the suffix: `slice_id="${sentinel_basename%__attempt-*}"`; `attempt_n="${sentinel_basename##*__attempt-}"`; numeric validation rejects malformed names. |
| M-2: `LOOP_TEST_INJECT_FAULT` blocks missing from implementation pseudocode | Two explicit `if [[ ${LOOP_TEST_MODE:-0} == 1 && ${LOOP_TEST_INJECT_FAULT:-} == ... ]]; exit 137; fi` blocks added inside `_do_resume_loop_infra` at the named fault sites. |
| M-3: duplicate/stale older 26a/26b verification block | Removed. Step 26 now has exactly one authoritative pair using the env var. |
| M-4: approval prose HEAD/HEAD~1 order wrong | Now reads `HEAD [loop-infra-pending]` / `HEAD~1 [loop-infra-repair]` with explicit note about commit order. |
| L: gate fault-injection behind `LOOP_TEST_MODE=1` | Both injection blocks require `LOOP_TEST_MODE=1` AND matching `LOOP_TEST_INJECT_FAULT` value. |
| L: merger should clean up stale attempt sentinels on slice merge | New `cleanup_slice_state` helper purges per-slice repair/plan-iter/fail counters AND globs `.approved-loop-infra-repair/<slice_id>__attempt-*`. Wired into merger flow. New verification step 28. |

L-answers all applied:
- `LOOP_TEST_MODE=1` defense-in-depth gate
- Merger cleanup of stale attempt-N sentinels (verification step 28)

Round-12 review please:
- Round-11 fixes in §4 (sentinel parse, fault-injection blocks in pseudocode, prose ordering, `cleanup_slice_state`)
- Verification step 26 (now single authoritative 26a + 26b + Resume-as: revising sub-case + LOOP_TEST_MODE prerequisite)
- New verification step 28 (merger sentinel cleanup)
- Round-12 open questions in §9 (cross-reference cleanliness, step-28 timing, final approval bar)

Triage as `High` / `Medium` / `Low`. Approving this round means implementation kicks off.

---

End of plan.
