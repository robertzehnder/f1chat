---
slice_id: 05-template-cache-coverage-audit
phase: 5
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T13:40:00-04:00
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

**Branch:** `slice/05-template-cache-coverage-audit`
**Commits on this slice (after plan approval):**
- `5322a20` — slice 05: template-cache coverage audit (32/32 templates documented)

### Inventory & coverage
- Extracted **32** distinct `templateKey: "..."` literals from `web/src/lib/deterministicSql.ts` (full list inside the audit doc).
- No `web/src/lib/templates/` directory exists in this repo; the inline literals in `deterministicSql.ts` are the canonical inventory, as the approved plan stated.
- The slice doc `diagnostic/notes/05-template-cache-coverage.md` contains one row per templateKey (32/32). `## Excluded` is intentionally empty — every template was analyzed.

### Decisions / findings
- **Headline:** No template currently short-circuits to a cached deterministic *response*. Every row in the coverage table is `cache-eligible = N` today.
- `web/src/lib/resolverCache.ts` caches **resolver lookups only** (`sessions_for_resolution`, `drivers_for_resolution`, `sessions_from_search_lookup`, `drivers_from_identity_lookup`). It does not cache template SQL output.
- `web/src/lib/chatRuntime.ts` has two prompt-specific resolver-skip fast paths (`coverage_prompt_fast_path` at line 1394, `abu_dhabi_2025_deterministic_fast_path` at line 1508). Both still hand SQL to `runReadOnlySql` in `web/src/app/api/chat/route.ts:461`, so even those three templates re-execute SQL on every request.
- Three templates (`sessions_most_complete_downstream_coverage`, `max_leclerc_qualifying_improvement`, `abu_dhabi_weekend_smallest_spread_and_comparison`) are the only ones whose prompts already hit a runtime fast path; the audit doc marks them as resolver-skip-only and lists the same future-cache disposition as the others.
- Per-template "future-Y / future-Y with TTL / future-N" disposition is recorded in the doc to drive subsequent template-cache slices.

### Gate results (all from this worktree, this branch)

| Gate | Command | Exit | Notes |
| --- | --- | --- | --- |
| build | `cd web && npm run build` | 0 | clean Next build (after `npm install` to populate `web/node_modules`). |
| typecheck | `cd web && npm run typecheck` | 0 | `tsc --noEmit` clean. |
| grading tests | `cd web && npm run test:grading` | 0 | 32 passed, 10 skipped (integration tests gated on `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`). |
| slice coverage gate | inline `bash -c` block from slice file | 0 | "Coverage gate passed: all templateKeys documented." |

### Self-check vs. acceptance criteria
- [x] `diagnostic/notes/05-template-cache-coverage.md` contains a row for every distinct `templateKey: "..."` literal in `web/src/lib/deterministicSql.ts` (32/32). `## Excluded` is empty.
- [x] Each row records cache-eligible (Y/N) and a reason when N.
- [x] The coverage gate shell block exits 0 against the produced doc (verified above).

### Files changed
- `diagnostic/notes/05-template-cache-coverage.md` (new — only changed file expected by the slice).
- `diagnostic/slices/05-template-cache-coverage-audit.md` (frontmatter + this completion note; metadata bookkeeping only, not subject to "Changed files expected").

## Audit verdict
**Status: PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `cd web && npm run test:grading` -> exit `0`
- Gate #4 coverage gate shell block -> exit `0`
- Scope diff -> PASS: `git diff --name-only integration/perf-roadmap...HEAD` returned `diagnostic/notes/05-template-cache-coverage.md` and `diagnostic/slices/05-template-cache-coverage-audit.md`; subset of allow-list with implicit slice-file allowance.
- Criterion 1 -> PASS: `grep -oE 'templateKey: "[^"]+"' web/src/lib/deterministicSql.ts | sed -E 's/templateKey: "([^"]+)"/\1/' | sort -u | wc -l` returned `32`; the doc contains 32 coverage rows at `diagnostic/notes/05-template-cache-coverage.md:45` through `diagnostic/notes/05-template-cache-coverage.md:76`, and `## Excluded` is explicitly empty at `diagnostic/notes/05-template-cache-coverage.md:78`.
- Criterion 2 -> PASS: every documented template row carries `cache-eligible (Y/N)` plus a populated `reason if N` column at `diagnostic/notes/05-template-cache-coverage.md:43` through `diagnostic/notes/05-template-cache-coverage.md:76`.
- Criterion 3 -> PASS: the coverage gate exited `0` locally.
- Substantive check -> PASS: the doc’s headline claim at `diagnostic/notes/05-template-cache-coverage.md:9` through `diagnostic/notes/05-template-cache-coverage.md:34` matches the code. `web/src/lib/resolverCache.ts:114` through `web/src/lib/resolverCache.ts:168` cache only resolver lookups, `web/src/lib/chatRuntime.ts:1371` through `web/src/lib/chatRuntime.ts:1471` and `web/src/lib/chatRuntime.ts:1474` through `web/src/lib/chatRuntime.ts:1523` implement resolver-skip fast paths only, and `web/src/app/api/chat/route.ts:400` through `web/src/app/api/chat/route.ts:461` still executes deterministic template SQL via `runReadOnlySql` on request.

Ready to merge.

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

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current on 2026-04-28; no stale-state note required.
