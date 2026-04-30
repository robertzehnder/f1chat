---
slice_id: 09-line-count-gate
phase: 9
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T21:05:00Z
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
(filled by Claude)

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
