# End-to-End Automation — Loop Runner Mechanism

**Date:** 2026-04-25
**Author:** Claude, for Codex review
**Companion to:** [execution_plan_2026-04_autonomous_loop.md](execution_plan_2026-04_autonomous_loop.md)
**Purpose:** the *execution plan* describes the control loop (Claude implements, Codex verifies, slice-file state machine). This doc specifies the *mechanism* — how to actually run that loop end-to-end with minimal human attention.

---

## 1. Architecture options, with recommendation

| Option | What it is | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Single-agent self-audit** | Claude does both implementation and audit in alternating prompts | Cheapest; one CLI | Loses independent-audit value; same model in both seats | Reject — defeats the purpose |
| **B. Local orchestrator + dual CLI** | Bash/TS script picks next slice, dispatches to Claude or Codex headlessly, advances state | Faithful to the plan; both agents are real; runs anywhere | More glue code; both CLIs must support headless mode | **Recommend** for v1 |
| **C. GitHub-Actions-driven** | Slice file commits trigger workflows that invoke the right agent | Fully cloud; nothing runs locally | Slower per cycle; CI minutes / API keys in CI; harder debug | Migrate to this once v1 is stable |
| **D. Hybrid** | Local orchestrator + GitHub for branch state | Best of B+C | Most moving parts at once | Defer until v1 is operational |

**Recommendation: build Option B first.** It runs on the user's machine, uses files-on-disk as the queue, and the same scripts will move cleanly into Option C later. Estimated effort: 1–2 days of orchestrator scripting before the loop can run unattended overnight.

---

## 2. The runtime model

```
                      ┌─────────────────────┐
                      │  scripts/loop/      │
                      │  runner.sh          │
                      │  (long-running)     │
                      └──────────┬──────────┘
                                 │ tick (every 30 s)
                                 ▼
                      ┌──────────────────────┐
                      │ select_next_slice.sh │
                      │ reads slice frontmatter
                      │ returns: { id, owner, status }
                      └──────────┬───────────┘
              ┌──────────────────┼─────────────────────┐
              ▼                  ▼                     ▼
     owner=claude         owner=codex          owner=user
     status=pending       status=awaiting_audit  status=blocked
              │                  │                     │
              ▼                  ▼                     ▼
     dispatch_claude.sh   dispatch_codex.sh    print + ring bell;
     (headless invoke)    (headless invoke)    sleep until next tick
              │                  │
              ▼                  ▼
       Claude works         Codex audits
       writes slice file    writes verdict
       sets owner=codex     PASS → owner=user (Phase 0) | codex (P1+)
                            REVISE → owner=claude
                            REJECT → owner=user
```

**Key invariants:**
- Slice frontmatter (`status`, `owner`) is the single source of truth.
- Either agent can crash mid-tick; the next tick recovers from disk state.
- Runner never modifies slice files itself — only dispatches the agents that do.
- Runner never makes git commits — agents do, with the `[slice:<id>][awaiting-audit|pass]` tag.
- Runner uses a `run_with_timeout` helper that prefers `timeout` / `gtimeout` and falls back to a `perl` alarm shim. **Stock macOS bash 3.2 has neither GNU coreutils command, so the perl shim is the active path on a fresh Mac**; document this in slice "Required services / env" if a slice depends on the timeout being exact.

---

## 3. Files to create

```
scripts/loop/
├── runner.sh                  # top-level long-running orchestrator
├── select_next_slice.sh       # parse slice frontmatter, return next actionable slice
├── dispatch_claude.sh         # headless Claude Code invocation
├── dispatch_codex.sh          # headless Codex CLI invocation (or fallback)
├── preconditions.sh           # clean worktree, env present, services running
├── prompts/
│   ├── claude_implementer.md  # static system prompt for Claude
│   └── codex_auditor.md       # static system prompt for Codex
└── state/
    ├── runner.log             # append-only event log
    └── runner.pid             # for stop/resume
```

All scripts go under `scripts/loop/` so the existing `scripts/init_db.sh` etc. remain untouched.

---

## 4. The runner loop, concrete

```bash
#!/usr/bin/env bash
# scripts/loop/runner.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

LOG=scripts/loop/state/runner.log
TICK=30   # seconds between ticks
MAX_SLICE_DURATION=3600  # one hour — abort the slice if exceeded
COST_BUDGET_USD=20       # daily soft cap

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }

while true; do
  if ! ./scripts/loop/preconditions.sh; then
    log "preconditions failed; sleeping"
    sleep "$TICK"; continue
  fi

  read -r slice_id owner status <<<"$(./scripts/loop/select_next_slice.sh)"
  if [[ -z "$slice_id" ]]; then
    log "no actionable slice; sleeping"
    sleep "$TICK"; continue
  fi

  log "tick: slice=$slice_id owner=$owner status=$status"

  case "$owner:$status" in
    claude:pending|claude:revising)
      run_with_timeout "$MAX_SLICE_DURATION" ./scripts/loop/dispatch_claude.sh "$slice_id" || log "claude timeout/fail $slice_id"
      ;;
    codex:awaiting_audit)
      run_with_timeout "$MAX_SLICE_DURATION" ./scripts/loop/dispatch_codex.sh "$slice_id" || log "codex timeout/fail $slice_id"
      ;;
    user:blocked|user:ready_to_merge)
      log "USER ATTENTION: slice=$slice_id status=$status"
      printf '\a'  # terminal bell
      sleep $((TICK * 4))
      ;;
  esac

  sleep "$TICK"
done
```

The runner is intentionally tiny. All the intelligence lives in the agents; the runner just routes.

---

## 5. Headless agent invocation

### 5.1 Claude (implementer)

Claude Code supports non-interactive mode via `claude --print`. The implementer dispatcher:

```bash
#!/usr/bin/env bash
# scripts/loop/dispatch_claude.sh
slice_id="$1"
slice_file="diagnostic/slices/${slice_id}.md"

claude --print \
  --append-system-prompt "$(cat scripts/loop/prompts/claude_implementer.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Bash,Grep,Glob" \
  <<EOF
You are the Claude implementation agent in the OpenF1 perf-roadmap loop.

The slice you are working is at: $slice_file

Read its frontmatter and 'Steps' section. Execute the slice end-to-end:
1. Verify status is 'pending' or 'revising'; if not, exit.
2. Update frontmatter: status=in_progress, owner=claude, updated=now.
3. Create branch slice/$slice_id from integration/perf-roadmap.
4. Execute the steps.
5. Run all gate commands listed in the slice file.
6. If all gates pass: fill 'Slice-completion note', set status=awaiting_audit, owner=codex.
7. Commit with message tag [slice:$slice_id][awaiting-audit].
8. Push branch.

Do not modify files outside 'Changed files expected'.
Do not advance to the next slice — that's the runner's job.
EOF
```

`--permission-mode acceptEdits` lets Claude write files without per-edit prompts. Keep `--allowedTools` tight to the slice's needs.

### 5.2 Codex (auditor)

OpenAI Codex CLI ships a non-interactive form (`codex exec` or equivalent). The auditor dispatcher follows the same shape:

```bash
#!/usr/bin/env bash
# scripts/loop/dispatch_codex.sh
# NOTE: the installed Codex CLI does NOT accept `--system`. Inject the static
# auditor prompt as the leading text of the user message via stdin instead.
# See scripts/loop/dispatch_codex.sh for the actual implementation.
slice_id="$1"
slice_file="diagnostic/slices/${slice_id}.md"

{
  cat scripts/loop/prompts/codex_auditor.md
  echo
  echo "---"
  cat <<EOF
You are the Codex audit agent in the OpenF1 perf-roadmap loop.

Slice file: $slice_file
Branch: slice/$slice_id

Audit steps:
1. Pull the branch.
2. Run every gate command in the slice's 'Gate commands' block; record exit codes.
3. Verify only files in 'Changed files expected' were modified ('git diff --name-only main').
4. Run each 'Acceptance criteria' check verbatim.
5. Write the 'Audit verdict' section: PASS, REVISE, or REJECT.
6. Update frontmatter:
   - PASS  → status=ready_to_merge, owner=user (Phase 0) or owner=codex (Phase 1+)
   - REVISE → status=revising, owner=claude
   - REJECT → status=blocked, owner=user
7. Commit with [slice:$slice_id][pass|revise|reject].
8. Push.

Be skeptical. Do not give PASS for cosmetic compliance — verify the substantive intent.
EOF
} | codex exec -
```

### 5.3 Fallback when Codex CLI isn't available headlessly

If Codex CLI doesn't yet expose a clean non-interactive mode, fall back to a **second Claude session in adversarial-auditor mode**. Cleared and labeled inferior to a real Codex audit:

```bash
# in dispatch_codex.sh, fallback branch
claude --print \
  --append-system-prompt "$(cat scripts/loop/prompts/codex_auditor.md)" \
  --model claude-opus-4-7 \
  ...
```

The system prompt for that fallback explicitly tells the model: "You are roleplaying an independent auditor. Be more skeptical than the implementer. Assume the implementer cut corners. Read the diff, do not trust the slice-completion notes." This is a known-imperfect substitute — note in the slice's audit verdict that fallback mode was used.

---

## 6. Preconditions check

Runs every tick. Refuses to dispatch if any precondition fails.

```bash
#!/usr/bin/env bash
# scripts/loop/preconditions.sh
set -e

# 1. Clean worktree, IGNORING approval-sentinel touch files
#    (those are intentional runtime state, not slice work).
dirty=$(git status --porcelain | grep -vE '^\?\?[[:space:]]+diagnostic/slices/\.approved(-merge)?/[^/]+$' || true)
if [[ -n "$dirty" ]]; then echo "FAIL: dirty worktree" >&2; exit 1; fi

# 2. Always-required env.
: "${ANTHROPIC_API_KEY:?missing}"

# Slice-specific env (DB URL, dev server up, etc.) is NOT checked here —
# bootstrap slices like 00-codex-handoff-protocol must be able to run with no
# DB connectivity. Each slice declares its own service/env requirements in
# its "Required services / env" block, and the dispatcher-side prompt is
# responsible for checking them before doing slice work.

# 3. On the right base branch.
branch=$(git rev-parse --abbrev-ref HEAD)
[[ "$branch" == "integration/perf-roadmap" || "$branch" == slice/* ]] \
  || { echo "FAIL: not on integration/perf-roadmap or a slice branch" >&2; exit 1; }

# 4. Cost budget (ADVISORY — see §9). Currently relies on placeholder
#    cost_usd=0 records until real usage capture is wired.
./scripts/loop/check_budget.sh || { echo "FAIL: budget exceeded" >&2; exit 1; }

exit 0
```

If a precondition fails the runner sleeps and retries on the next tick. The user resolves the cause out-of-band; the loop self-resumes.

---

## 7. Slice selection

```bash
#!/usr/bin/env bash
# scripts/loop/select_next_slice.sh
# Returns: "slice_id owner status" for the next actionable slice, or empty.

# 1. Read _index.md to get phase order.
# 2. For each slice in order, parse frontmatter.
# 3. Skip status in (done, ready_to_merge if Phase 0 and we're not user).
# 4. First actionable slice wins.

awk '...' diagnostic/slices/_index.md \
  | while read -r slice_id; do
      f="diagnostic/slices/${slice_id}.md"
      status=$(yq '.status' "$f")
      owner=$(yq '.owner' "$f")
      approval=$(yq '.user_approval_required' "$f")

      # User-approval slices need an APPROVED sentinel before claude can start.
      if [[ "$status" == "pending" && "$approval" == "yes" ]]; then
        if [[ ! -f "diagnostic/slices/.approved/${slice_id}" ]]; then
          continue   # waiting on user approval
        fi
      fi

      case "$status" in
        pending|revising) echo "$slice_id claude $status"; exit 0 ;;
        awaiting_audit)   echo "$slice_id codex $status";  exit 0 ;;
        ready_to_merge|blocked) echo "$slice_id user $status"; exit 0 ;;
      esac
    done
```

User approval is signaled by touching `diagnostic/slices/.approved/<slice_id>`. The `.approved/` directory itself is tracked (via its `.gitkeep`), but the **token files inside it are intentionally git-ignored** — otherwise every approval would taint the worktree and `preconditions.sh` would block the loop. For final-merge approval on already-PASSed slices, use a separate `.approved-merge/<slice_id>` sentinel under the same ignore-with-gitkeep-exception rule.

---

## 8. State the runner persists

Already in repo (per execution plan §10):
- `diagnostic/slices/*.md` — slice files (state machine).
- `diagnostic/slices/_index.md` — ordered queue.
- `diagnostic/artifacts/{perf,healthcheck,explain}/*` — promoted artifacts.

New, runner-specific:
- `scripts/loop/state/runner.log` — append-only event log (every tick).
- `scripts/loop/state/runner.pid` — for `runner stop`.
- `diagnostic/slices/.approved/<slice_id>` — user-approval sentinel (start gate).
- `diagnostic/slices/.approved-merge/<slice_id>` — user-approval sentinel (merge gate).
- `scripts/loop/state/cost_ledger.jsonl` — per-call cost record for §9 budget.

Add to `00-gitignore-exceptions`:
```gitignore
!diagnostic/slices/
!diagnostic/slices/**
!diagnostic/slices/.approved/
!diagnostic/slices/.approved/.gitkeep
!diagnostic/slices/.approved-merge/
!diagnostic/slices/.approved-merge/.gitkeep
!scripts/loop/
!scripts/loop/**

# Approval sentinels themselves (touch files inside .approved/) MUST stay
# ignored — otherwise every approval taints the worktree and preconditions
# block the loop. Only the .gitkeep above is tracked.
diagnostic/slices/.approved/*
!diagnostic/slices/.approved/.gitkeep
diagnostic/slices/.approved-merge/*
!diagnostic/slices/.approved-merge/.gitkeep
```

The `state/` directory contents stay ignored (logs, pid, ledger) but the scripts themselves track.

---

## 9. Cost / rate-limit / safety guardrails

The loop will run unattended overnight. It must not burn money or push bad code.

| Guardrail | Mechanism | Trip behavior |
|---|---|---|
| Daily LLM cost cap (**ADVISORY for now**) | Each dispatcher appends a row to `cost_ledger.jsonl`; `check_budget.sh` sums today's entries. **Currently writes `cost_usd=0` placeholders** because the Claude / Codex CLIs do not surface usage in non-interactive mode. Cap only bites when external tooling backfills real numbers (parse `~/.claude/logs/`, SDK-wrap, or Anthropic console export). | When real numbers exist: refuse to dispatch; sleep until midnight UTC. Today: scaffolding only. |
| Per-slice timeout | `run_with_timeout` helper in runner.sh — prefers `timeout` / `gtimeout`, falls back to a `perl` alarm shim. Stock macOS bash 3.2 has neither GNU command, so the perl shim is the active path. | Mark slice `blocked`, owner=user |
| Repeat-failure circuit breaker | If a slice fails its gates 3 times in a row | Mark slice `blocked`, owner=user |
| Phase-boundary gate | After last slice of a phase, runner halts and waits for explicit `phase-N-approved` sentinel | Loop pauses; user reviews benchmark |
| Force-stop | `kill $(cat scripts/loop/state/runner.pid)` | Runner exits cleanly between ticks |
| Production-touching slices | `user_approval_required: yes` requires sentinel before start AND before merge | Loop sleeps on those slices until human acts |
| Merge to `main` | NEVER automated. `main` only updated when user opens a PR from `integration/perf-roadmap` after a phase boundary | n/a |

The runner has no permission to push to `main`, ever. It only ever pushes to `slice/*` and merges to `integration/perf-roadmap`.

---

## 10. Observability

Three tools the user uses to know what's happening:

1. **Tail the event log:** `tail -f scripts/loop/state/runner.log`. One line per tick.
2. **Slice-queue snapshot:** `make loop-status` → reads every slice's frontmatter and prints a table:
   ```
   PHASE  SLICE_ID                          STATUS          OWNER
   0      00-gitignore-exceptions           done            -
   0      00-branch-bootstrap               done            -
   0      00-artifact-tree                  ready_to_merge  user      ← needs you
   0      00-codex-handoff-protocol         pending         claude
   ...
   ```
3. **Daily summary:** Codex writes `diagnostic/slices/_progress_log.md` daily with what advanced, what failed, what's blocked. The runner appends a one-liner per tick; Codex synthesizes once a day.

---

## 11. Bootstrap — actually starting the loop today

The minimal sequence to go from "approved plan" to "running unattended":

```bash
# 1. Settle the dirty worktree (pre-loop adoption).
git add diagnostic/
git commit -m "docs: roadmap, execution plan, automation plan"
# (decide what to do with the three modified web files separately)

# 2. Create the integration branch (manually, before the loop runs).
git checkout -b integration/perf-roadmap

# 3. Build the runner scaffolding (this is itself a one-time manual job — not a slice).
mkdir -p scripts/loop/{prompts,state}
$EDITOR scripts/loop/runner.sh
$EDITOR scripts/loop/dispatch_claude.sh
$EDITOR scripts/loop/dispatch_codex.sh
$EDITOR scripts/loop/select_next_slice.sh
$EDITOR scripts/loop/preconditions.sh
$EDITOR scripts/loop/prompts/claude_implementer.md
$EDITOR scripts/loop/prompts/codex_auditor.md
chmod +x scripts/loop/*.sh

# 4. Convert the execution plan §7 queue into actual slice files.
mkdir -p diagnostic/slices/.approved diagnostic/slices/.approved-merge
$EDITOR diagnostic/slices/_index.md
$EDITOR diagnostic/slices/00-gitignore-exceptions.md
# ... etc for the bootstrap block. Filling these is itself work; ~1 day.

# 5. Start the runner in a tmux/screen session.
tmux new-session -d -s perf-loop "scripts/loop/runner.sh"

# 6. Tail the log. Approve sentinels as the loop blocks on them.
tail -f scripts/loop/state/runner.log
```

After step 6, the loop runs by itself. The user's only job is to:
- `touch diagnostic/slices/.approved/<slice_id>` when a slice asks for approval.
- Open PRs from `integration/perf-roadmap` to `main` at phase boundaries.
- Investigate `blocked` statuses.

---

## 12. Why not Claude Code's `/loop` skill directly?

The Claude Code `/loop` skill does provide self-paced recurring execution and could in principle drive this whole thing inside one Claude session. But:

- `/loop` runs *one* prompt repeatedly. It's a great tool for "keep checking X every 5 minutes," not for the dual-agent state machine described here.
- The loop in this plan needs to alternate between two distinct system prompts (implementer / auditor) and two distinct tool surfaces. That's a control-flow shape the bash runner expresses naturally.
- The runner is a thin shell script — losing it costs little. Claude Code's `/loop` is one dependency more; if the user runs the loop on a build server later, `/loop` won't be available.

**Compromise:** the runner can itself be invoked from Claude Code's `/loop` if the user wants to drive it from a Claude session — but the runner is the substrate, not the loop primitive.

---

## 13. Open questions for Codex (round 1 of automation review)

1. Is OpenAI Codex CLI's headless mode mature enough for `dispatch_codex.sh` as written, or do we lead with the Claude-as-auditor fallback for v1?
2. Should the cost ledger be per-slice or per-day? Per-slice gives finer attribution; per-day matches the soft-cap mental model.
3. Should phase-boundary "explicit approval" (§9) be a sentinel file, a GitHub PR review, or a CLI command? Sentinel is simplest; CLI is most discoverable.
4. Is there value in shipping the runner as a tiny TypeScript program instead of bash? Cross-platform, type-checkable, but adds a dependency.
5. Should the runner expose a `make loop-pause` / `make loop-resume` API, or is "kill the tmux session" sufficient?
6. Is the `diagnostic/slices/.approved/` sentinel pattern good, or does Codex want approvals tied to `gh pr review` so they show up in PR history?
7. The §11 bootstrap mixes manual and automated work. Should we add a `00-runner-scaffold` slice that the loop runs *first* — bootstrapping itself? (Chicken-and-egg risk: the runner has to exist before it can run a slice that creates itself.)
8. Should there be a "dry-run mode" where the runner logs what it *would* dispatch but doesn't actually invoke any LLM? Useful for testing the state machine without burning calls.

---

## 14. Realistic timeline to running unattended

| Day | Work |
|---|---|
| Day 0 | Codex audits this doc; user resolves §13 open questions |
| Day 1 | User commits planning docs, decides WIP fate, creates `integration/perf-roadmap`; bootstrap script scaffolding |
| Day 2 | Author the seven scripts in `scripts/loop/`; test against a hand-written `_handoff_test` slice |
| Day 3 | Convert §7 Phase 0 bootstrap slices (`00-gitignore-exceptions` through `00-fresh-benchmark`) into actual slice files |
| Day 4 | Loop runs Phase 0 unattended; user signs off at phase boundary |
| Day 5+ | Loop continues into Phase 1+ on its own |

After Day 5, the loop is self-driving. The user becomes a phase-boundary reviewer plus a sentinel-toucher for approval-flagged slices.

---

End of automation plan. Codex: PASS / REVISE / REJECT and answer §13.
