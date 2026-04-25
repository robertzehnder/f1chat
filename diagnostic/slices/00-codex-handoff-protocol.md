---
slice_id: 00-codex-handoff-protocol
phase: 0
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25T18:21:51-04:00
---

## Goal
Validate the loop's handoff mechanism end-to-end on a no-op change. De-risks every later slice by proving branch creation, commit tagging, status transitions, gate execution, audit verdict, and merge authority all work before any real change rides on the protocol.

## Inputs
- [automation_2026-04_loop_runner.md §5, §11](../automation_2026-04_loop_runner.md)
- [execution_plan §0a, §3, §4](../execution_plan_2026-04_autonomous_loop.md)

## Required services / env
- `git` configured.
- `claude` CLI on `PATH` (for headless invocation).
- `ANTHROPIC_API_KEY` set.
- (Optional) `codex` CLI on `PATH` — falls back to claude-as-auditor mode if absent.

## Steps
1. Create file `diagnostic/_handoff_test.md` containing exactly one line: `handoff test executed at <iso-timestamp>`.
2. Stage, commit on `slice/00-codex-handoff-protocol` with message tag `[slice:00-codex-handoff-protocol][awaiting-audit]`.
3. Push branch.
4. Update this slice's frontmatter to `status: awaiting_audit, owner: codex`.
5. Auditor (Codex or claude-fallback) verifies: branch exists, commit tag is correct, only `diagnostic/_handoff_test.md` was modified, line count is exactly 1.
6. Auditor sets `status: ready_to_merge, owner: user`.
7. User merges to `integration/perf-roadmap`.

## Changed files expected
- `diagnostic/_handoff_test.md` (new file, single line)
- `diagnostic/slices/00-codex-handoff-protocol.md` (frontmatter updates only)

## Artifact paths
None.

## Gate commands
```bash
set -e

test -f diagnostic/_handoff_test.md || { echo "FAIL: file missing"; exit 1; }
[[ "$(wc -l < diagnostic/_handoff_test.md | tr -d '[:space:]')" == "1" ]] || { echo "FAIL: not single line"; exit 1; }

git log --oneline -1 | grep -q '\[slice:00-codex-handoff-protocol\]\[awaiting-audit\]' \
  || { echo "FAIL: commit tag missing"; exit 1; }

# Strict scope check matching the acceptance criterion: the diff must equal
# exactly the two allow-listed files — no extras (scope creep) and no missing
# (slice did not actually do its work).
expected=$(printf '%s\n' \
  'diagnostic/_handoff_test.md' \
  'diagnostic/slices/00-codex-handoff-protocol.md' \
  | sort)
actual=$(git diff --name-only integration/perf-roadmap...HEAD | sort)

unexpected=$(comm -23 <(echo "$actual") <(echo "$expected"))
missing=$(comm -13 <(echo "$actual") <(echo "$expected"))

if [[ -n "$unexpected" ]]; then
  echo "FAIL: scope creep — unexpected files in diff:"; echo "$unexpected" | sed 's/^/  /'
  exit 1
fi
if [[ -n "$missing" ]]; then
  echo "FAIL: required files missing from diff:"; echo "$missing" | sed 's/^/  /'
  exit 1
fi

echo "handoff dry-run gates pass"
```

## Acceptance criteria
- [ ] `diagnostic/_handoff_test.md` exists with exactly one line.
- [ ] Commit message contains `[slice:00-codex-handoff-protocol][awaiting-audit]` tag.
- [ ] Diff scope is exactly the two files above.
- [ ] Auditor recorded their verdict in this file's "Audit verdict" section.
- [ ] (Phase 0) status transitions to `ready_to_merge` with `owner: user`.

## Out of scope
- Anything that touches application code.
- Modifying scripts in `scripts/loop/`.

## Risk / rollback
Trivially rollback by deleting `diagnostic/_handoff_test.md` and reverting the commit. The whole point of this slice is to be cheap and reversible.

## Slice-completion note
- Branch: `slice/00-codex-handoff-protocol` (from `integration/perf-roadmap`)
- Commit: HEAD of `slice/00-codex-handoff-protocol` (see `git log --oneline -1`)
- `diagnostic/_handoff_test.md` created with exactly one line + trailing newline
- Gate fix: BSD `wc -l` on macOS pads output with spaces (`"       1"` not `"1"`); gate line-count check updated to pipe through `tr -d '[:space:]'` for cross-platform compatibility
- All gate commands exited 0: file-exists, line-count, commit-tag, scope check
- No application code touched; no files outside "Changed files expected" modified

## Audit verdict
(filled by Codex / claude-fallback on audit)
