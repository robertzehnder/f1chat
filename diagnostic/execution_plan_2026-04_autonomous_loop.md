# Autonomous Execution Plan — Claude implements, Codex verifies

**Date:** 2026-04-25
**Author:** Claude, for Codex review
**Companion to:** [roadmap_2026-04_performance_and_upgrade.md](roadmap_2026-04_performance_and_upgrade.md)
**Purpose:** describe how to run the 13-phase performance+quality roadmap as a continuous autonomous loop where Claude does the implementation work and Codex does the verification + work-slicing + feedback. Codex should validate this loop design before we start executing on it.

---

## 0a. Repo state pre-flight (caught in Codex audit)

The current repo has four structural conditions that would make several early slices silently fail. **The very first slices in §7 deal with these before anything else lands.**

**Pre-loop adoption (must be settled before the first slice runs):** the worktree must be clean. As of 2026-04-25 it shows three pre-existing modified files (`web/src/app/api/chat/route.ts`, `web/src/components/chat/ContextChip.tsx`, `web/tsconfig.tsbuildinfo`) and three untracked planning docs (the two roadmap files and this execution plan). Per §8's dirty-worktree rule, the loop refuses to start on this state. Before kicking off `00-gitignore-exceptions`, the user or maintainer must commit the planning docs, commit or stash the WIP, or explicitly bless the diff so the loop knows what to ignore.


1. **`.gitignore` blocks several planned source-of-truth files.** Verified with `git check-ignore -v`:
   - `.github/workflows/ci.yml` — ignored by `**/.*` rule on [.gitignore:3](../.gitignore)
   - `.env.example`, `web/.env.local.example` — ignored by the same rule
   - `web/logs/*` — ignored by `web/logs/` rule on [.gitignore:22](../.gitignore)

   Implication: the planned `.github/workflows/ci.yml` would not be tracked by git, env examples cannot be committed, and any "committed source-of-truth benchmark log" in `web/logs/` is invisible to git. **First slice = `00-gitignore-exceptions`.**

2. **No service-management story for benchmark slices.** `web/scripts/chat-health-check.mjs` defaults to `OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000`. Without an explicit "start dev server, target deployed URL, or use a fixture" step, `00-fresh-benchmark` simply errors. **Benchmark slices now carry a required-service block.**

3. **No `integration/perf-roadmap` branch exists.** `git branch -a` shows only `main`, `ui-updates`, and `origin/main`. The plan assumes a long-lived integration branch and a protected main. **Second slice = `00-branch-bootstrap`** (creates the branch, decides protection mode, names merge authority).

4. **Persisted artifacts cannot live in `web/logs/`.** Runtime traces can stay there for the dev sink (Phase 1), but **promoted, source-of-truth artifacts must live under tracked paths**: `diagnostic/artifacts/perf/`, `diagnostic/artifacts/healthcheck/`, and `diagnostic/artifacts/explain/`. Slice `00-artifact-tree` creates these directories with `.gitkeep`.

These four fixes plus the existing Phase 0 work form the bootstrap block of the queue. None of the rest of the loop can run until they land.

---

## 0. Why a loop, not a sprint

The roadmap has ~30 working days of distinct work across Phases 0–12, and the work is **not uniformly risky**:

- Phase 0 (hygiene) is mostly unattended-safe: lint config, deps, CI yaml.
- Phase 3 (materializing semantic contracts) needs grain discovery, parity checks, and Neon-branch validation per contract — every contract is its own PR with its own audit.
- Phase 6 (Neon driver swap) is a single touchy change to a hot path.
- Phase 9 (runtime refactor) is many small mechanical splits where audit value is high but per-PR complexity is low.

A naive "Claude does all of it, then Codex audits the megamerge" loses the audit signal. The loop below interleaves implementation and verification at a slice granularity small enough that Codex can hold the whole change in head, and explicit enough that Claude can resume the loop after every interruption without re-reading the entire roadmap.

## 1. Roles

### Claude (implementation agent)
- Picks the next work slice from the slice queue.
- Implements the change end-to-end on a feature branch.
- Self-checks against the slice's local exit criteria before requesting audit.
- Writes a short slice-completion note in the slice file.
- Hands the branch to Codex for verification.

### Codex (verification + slicing + feedback agent)
- Reviews each completed slice against its acceptance criteria.
- Decides PASS / REVISE / REJECT with concrete diffs or commands.
- Refines the slice queue when implementation reveals new constraints (e.g. a contract's grain turns out to be non-unique → split into two slices).
- Owns the final benchmark + metric verdict at the end of each phase.

### User (sponsor)
- Approves phase transitions.
- Resolves the open questions in [roadmap §7](roadmap_2026-04_performance_and_upgrade.md) (Neon autosuspend, cost ceiling, Upstash now vs later, etc.).
- Has veto on any production-touching change before it leaves a Neon branch.

## 2. Slice granularity

A **slice** is the smallest unit Codex audits. Targeting 0.5–1.5 days of Claude work per slice for two reasons:

1. Small enough that the diff fits in one Codex audit pass without context loss.
2. Large enough that Claude can deliver a coherent, tested change with a real exit criterion — not just a stub.

Examples:

| Phase | Slice | Why this size |
|---|---|---|
| 0 | "Add CI workflow + tsbuildinfo gitignore" | Single config PR; binary verifiable |
| 0 | "Patch Next/PostCSS + run npm audit fix; verify build" | Dep changes need their own audit |
| 0 | "Rerun intense benchmark; commit fresh baseline" | Generates the source of truth for Phase 11 |
| 1 | "Add per-stage perf timing to route.ts + serverLog.ts" | One file pair, one shape of trace |
| 3 | "Prototype core_build / mat / facade for `driver_session_summary`" | One contract, parity check, ingest hook, Neon-branch validation |
| 3 | "Scale-out: laps_enriched (with grain-discovery)" | The contract that revealed the non-unique grain is its own slice |
| 9 | "Split chatRuntime.ts → chat/classification.ts + chat/resolution.ts" | One mechanical split per slice |

Slices that must NOT be combined:
- Phase 3 contract scale-outs (each contract = one slice).
- Phase 9 module splits (each split = one slice).
- Phase 0 dep patches vs CI add (separate audit dimensions).
- Anything that touches the Neon production branch (always its own slice).

## 3. Slice file format

Every slice lives in `diagnostic/slices/<phase>-<slug>.md` and is the single source of truth for that work. Created by Codex (or Claude on first run), updated by both.

```markdown
---
slice_id: 03-driver-session-summary-prototype
phase: 3
status: pending | in_progress | awaiting_audit | revising | done | blocked
owner: claude | codex | user
user_approval_required: yes | no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
One sentence.

## Inputs
- Files Claude must read before starting (paths + line ranges).
- Roadmap section IDs that govern this slice.
- Any prior-slice outputs this depends on (e.g. `01-perf-instrumentation.md` produced `web/lib/perfTrace.ts`).

## Required services / env
- Services that must be running (e.g. `npm run dev` in `web/` on port 3000, Docker Postgres up).
- Env vars that must be set, with how to source them (`cp .env.example .env`, ANTHROPIC_API_KEY, OPENF1_CHAT_BASE_URL).
- Database state preconditions (e.g. `core.session_completeness` analytic-ready set non-empty).
- Teardown step at end of slice.

## Steps (Claude executes; Codex verifies)
1. ...
2. ...

## Changed files expected
- `path/to/file.ts` — short reason
- `sql/008_materialized_summaries.sql` — short reason
(Anything outside this list = scope creep; Codex REJECTs.)

## Artifact paths
Where committed outputs land. Promoted artifacts go to tracked paths:
- `diagnostic/artifacts/perf/<slice_id>_<date>.json`
- `diagnostic/artifacts/healthcheck/<slice_id>_<date>.json`
- `diagnostic/artifacts/explain/<slice_id>_<query>.txt`
Runtime/dev sinks may use `web/logs/` but those are not source of truth.

## Gate commands (executable, in order)
```bash
# Each command must exit 0 for the slice to be auditable.
cd web && npm run typecheck
cd web && npm run test:grading
cd web && npm run build
# slice-specific:
psql "$NEON_DATABASE_URL" -c "SELECT count(*) FROM (...) AS diff"   # must return 0
```

## Acceptance criteria (Codex checks each)
- [ ] All gate commands above exited 0 on Codex's machine
- [ ] Concrete, falsifiable check (e.g. parity SQL returns 0 rows)
- [ ] Only files in "Changed files expected" were modified
- [ ] Tests added / passing
- [ ] CI green on the branch

## Out of scope
Things Claude must NOT do in this slice (prevents scope creep).

## Risk / rollback
What breaks if this slice is wrong; how to revert.

## Slice-completion note (Claude fills in)
- Branch name:
- Commits:
- Notable decisions / surprises:
- Self-check results:
- Tag in commit messages: `[slice:<slice_id>][awaiting-audit]`

## Audit verdict (Codex fills in)
- Outcome: PASS | REVISE | REJECT
- Gate-command exit codes observed:
- Diffs / commands required to fix:
- Follow-up slices to spawn:
```

## 4. The loop, mechanically

```
loop:
    Claude:
        1. Read MEMORY.md + slice queue index
        2. Pick top-of-queue slice with status=pending
        3. Set status=in_progress, owner=claude, push slice file
        4. Create branch slice/<slice_id>
        5. Execute slice "Steps"
        6. Run slice "Self-check results" template
        7. Set status=awaiting_audit, owner=codex
        8. Push branch + slice file; tag user with link
    Codex:
        9. Pull branch + slice file
        10. Run each "Acceptance criteria" check verbatim
        11. Write "Audit verdict"
        12. If PASS: set status=ready_to_merge, owner=user (Phase 0) or owner=codex (Phase 1+, after Phase 0 sign-off), advance queue cursor
        13. If REVISE: set status=revising, owner=claude, list precise diffs
        14. If REJECT: set status=blocked, owner=user; describe why
    Merge authority:
        15. Phase 0: user (or explicit maintainer) performs every merge to integration/perf-roadmap
        16. Phase 1+: after user signs off on loop reliability post-Phase-0, Codex may merge PASSed slices
        17. Always: user-approval-flagged slices (security, production, cost) require user approval at both start AND final merge
    User (only on phase boundaries):
        18. Approve phase transition; sign off on benchmarks
```

This is a literal control loop. It works because every transition point is a status field in a markdown file + a git branch state. Either agent can resume after interruption by reading the slice file.

## 5. Integration branch strategy

- `main` — protected; only phase-completion merges land here.
- `integration/perf-roadmap` — long-lived; every PASS slice merges here. CI runs on every push.
- `slice/<slice_id>` — short-lived per slice; deleted on PASS merge.

Phase-completion criterion: integration branch passes CI, fresh perf trace shows the phase's expected speedup, and the phase's quality benchmark is non-regressive vs the Phase 0 baseline. Then `integration/perf-roadmap` merges to `main` and a new `integration/perf-roadmap-phase-<N+1>` branch starts.

This means there's always exactly one mainline-ready snapshot, and every regression is bisectable to a single slice.

## 6. Quality gates baked into the loop

Each loop iteration runs deterministic checks before Codex starts the human-judgment audit. The base set runs on **every** slice; conditional gates run when the slice touches the relevant surface.

**Always (every slice):**

| Gate | Tool | Blocks merge if |
|---|---|---|
| Typecheck | `cd web && npm run typecheck` | TS error |
| Tests | `cd web && npm run test:grading` | red |
| Build | `cd web && npm run build` | red |

**Conditional (added by slice-relevance):**

| Trigger | Gate | Tool |
|---|---|---|
| Slice touches `web/package.json` or `package-lock.json` | Security audit | `cd web && npm audit --omit=dev` (block on high-severity prod) |
| Slice touches any `src/**/*.py` or new Python module | Python compile | `python -m compileall -q src/` |
| Slice touches `scripts/**/*.sh` or `web/scripts/**/*.sh` | Shell syntax | `bash -n <file>` for each touched script |
| Slice touches `sql/**/*.sql` | SQL parse | `psql -X -v ON_ERROR_STOP=1 -f <file>` against an empty Neon branch |
| Slice produces / consumes benchmark artifacts | Artifact tracked-path check | Verify outputs written under `diagnostic/artifacts/`, not `web/logs/` |

Phase-boundary additional gates:

| Phase | Gate | Source of truth |
|---|---|---|
| 0 | Fresh intense benchmark exists | `web/logs/chat_health_check_*.json` newer than 2026-04-25 |
| 1 | Perf baseline JSON exists | `web/logs/perf_baseline_<date>.json` |
| 2 | Anthropic cache hit ratio ≥ 80 % | `cache_read_input_tokens` in trace |
| 3 | Per-contract parity check returns 0 | bidirectional `EXCEPT ALL` ([roadmap §4 Phase 3 step 5](roadmap_2026-04_performance_and_upgrade.md)) |
| 4 | EXPLAIN shows index scans on benchmark queries | EXPLAIN dump diff |
| 5 | Repeat-question latency < 200 ms | perf trace |
| 6 | p50 connection time < 50 ms | perf trace |
| 7 | TTFT < 600 ms warm | perf trace |
| 8 | Zero `structured_rows_summarized` failures | grader report |
| 9 | Every refactored module < 600 LOC; tests unchanged | line count + test diff |
| 11 | Semantic-conformance ≥ 40 A/B / 50 on fresh baseline | grader report |

Codex's audit pass cannot override a failed deterministic gate. That keeps the loop honest.

## 7. Slice queue, ordered

Below is the initial queue. Codex refines as work reveals constraints. **`*` = blocking gate for the next phase to start.**

### Phase 0 — Bootstrap, Hygiene & Baseline (executed strictly in this order)

**Bootstrap (must land before anything else; addresses pre-flight in §0a):**
- `00-gitignore-exceptions` — add the following exceptions to root [.gitignore](../.gitignore), then verify with `git check-ignore -v` against each path:
  ```gitignore
  !.github/
  !.github/**
  !.env.example
  !web/.env.local.example
  !.gitignore
  !diagnostic/artifacts/**/.gitkeep
  ```
  The double-pattern (`!.github/` plus `!.github/**`) is required because `**/.*` is a broad ignore — directory-only un-ignore is insufficient on nested files. Verification: `git check-ignore -v .github/workflows/ci.yml .env.example web/.env.local.example diagnostic/artifacts/perf/.gitkeep` must produce **no output** for any of those paths. **No other slice can land first.**
- `00-branch-bootstrap` — create `integration/perf-roadmap` from `main`. Branch protection on `main`: GitHub-side if available, procedural otherwise. **Merge authority during Phase 0**: user (or an explicit maintainer) performs every merge to `integration/perf-roadmap`. Codex may mark PASS but does **not** merge until the loop has proven itself end-to-end through all Phase 0 slices. After Phase 0 is complete and the user signs off on loop reliability, merge authority for PASSed slices may transfer to Codex for Phases 1+. User approval required: **yes**, both at start and at final merge.
- `00-artifact-tree` — create `diagnostic/artifacts/perf/`, `diagnostic/artifacts/healthcheck/`, `diagnostic/artifacts/explain/`. Use **`.gitkeep` files** for each (these become trackable thanks to the `!diagnostic/artifacts/**/.gitkeep` exception added in `00-gitignore-exceptions`). If for any reason that exception is dropped, fall back to `KEEP` (no leading dot) as the sentinel filename.
- `00-codex-handoff-protocol` — dry-run slice that exercises the full loop mechanism end-to-end on a no-op change (e.g. add a one-line comment to `diagnostic/_handoff_test.md`). Validates: branch creation, `[slice:00-codex-handoff-protocol][awaiting-audit]` commit tag, status-field transitions in the slice file, deterministic-gate execution, Codex audit verdict, merge authority. De-risks every later slice by proving the protocol works before any real change rides on it.
- `00-tsbuildinfo-gitignore` — add `web/tsconfig.tsbuildinfo` ignore + `git rm --cached`.

**Hygiene:**
- `00-ci-workflow` — `.github/workflows/ci.yml` running the three always-gates plus the conditional gates from §6.
- `00-dep-patches` — Next 15.5.15, React 19.2.5, PostCSS 8.5.10, autoprefixer 10.5.0, @types/pg 8.20.0; `npm audit fix`. **User approval required: yes** (security-relevant).
- `00-font-network-doc` — `web/README.md` note + optional self-host fallback.
- `00-verify-script` — `npm run verify` chain.

**Baseline (gate to Phase 1):**
- `00-fresh-benchmark` * — required services: `npm run dev` running in `web/` on `:3000`, Postgres reachable, `ANTHROPIC_API_KEY` set, `OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000`. Run `npm run healthcheck:chat:intense` then `npm run healthcheck:grade:intense`. Promote results into `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<date>.{json,md}` (the runtime files in `web/logs/` are dev-sink only and remain ignored). Stop the dev server in teardown.

### Phase 1 — Performance Instrumentation
- `01-perf-trace-helpers` — `web/src/lib/perfTrace.ts` (or `serverLog.ts` extension).
- `01-route-stage-timings` — wire stages into `route.ts`.
- `01-perf-summary-route` — `/api/admin/perf-summary` (local/dev only).
- `01-baseline-snapshot` * — required services: dev server up. Capture baseline; promote to `diagnostic/artifacts/perf/01-baseline-snapshot_<date>.json`. Runtime traces in `web/logs/chat_query_trace.jsonl` remain dev sink only.

### Phase 2 — Anthropic Prompt Caching
- `02-prompt-static-prefix-split` — refactor SQL-gen / repair / synthesis builders.
- `02-cache-control-markers` — add `cache_control: ephemeral`.
- `02-cache-hit-assertion` * — assert `cache_read_input_tokens > 0` after warmup; verify ≥ 80 % hit rate.

### Phase 3 — Materialize Hot Semantic Contracts

The materialization **pattern itself** (build view → mat table → refresh hook → bidirectional `EXCEPT ALL` parity → facade → Neon-branch validation) requires user approval before the prototype slice runs, because it sets the template every other contract follows.

- `03-core-build-schema` — introduce `core_build` schema. **User approval required: yes** (defines the schema convention).
- `03-driver-session-summary-prototype` * — establishes the full pattern. **User approval required: yes**. After PASS, the pattern is locked and subsequent contracts inherit it.
- `03-laps-enriched-grain-discovery` — discovery-only slice: run the `count(*)` vs `count(DISTINCT (...))` query, document the grain, propose either a discriminator column or a heap-with-indexes strategy. Splitting discovery from materialization because the audit revealed the obvious triple is non-unique.
- `03-laps-enriched-materialize` — apply whichever strategy the discovery slice chose.
- `03-stint-summary`
- `03-strategy-summary`
- `03-race-progression-summary`
- `03-grid-vs-finish`
- `03-pit-cycle-summary`
- `03-strategy-evidence-summary`
- `03-lap-phase-summary`
- `03-lap-context-summary`
- `03-telemetry-lap-bridge` — conditional on Phase 1 numbers showing telemetry questions are slow.

### Phase 4 — Targeted Indexes
- `04-perf-indexes-sql` — schema-verified `sql/009_perf_indexes.sql`.
- `04-explain-before-after` * — required services: Postgres reachable. Capture EXPLAIN diffs into `diagnostic/artifacts/explain/04-<query>_{before,after}.txt`.

### Phase 5 — App-Layer Caches
- `05-resolver-lru` — process LRU + ingest-version invalidation.
- `05-template-cache-coverage-audit` — measure 0-LLM-path coverage; widen.
- `05-answer-cache` * — in-process LRU keyed by question + ingest version.

### Phase 6 — Neon Production Plumbing
**All Phase 6 slices require user approval before Claude starts** — they touch the production hot path or Neon billing.

- `06-driver-swap-local-fallback` — `@neondatabase/serverless` + Docker fallback. **User approval: yes**.
- `06-pooled-url-assertion` — startup check.
- `06-stmt-cache-off` — `statement_cache_size: 0`.
- `06-warm-keeper-cron` — Vercel cron / GitHub Action hitting `/api/health`. **User approval: yes** (cost / scheduling implications).
- `06-cu-rightsize` * — verify p50 connection < 50 ms; cold-start spike removed. **User approval: yes** (Neon billing change).

### Phase 7 — LLM Path Tightening + Streaming
- `07-zero-llm-path-tighten` — extend `buildDeterministicSqlTemplate`; tighten `route.ts:367` branch.
- `07-skip-repair-on-deterministic` — guard `route.ts:502`.
- `07-streaming-synthesis` * — stream + UI consumer.

### Phase 8 — Synthesis Hardening (typed fact contracts + validators)
- `08-fact-contract-shape` — Zod (or chosen lib) per question family.
- `08-synthesis-payload-cutover` — synthesis consumes typed payload.
- `08-validators-pit-stints`
- `08-validators-sector-consistency`
- `08-validators-grid-finish`
- `08-validators-strategy-evidence`
- `08-validators-count-list-parity` *

### Phase 9 — Runtime Refactor
Every split is its own slice file — Codex audits each diff in isolation.

- `09-split-chatRuntime-classification`
- `09-split-chatRuntime-resolution`
- `09-split-chatRuntime-completeness`
- `09-split-chatRuntime-recommendations`
- `09-split-chatRuntime-planTrace`
- `09-split-deterministicSql-pace`
- `09-split-deterministicSql-strategy`
- `09-split-deterministicSql-result`
- `09-split-deterministicSql-telemetry`
- `09-split-deterministicSql-dataHealth`
- `09-split-queries-catalog`
- `09-split-queries-resolver`
- `09-split-queries-sessions`
- `09-split-queries-execute`
- `09-split-route-orchestration` — pull synthesis / sanity / repair out of `route.ts`
- `09-split-answerSanity-pit-stints`
- `09-split-answerSanity-sector`
- `09-split-answerSanity-grid-finish`
- `09-split-answerSanity-strategy-evidence`
- `09-split-answerSanity-count-list`
- `09-line-count-gate` * — every refactored module < 600 LOC; test diff = 0; full type-graph still resolves.

### Phase 10 — Product Surfaces
- `10-session-detail-pace-table`
- `10-session-detail-stint-timeline`
- `10-session-detail-strategy-summary`
- `10-catalog-completeness-page`
- `10-saved-analyses-persistence`
- `10-replay-viewer-mvp` *

### Phase 11 — Quality Cleanup
- `11-rerun-benchmark-baseline` — fresh post-architecture numbers.
- `11-residual-raw-table-regressions` — re-targeted at fresh failure IDs.
- `11-valid-lap-policy-v2`
- `11-resolver-disambiguation-tightening`
- `11-multi-axis-grader-redesign` *

### Phase 12 — Production Deployment Hardening (conditional)
**All Phase 12 slices require user approval** — replica provisioning has Neon billing impact, migration runner has process implications.

- `12-read-replica-pool-split` — **User approval: yes**.
- `12-env-assertions`
- `12-migration-runner-adoption` * — **User approval: yes** (process-level change).

## 8. Failure modes and how the loop handles them

| Failure | Loop response |
|---|---|
| Codex REJECTs slice (architectural problem) | status=blocked; spawn user-decision slice; Claude does NOT proceed |
| Codex REVISEs (small fixes) | status=revising; Claude reads concrete diffs; re-submits same branch |
| Deterministic gate fails (typecheck etc.) | Claude self-revises before requesting audit; if persistent, escalate to user |
| Phase-boundary metric gate fails | phase blocks; spawn diagnostic slice; do not advance |
| Two slices merge-conflict | first to PASS wins; second rebases; Codex re-audits |
| Claude introduces unintended change outside slice scope | Codex REJECTs on "Changed files expected" mismatch |
| Neon branch validation surfaces production-only bug | spawn `XX-prod-only-investigation` slice; user-owned |
| **Slice produces files git ignores** (e.g. `.github/workflows/*` before `00-gitignore-exceptions` lands) | Codex REJECTs; verify `git status --ignored` and the artifact tracked-path gate |
| **Slice requires a service that isn't running** (dev server, Postgres) | Claude blocks self-check; documents the gap in slice file; status stays `in_progress` until env requirements are added to the slice file |
| **LLM-call slice flakes** (Anthropic 5xx, rate limit, timeout) | retry with exponential backoff up to 3 times; if still failing, status=blocked with `flaky_llm` tag; user resolves whether to wait, switch model, or increase budget |
| **Benchmark non-reproducibility** (warmth/cold variance, prompt-cache state) | benchmark slices must run twice and assert variance; if delta > 20% on the same input, mark `non_reproducible` and spawn investigation slice before treating numbers as authoritative |
| **Dirty worktree at slice start** (pre-existing user changes outside slice) | Claude refuses to start; surfaces `git status` to user; user either stashes, commits, or instructs Claude to scope around them |

## 9. Codex's round-1 answers (recorded; informs §7 ordering and §3 schema)

Codex audited round 1 of this plan and returned the following verdicts. Each item is now reflected in the plan above.

1. **Slice granularity (0.5–1.5 days):** PASS, with the caveat that all `09-*` splits and each Phase 3 contract must be enumerated as their own queue entries — done in §7.
2. **Deterministic gate set:** REVISE. Keep typecheck / tests / build always; add `npm audit --omit=dev` after dep slices, plus `python -m compileall` and `bash -n` for slices touching those surfaces — done in §6 conditional table.
3. **Branch strategy (`integration/perf-roadmap`):** REVISE. Add a `00-branch-bootstrap` slice and name explicit merge authority — done in §7 Phase 0 bootstrap block.
4. **Slice schema:** REVISE. Add `Required services / env`, `Changed files expected`, `Artifact paths`, `Gate commands`, and `user_approval_required` flag — done in §3 schema.
5. **Queue order:** REVISE. Insert `00-gitignore-exceptions` and `00-branch-bootstrap` before CI / benchmark — done in §7 Phase 0.
6. **User sign-off candidates:** confirmed for `00-dep-patches`, `00-branch-bootstrap`, `03-core-build-schema`, `03-driver-session-summary-prototype`, all Phase 6 slices, all Phase 12 slices — flagged in §7.
7. **Further splits:** confirmed Phase 9 should list each module split individually; Phase 3 `laps_enriched` should split into discovery + materialization — done in §7.
8. **Missing failure modes:** ignored artifacts, missing service/env, flaky LLM/API, benchmark non-reproducibility, dirty worktree — added to §8 table.
9. **Handoff signaling:** dual signal — slice `status` field + commit-message tag `[slice:<id>][awaiting-audit]` — recorded in §3 schema and §10.

## 9b. Codex's round-2 answers (recorded; informs §7 bootstrap and §3 schema)

1. **Conditional gates set:** PASS as-is. `eslint` / `prettier` / `ruff` / SQL formatter are NOT promoted to always-on until those tools actually exist in the repo. If a future slice introduces one, that slice also adds the corresponding always-gate.
2. **Artifact layout:** PASS, with the `.gitkeep` exception called out in `00-gitignore-exceptions` (or fallback to `KEEP` non-hidden sentinel). Done in §7.
3. **Handoff signaling:** PASS. Slice `status` + commit tag is sufficient. PR labels / `gh pr review` automation deferred until needed.
4. **LLM-flake retry policy:** stay model-agnostic. Record the model used (`anthropic-version`, model id, `cache_read_input_tokens`) into the slice's artifact JSON so post-mortem analysis can correlate flakes to model choice without baking a fallback chain into the loop.
5. **User-approval flag scope:** for production / cost / security slices, approval gates **both start and final merge** (not just start). Reflected in §4 loop step 17.

   This applies to: `00-dep-patches`, `00-branch-bootstrap`, `03-core-build-schema`, `03-driver-session-summary-prototype`, all Phase 6 slices, all Phase 12 slices.
6. **Codex handoff dry-run slice:** confirmed. `00-codex-handoff-protocol` added to §7 bootstrap, runs after `00-branch-bootstrap` and before any real implementation slice. De-risks the protocol on a no-op change.

These answers are now reflected in §3 (schema), §4 (loop), §7 (queue), and §8 (failure modes). The plan is locked pending Codex's final go-signal on this revision.

## 10. State the loop carries between iterations

Persisted in repo (so any agent picking up the loop after interruption can resume). Tracked-path artifacts only — `web/logs/` is dev sink and is git-ignored:

- `diagnostic/slices/*.md` — slice queue with statuses.
- `diagnostic/slices/_index.md` — ordered queue + cursor.
- `diagnostic/slices/_progress_log.md` — daily progress notes (Codex-authored).
- `diagnostic/artifacts/perf/*.json` — promoted perf baselines per slice (source of truth).
- `diagnostic/artifacts/healthcheck/*.{json,md}` — promoted benchmark reports per slice.
- `diagnostic/artifacts/explain/*.txt` — captured EXPLAIN diffs.
- `integration/perf-roadmap` branch state — code-level truth.
- This file (`execution_plan_2026-04_autonomous_loop.md`) — control-loop spec.
- Commit-message tags `[slice:<id>][awaiting-audit]` / `[slice:<id>][pass]` — handoff signal.

Persisted in Claude memory (per `~/.claude/projects/.../memory/`):
- Loop preferences (cadence, naming, message style) once Codex confirms them.
- User decisions on the open questions in [roadmap §7](roadmap_2026-04_performance_and_upgrade.md).

Persisted nowhere (must be re-derived each iteration):
- Working hypotheses about latency causes (always re-check perf trace, never trust prior session's intuition).

## 11. Cadence

- **Slice tick:** every time Claude completes a slice or Codex completes an audit.
- **Daily:** Codex emits a one-paragraph progress summary in `diagnostic/slices/_progress_log.md`.
- **Weekly:** user reviews; rebalances queue if priorities shifted.
- **Phase boundary:** user sign-off; phase-completion benchmark snapshot; merge integration → main.

The loop self-paces — there's no fixed clock. If Claude hits a blocker, the loop pauses on `status=blocked` until user resolves it, rather than churning.

## 12. Stopping conditions

The loop stops when any of the following hold:

- All Phase 0–8 slices PASS, the post-Phase-8 benchmark shows the headline latency outcome ([roadmap §5: cold 8–12 s → 2–3 s, warm 6–10 s → 400–800 ms, cached ~100 ms](roadmap_2026-04_performance_and_upgrade.md)), and the user accepts. Phases 9–12 become optional follow-ons.
- A phase-boundary metric gate fails three times in a row across different slice attempts (signals a model error in the roadmap, not an implementation error).
- User invokes `/loop-stop` or otherwise cancels.

---

## Codex: round-3 final go-signal

Two prior audit rounds have landed (§9 round-1 answers, §9b round-2 answers). The remaining ask is a single PASS / REVISE on the revised plan as a whole. Specifically:

1. Confirm the bootstrap block ordering — `00-gitignore-exceptions` → `00-branch-bootstrap` → `00-artifact-tree` → `00-codex-handoff-protocol` → `00-tsbuildinfo-gitignore` → `00-ci-workflow` → `00-dep-patches` → `00-font-network-doc` → `00-verify-script` → `00-fresh-benchmark` — is the order Codex wants to see executed.
2. Confirm the `.gitignore` exception block in `00-gitignore-exceptions` is sufficient (six exceptions: `.github/`, `.github/**`, `.env.example`, `web/.env.local.example`, `.gitignore`, `diagnostic/artifacts/**/.gitkeep`).
3. Confirm the merge-authority transition rule: user-only during Phase 0; Codex may merge non-approval-flagged Phase 1+ slices after Phase 0 sign-off; user-approval-flagged slices always require user merge.
4. Confirm `00-codex-handoff-protocol` is the right place to validate the handoff mechanism end-to-end before real work starts.

Once Codex says PASS on this round, this plan converts into a slice queue under `diagnostic/slices/` and the loop begins with `00-gitignore-exceptions` (the very first slice — no other change can land before the gitignore exceptions are in place, otherwise the bootstrap files themselves would be invisible to git).
