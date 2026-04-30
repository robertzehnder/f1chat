---
slice_id: 09-line-count-gate
phase: 9
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T16:03:28-04:00
---

## Goal
Add a CI gate that asserts no NEW `.ts` file under `web/src/lib/` exceeds 500 lines, and that existing oversized files (allowlisted with their current line count as a ceiling) cannot regress further. Catches future bloat regressions without forcing immediate splits of the four currently-oversized files (`web/src/lib/chatRuntime.ts` 1601, `web/src/lib/anthropic.ts` 642, `web/src/lib/deterministicSql/pace.ts` 631, `web/src/lib/deterministicSql.ts` 511).

## Inputs
- `web/src/lib/`
- `.github/workflows/ci.yml`

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time. The script must be runnable with `bash` only — no Node/npm dependency.

## Steps
1. Add `scripts/loop/line_count_gate.sh` (bash, `set -euo pipefail`). Behavior:
   - Scans every `*.ts` (recursive) under `web/src/lib/`.
   - Reads a baseline file `scripts/loop/state/line_count_baseline.txt` containing one `<repo-relative-path>:<max_lines>` entry per non-blank, non-`#` line.
   - For each scanned file:
     - If its path appears in the baseline, fail when the current line count exceeds that entry's `<max_lines>` ceiling.
     - Otherwise, fail when the current line count exceeds 500.
   - On failure, print every offending path with its current line count and (if applicable) its baseline ceiling, then exit non-zero.
   - On success, exit 0.
   - The script accepts no positional arguments; the scan root and baseline path are fixed constants. (No fixture-path input mode.)
2. Add `scripts/loop/state/line_count_baseline.txt` seeded with the four currently-oversized files, each pinned to its measured count as the ceiling. Populate by running:
   ```bash
   find web/src/lib -type f -name '*.ts' -print0 | xargs -0 wc -l | awk '$1>500 && $2!="total"{print $2":"$1}' | sort
   ```
   Expected initial contents (verify with the command above before commit):
   ```
   web/src/lib/anthropic.ts:642
   web/src/lib/chatRuntime.ts:1601
   web/src/lib/deterministicSql.ts:511
   web/src/lib/deterministicSql/pace.ts:631
   ```
3. Wire the gate into `.github/workflows/ci.yml` as a new step that runs `bash scripts/loop/line_count_gate.sh` (placed before the existing build/typecheck steps so a bloat regression is caught early).
4. Run `bash scripts/loop/line_count_gate.sh` locally; expect exit 0 against the seeded baseline.
5. Verify the failure path twice (revert each pad before commit):
   a. New-file path: create a throwaway `web/src/lib/__bloat_probe.ts` with 501 lines of `// pad`, run the gate, confirm non-zero exit and that the file is listed; delete the probe.
   b. Baseline-ratchet path: append one extra line to `web/src/lib/chatRuntime.ts` so it reaches 1602 lines (over its 1601 baseline ceiling), run the gate, confirm non-zero exit naming `chatRuntime.ts` with both current count and baseline ceiling; revert the appended line.

## Changed files expected
- `scripts/loop/line_count_gate.sh`
- `scripts/loop/state/line_count_baseline.txt`
- `.github/workflows/ci.yml`

## Artifact paths
None.

## Gate commands
```bash
bash scripts/loop/line_count_gate.sh
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `bash scripts/loop/line_count_gate.sh` exits 0 against current state with the seeded `scripts/loop/state/line_count_baseline.txt`.
- [ ] Gate exits non-zero when a NEW `web/src/lib/*.ts` file (not in the baseline) is artificially padded > 500 lines, and the offending path + line count are printed.
- [ ] Gate exits non-zero when a baseline-listed `web/src/lib/*.ts` file (e.g., `chatRuntime.ts`) is padded past its baseline ceiling, and the printout names the file with current count and baseline ceiling.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-line-count-gate`

**Files changed (3, all listed in scope):**
- `scripts/loop/line_count_gate.sh` (new, executable, bash-3.2 compatible — uses parallel arrays, not `declare -A`)
- `scripts/loop/state/line_count_baseline.txt` (new; force-added because `scripts/loop/state/*` is gitignored as ephemeral runtime state — `.gitignore` itself was deliberately not modified to stay in scope)
- `.github/workflows/ci.yml` (added `line-count-gate` job; existing `web-typecheck`, `web-tests`, `web-build` now `needs: line-count-gate` so a bloat regression fails fast before downstream jobs run)

**Baseline contents** (verified via `find web/src/lib -type f -name '*.ts' -print0 | xargs -0 wc -l | awk '$1>500 && $2!="total"{print $2":"$1}' | sort`):
```
web/src/lib/anthropic.ts:642
web/src/lib/chatRuntime.ts:1601
web/src/lib/deterministicSql.ts:511
web/src/lib/deterministicSql/pace.ts:631
```

**Decisions:**
- Bash 3.2 compatibility: macOS ships bash 3.2, so the script avoids `declare -A` (associative arrays) and uses two parallel arrays (`baseline_paths`, `baseline_ceilings`) with a linear-scan `lookup_ceiling` helper. Linear scan is fine — the baseline currently has 4 entries.
- CI wiring: implemented as a separate top-level `line-count-gate` job that the three downstream jobs (`web-typecheck`, `web-tests`, `web-build`) declare via `needs:`. Catches bloat regressions before slow Node-based steps run.
- Baseline path: kept at the slice-specified `scripts/loop/state/line_count_baseline.txt`. Used `git add -f` (one-time force) rather than editing `.gitignore`, because `.gitignore` is outside the slice's declared scope. Once tracked, future modifications to the baseline file show up normally.

**Gate-command results (exit codes):**
- `bash scripts/loop/line_count_gate.sh` → 0 (`line_count_gate: OK`)
- `cd web && npm run build` → 0 (Next.js build succeeded; route table printed)
- `cd web && npm run typecheck` → 0 (`tsc --noEmit` clean)
- `bash scripts/loop/test_grading_gate.sh` → 0 (`PASS (no new failures vs integration baseline) slice_fails=38 baseline_fails=38 baseline_failures_fixed=0`)

**Self-checks (failure paths verified, both reverted before commit):**
1. **New-file path:** Created `web/src/lib/__bloat_probe.ts` with 501 lines of `// pad` (`awk 'BEGIN { for(i=1;i<=501;i++) print "// pad" }'`). Gate exited 1 with output: `web/src/lib/__bloat_probe.ts: 501 lines exceeds default cap 500`. Probe deleted; `ls` confirms removal.
2. **Baseline-ratchet path:** Saved `web/src/lib/chatRuntime.ts` to `/tmp/chatRuntime.ts.bak`, appended one newline (1601→1602 lines), ran gate. Gate exited 1 with output: `web/src/lib/chatRuntime.ts: 1602 lines exceeds baseline ceiling 1601` (current count + ceiling both named, as required). Restored from backup; `wc -l` confirms back to 1601.

**Commit:** to be filled after the commit is created.

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Add the new line-count gate command itself to `## Gate commands` so the slice can verify `scripts/loop/line_count_gate.sh` exits 0 on current state and fails when a `web/src/lib/*.ts` file is padded past 500 lines, matching the acceptance criteria.

### Medium
- [x] Replace raw `cd web && npm run test:grading` in `## Gate commands` with `bash scripts/loop/test_grading_gate.sh` per the repository audit note, so pre-existing grading failures do not make this slice's verification nondeterministic.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T19:53:42Z, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Revise the goal, steps, gate commands, and acceptance criteria so the slice does not require `bash scripts/loop/line_count_gate.sh` to exit 0 against the current tree while `web/src/lib/chatRuntime.ts` (1601), `web/src/lib/anthropic.ts` (642), `web/src/lib/deterministicSql/pace.ts` (631), and `web/src/lib/deterministicSql.ts` (511) already exceed the proposed 500-line cap (`find web/src/lib -type f -name '*.ts' -print0 | xargs -0 wc -l | sort -nr | sed -n '1,10p'` exited 0). 

### Medium
- [x] Remove the unsupported "or feed an oversized fixture path" branch from Step 4 or specify the exact script interface and fixture artifact needed to test it, because Step 1 defines only a fixed scan of `web/src/lib/*.ts` and `## Artifact paths` is currently `None` ([diagnostic/slices/09-line-count-gate.md](/Users/robertzehnder/.openf1-loop-worktrees/09-line-count-gate/diagnostic/slices/09-line-count-gate.md:25), [diagnostic/slices/09-line-count-gate.md](/Users/robertzehnder/.openf1-loop-worktrees/09-line-count-gate/diagnostic/slices/09-line-count-gate.md:28), [diagnostic/slices/09-line-count-gate.md](/Users/robertzehnder/.openf1-loop-worktrees/09-line-count-gate/diagnostic/slices/09-line-count-gate.md:34)).
- [x] Correct the acceptance criterion to refer to a `web/src/lib/*.ts` file rather than a "test file in lib/" so it matches the goal and the scripted scope ([diagnostic/slices/09-line-count-gate.md](/Users/robertzehnder/.openf1-loop-worktrees/09-line-count-gate/diagnostic/slices/09-line-count-gate.md:12), [diagnostic/slices/09-line-count-gate.md](/Users/robertzehnder/.openf1-loop-worktrees/09-line-count-gate/diagnostic/slices/09-line-count-gate.md:47)).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated 2026-04-30T19:53:42Z, within 24 hours.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated 2026-04-30T19:53:42Z, within 24 hours.
