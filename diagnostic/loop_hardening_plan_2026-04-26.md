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

### Item 2 — C-3 + repo-level mutation lock (revised post-audit)

**Files to modify:**
- `scripts/loop/dispatch_claude.sh`
- `scripts/loop/dispatch_codex.sh`
- `scripts/loop/dispatch_repair.sh`
- `scripts/loop/dispatch_plan_revise.sh`
- `scripts/loop/runner.sh` (preconditions check needs to know worktree paths)
- `scripts/loop/dispatch_merger.sh` (clean up worktree after merge; lock around merge+push+state-update)
- `scripts/loop/update_state.sh` (lock around state-update commit+push)
- New file: `scripts/loop/worktree_helpers.sh`
- New file: `scripts/loop/repo_lock.sh` (the lock primitive)

**Repo lock (mkdir-based, portable across macOS/Linux without `flock`):**
```bash
# scripts/loop/repo_lock.sh
LOCK_DIR=".git/openf1-loop.lock"
LOCK_TIMEOUT="${LOOP_LOCK_TIMEOUT:-300}"   # seconds
LOCK_POLL="${LOOP_LOCK_POLL:-1}"

acquire_repo_lock() {
  local owner="$1"
  local started elapsed
  started=$(date +%s)
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    elapsed=$(( $(date +%s) - started ))
    if [[ $elapsed -ge $LOCK_TIMEOUT ]]; then
      # Stale-lock detection: if owner pid is dead, force release
      if [[ -f "$LOCK_DIR/owner" ]] && ! kill -0 "$(cat "$LOCK_DIR/pid" 2>/dev/null)" 2>/dev/null; then
        echo "force-releasing stale lock from $(cat "$LOCK_DIR/owner")" >&2
        rm -rf "$LOCK_DIR"
        continue
      fi
      echo "lock timeout: held by $(cat "$LOCK_DIR/owner" 2>/dev/null)" >&2
      return 1
    fi
    sleep "$LOCK_POLL"
  done
  echo "$owner" > "$LOCK_DIR/owner"
  echo "$$"     > "$LOCK_DIR/pid"
  trap 'release_repo_lock' EXIT
  return 0
}

release_repo_lock() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  trap - EXIT
}

with_repo_lock() {
  local owner="$1"; shift
  acquire_repo_lock "$owner" || return 1
  "$@"
  local rc=$?
  release_repo_lock
  return $rc
}
```

**Worktree pattern (with lock around mutations):**
```bash
WORKTREE_BASE="${LOOP_WORKTREE_BASE:-$HOME/.openf1-loop-worktrees}"
slice_worktree="$WORKTREE_BASE/$slice_id"

# Create worktree under lock (mutates .git/worktrees and creates a branch)
if [[ ! -d "$slice_worktree" ]]; then
  with_repo_lock "dispatch_claude:$slice_id:worktree-add" \
    git worktree add "$slice_worktree" -b "slice/$slice_id" integration/perf-roadmap
fi

# Run agent in worktree (NO lock — agent can read/edit/commit-on-its-own-branch freely)
( cd "$slice_worktree" && claude --print ... )

# Mirror, push, cleanup happen under lock
with_repo_lock "dispatch_claude:$slice_id:post-dispatch" do_post_dispatch_steps "$slice_id"

# Worktree cleanup at merge time
with_repo_lock "merger:$slice_id:cleanup" \
  git worktree remove "$slice_worktree" --force
```

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
      [[ "$after" == "done" ]] ;;
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

### Item 5 — C-6 (deterministic mirror step, full pattern post-audit)

**Files to modify:**
- `scripts/loop/dispatch_codex.sh` — add post-step after `codex exec` returns
- `scripts/loop/dispatch_slice_audit.sh` — same post-step (plan-audit also mirrors)
- `scripts/loop/dispatch_plan_revise.sh` — same post-step (plan-revise also mirrors)
- `scripts/loop/prompts/codex_auditor.md` — remove mirror instructions
- `scripts/loop/prompts/codex_slice_auditor.md` — remove mirror instructions
- `scripts/loop/prompts/claude_plan_reviser.md` — remove mirror instructions
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

  # 1. Ensure runner is on integration and synced.
  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$current_branch" != "integration/perf-roadmap" ]]; then
    git checkout integration/perf-roadmap || return 1
  fi
  git pull --ff-only origin integration/perf-roadmap 2>/dev/null || true

  # 2. Does the slice branch even exist? (Plan-audit may not create one.)
  if ! git rev-parse --verify "$slice_branch" >/dev/null 2>&1; then
    # No slice branch yet (plan-audit / plan-revise often only edit on integration).
    # Already on integration, so nothing to mirror.
    return 0
  fi

  # 3. Read the slice's slice-file version from the slice branch.
  local slice_branch_content
  slice_branch_content=$(git show "${slice_branch}:${slice_path}" 2>/dev/null) || return 0

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

### Item 6 — C-7 (auto-merger conflict policy, hardened pre-run)

**Files to modify:**
- `scripts/loop/dispatch_merger.sh`

**Pattern:** the existing conflict resolver currently auto-takes the slice branch's version for `web/*` and the slice file, bails on everything else. New policy uses two explicit allow-lists:

```bash
# Paths the slice is *expected* to modify — auto-take slice branch's version.
SLICE_OWNED_PATHS=(
  "web/"
  "sql/"
  "src/"
  "diagnostic/artifacts/"
  "diagnostic/slices/${slice_id}.md"
)

# Paths the slice should NEVER modify — auto-take integration's version.
INTEGRATION_OWNED_PATHS=(
  "scripts/loop/"
  "scripts/loop/prompts/"
  "diagnostic/_state.md"
  "diagnostic/_index.md"
  "diagnostic/slices/_index.md"
  ".github/"
  ".gitignore"
)

# Decision tree per conflicted path:
#   - matches SLICE_OWNED_PATHS prefix → git checkout --theirs
#   - matches INTEGRATION_OWNED_PATHS prefix → git checkout --ours
#   - matches neither → BLOCK (status=blocked, owner=user)
```

After all conflicts processed:
- If any path was in INTEGRATION_OWNED set, log it loudly — the slice tried to touch loop infrastructure, which is a protocol violation worth surfacing in the audit verdict next round.
- If any path matched neither list, abort the merge, set the slice's `status: blocked, owner: user`, append a "Merger escalation" section to the slice file with the conflict list. Push the abort. Exit 1.

**Why this matters now:** Phase 3 slices touch `sql/*` (matview definitions), Phase 9 touches `src/*` (refactored TS modules). The current merger would bail on these and surface USER ATTENTION on every Phase 3 / 9 slice merge. The hardened policy auto-resolves the expected paths and only escalates the genuinely ambiguous cases.

### Item 7 — C-8 (CI verification before kickoff)

**Files / actions:**
- One-time pre-flight check, no script changes needed
- Verify GitHub Actions workflow at `.github/workflows/ci.yml` actually fires

**Procedure:**
```bash
# Make a trivial change that touches no app code
echo "" >> diagnostic/_state.md
git add diagnostic/_state.md
git commit -m "ci: trigger workflow verification [no-op]"
git push

# Wait ~30s for the workflow to register
sleep 30

# Confirm a run was triggered for this commit
gh run list --branch integration/perf-roadmap --limit 1 \
  --json status,conclusion,event,headSha \
  | python3 -c "
import json, sys
runs = json.load(sys.stdin)
if not runs: print('FAIL: no run registered'); sys.exit(1)
r = runs[0]
print(f'status={r[\"status\"]}, conclusion={r.get(\"conclusion\") or \"in-progress\"}, sha={r[\"headSha\"][:8]}')
sys.exit(0 if r['status'] != 'completed' or r.get('conclusion') == 'success' else 1)
"
```

If the workflow doesn't fire, fix `.github/workflows/ci.yml` (likely a trigger-paths issue) before kickoff.

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

### Item 10 — I-3-min (minimal post-merge regression gate)

**Files to modify:**
- `scripts/loop/dispatch_merger.sh` — add `run_regression_gate` step before `update_state.sh`

**Gates per merge (all must exit 0 or merger sets `REGRESSION` event and exits 1):**
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

**Phase-boundary detection:** use `loop_status.sh` to count `done` slices in the just-merged slice's phase; if equal to phase total, run boundary gate.

**On regression detection:**
- Log `REGRESSION` event (caught by webhook in Item 11).
- Set the just-merged slice's `status: blocked, owner: user` and append a "Regression detected" note.
- Exit 1; runner trips circuit breaker on next tick.

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

**Day 3 — slice authoring:**
9. Item 1 (span fix) — kicked off as a slice through the now-hardened loop.
10. Item 8 (stub 71 slices) — done last so we validate hardening on early Phase-2 slices first.

**Realistic wall-clock for full prep:** 2.5 days if focused.

**Why stub-after-harden (per Codex Q8 final answer):** if I stub all 71 first and then a hardening fix proves to need a slice-file format change, I rewrite 71 files. Stubbing after means I validate the format on early Phase-2 slices first, then mass-stub when stable.

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
- `scripts/loop/repo_lock.sh` — mkdir-based portable lock primitive
- `scripts/loop/worktree_helpers.sh` — worktree create/cleanup helpers
- `scripts/loop/state_transitions.sh` — terminal-state allow-list per dispatch type
- `scripts/loop/mirror_helper.sh` — deterministic mirror with lock + validation + retry
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
9. **Slice file count:** `find diagnostic/slices -name '*.md' -not -name '_*' | wc -l` should be 85.
10. **`loop_status.sh`:** zero `MISSING` rows; all 85 slices show a real status.
11. **Repo lock under merger:** trigger a manual merge while the runner is mid-dispatch. Verify the merger waits, neither corrupts state.
12. **Cost telemetry shape:** dispatch one slice, verify `cost_ledger.jsonl` has a row with `model`, `source: "session-log-parse"`, real (or 0) `cost_usd`, and `estimated: true`.
13. **Webhook:** trigger a `CIRCUIT BREAKER` synthetically with `LOOP_NOTIFY_WEBHOOK=https://webhook.site/...` set; verify a JSON payload arrives with `event`, `slice_id`, `commit`, `message`.
14. **Regression gate at phase boundary:** synthesize a Phase-2 last-slice merge where `npm run typecheck` would fail. Verify merger logs `REGRESSION` event, sets slice to `blocked`, exits 1.
15. **Smoke run:** kick off the runner in real mode against a single Phase-2 slice; verify plan-audit → implement → audit → merge → state-update cleanly with all locks acquired and released.

After all 15 verifications pass, the loop is ready for end-to-end kickoff.

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

## 9. Codex round-1 audit answers + remaining open questions

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

- `diagnostic/_state.md` showing all 85 slices done.
- A series of `[state-update]` commits on integration after each merge.
- Phase-by-phase perf baselines under `diagnostic/artifacts/perf/`.
- Phase 11 quality cleanup baseline under `diagnostic/artifacts/healthcheck/` showing semantic-conformance ≥ 40 A/B out of 50.
- A loop-history report (`scripts/loop/loop_history.sh`) summarizing per-slice cost, plan-iter rounds, repair attempts.
- A clean `git log` showing the merge story.

Webhook events fire on every blocked / repaired / phase-boundary state for visibility. If the loop hits a circuit breaker, I get pinged and can intervene; otherwise it runs to completion.

---

## 11. Codex round-2 audit ask

This is the round-2 revision. Codex round-1 returned 4 High + 3 Medium + 6 Low/Answers items; all addressed:

| Codex round-1 item | How resolved |
|---|---|
| H-1: worktree needs repo-level lock | Item 2 now includes `repo_lock.sh` mkdir-based primitive + explicit `with_repo_lock` wrapping all mutations (§4 Item 2 recipe) |
| H-2: status-based detection too broad | Item 4 now uses terminal-state allow-list per dispatch type, rejects `in_progress` and unmirrored transitions (§4 Item 4 recipe) |
| H-3: mirror not deterministic enough | Item 5 now: explicit checkout/pull, lock acquisition, terminal-state validation, push-fail retry (§4 Item 5 recipe) |
| H-4: deferring auto-merger conflict policy breaks unattended goal | Pulled in as new Item 6 (C-7); explicit allow-lists for slice-owned + integration-owned paths, block on neither (§4 Item 6 recipe) |
| M-5: CI verification should be pre-run | Pulled in as new Item 7 (C-8); one-push trigger + `gh run list` confirmation (§4 Item 7 recipe) |
| M-6: cost telemetry should be config-driven + best-effort | Item 9: `scripts/loop/pricing.json`, env-overridable, all rows `estimated: true` until validated (§4 Item 9 recipe) |
| M-7: regression gate needs minimal version | Pulled in as new Item 10; cheap every-merge gates + boundary-only heavy gates (§4 Item 10 recipe) |
| L-answers: worktree disk, deferral policy, stub mapping, webhook generic, fallback retention, sequencing | All applied to §3 / §5 / §9 |

Round-2 review please:
- Recipes in §4 — especially the lock pattern, terminal-state allow-list, mirror retry logic, merger conflict policy
- Sequencing in §5 (Day 1 / 2 / 3 split)
- New verification items 3, 7, 11, 14 in §7 (lock contention, conflict policy, regression at phase boundary)
- Remaining open questions in §9 (repo-lock granularity, lock timeout, terminal-state read source, merger path coverage, regression gate model, cost validation, fallback function vs fail-fast, no-op mirror behavior)

Triage as `High` / `Medium` / `Low`. I'll resolve and re-submit until APPROVED before kicking off the run.

---

End of plan.
