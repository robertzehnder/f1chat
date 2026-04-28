---
slice_id: 05-template-cache-coverage-audit
phase: 5
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28
---

## Goal
Audit which question templates short-circuit to cached deterministic responses today and document the coverage gap (which templates miss). Output a list to drive subsequent template-cache slices.

## Inputs
- `web/src/lib/deterministicSql.ts` (the canonical source of `templateKey: "..."` entries; no `web/src/lib/templates/` directory exists in this repo)
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/resolverCache.ts` (cache short-circuit path)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Enumerate every template by extracting all `templateKey: "..."` entries from `web/src/lib/deterministicSql.ts` (the authoritative template registry — note the slice originally referenced a non-existent `web/src/lib/templates/` directory).
2. For each template, trace `chatRuntime.ts` + `resolverCache.ts` to determine whether the synthesis path can short-circuit to a cached deterministic response.
3. Write `diagnostic/notes/05-template-cache-coverage.md` with a table whose rows cover EVERY templateKey from step 1: columns = template, cache-eligible (Y/N), reason if N. If any template is intentionally excluded from analysis, list it under an explicit `## Excluded` section in the doc with one-line rationale per entry.

## Decisions
- Templates are defined inline in `web/src/lib/deterministicSql.ts` as `templateKey: "..."` literals; there is no separate `templates/` directory. The audit treats the de-duplicated set of `templateKey` literals in that file as the complete template inventory.

## Changed files expected
- `diagnostic/notes/05-template-cache-coverage.md`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
# Coverage gate: every templateKey in deterministicSql.ts must appear in the audit doc
# (or be explicitly listed under the doc's `## Excluded` section).
bash -c '
  set -euo pipefail
  doc=diagnostic/notes/05-template-cache-coverage.md
  missing=0
  for k in $(grep -oE "templateKey: \"[^\"]+\"" web/src/lib/deterministicSql.ts | sed -E "s/templateKey: \"([^\"]+)\"/\1/" | sort -u); do
    if ! grep -qF "$k" "$doc"; then
      echo "MISSING from $doc: $k"
      missing=$((missing+1))
    fi
  done
  if [ "$missing" -gt 0 ]; then
    echo "Coverage gate failed: $missing template(s) not documented." >&2
    exit 1
  fi
  echo "Coverage gate passed: all templateKeys documented."
'
```

## Acceptance criteria
- [ ] `diagnostic/notes/05-template-cache-coverage.md` contains a row (or `## Excluded` entry) for every distinct `templateKey: "..."` literal in `web/src/lib/deterministicSql.ts` — 100% coverage, no `>=80%` allowance.
- [ ] Each row records cache-eligible (Y/N) and a reason when N.
- [ ] The "coverage gate" shell block in `## Gate commands` exits 0 against the produced doc.

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
- [ ] None.

### Medium
- [x] Tighten the acceptance criteria to require decisions for every template in `web/src/lib/templates/`, or explicitly enumerate any excluded templates; the current `>=80%` threshold contradicts Step 1's per-template audit goal and can miss real coverage gaps.
- [x] Add a gate or acceptance check that verifies `diagnostic/notes/05-template-cache-coverage.md` covers the full template set; `build`, `typecheck`, and `test:grading` do not validate the slice's only promised artifact.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current on 2026-04-28; no stale-state note required.
