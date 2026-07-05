# Session bookmark — 2026-06-03

State capture before VSCode restart. Resume from here.

## Where we are

Running the **F1 visualizations combined plan** through the upgraded loop. Hit a structural blocker on the first slice; loop is stopped; need one decision before resuming.

- Plan: [diagnostic/f1_visualizations_combined_plan_2026-05-25.md](./f1_visualizations_combined_plan_2026-05-25.md)
- Slice queue: 11 slices under Phase 22 in [diagnostic/slices/_index.md](./slices/_index.md) — `viz-01` through `viz-09` (Phase 3 + Phase 7 each split into `a` + `b`)
- Loop infrastructure: §A.1–§C.3 of [loop_upgrade_plan_v2_2026-05-24.md](./loop_upgrade_plan_v2_2026-05-24.md) — **all committed**

## Git state

| Ref | Commit | Notes |
|---|---|---|
| Current branch | `ui/v0-frontend-replacement` | HEAD = `6dce732` |
| `ui/v0-frontend-replacement` | `6dce732` | Latest: loop infra + viz slice commit (54 files, +3406 / −140) |
| `integration/perf-roadmap` | `7a2f909` | **Behind ui by 1 commit** — this is the blocker (see below) |
| `origin/integration/perf-roadmap` | (last pushed) | Origin is even further behind; unpushed for the session |

**Uncommitted WIP**: 27 modified files in `web/` — your hand-driven v0 visualization edits. **Not touched**. Preserved.

**Stash entries**: 2 (from earlier merge sequence). Check `git stash list` after restart — they may be redundant given the commit. Safe to drop after verifying.

**Worktrees**:
- main: `ui/v0-frontend-replacement` at `6dce732`
- legacy slice worktrees: `02-cost-telemetry-validation`, `07-streaming-synthesis` (from prior work, ignorable)
- viz-01 proposal worktree: **deleted** (was stale; got purged during debugging)

## The blocker (the one decision you need to make)

`scripts/loop/lib/proposal_helpers.sh:88` hard-codes `integration/perf-roadmap` as the fork base for every proposal branch. My commit (with the 11 slice files + the §A.2 tools the agent needs) is on `ui` only. So new proposal worktrees fork from a base that doesn't have what they need to do work — and the agent reads a stale slice file (status=blocked from a prior session) and exits, 5 times, circuit breaker fires.

**Two paths** (pick one before restarting the loop):

### Path 1 — Quick fix (recommended)

Fast-forward integration locally so it matches ui:

```bash
git branch -f integration/perf-roadmap ui/v0-frontend-replacement
# verify
git rev-parse ui/v0-frontend-replacement
git rev-parse integration/perf-roadmap
# should be the same SHA
```

This is local-only (no push). Reversible: `git branch -f integration/perf-roadmap 7a2f909`.

### Path 2 — Proper fix

Refactor `scripts/loop/lib/proposal_helpers.sh` + ~5 callers in dispatch_*.sh to honor `LOOP_TARGET_BRANCH` env var. ~30 min of careful editing + testing. Cleaner, but more code to land before the next attempt.

## After picking a path, restart the loop

```bash
# kill any zombies from previous attempts (should be none, but check)
pkill -f "scripts/loop/runner.sh|scripts/loop/watchdog.sh" 2>/dev/null

# reset failure counter (the circuit breaker tripped twice)
rm -f scripts/loop/state/fail_count_viz-01-screenshot-manifest
rm -f scripts/loop/state/claude_dispatch_count_viz-01-screenshot-manifest

# start with env overrides — required because we're on a feature branch with WIP
LOOP_ALLOW_DIRTY_WORKTREE=1 LOOP_TARGET_BRANCH=ui/v0-frontend-replacement \
  nohup scripts/loop/runner.sh > .loop-state/runner.console.log 2>&1 &
echo $! > .loop-state/runner.pid
```

Watch progress:
```bash
tail -f scripts/loop/state/runner.log
```

## Cost so far

~$6.50 burned on failed viz-01 dispatches across 2 circuit-breaker cycles. Each cycle: 5 dispatches at $0.20–$3.00 each. The agent was actually doing work each time (reading, reasoning, recommending) but writing to the wrong slice file location.

Cost ledger lives at `scripts/loop/state/cost_ledger.jsonl`. The last 10 entries are all viz-01 attempts.

## Loop infrastructure recap (what we built this session)

The loop got the §A.1–§C.3 upgrades from the v2 plan, committed in `6dce732`:

- **§A.1 sandbox**: proposal-branch naming (`slice/<id>/proposal-<n>`), ff-only merge ladder, rebase fallback. `lib/proposal_helpers.sh` + rewrite of `dispatch_merger.sh`.
- **§A.2 tool surface**: 6 wrapper bundles under `scripts/loop/tools/`, `lib/tool_registry.sh`, registry-driven `--allowed-tools` in `dispatch_claude.sh`.
- **§A.3 model packs**: `lib/pack_resolver.sh` + `.loop-packs.yaml`. Default pack: `nightly-cost-optimized` (Sonnet for implementer, Codex for auditor, Haiku for summarizer).
- **§A.4 auditor hardening**: `lib/parse_and_apply_verdict.py` (runner-side verdict parser with delimiter-count safety), `LOOP_AUDITOR_SANDBOX=hardened|legacy` env wiring.
- **§B.2 approval policy**: `lib/policy_check.sh`, `lib/shell_parser.py`, `loop_review.sh`, new `awaiting_human_review` state.
- **§B.3 restore verbs**: 3 new dispatch scripts (workspace / task / taskAndWorkspace) per Cline naming.
- **§C.2 rules loader**: `lib/rules_loader.sh` matches slice's `Changed files expected` against `.loop-rules/*.md` glob frontmatter.
- **§C.3 trajectory artifact**: `lib/trajectory.sh` records each dispatch's stdout to `.loop-state/dispatches/<slice>/<turn>.jsonl`.

The runner skill is at `.claude/skills/run-loop/SKILL.md`. Invocation pattern in this conversation: type `run the loop against <plan-path>` and Claude reads the skill.

## What to expect on the next run

If Path 1 (quick fix) is applied:

1. Runner picks up viz-01, creates proposal worktree from `integration/perf-roadmap` HEAD (= ui's HEAD = 6dce732, which has the slice file).
2. Agent reads viz-01's slice file with `status: pending`, executes the steps (build manifest.json + inventory.md + validator.ts), flips status to `awaiting_audit`, commits.
3. Mirror copies the slice file back to main worktree (= ui), commit gets added to ui.
4. Next tick: codex auditor runs against the proposal, emits structured verdict, dispatcher parses + writes verdict to slice file.
5. Slice flips to `ready_to_merge` or `revising`.
6. **Merger will fail** on the FF-only attempt because main worktree is dirty (your 27 web/ files) and the merger tries to `git checkout integration`. Slice gets stuck at `ready_to_merge`. That's expected. Next slice gets picked up.
7. Phase 1+2 slices (viz-01, viz-02) only touch `docs/`, `diagnostic/`, `web/scripts/health/` — no collision with your web/ WIP.
8. Phase 3+ slices touch `web/src/components/f1-chat/charts/*` and `web/src/lib/*` — these will collide with your WIP. **Stop the runner before Phase 3 starts** if you want to keep your WIP intact, or commit your web/ WIP first.

## Files you'll want to look at after restart

- This file: [diagnostic/SESSION_BOOKMARK_2026-06-03.md](./SESSION_BOOKMARK_2026-06-03.md)
- The plan being executed: [diagnostic/f1_visualizations_combined_plan_2026-05-25.md](./f1_visualizations_combined_plan_2026-05-25.md)
- The 11 slice files: `diagnostic/slices/viz-*.md`
- The loop infra (committed): `scripts/loop/lib/`, `scripts/loop/tools/`, `scripts/loop/dispatch_*.sh`, `scripts/loop/runner.sh`, etc.
- Skill definition: `.claude/skills/run-loop/SKILL.md`

## TL;DR

- Loop infrastructure: ✅ committed
- 11 slice files: ✅ committed
- Your web/ WIP: ✅ preserved (untouched)
- Loop runs: ❌ stopped — `integration` branch needs to be FF'd to ui's HEAD before the loop can find the slice files in the proposal worktree
- One command + an env-var-prefixed restart = back in business

When you resume, paste this back to me:
> resume from SESSION_BOOKMARK_2026-06-03 — do Path 1 + restart loop

And I'll run the FF + restart sequence.
