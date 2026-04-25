---
slice_id: 00-artifact-tree
phase: 0
status: done
owner: -
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Create the tracked `diagnostic/artifacts/{perf,healthcheck,explain}/` directories and slice-approval sentinel directories with `.gitkeep` files.

## Inputs
- [automation_2026-04_loop_runner.md §8](../automation_2026-04_loop_runner.md)

## Required services / env
None.

## Steps
1. `mkdir -p diagnostic/artifacts/{perf,healthcheck,explain}`.
2. `mkdir -p diagnostic/slices/.approved diagnostic/slices/.approved-merge`.
3. `touch` `.gitkeep` in each.

## Changed files expected
- `diagnostic/artifacts/perf/.gitkeep`
- `diagnostic/artifacts/healthcheck/.gitkeep`
- `diagnostic/artifacts/explain/.gitkeep`
- `diagnostic/slices/.approved/.gitkeep`
- `diagnostic/slices/.approved-merge/.gitkeep`

## Artifact paths
N/A — this slice creates the artifact tree.

## Gate commands
```bash
for d in diagnostic/artifacts/perf diagnostic/artifacts/healthcheck diagnostic/artifacts/explain diagnostic/slices/.approved diagnostic/slices/.approved-merge; do
  test -d "$d" || { echo "FAIL: $d missing"; exit 1; }
  test -f "$d/.gitkeep" || { echo "FAIL: $d/.gitkeep missing"; exit 1; }
  git check-ignore -q "$d/.gitkeep" && { echo "FAIL: $d/.gitkeep still ignored"; exit 1; }
done
echo "artifact tree ok"
```

## Acceptance criteria
- [x] All five directories exist.
- [x] All five `.gitkeep` files exist and are tracked.

## Out of scope
Slice-file content for approvals (touched in later slices).

## Risk / rollback
Rollback: `rm -r` the directories.

## Slice-completion note
Done during bootstrap before runner existed.

## Audit verdict
Self-audited at execution time.
