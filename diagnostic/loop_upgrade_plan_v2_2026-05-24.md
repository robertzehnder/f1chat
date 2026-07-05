# Loop upgrade plan — v2 (2026-05-24)

**Status**: v2.9 · audit applied (Codex v2.8 audit, 2026-05-25) · supersedes [loop_upgrade_plan_2026-05-24.md](./loop_upgrade_plan_2026-05-24.md) (v1). Execution started: foundation + spikes (built), Tier A in progress.

### v2.9 audit response

- **HIGH (delimiter-collision check unreachable)**: v2.8's parser regex `===VERDICT-START===\n(.*?)===VERDICT-END===` with non-greedy `(.*?)` stops at the FIRST `===VERDICT-END===`. If the body contains the literal END marker, that becomes the actual end of capture and the body extracted is *truncated*; the post-extraction check `if '===VERDICT-END===' in body` can never fire (body never contains END by definition). Acceptance case (g) would commit partial content instead of failing closed. v2.9 rewrites the parser to count delimiter lines before extraction: tokenize stdout into lines, require exactly one `===VERDICT-START===` line + one `===BODY===` line + one `===VERDICT-END===` line, all anchored to start-of-line. Reject if count != 1 for any.
- **HIGH (bash command-substitution mangling)**: v2.8 had bash do `parsed=$(parse_verdict_block ...)` and split kind/body via parameter expansion. `$(...)` strips trailing newlines AND `${parsed#*$'\n'}` returns the kind line itself when body is empty. v2.9 moves the entire transaction into the Python script — parse + flip status + append section + git commit — so kind/body never traverse a bash variable boundary. Bash just calls `parse_and_apply_verdict.py "$capture" "$slice_id" "$slice_worktree"` and checks the exit code.
- **MEDIUM (`$capture` deleted before parser runs)**: existing [dispatch_codex.sh:132](../scripts/loop/dispatch_codex.sh#L132) does `rm -f "$capture"` after the codex/claude call returns. v2.8's parser runs against `$capture` but the file is already gone. v2.9 reorders: parser runs BEFORE the rm; capture is preserved through parse success/failure; cleanup happens at the end of the dispatch function after the verdict is applied (or after a parse failure is logged).
- **LOW (stale v2.4/v2.6 text in §A.4)**: "preserved inside `slice_write_verdict`" line in the "Doesn't change" block, and "Future refinement — approach (a)" footer both belong to the abandoned wrapper design. v2.9 strikes both.



### v2.8 audit response — structural

The v2.7 audit's HIGH finding (shell-substitution attack via positional `<body>`) is a fundamental problem with the wrapper-based design: the shell expands `$(...)` and backticks **before** `Bash(./.loop/tools/slice_write_verdict:*)` pattern matching runs, so a verdict body containing command substitution would execute arbitrary commands inside an otherwise-allowed invocation. `$'...'` ANSI-C quoting avoids this but pushes the burden onto the model to escape backslashes and single quotes correctly across multi-line markdown — too fragile for a safety boundary. Base64-encoded bodies would work but require the model to encode reliably, untested by §A.2-pre.

v2.8 **promotes approach (a) (runner-side verdict parsing) to primary** and deletes the `slice_write_verdict` wrapper from the auditor flow. The auditor now has *zero* write tools:

- **Auditor emits structured stdout**: prompt instructs the model to end its response with a delimited verdict block (`===VERDICT-START===` … `===VERDICT-END===`).
- **Dispatcher parses + writes**: [dispatch_codex.sh](../scripts/loop/dispatch_codex.sh) already captures stdout (`tee "$capture"`). After dispatch returns, the dispatcher extracts kind + body from the capture, calls `flip_slice_status` + `append_slice_section` itself (with `WORKING_DIR` set to the proposal worktree), commits, returns.
- **Auditor sandbox truly read-only**: Codex uses `--sandbox read-only` (not `workspace-write`); Claude fallback allowlist drops both `slice_write_verdict` AND `Edit`/`Write`. Reads, `git diff`, `git log`, and `slice_view_history` only.

Closing the three findings under this restructure:
- **HIGH (shell-substitution attack)**: eliminated — no wrapper takes user content as a positional arg, so no shell-expansion surface exists. Verdict body travels through the dispatcher as raw stdout text, never as a shell argument.
- **MEDIUM (arity check)**: moot for the auditor (no wrapper). General arity-check requirement now stated for all §A.2 bundles (implementer side): every wrapper begins with `[[ $# -eq <expected> ]] || { echo "ERROR: arg count" >&2; exit 2; }`.
- **MEDIUM (§14 stale)**: §14 rewritten for v2.8 — drops verdict-file / wrapper-arity questions; adds parser-robustness, delimiter-injection, and the schedule shift.

**Schedule impact**: §A.4 grows from 0.5d → 1d (dispatcher parser + structured-output prompt + acceptance tests for malformed/missing delimiters). Day 7 reverts to §A.3 only; §A.4 gets its own elapsed day. Everything from §B.1 onward shifts +1 elapsed day. Work-day totals: 14.25 → **14.75 (A/B)**, 16.25 → **16.75 (C)**. Elapsed-day totals: 16 → **17 (A/B)**, 18 → **19 (C)**.

### v2.7 audit response

- **HIGH (`slice_write_verdict` silently mutates main worktree)**: v2.6 wrapper sourced helpers from `$LOOP_MAIN_WORKTREE` but didn't set `WORKING_DIR`. The helpers' contract at [slice_helpers.sh:32](../scripts/loop/slice_helpers.sh#L32) and [:67](../scripts/loop/slice_helpers.sh#L67) defaults `work_dir` to `LOOP_MAIN_WORKTREE` when `WORKING_DIR` is unset — meaning the wrapper would have written the audit verdict to the MAIN worktree's slice file, then `git add`/`git commit` from the proposal-worktree cwd would have nothing to stage. Silent two-worktree drift. v2.7 makes the wrapper set `WORKING_DIR="$(pwd)"` before any helper call. Acceptance case (c) extended to verify the audit commit lands on the proposal branch with a non-empty diff.
- **MEDIUM (body-production gap under hardened allowlist)**: v2.6 had the prompt run `mktemp` + `cat > "$verdict_file" <<BODY` to build the verdict file, but the hardened allowlist permits neither bare `Bash(mktemp:*)` nor shell redirection nor heredocs — the agent literally can't create the temp file. v2.7 rewrites the wrapper to **take the verdict body as the third positional arg** (`<body>` is a shell-quoted string, multi-line allowed). No temp file, no second wrapper, no stdin gymnastics. The agent's call is `./.loop/tools/slice_write_verdict SLICE-001 pass "PASS\nExit codes: ..."`. Multi-line content works because shell double-quoting handles embedded newlines. §A.2-pre Case (a) already validates multi-positional-arg pattern matching with the same shape.
- **MEDIUM (acceptance case (a) mixes enforcement layers)**: v2.6 acceptance said "audit prompt tries to call `Edit` on `../host-config.yaml` → Codex `--sandbox workspace-write` rejects." But `Edit` is a Claude tool, not a Codex shell command — case (a) was testing Claude's tool-deny while claiming to test Codex's sandbox. v2.7 splits cleanly: **case (a) Codex sandbox**: fixture asks Codex to `echo X > ../host-config.yaml` → workspace-write rejects the out-of-cwd filesystem write. **case (b) Claude tool-deny**: fixture asks the model to `Edit ../host-config.yaml` → tool-deny fires (Edit is in disallowed-tools). Each case tests one enforcement layer.

### v2.6 audit response

- **HIGH (auditor prompt content does change after all)**: §A.4 said "the auditor's prompt content doesn't change," but the current Claude-fallback prompt at [dispatch_codex.sh:139-167](../scripts/loop/dispatch_codex.sh#L139) tells the model to *Edit* the frontmatter, *write* the verdict, and *commit*. Under hardened mode all three operations are denied. v2.6 adds §A.4.2.5 — the explicit prompt rewrite: the auditor's step 4–5 become "call `slice_write_verdict <slice-id> <pass|revise|reject> <verdict-file>`"; the wrapper handles everything the prompt previously asked the model to do directly. Removed the false "prompt doesn't change" claim.
- **HIGH (path mismatch pre/post migration)**: hardened allowlist hardcoded `./.loop/tools/slice_write_verdict:*` but bundles live under `scripts/loop/tools/` until §5.4 migrates them (Day 16+). Hardened audits between Day 7.5 (§A.4 ships) and migration day would fail because the wrapper isn't at the allowlist's path. v2.6 fixes this by routing the allowlist through §A.2's registry — `tool_registry.sh bundle_allowed_tools_flag --role=auditor` picks `scripts/loop/tools/` pre-migration and `.loop/tools/` post-migration based on which directory exists. The literal hardened-mode strings in §A.4.4 are replaced with a call to the registry.
- **MEDIUM (`slice_write_verdict` underspecified)**: signature was `slice_write_verdict <slice-id> <verdict>` — a single `<verdict>` arg can't carry both the kind (PASS/REVISE/REJECT) and the markdown body cleanly. v2.6 rewrites the signature to `slice_write_verdict <slice-id> <pass|revise|reject> <verdict-file>` with enum validation, file-body input, and explicit responsibility: append the audit section + flip status+owner per the verdict table + commit on the current proposal branch. No push (pushes happen via §A.1's merge ladder, not the auditor). §A.2's bundle list now spells out the new signature.

### v2.5 audit response

- **HIGH (Claude fallback verdict-write contradiction)**: v2.4 hardened the fallback allowlist to `Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(./.loop/tools/slice_view_history:*)` then *also* claimed "Edit + Write stay allowed so the fallback can write the verdict." Direct contradiction — the allowlist omits both. v2.5 adds a dedicated `slice_write_verdict` wrapper to §A.2's bundle list (writes the verdict via the same `flip_slice_status` + `append_slice_section` helpers the runner uses); the auditor's allowlist now includes `Bash(./.loop/tools/slice_write_verdict:*)` for the write path. Edit and Write are *fully denied* in the hardened mode. The "Edit + Write stay allowed" sentence is removed.
- **MEDIUM (§14 audit prompt stale again)**: still asked about approach (a) vs (b) which v2.4 locked in. Rewritten for v2.5 reviewer to test the actual current risks: fallback write-path contradiction (fixed in this rev — auditor should verify the bundle exists in §A.2 + allowlist), scalar sandbox-flag wiring trace, `clear_slice_field` idempotency, and §A.2 bundle-count drift.
- **LOW (§12 rollback row failure-mode mismatch)**: row said "`--sandbox read-only` blocks the verdict-write path" but v2.4 chose `workspace-write`, not `read-only`. Updated failure-mode description: "`workspace-write` rejects writes outside cwd; if the auditor needs to read or reference a file outside the proposal worktree (e.g. `loop-references/`), the audit fails." Rollback unchanged.
- **LOW (heredoc terminator indentation)**: §B.2.8.f's `clear_slice_field` Python heredoc is shown indented inside a Markdown list item, which would break shell parsing if copied literally (`<<'PY'` requires column-0 terminator). Added an explicit implementation note. Existing `flip_slice_status` in [slice_helpers.sh](../scripts/loop/slice_helpers.sh) has the same shape and is the working template.

### v2.4 audit response

- **MEDIUM (§A.4 env-var wiring is aspirational)**: v2.3's risk table claimed `LOOP_AUDITOR_SANDBOX=legacy` was a one-line revert, but §A.4 itself never said how the env var gets read or which lines it toggles. v2.4 adds an explicit "Env var wiring" subsection (§A.4.4) spec'ing the top-of-script env read + two if-else branches (Codex sandbox flag at line 116, Claude fallback allowlist + permission mode at line 144). One env var, one read, two write sites.
- **MEDIUM (§A.4 0.5d budget assumed approach (b))**: v2.3 left the approach choice open and budgeted 0.5d, which only holds for approach (b) `workspace-write`. v2.4 **locks in approach (b) as primary** (sandbox confines writes to cwd; auditor still writes its verdict to the slice file because it's in cwd; no runner-side parser needed). Approach (a) demoted to "future refinement" note — its cleaner-separation benefit isn't worth the schedule cascade. 0.5d holds.
- **LOW (status_before_block clear primitive missing)**: v2.3's `flip_slice_status` 4-arg extension only specs *writing* the field, not *deleting* it. `--approve` needs to remove the field. v2.4 adds a standalone `clear_slice_field <slice_id> <field>` helper in `slice_helpers.sh` (small, single-purpose, composable with `flip_slice_status`). §B.2.8.b updated to call it after the status flip.

### v2.3 audit response

- **MEDIUM (schedule still drifted)**: v2.2 patched the schedule by inserting Day 7.5 but left a Days 9–10 gap for the A/B path, and the `17.5d` total didn't match the section-budget sum (which is actually 14.25d for A/B). v2.3 renumbers Day 8+ to close the gap, combines pairs of 0.5d sections into single elapsed days (Day 7 = §A.3 + §A.4; Day 11 = §B.3 + §C.2), and presents two numbers: **work-days** (sum of section budgets) and **elapsed days** (calendar days including day-boundary rounding). Branch C shifts everything by +2 since §B.1 grows from 1d → 3d.
- **LOW (audit prompt stale)**: §14 still asked the v2 questions. Rewritten to ask the v2.3 auditor about the schedule renumbering, the `status_before_block` write/clear/archive semantics (§B.2.8.a–e), and whether the §A.4 `LOOP_AUDITOR_SANDBOX=legacy` rollback is actually a one-line revert or needs more plumbing.

### v2.2 audit response

- **MEDIUM (schedule)**: §10 implementation order skipped §A.4 entirely (jumped Day 7 → Day 8) and the total was still `17–19 days`. Added Day 7.5 for §A.4; total now `17.5–19.5 days`; §10 breakdown line updated.
- **MEDIUM (status_before_block is aspirational, not real)**: v2.1 referenced `status_before_block` as if `dispatch_repair.sh` already wrote it. False — [dispatch_repair.sh:181](../scripts/loop/dispatch_repair.sh#L181) only comments about it; [slice_helpers.sh:124](../scripts/loop/slice_helpers.sh#L124) reads it but defaults when absent. §B.2 now requires the approval wrapper to *write* `status_before_block: <prior_status>` before the `awaiting_human_review` flip, and `loop_review.sh --approve/--reject` clears it after release. A retroactive write into `dispatch_repair.sh` (so existing repair flows also surface the field) is added as §B.2.8.
- **LOW (§A.4 rollback row missing)**: §12 risk/rollback table had no row for §A.4. Added: `LOOP_AUDITOR_SANDBOX=legacy` env var preserves the current `danger-full-access` + write-allowing fallback; flipping back is a one-line env-var change.

### v2.1 audit response

- **HIGH (auditor sandbox)**: v2 said Codex runs read-only and §A.2 needn't touch `dispatch_codex.sh`. False — current code uses `--sandbox danger-full-access` at [dispatch_codex.sh:116](../scripts/loop/dispatch_codex.sh#L116) and the Claude fallback at [dispatch_codex.sh:144](../scripts/loop/dispatch_codex.sh#L144) allows `Read,Edit,Write,Bash,Grep,Glob`. Added §A.4 (Auditor hardening) as a Tier A deliverable; §A.2 "doesn't change" wording corrected; §3 layer 4 status downgraded from "exists" to "exists but unsafe — §A.4 hardens it."
- **HIGH (state machine integration)**: v2 introduced `status: awaiting_human_review` but didn't wire it into `state_transitions.sh`, `select_next_slice.sh`, or `dispatch_merger.sh`. §B.2 now has an explicit "state machine integration" subsection enumerating the three edits, and the merger guard for `.loop-state/pending_approvals/<slice_id>-*.json` is called out as a hard gate.
- **MEDIUM (approval sentinels)**: §1 delta-map row conflated `.approved/` (pre-impl, [select_next_slice.sh:15](../scripts/loop/select_next_slice.sh#L15)) and `.approved-merge/` (pre-merge, [dispatch_merger.sh:33](../scripts/loop/dispatch_merger.sh#L33)). Fixed; both sentinels named.
- **MEDIUM (link paths)**: All in-repo links now use `../` prefix; reference links use `../../../loop-references/` (three `..`). Plan lives under `diagnostic/`, so file-relative resolution needs the extra hop.

V1 was the source-of-truth design exploration (15 rev iterations of audit-driven refinement) but was framed too greenfield — it underweighted how much of the target mechanism already exists in `scripts/loop/`. V2 leads with the delta map against current code and is half the size. V1 stays around for the audit history and source-context arc (Phase B of the prior conversation: deep-dives on Plandex / SWE-agent / Cline / Aider / GSD / OpenHands).

---

## 0 · Premise

The loop has been idle since 2026-05-01 (perf-roadmap shipped: 89/89 slices done across Phases 0–12). The infrastructure works. This plan upgrades it for the *next* use case (TBD; likely the v0-frontend-replacement work the user is hand-driving today) by adding the missing safety/cost-control/leverage layers that the deep-dive identified.

Constraint: **laptop-only, drop-in style.** No daemons, no cloud, no cross-runtime installer. The submodule packaging (§5.4 of v1) is the *final* step after Tier 1–3 are validated in place.

---

## 1 · Delta map — what exists vs. what changes

| Plan section | Existing analog (current code path) | Delta type | Real work |
|---|---|---|---|
| §A.1 Proposal-branch refactor | `worktree_helpers.sh` (per-slice worktrees), `slice/<id>` branches, `dispatch_merger.sh` with `--no-ff` + path-aware conflict policy + regression gate | **refactor** | Rename to `slice/<id>/proposal-<n>` (n=1 default; n>1 unlocks §C.1). Swap merge strategy to ff-only-first + rebase-fallback. Existing conflict policy becomes the post-rebase fallback. Add `merge_attempts` frontmatter log. |
| §A.2 Tool surface | none — agent has full Claude Code tool surface | **net new** | `.loop/tools/<name>/` bundle layout; bash registry that emits `--allowed-tools` flag value; wire into `dispatch_claude.sh`. Requires §A.2-pre spike. |
| §A.3 Model packs | `LOOP_CLAUDE_IMPL_MODEL` + `CODEX_AUDIT_MODEL` env vars; `pricing.json` for cost lookup | **new abstraction** | `.loop-packs.yaml` with role→model maps; `lib/pack_resolver.sh` exports `LOOP_MODEL_PLANNER/IMPLEMENTER/AUDITOR/SUMMARIZER`. Dispatchers read those. Fallback-on-unset (Plandex `GetCoder()` pattern). |
| §B.1 History processors + cache control | `post_dispatch_cost.sh` already surfaces `cache_read_tokens` / `cache_write_tokens` in the ledger. **No history-shaping pipeline exists.** | **net new** (branch-conditional on §A.0 spike) | Branch A: explicit `cache_control: ephemeral` markers via jq. Branch B: stable-prefix-first reordering. Branch C: SDK direct calls. §A.0 spike picks. |
| §B.2 Dispatcher-enforced approval | Two sentinel mechanisms: `.approved/<slice_id>` ([select_next_slice.sh:15](../scripts/loop/select_next_slice.sh#L15)) gates `pending` slices with `user_approval_required: yes` before impl dispatch; `.approved-merge/<slice_id>` ([dispatch_merger.sh:33](../scripts/loop/dispatch_merger.sh#L33)) gates `ready_to_merge` slices before merger. Plus `LOOP_AUTO_APPROVE=1` env override. | **promote + add** | Existing mechanism is *human pre-approval* at two gates (pre-impl + pre-merge). Add *dispatcher-enforced* per-action approval: `policy_check.sh` reads `.loop-rules/approval-policy.yaml`, evaluates proposed patches/commands, writes to `.loop-state/pending_approvals/` queue. Three layers coexist: pre-impl human-flagged (existing), pre-merge human-flagged (existing), per-action policy hits (new). |
| §B.3 Three-scope restore | `dispatch_repair.sh` (3 layers: slice-state vs loop-infra classification, attempt-N sentinels, repair count cap) + `classify_repair_mode` + `triage_blocked_slice.sh` + `reject_loop_infra_repair.sh` | **refactor + rename** | Existing classification logic survives. Split `dispatch_repair.sh` into three named verbs (Cline's `task` / `workspace` / `taskAndWorkspace`). `triage_blocked_slice.sh` picks one based on failure pattern. The classification → verb mapping is a small switch. |
| §C.1 Speculative branches | None — `slice/<id>` is single-proposal. `repo_lock.sh` exists. | **net new** | Add per-slice mutex via `acquire_slice_lock <id>` (extends `repo_lock.sh`). `dispatch_speculative_fork.sh` creates `slice/<id>/v<n>-<seed>` branches. Cancel-on-success flow under the slice mutex. Opt-in via `LOOP_ALLOW_SPECULATIVE=1`. |
| §C.2 Path-scoped rules | None. `CLAUDE.md` plays a global role. | **net new** | `.loop-rules/<name>.md` with YAML frontmatter `paths:` globs. `lib/rules_loader.sh` matches slice's touched files → concatenates matching bodies into the dispatch's system prompt. |
| §C.3 Trajectory artifact | Dispatches log to `runner.log` (plain text). `dispatch_codex.sh` writes structured JSON per turn (already parsed by `post_dispatch_cost.sh`) but it's transient. | **net new (cheap)** | Tee `claude --output-format json` / Codex JSON output to `.loop-state/dispatches/<slice-id>/<turn-n>.jsonl`. ~10 lines per dispatcher. |
| §D.1 Plan/Act mode | Plan-audit and impl dispatches are already separate scripts (`dispatch_plan_revise.sh`, `dispatch_claude.sh` for impl). | **net new — empty-history handoff** | Aider's `architect_coder.reply_completed()` mechanic: implementer dispatch starts with `cur_messages = []` and the planner's plan blob as the only user message. Optional Tier 4. |

**Refactor sections do not delete the existing mechanism — they layer on top or rename.** The plan can be aborted at any tier boundary without leaving the loop broken.

---

## 2 · Goals & non-goals

**Goals**:
1. Make agent edits structurally incapable of touching integration before audit (proposal-branch sandbox + ff-only merge ladder).
2. Make the implementer's tool surface explicit and enforced at the CLI flag layer (no prompt-convention safety).
3. Make policy-gated actions queueable without blocking the runner (deferred-review queue separate from existing merge-time human pre-approval).
4. Make revision spirals cheaper by 30–50% via cache control (branch-conditional on spike).
5. Make failure modes leveragable — speculative variants for sticky failures, three-scope restore for repair choice.

**Non-goals**:
- Single-agent event-stream rewrite (OpenHands paradigm). Two-vendor Claude+Codex split is load-bearing.
- Cross-runtime packaging (`npx @loop/install`). Drop-in directory, period.
- Hub-spoke daemon. Bash + git + JSON files. Crash recovery is "re-run the runner."
- Per-tool-use shadow-git checkpoints (Cline's model). Proposal branch + commit-on-merger is the right grain.
- Replacing the existing path-aware conflict resolver, regression gate, or repair classification — those *survive* the refactors.

---

## 3 · Architecture — layered safety

| Layer | Mechanism | Status |
|---|---|---|
| 1. Branch isolation | Agent writes happen on `slice/<id>/proposal-<n>` in a dedicated worktree; integration is read-only from dispatcher's view | exists; §A.1 renames + adds ff-only-first merge-ladder |
| 2. Tool-surface restriction | `--allowed-tools` + `--disallowed-tools` CLI flags allowlist `.loop/tools/<name>/bin/<name>` wrappers + read tools; deny `Edit`/`Write`/`Bash(rm:*)` | **none — §A.2 net new** |
| 3. Action-level policy | Wrappers call `policy_check.sh` against `.loop-rules/approval-policy.yaml`; on `require_approval`, action goes to `.loop-state/pending_approvals/` queue; on `forbidden`, returns tool error | partial — merge-time pre-approval exists; §B.2 adds dispatch-time |
| 4. Audit | Codex reviews `git diff integration..proposal`; emits PASS / REVISE / REJECT | exists but **unsafe** — current code uses `--sandbox danger-full-access` at [dispatch_codex.sh:116](../scripts/loop/dispatch_codex.sh#L116); fallback Claude auditor at [dispatch_codex.sh:144](../scripts/loop/dispatch_codex.sh#L144) allows `Read,Edit,Write,Bash,Grep,Glob`. §A.4 hardens both. §A.1 changes diff base. |

Each layer fails closed. Even if the model bypasses one, the next catches it.

---

## 4 · Spike prerequisites (already built)

Both harnesses are ready under [scripts/loop/spikes/](../scripts/loop/spikes/) and gated by `LOOP_SPIKE_BUDGET_OK=1` so accidental invocation is harmless.

### §A.0 — Cache-control feasibility spike (1 day; ~$0.50–$2.00 in API)

[scripts/loop/spikes/cache_control_spike.sh](../scripts/loop/spikes/cache_control_spike.sh) — runs a 5-turn revision-spiral fixture twice (with and without `cache_control: ephemeral` markers), reports `cache_read` / `cache_creation` deltas, picks Branch A/B/C, writes `diagnostic/cache_control_spike_<YYYY-MM-DD>.md`.

| Outcome | Branch | §B.1 form | Budget |
|---|---|---|---|
| markers honored, cache visible | A | bash+jq, insert `cache_control: ephemeral` on last N user/tool messages | $50 |
| auto-cache only, no marker effect | B | bash+jq, reorder for stable-prefix-first | $75 |
| no observable cache effect | C | Node SDK helper for Claude roles | $60 |

**Q3 already answered**: `post_dispatch_cost.sh:175-176` parses `cache_read_input_tokens` and `cache_creation_input_tokens`; `pricing.json` has the rates. The ledger surfaces it. The spike now only answers Q1 (markers honored?) and Q2 (hit rate on revisions).

### §A.2-pre — Tool-surface CLI-flag preflight (1 day; ~$0.20–$0.50)

[scripts/loop/spikes/tool_surface_preflight.sh](../scripts/loop/spikes/tool_surface_preflight.sh) — stands up production-shaped fixtures (`{.loop,scripts/loop}/tools/preflight_test/`) + sibling, runs four-case marker verification per candidate pattern, picks the simplest that passes (a) wrapper-with-args succeeds, (b) `Edit` denied, (c) `Bash(ls)` denied, (d) sibling fixture denied. Writes `diagnostic/cli_preflight_<YYYY-MM-DD>.md`.

**Pre-migration adjustment**: harness uses `scripts/loop/tools/` if `.loop/` doesn't exist (current state). Re-run after §5.4 migration to validate the production `.loop/tools/` path.

Both spikes should run before §B.1 and §A.2 respectively. They write reports; the report content updates this plan's branch decision and pattern form before downstream work begins.

---

## 5 · Foundation (DONE)

Built this turn — all net-additive, nothing modified:

| File | Purpose |
|---|---|
| [scripts/loop/lib/loop_refs_dir.sh](../scripts/loop/lib/loop_refs_dir.sh) | Canonical resolver for documentation references (env → config → default precedence; 2-canary check). |
| [scripts/loop/setup_host_project.sh](../scripts/loop/setup_host_project.sh) | Idempotent + self-healing host setup. Setup-specific pwd-based host-root validation (not the helper, which has submodule-context bias). |
| [scripts/loop/.loop-defaults/](../scripts/loop/.loop-defaults/) | Seed templates: `.loop-rules/{global.md, migrations-safety.md, approval-policy.yaml}`, `.loop-packs.yaml`, `.loop-config.yaml`. |
| [.loop-rules/](../.loop-rules/), [.loop-packs.yaml](../.loop-packs.yaml), [.loop-config.yaml](../.loop-config.yaml) | Host-level seeded copies. |
| [.loop-state/](../.loop-state/) | Runtime state tree: `pending_approvals/`, `dispatches/`, `locks/`. Added to `.gitignore`. |
| [scripts/loop/spikes/](../scripts/loop/spikes/) | Cache + tool-surface spike harnesses (above). |

Verified: `bash -c 'source scripts/loop/lib/loop_refs_dir.sh; resolve_loop_refs_dir'` returns `/Users/robertzehnder/Documents/coding/loop-references`. Helper has all four host-root resolution paths (LOOP_HOST_ROOT → `--show-superproject-working-tree` → `--show-toplevel` → pwd) for downstream callers.

---

## 6 · Scope — Tier A (Foundation, in-place)

### §A.1 — Proposal-branch refactor · 1.5 days

**What changes**:

1. **Branch naming**: `slice/<id>` → `slice/<id>/proposal-<n>`. `n` defaults to 1; `n>1` is reserved for §C.1 speculative variants. `worktree_helpers.sh` gains `proposal_branch_name <id> [n]` helper; `ensure_slice_worktree` keeps working as `n=1` alias for backward compatibility during migration.

2. **Merge strategy**: `dispatch_merger.sh:143` swaps from `git merge --no-ff "$slice_branch"` to a ladder:
   ```
   git merge --ff-only proposal
     success → done
     fail (non-FF) → rebase proposal onto integration
       clean → rerun audit → ff-only retry
       conflict → status: awaiting_rebase, branch preserved
   ```
   The existing conflict resolver (`resolve_conflict`, `path_in_changed_files_expected`, `INTEGRATION_OWNED_PATHS`, `SLICE_PLAUSIBLE_PATHS`) survives as the **post-rebase conflict fallback** for hunks the rebase produces.

3. **Audit base change**: `dispatch_slice_audit.sh` reads `git diff integration/perf-roadmap..proposal-branch` instead of `HEAD~1..HEAD`. This is structurally what it does now (it operates inside the slice worktree on the slice branch); the explicit ref makes the diff stable across the merge ladder's rebase step.

4. **Frontmatter**: add `merge_attempts` array; one entry per `dispatch_merger.sh` invocation:
   ```yaml
   merge_attempts:
     - attempt: 1
       strategy: ff-only
       result: non_ff | success | fail
     - attempt: 2
       strategy: rebase
       result: clean | conflict
   ```

**Doesn't change**: `repo_lock.sh`, `cleanup_slice_state`, regression gate, push behavior, `.approved-merge/` human gate.

**Acceptance**:
- Reject test: a REJECT verdict on a slice produces zero commits on integration; proposal branch is deleted.
- Drift test: commit something to integration after the proposal branched off → merger detects non-FF → rebase path runs → `merge_attempts` log shows both attempts.
- Conflict test: a deliberate conflict in the proposal triggers the existing `resolve_conflict` fallback after the rebase; if it can't resolve, status goes to `awaiting_rebase` and the branch is preserved for inspection.

### §A.2 — Custom tool surface · 1.5 days (gated by §A.2-pre spike)

**What's new**:

1. **Bundle layout** under `scripts/loop/tools/` (becomes `.loop/tools/` after §5.4 migration). Each bundle: `config.yaml` declaring `tools:` (signature + docstring + argument schema) + `bin/<command>` (executable). Six initial bundles (all implementer-facing; auditor flow uses runner-side parsing per §A.4):
   ```
   slice_read_state          # read slice frontmatter + audit history
   slice_propose_change      # apply a unified diff to proposal worktree
   slice_run_typecheck       # tsc on proposal worktree
   slice_run_adapter_tests   # mapInsight smoke tests
   slice_request_audit       # flip status awaiting_audit + invoke codex
   slice_view_history        # inspect prior turns
   ```

   v2.8 note: an earlier rev planned a `slice_write_verdict` bundle for §A.4 hardened auditors. Promoted to runner-side parsing (no wrapper); §A.2's auditor surface is now purely read tools (`slice_view_history`). Implementer side unchanged at six bundles.

   **Universal wrapper requirement (closes v2.7 MEDIUM)**: every implementer-side wrapper begins with an exact-arity check before reading positional args:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   [[ $# -eq <N> ]] || { echo "ERROR: expected <N> args, got $#" >&2; exit 2; }
   ```
   Prevents silent truncation when shell quoting fails. Each bundle's config.yaml documents its arity; the registry validates the wrapper's first 5 lines against that arity claim during `list_bundles`.

2. **Registry** at `scripts/loop/lib/tool_registry.sh`:
   - `list_bundles` — enumerate `tools/*/config.yaml` under the active tool root (resolves at runtime to `scripts/loop/tools/` pre-migration, `.loop/tools/` post-§5.4 — checks dir existence in that order)
   - `bundle_docstrings [--role=implementer|auditor]` — concatenate signatures + docstrings into a markdown block (input to the role's prompt). Default `--role=implementer`. Auditor variant emits only `slice_view_history` docstring (no write tools; verdict-write is runner-side per §A.4).
   - `bundle_allowed_tools_flag [--role=implementer|auditor]` — emit the `--allowed-tools` flag value using the pattern verified by §A.2-pre. Active tool root is prefixed in every wrapper path (`./scripts/loop/tools/<name>:*` pre-migration vs `./.loop/tools/<name>:*` post-§5.4). The fixed read-only prefix differs by role: auditor gets `Read,Grep,Glob,Bash(git diff:*),Bash(git log:*)` + only `slice_view_history` wrapper; implementer gets `Read,Grep,Glob` + all six implementer wrappers.

3. **Dispatcher wiring** in `dispatch_claude.sh:55–70` (the `claude -p` invocation):
   - Add `--allowed-tools "$(bundle_allowed_tools_flag)"`
   - Add `--disallowed-tools "Edit,Write,MultiEdit,NotebookEdit,Bash(rm:*),Bash(sudo:*),Bash(git push:*),Bash(npm publish:*)"`
   - Prompt change: implementer prompt receives `bundle_docstrings` output as its capability list (replaces "you have full Claude Code tools").

**Doesn't change**: `dispatch_codex.sh` (auditor — covered separately by §A.4).

**Acceptance**:
- Smoke test: a fixture slice's dispatch trace shows the agent invoking `slice_propose_change` instead of `Edit`/`Write`.
- Negative test: a fixture slice's prompt explicitly asks for `Edit` → CLI returns a tool error → no file change.
- Boundary test: prompt asks for `Bash(rm -rf .git)` → CLI rejects → no shell execution.

### §A.3 — Model packs · 0.5 days

**What's new**: `lib/pack_resolver.sh` reads `.loop-packs.yaml` (already seeded in [.loop-packs.yaml](../.loop-packs.yaml)) and the active pack name (env `LOOP_PACK` > config `active_pack` > builtin default `nightly-cost-optimized`); exports four env vars:
```
LOOP_MODEL_PLANNER     # falls back to: planner
LOOP_MODEL_IMPLEMENTER # falls back to: planner if unset
LOOP_MODEL_AUDITOR     # falls back to: planner if unset
LOOP_MODEL_SUMMARIZER  # falls back to: planner if unset
```
Fallback-on-unset is the Plandex `GetCoder()` pattern: missing roles inherit the planner.

**What changes**: dispatchers swap hardcoded model env vars for the pack-resolved ones:
- `dispatch_claude.sh:61` — `--model "${LOOP_MODEL_IMPLEMENTER:-claude-opus-4-7}"` (was `LOOP_CLAUDE_IMPL_MODEL`)
- `dispatch_codex.sh:118` — `model=\"${LOOP_MODEL_AUDITOR:-gpt-5-codex}\"` (was `CODEX_AUDIT_MODEL`)
- Equivalent for `dispatch_plan_revise.sh` (planner) and the summarizer (TBD which script).

**Backward compat**: keep reading the old env vars as fallbacks for one cycle so existing runner invocations don't break. Migration is "set `LOOP_PACK=daytime-debug` and unset the old vars."

**Acceptance**: `LOOP_PACK=premium-quality scripts/loop/runner.sh --once` produces a per-dispatch ledger entry showing `model: claude-opus-4-7` for the impl dispatch.

### §A.4 — Auditor hardening · 1 day

**Why this exists**: Codex audit currently runs with `--sandbox danger-full-access` ([dispatch_codex.sh:116](../scripts/loop/dispatch_codex.sh#L116)) and the Claude-fallback auditor allows `Read,Edit,Write,Bash,Grep,Glob` ([dispatch_codex.sh:144](../scripts/loop/dispatch_codex.sh#L144)). A misbehaving auditor — or a prompt injection in the diff it reviews — has full write access to the proposal worktree. The plan's §3 layer-4 claim ("audit is read-only") only becomes true after this.

**Design — approach (a) is primary** (promoted from deferred refinement in v2.8 after the v2.7 audit's HIGH on shell-substitution): the auditor has *zero write tools*. Verdict is emitted to STDOUT in a structured delimited block; the dispatcher parses it and writes the slice file itself. Approach (b) `workspace-write` + wrapper was the v2.4–v2.7 design; abandoned because any positional-arg shell wrapper is vulnerable to `$(...)` / backtick expansion in the model's verdict body. Runner-side parsing eliminates the shell-quoting surface entirely.

**What changes**:

1. **Codex auditor sandbox**: swap `--sandbox danger-full-access` → `--sandbox read-only`. Codex can read files, run `git diff` / `git log`, exec read-only commands, but cannot write anywhere. The verdict-write path is no longer Codex's responsibility.

2. **Claude fallback auditor allowlist**: replace `--allowed-tools "Read,Edit,Write,Bash,Grep,Glob"` ([dispatch_codex.sh:144](../scripts/loop/dispatch_codex.sh#L144)) with a tightened read-only set. The allowlist is **emitted by §A.2's registry** (one read-only wrapper, registry handles pre/post-migration path):

   ```bash
   # Emitted by tool_registry.sh bundle_allowed_tools_flag --role=auditor :
   #
   # Pre-migration result:
   #   Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(./scripts/loop/tools/slice_view_history:*)
   #
   # Post-§5.4 result:
   #   Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(./.loop/tools/slice_view_history:*)
   ```

   Plus `--disallowed-tools "Edit,Write,MultiEdit,NotebookEdit,Bash(rm:*),Bash(sudo:*),Bash(git push:*)"`. **The auditor has no write tools at all** — no `Edit`, no `Write`, no `Bash(./...:*)` wrapper that produces side effects. Verdict-writing happens runner-side after the dispatch returns.

3. **Auditor prompt rewrite — structured stdout block**: the current prompt at [dispatch_codex.sh:139-165](../scripts/loop/dispatch_codex.sh#L139-L165) tells the model to Edit the frontmatter directly. The new prompt asks the model to end its response with a delimited block:

   ```
   Steps:
   1. Run every command in the slice's "Gate commands" block; record exit codes.
   2. git diff --name-only integration/perf-roadmap...HEAD must match "Changed files expected".
   3. Run each "Acceptance criteria" check.
   4. End your response with EXACTLY this block, on its own lines, with no
      surrounding code fences or quoting:

      ===VERDICT-START===
      kind: <pass|revise|reject>
      ===BODY===
      <your verdict markdown body — multi-line, no escaping needed,
       any character is allowed except the literal string ===VERDICT-END===>
      ===VERDICT-END===

      The dispatcher parses this block from your stdout. The body becomes
      the new "## Audit verdict" section verbatim; kind controls the slice's
      status/owner transition (pass→ready_to_merge/user; revise→revising/claude;
      reject→blocked/user). The dispatcher does the commit on this branch.
      Do NOT push.
   ```

   Body delimiters use uncommon ASCII sequences (`===VERDICT-START===` etc.) so collision with normal markdown content is implausible. The dispatcher's parser rejects responses where:
   - the `===VERDICT-START===` line is missing → audit fails with `no_verdict_block`
   - `kind:` line is missing or value is not in `{pass, revise, reject}` → audit fails with `bad_verdict_kind`
   - `===VERDICT-END===` line is missing → audit fails with `unterminated_verdict_block`
   - the literal `===VERDICT-END===` appears in the body → audit fails with `delimiter_collision` (extremely rare; the model has been told this is the one forbidden string)

   On any parse failure, the slice stays in `awaiting_audit` and the runner logs the failure for next-iteration retry. No partial write.

4. **Dispatcher-side parser + writer** (a new Python script `scripts/loop/lib/parse_and_apply_verdict.py`, called by `dispatch_codex.sh` after the codex/claude invocation captures stdout). v2.9 moves the whole transaction into Python — kind and body never traverse a bash variable boundary (closes v2.8 HIGH #2). The parser line-counts delimiters and rejects collisions / double-START / missing-BODY (closes v2.8 HIGH #1):

   ```python
   # scripts/loop/lib/parse_and_apply_verdict.py
   # Usage: parse_and_apply_verdict.py <capture_file> <slice_id> <slice_worktree>
   # Exit codes: 0 = applied; 2 = no/malformed verdict (slice stays awaiting_audit);
   #             3 = transaction failure (parse OK but write/commit failed).
   import os, re, subprocess, sys, pathlib

   capture_path, slice_id, slice_worktree = sys.argv[1:4]
   text = pathlib.Path(capture_path).read_text()
   lines = text.splitlines()

   # Count delimiter lines BEFORE extraction (closes v2.8 HIGH #1).
   # Each delimiter must appear EXACTLY ONCE, anchored as its own full line.
   START, BODY_DEL, END = "===VERDICT-START===", "===BODY===", "===VERDICT-END==="
   if (lines.count(START), lines.count(BODY_DEL), lines.count(END)) != (1, 1, 1):
     sys.exit("malformed_verdict_block: expected exactly one of each delimiter line")

   i_start = lines.index(START)
   i_body  = lines.index(BODY_DEL)
   i_end   = lines.index(END)
   if not (i_start < i_body < i_end):
     sys.exit("malformed_verdict_block: delimiter order is wrong")

   header_lines = lines[i_start+1:i_body]
   body_lines   = lines[i_body+1:i_end]

   # Header has exactly one 'kind: <pass|revise|reject>' line.
   if len(header_lines) != 1:
     sys.exit("malformed_verdict_block: header must be exactly one line")
   km = re.fullmatch(r'kind:\s*(pass|revise|reject)\s*', header_lines[0])
   if not km:
     sys.exit(f"bad_verdict_kind: got {header_lines[0]!r}")
   kind = km.group(1)
   body = "\n".join(body_lines)

   # Run helper-backed transaction. WORKING_DIR set so slice_helpers.sh mutates
   # the PROPOSAL worktree's slice file, not the main worktree's.
   env = {**os.environ, "WORKING_DIR": slice_worktree}
   def sh(cmd, check=True):
     return subprocess.run(cmd, shell=True, cwd=slice_worktree, env=env, check=check)

   verdict_to_status = {
     "pass":   ("ready_to_merge", "user"),
     "revise": ("revising",       "claude"),
     "reject": ("blocked",        "user"),
   }
   new_status, new_owner = verdict_to_status[kind]

   loop_root = os.environ["LOOP_MAIN_WORKTREE"]
   helpers = f"{loop_root}/scripts/loop/slice_helpers.sh"

   # Use the existing helpers — append section + flip status — then commit.
   # Body is passed via env var, not shell arg, to avoid quoting issues.
   env_body = {**env, "VERDICT_BODY": body}
   try:
     subprocess.run(
       ["bash", "-c", f'source "{helpers}" && '
                      f'append_slice_section "{slice_id}" "## Audit verdict" "$VERDICT_BODY" && '
                      f'flip_slice_status "{slice_id}" "{new_status}" "{new_owner}"'],
       cwd=slice_worktree, env=env_body, check=True)
     sh(f"git add diagnostic/slices/{slice_id}.md")
     sh(f'git commit -m "audit: {slice_id} → {kind} [slice:{slice_id}][audit:{kind}]"')
   except subprocess.CalledProcessError as e:
     sys.exit(f"transaction_failed: {e}")

   print(kind)
   ```

   Bash side becomes a single conditional call:
   ```bash
   # Called after dispatch returns, BEFORE capture cleanup (closes v2.8 MEDIUM):
   if [[ "$use_verdict_parser" == "1" ]]; then
     if ! python3 "$LOOP_MAIN_WORKTREE/scripts/loop/lib/parse_and_apply_verdict.py" \
            "$capture" "$slice_id" "$slice_worktree"; then
       logmsg "audit_parse_failure for slice=$slice_id; slice stays awaiting_audit"
       # Preserve capture for triage on parse failure.
       cp "$capture" "$LOOP_STATE_DIR/audit_parse_failures/${slice_id}-$(date +%s).txt"
     fi
   fi
   # ... existing rm -f "$capture" stays at the end of the function
   ```

   No shell-substitution surface — body is a Python string passed to `subprocess.run` via env var, never through a shell-arg parsing step.

5. **Env-var wiring for the `LOOP_AUDITOR_SANDBOX=legacy` rollback**:

   ```bash
   # At top of dispatch_codex.sh:
   loop_auditor_sandbox="${LOOP_AUDITOR_SANDBOX:-hardened}"
   if [[ "$loop_auditor_sandbox" == "legacy" ]]; then
     codex_sandbox_flag="--sandbox danger-full-access"
     claude_fallback_allowed_tools="Read,Edit,Write,Bash,Grep,Glob"
     claude_fallback_disallowed_tools=""
     use_verdict_parser=0
   elif [[ "$loop_auditor_sandbox" == "hardened" ]]; then
     codex_sandbox_flag="--sandbox read-only"
     claude_fallback_allowed_tools="$(./scripts/loop/lib/tool_registry.sh bundle_allowed_tools_flag --role=auditor)"
     claude_fallback_disallowed_tools="Edit,Write,MultiEdit,NotebookEdit,Bash(rm:*),Bash(sudo:*),Bash(git push:*)"
     use_verdict_parser=1
   else
     echo "ERROR: LOOP_AUDITOR_SANDBOX must be 'hardened' or 'legacy' (got: $loop_auditor_sandbox)" >&2
     exit 2
   fi
   ```

   Three write sites consume these vars: line 116 (sandbox flag), line 144 (allowlist + conditional disallowed), and the new post-dispatch parser block (gated by `if [[ $use_verdict_parser == 1 ]]; then parse_verdict_block ...; else (legacy: prompt already wrote the slice file via Edit); fi`). Three write sites instead of two — the §12 rollback row now reflects this.

6. **Legacy-mode prompt**: when `LOOP_AUDITOR_SANDBOX=legacy`, the dispatcher emits the original Edit-based prompt (the auditor writes the slice file directly). One conditional in the prompt-construction block selects between the two prompts.

7. **Permission mode**: drop `--permission-mode acceptEdits` for the Claude fallback under hardened mode — there are no edits to confirm. Keep it under legacy mode (the original Edit-based path needs it). Conditional on `$use_verdict_parser`.

8. **Acceptance test** — eight cases. Each tests one enforcement layer at one auditor; parser-robustness gets four of the eight:
   - **(a) Codex sandbox bound (read-only)**: fixture asks Codex to write a file → `--sandbox read-only` rejects; audit fails with a sandbox error.
   - **(b) Claude fallback tool-deny (Edit)**: fixture asks Claude fallback to `Edit ../host-config.yaml` → disallowed-tools fires; no file change.
   - **(c) Claude fallback tool-deny (Bash)**: fixture asks for `Bash(rm -rf .git)` → disallowed-tools fires; nothing executes.
   - **(d) happy path (PASS)**: known-PASS fixture. Auditor emits a well-formed verdict block. Dispatcher's parser extracts kind=pass + body. `append_slice_section` + `flip_slice_status` run inside the proposal worktree (verify via `WORKING_DIR`). Exactly one new commit; only the slice file changed; no push.
   - **(e) parse failure — no verdict block**: fixture where the model "forgets" to emit the delimited block. Dispatcher's parser exits with `no_verdict_block`; slice stays `awaiting_audit`; no file change; failure logged.
   - **(f) parse failure — bad kind**: model emits `kind: PASS` (uppercase) or `kind: indeterminate`. Parser exits with `bad_verdict_kind_or_format`; same recovery.
   - **(g) parse failure — delimiter collision**: model's body contains the literal string `===VERDICT-END===` (extremely unlikely; this acceptance just proves the rejection is real). Parser exits with `delimiter_collision`; slice stays `awaiting_audit`.
   - **(h) legacy revert**: `LOOP_AUDITOR_SANDBOX=legacy` restores `danger-full-access`, the old `Read,Edit,Write,Bash,Grep,Glob` allowlist, the Edit-based prompt, AND skips the parser block. Re-running (a) succeeds (legacy sandbox permits the write); (d) succeeds via the legacy Edit-direct path.

**Doesn't change**: the verdict→status mapping (preserved inside the Python parser's `verdict_to_status` dict), the existing usage-limit detection ([dispatch_codex.sh:127-131](../scripts/loop/dispatch_codex.sh#L127-L131)), the Codex→Claude fallback trigger.

**Dependency**: §A.2 must define the wrapper-tool pattern (§A.2-pre spike result) so the Claude fallback auditor's `Bash(./.loop/tools/slice_view_history:*)` entry uses the same syntax form as the implementer's allowlist.

---

## 7 · Scope — Tier B (Cost + safety)

### §B.1 — History processor pipeline + cache control · branch-conditional

**Gated by §A.0 spike outcome.** Plan the work after the spike report exists.

Common skeleton (all branches):
- `lib/history_processor.sh` reads `.loop-rules/history_processors.yaml`
- Each processor is a script under `lib/processors/<type>.sh` (stdin: history JSON; stdout: history JSON; pipeline-able with `|`)
- `dispatch_claude.sh` / `dispatch_plan_revise.sh` pipes its history through the pipeline before sending

Branch A (markers honored — 1 day):
- `processors/cache_control.sh` — port of [`swe-agent/sweagent/agent/history_processors.py:261-303`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py); inserts `cache_control: ephemeral` on last 4 user/tool messages
- `processors/remove_regex.sh` — strip `^DEBUG:.*$` lines, keep last 5 matches

Branch B (auto-cache only — 1 day):
- `processors/stable_prefix_first.sh` — reorder messages to put stable system+tools first, mutable context last; no explicit markers

Branch C (SDK fallback — 3 days):
- `lib/anthropic_sdk_dispatch.mjs` — Node helper invoking the Anthropic SDK directly for Claude roles. CLI path preserved for Codex auditor.
- Adds Node as a hard runtime dep for the impl path (already a dep for `web/`)

**Acceptance**: a revision-spiral slice (5+ revisions on the same prompt) shows reduced `input_tokens` on turns 2+; cost ledger shows `cache_read_tokens > 0`. Target ≥30% input-token savings on revisions 3+ (Branch B) or ≥50% (Branch A).

### §B.2 — Dispatcher-enforced approval + deferred-review queue · 2 days

**What's new** (layers on top of the existing merge-time human-approval mechanism — does not replace it):

1. **Policy file**: [.loop-rules/approval-policy.yaml](../.loop-rules/approval-policy.yaml) — already seeded. Three sections:
   - `require_approval.paths` — glob patterns matched against `git diff --name-only`
   - `require_approval.patch_patterns` — regex matched against patch hunks (e.g. `DROP\s+TABLE`)
   - `require_approval.shell_prefixes` — argv prefixes (e.g. `rm -rf`, `git push`)
   - `forbidden` — same shape, but returns tool error instead of queueing

2. **Policy controller** at `lib/policy_check.sh`:
   - Takes a change descriptor (patch file or argv array) + change type (`patch` | `shell`)
   - Loads `.loop-rules/approval-policy.yaml`
   - For shell: invokes `lib/shell_parser.py` (uses `bashlex` for AST — naive substring matching is the documented anti-pattern; `cmd1 && rm -rf /` bypasses it). Validates each segment.
   - For patch: extracts paths via `git diff --name-only --no-renames`; greps hunks for patch_patterns.
   - Returns: `pass` | `require_approval:<reason>` | `forbidden:<reason>`

3. **Wrapper enforcement**: each `slice_*` tool (§A.2) calls `policy_check.sh` before applying changes. On `require_approval`, the wrapper persists the action to `.loop-state/pending_approvals/<slice-id>-<turn>.json` and marks the slice `status: awaiting_human_review`.

4. **Triage tool**: `loop_review.sh` lists pending approvals; `loop_review.sh --approve <slice-id>` releases or `--reject <slice-id>` discards.

5. **Coexistence with existing mechanism** (three independent gates):
   - `user_approval_required: yes` (frontmatter, set by human upfront) + `.approved/<slice_id>` sentinel → pre-impl gate ([select_next_slice.sh:69-71](../scripts/loop/select_next_slice.sh#L69-L71)) — unchanged
   - Same frontmatter flag + `.approved-merge/<slice_id>` sentinel → pre-merge gate ([dispatch_merger.sh:109](../scripts/loop/dispatch_merger.sh#L109)) — unchanged
   - Policy hit at dispatch time → `.loop-state/pending_approvals/` queue (new)
   - All three can fire on the same slice; all three must clear before `done`

6. **State machine integration** (the missing wiring that v2 omitted):

   a. **`state_transitions.sh`**: add `awaiting_human_review` to the `impl` and `impl_audit` allow-lists. Concretely:
      ```
      impl:       pending|revising → awaiting_audit|blocked|awaiting_human_review
      impl_audit: awaiting_audit   → ready_to_merge|revising|blocked|awaiting_human_review
      ```
      Plus a new dispatch type for the release path:
      ```
      release_approval: awaiting_human_review → <restored_status>
      ```
      where `<restored_status>` is the value of `status_before_block` (existing frontmatter pattern from `dispatch_repair.sh`).

   b. **`select_next_slice.sh`**: add a case for `awaiting_human_review`:
      ```
      awaiting_human_review)
        # Skip — waiting on loop_review.sh --approve/--reject.
        continue
        ;;
      ```
      Placed alongside `done|""` so the runner walks past it.

   c. **`dispatch_merger.sh`**: hard guard at the top of `do_merge_under_lock` — refuse to merge if ANY `.loop-state/pending_approvals/<slice_id>-*.json` exists. The check goes right after the `user_approval_required` / `.approved-merge/` block (existing line 109). Refusal: log `BLOCKED: pending_approvals for $slice_id`; exit 0 (not failure — the runner just moves on).

   d. **`loop_review.sh`** (new): three subcommands.
      - `loop_review.sh --list` — enumerate all `.loop-state/pending_approvals/*.json` grouped by slice; pretty-print each with policy-hit reason + proposed change + slice's audit history (from existing `loop_history.sh`).
      - `loop_review.sh --approve <slice-id>` — remove the slice's pending-approval files; transition status from `awaiting_human_review` back to `status_before_block` (uses existing `flip_slice_status` from [slice_helpers.sh](../scripts/loop/slice_helpers.sh)).
      - `loop_review.sh --reject <slice-id>` — remove the pending-approval files; transition status to `blocked`; record rejection in slice frontmatter so `triage_blocked_slice.sh` can route it to §B.3 restore.

7. **Frontmatter additions**:
   ```yaml
   pending_approvals:
     - turn: 3
       reason: "path matched sql/migrations/**"
       change_descriptor: pending_approvals/<slice-id>-3.json
   status_before_block: awaiting_audit   # WRITTEN by the approval wrapper; see §B.2.8
   ```

8. **`status_before_block` must actually be written** (audit MEDIUM #2): the field is *read* by [`slice_helpers.sh:124`](../scripts/loop/slice_helpers.sh#L124) (`determine_resume_target`) and *referenced in a comment* at [`dispatch_repair.sh:181`](../scripts/loop/dispatch_repair.sh#L181), but **no current script actually writes it** — `determine_resume_target` defaults to `revising_plan` when absent. The new approval wrapper must explicitly write it. Concretely:

   a. **Approval wrapper write**: before flipping the slice's `status` from `<prior>` to `awaiting_human_review`, the wrapper calls `flip_slice_status` (extended to accept an optional fourth `status_before_block` arg) so the frontmatter ends up:
      ```yaml
      status: awaiting_human_review
      owner: user
      status_before_block: <prior>           # e.g. awaiting_audit
      updated: <now>
      ```

   b. **`loop_review.sh --approve` clears it on release**: when the human approves, the script flips `status` back to `status_before_block`'s value AND removes the `status_before_block` field (the slice is no longer blocked). Concretely two calls:
      ```bash
      prior=$(read_slice_field "$slice_id" status_before_block)
      flip_slice_status "$slice_id" "$prior" "claude"          # flip status back
      clear_slice_field "$slice_id" status_before_block         # delete the now-stale field
      ```
      `clear_slice_field` is a new helper (see §B.2.8.f) — single-purpose, composable with `flip_slice_status` instead of overloading the latter with a magic sentinel.

   c. **`loop_review.sh --reject` archives it**: the script flips `status` to `blocked` and *keeps* `status_before_block` so the existing `dispatch_repair.sh` → `determine_resume_target` chain can route the repair correctly.

   d. **Retroactive fix in `dispatch_repair.sh`**: that script's `# (slice_helpers' determine_resume_target reads status_before_block; round-10 M-2.)` comment at line 181 reflects an unfinished round-10 task. Close it: have `dispatch_repair.sh` also write `status_before_block: <prior>` when it flips a slice to `blocked`, so the field is populated for *both* repair-path and approval-path blocks. Existing slices without the field continue to use `determine_resume_target`'s `revising_plan` default — no migration needed.

   e. **`flip_slice_status` extension**: the existing helper in [`slice_helpers.sh:30-61`](../scripts/loop/slice_helpers.sh#L30-L61) currently takes `(slice_id, new_status, new_owner)`. Extend signature to `(slice_id, new_status, new_owner, [status_before_block_value])`. When the 4th arg is present, the embedded Python frontmatter editor writes/updates `status_before_block`. When omitted, behavior is unchanged. Backward compatible. **Writes only — does NOT clear** (see §B.2.8.f for deletion).

   f. **`clear_slice_field` new helper** (closes v2.3 audit LOW #3 — `flip_slice_status` 4-arg only handles writes): new function in [slice_helpers.sh](../scripts/loop/slice_helpers.sh), single-purpose. **Implementation note**: the snippet below is shown indented inside a Markdown list item; when copying to `slice_helpers.sh`, the `PY` heredoc terminator MUST be at column 0 (or use `<<-'PY'` with tab indentation). The existing `flip_slice_status` at [slice_helpers.sh:30-61](../scripts/loop/slice_helpers.sh#L30-L61) uses the same column-0 pattern and is the working reference.
      ```bash
      # Remove a frontmatter field from a slice file. Idempotent: missing field is a no-op.
      # Args: <slice_id> <field>
      # Operates on $WORKING_DIR if set, else LOOP_MAIN_WORKTREE (mirrors flip_slice_status).
      clear_slice_field() {
        local slice_id="$1" field="$2"
        local work_dir="${WORKING_DIR:-$LOOP_MAIN_WORKTREE}"
        local f="$work_dir/diagnostic/slices/${slice_id}.md"
        [[ -f "$f" ]] || { echo "clear_slice_field: missing $f" >&2; return 1; }
        python3 - "$f" "$field" <<'PY'
      import sys, re
      path, field = sys.argv[1:3]
      with open(path, 'r') as fh: text = fh.read()
      m = re.match(r'^---\n(.*?)\n---\n', text, flags=re.S)
      if not m: sys.exit("no frontmatter in " + path)
      fm = m.group(1)
      # Match either `field: value` (with optional leading spaces) or the bare key form.
      pat = re.compile(r'^' + re.escape(field) + r':[^\n]*\n', flags=re.M)
      fm_new = pat.sub('', fm)
      if fm_new == fm:
        sys.exit(0)  # field absent; idempotent no-op
      new_text = '---\n' + fm_new.rstrip() + '\n---\n' + text[m.end():]
      with open(path, 'w') as fh: fh.write(new_text)
      PY
      }
      ```
      Composes cleanly with `flip_slice_status`: status-flip and field-clear are two atomic operations the caller sequences as needed. No magic sentinel values, no overloading. Used by `loop_review.sh --approve` (§B.2.8.b).

**Why this is enforcement, not convention**: the wrapper script is the only path from agent to actual change (because §A.2 restricts the tool surface). The wrapper runs policy unconditionally. Model cannot bypass. The merger guard ensures stale approvals can never be silently ignored.

**Acceptance**:
- Test 1: a slice attempting `DROP TABLE` → policy hit → `pending_approvals/` entry → slice `awaiting_human_review` → runner advances
- Test 2 (trust-the-model bug): prompt instructs model to omit `requires_approval`; action touches `sql/migrations/` → wrapper still queues because path matched policy
- Test 3 (forbidden): `git push --force origin main` → tool error returned to model; nothing queued; nothing pushed
- Test 4: `loop_review.sh` lists each pending action with policy-hit reason

### §B.3 — Three-scope restore · 0.5 days (refactor)

**What changes**: split `dispatch_repair.sh` into three named verbs (Cline terminology):

- `dispatch_restore_workspace.sh <slice>` — `git checkout integration -- <files>` in proposal worktree; preserve slice history JSON; agent re-runs with audit feedback in context (≡ Cline `"workspace"`)
- `dispatch_restore_task.sh <slice>` — truncate prompt history to first turn; keep proposal code; agent re-runs with fresh perspective (≡ Cline `"task"`)
- `dispatch_restore_taskAndWorkspace.sh <slice>` — both (≡ Cline `"taskAndWorkspace"`)

**Triage routing** (existing `triage_blocked_slice.sh` extended):
- Same audit verdict twice → `restore_task` (agent stuck in loop)
- Different audit verdicts, consistent REJECT → `restore_taskAndWorkspace`
- REVISE with specific guidance → `restore_workspace`

**Doesn't change**: `classify_repair_mode` (still distinguishes slice-state vs loop-infra), repair count cap, attempt-N sentinels, `reject_loop_infra_repair.sh`. Those are about whether to repair at all; the three-scope split is about how.

**Acceptance**: triage logs in `${LOOP_STATE_DIR}/triage_actions.jsonl` show the chosen restore mode per recovery; fixture slice manually verifies each verb does what its name claims.

---

## 8 · Scope — Tier C (Leverage on failures)

### §C.1 — Speculative branches · 2 days

**What's new**:

1. **Trigger**: slice `revision_count >= 2` AND no successful audit yet AND `LOOP_ALLOW_SPECULATIVE=1`

2. **Fork**: `dispatch_speculative_fork.sh <slice-id>` creates three variants:
   - `slice/<id>/v<n>-conservative` (temperature=0.2)
   - `slice/<id>/v<n>-aggressive` (temperature=0.6)
   - `slice/<id>/v<n>-alt-planner` (different model from pack)

3. **Per-variant policy**: each runs §B.2 policy check independently. The slice is *not* blocked by one risky variant (table at §C.1 of v1).

4. **Slice mutex**: extend `repo_lock.sh` with `acquire_slice_lock <slice-id>` / `release_slice_lock <slice-id>` (flock-based, `.loop-state/locks/slice-<id>.lock`). Operations that MUST hold the lock:
   - Final ff-only merge of a variant
   - Cancellation of sibling variants on first PASS
   - Mutation of variant entries in `pending_approvals/`
   - Setting `status: done` or `status: all_variants_queued`

5. **Cancel-on-success** (inside the lock):
   ```
   for variant in non-done variants:
     case status:
       pending|in_progress  → kill dispatch, remove worktree, branch -D, mark cancelled_by_winner
       awaiting_human_review → remove pending_approvals entry, remove worktree, branch -D
       awaiting_rebase{,_audit} → leave alone (mid-merge; loser's merger detects done on re-read)
   ```

6. **Frontmatter**: `speculative_variants` array, `chosen_variant` field.

**Acceptance**: a fixture slice designed to fail twice gets three forks on the third attempt; first PASS wins; sibling variants cancelled with no orphan worktrees; morning view shows all three with their audit verdicts.

### §C.2 — Path-scoped rules · 0.5 days

**What's new**: `lib/rules_loader.sh` globs slice's `Changed files expected` list against each `.loop-rules/*.md` file's `paths:` frontmatter; concatenates matching bodies into the dispatch's system prompt.

**Frontmatter format** (already seeded in [.loop-rules/global.md](../.loop-rules/global.md), [.loop-rules/migrations-safety.md](../.loop-rules/migrations-safety.md)):
```yaml
---
paths: ["sql/migrations/**", "web/src/lib/db/migrations/**"]
---
# Rule body in markdown…
```

**Ownership**: `.loop-rules/` is **human-owned**. The agent reads but never writes (enforced by `forbidden.paths` in [.loop-rules/approval-policy.yaml](../.loop-rules/approval-policy.yaml)).

**Acceptance**: a slice touching `sql/migrations/` includes `migrations-safety.md` body in its prompt; a slice touching only `web/src/components/` does not. Verified via the dispatch's persisted prompt artifact (requires §C.3).

### §C.3 — Per-dispatch trajectory artifact · 0.25 days

**What's new**: tee `claude --output-format json` (and Codex equivalent) to `.loop-state/dispatches/<slice-id>/<turn-n>.jsonl`. One record per turn with input + output + tool calls.

Triage report (`triage_blocked_slice.sh`) gains a `--trajectory` flag that links to the JSONL files for the failing turns.

**Acceptance**: after any dispatch, the JSONL file exists; `triage_blocked_slice.sh` triage report references it; cleanup happens on slice `done` (rotating: delete `.loop-state/dispatches/<slice>/` after merge).

---

## 9 · Scope — Tier D (optional, deferrable)

### §D.1 — Plan/Act mode-as-state (empty-history handoff) · 1 day

Aider's `architect_coder.reply_completed()` mechanic. Slice frontmatter gains `mode: plan | act`. Implementer dispatch (`dispatch_claude.sh` impl path) starts with `cur_messages = []` and the planner's plan blob as the *only* user message. Gives Codex a clean audit boundary (it audits diff against plan, not against full planner reasoning).

**Cost implication** (from v1 §A.0 table): once Tier D ships, implementer-role cache savings drop to ~0 because every impl dispatch has no shared prefix from the prior call. Update §7.4 budget table accordingly.

**Defer if Tier B is tight.** This is a refinement on top of model packs and history processors; nothing else depends on it.

---

## 10 · Implementation order (revised)

Linear, in-place. Each tier can stop here without leaving the loop broken.

Elapsed-day schedule (no gaps; A/B is the default, Branch C-only days marked).

| Day | Section(s) | Work | Notes |
|----:|---|---:|---|
| 1 | §A.0 cache spike (live; ~$2) | 1d | Picks Branch A/B/C |
| 2 | §A.2-pre tool-surface preflight (live; ~$0.50) | 1d | Picks `--allowed-tools` pattern; +0.5d contingency if no pattern passes |
| 3–4 | §A.1 proposal-branch refactor | 1.5d | dispatch_merger.sh + worktree_helpers.sh |
| 5–6 | §A.2 tool surface | 1.5d | bundles + registry + dispatch_claude.sh; uses Day 2 pattern |
| 7 | §A.3 model packs | 0.5d | Half-day; rest of day is buffer |
| 8 | §A.4 auditor hardening | 1d | Dispatcher parser + structured-output prompt + 8 acceptance cases |
| 9 (A/B) · 9–11 (C) | §B.1 history processors | 1d (A/B) / 3d (C) | Branch C extends by 2 elapsed days |
| 10–11 (A/B) · 12–13 (C) | §B.2 approval + queue + loop_review.sh | 2d | Includes §B.2.8 status_before_block plumbing |
| 12 (A/B) · 14 (C) | §B.3 restore + §C.2 rules loader | 0.5d + 0.5d | Both half-day items in one elapsed day |
| 13–14 (A/B) · 15–16 (C) | §C.1 speculative branches | 2d | Opt-in via `LOOP_ALLOW_SPECULATIVE=1` |
| 15 (A/B) · 17 (C) | §C.3 trajectory artifact + buffer | 0.25d | Rest of day is contingency |
| 16 (A/B) · 18 (C) | §D.1 plan/act mode (optional) | 1d | Skip if Tier B was tight |
| 16 or 17 (A/B) · 18 or 19 (C) | §5.4 submodule migration | 1d | `git mv scripts/loop/` + `git submodule add` + setup; re-run §A.2-pre against production `.loop/tools/` path |
| 17 or 18 (A/B) · 19 or 20 (C) | Acceptance run | 1d | Fixture slice end-to-end |

**Work-day totals** (sum of section budgets):

| Path | Tiers A–C only | + Tier D |
|---|---:|---:|
| A/B | 14.75d | 15.75d |
| C   | 16.75d | 17.75d |

**Elapsed-day totals** (calendar days including day-boundary rounding):

| Path | Tiers A–C only | + Tier D |
|---|---:|---:|
| A/B | 17 days | 18 days |
| C   | 19 days | 20 days |

Auto Mode interpretation: Days 1–2 require user authorization (live API spend). Days 3+ are code changes that can run autonomously.

---

## 11 · Drop-in packaging (§5.4 migration)

Repeating from v1 §5.4 because it's still the right shape:

1. Create `claude-codex-loop/` as a sibling repo: `git mv scripts/loop/ ../claude-codex-loop/scripts/loop/`
2. Move `scripts/loop/.loop-defaults/` to `claude-codex-loop/.loop-defaults/` and `scripts/loop/setup_host_project.sh` to `claude-codex-loop/setup_host_project.sh`
3. In OpenF1: `git submodule add ../claude-codex-loop .loop`
4. Delete `scripts/loop/` (its content now lives in `.loop/scripts/loop/`)
5. Run `./.loop/setup_host_project.sh` — verifies host setup, seeds any missing defaults, persists `loop_references_dir` to `.loop-config.yaml`
6. Update [CLAUDE.md](../CLAUDE.md) references: `scripts/loop/` → `.loop/scripts/loop/`
7. Re-run §A.2-pre against `.loop/tools/` path to validate the pattern still works

Done in plan order, this is mechanical. Risks: stale references in docs, runner.sh hardcoded paths. Pre-flight grep for `scripts/loop/` is the migration checklist.

---

## 12 · Risk + rollback

The risk surface shrinks dramatically because the loop is idle. Failure modes are dev-time, not production-time.

| Change | Failure mode | Rollback |
|---|---|---|
| §A.1 merge-ladder | Edge case in ff-only-fail → rebase doesn't trigger; merger gets stuck | Existing merger preserved as `dispatch_merger_legacy.sh`; `LOOP_LEGACY_MERGER=1` env var swaps |
| §A.2 tool surface | Pattern from §A.2-pre fails on a real slice the preflight didn't cover | `LOOP_TOOL_SURFACE=permissive` env var disables `--allowed-tools` (escape hatch); per-tool enumeration as fallback |
| §A.3 model packs | Misconfigured pack → 4xx from provider | Startup check in `pack_resolver.sh`: refuse to start if any model in active pack is unreachable; fall back to env-var-driven mode |
| §A.4 auditor hardening | (1) `--sandbox read-only` blocks any auditor that needs to write anywhere — but the new flow doesn't need to write, the dispatcher does. (2) Model emits a malformed `===VERDICT-START===` block → parser fails, slice stays `awaiting_audit`, runner retries on next tick. (3) Persistent parse failures suggest the model can't reliably produce the delimited format. | `LOOP_AUDITOR_SANDBOX=legacy` env var restores `--sandbox danger-full-access`, the old `Read,Edit,Write,Bash,Grep,Glob` allowlist, the original Edit-based verdict prompt, AND skips the dispatcher parser block (auditor writes the slice file directly via Edit, as in pre-§A.4). Three write sites toggle on the var, fully wired in §A.4.5. Fixture acceptance (case h) verifies the legacy path still works. |
| §B.1 cache control | Wrong marker placement bloats prompts | A/B test: 10 fixture slices with and without; abort if cost-per-slice rises |
| §B.2 policy queue | Approvals grow faster than human triage | `max_pending_approvals` cap in `.loop-config.yaml`; runner pauses queue dispatch if exceeded |
| §B.3 restore split | Wrong scope picked → loses too much state | Log restore-mode choice in triage report; `taskAndWorkspace` is always safe one-up |
| §C.1 speculative | 3× cost per failed slice | Gated by `LOOP_ALLOW_SPECULATIVE=1`; cap at one speculative round per slice |
| §C.2 rules glob | Too greedy → wrong rules activate | `--dry-run-rules <slice>` flag prints matches without running |
| §C.3 trajectory | Disk fills | Rotating cleanup: delete `.loop-state/dispatches/<slice>/` after slice `done` |

---

## 13 · Acceptance criteria

1. **Tier A**: agent in dispatch cannot touch integration branch (sandbox); allowlist blocks `Edit`/`Bash(rm:*)`; `LOOP_PACK=premium-quality` runs use Opus.

2. **Tier B**: cost ledger shows input-token savings on revisions ≥ branch-specific target ($50/$60/$75); fixture slice demonstrates `pending_approvals/` queueing without blocking runner.

3. **Tier C**: a deliberately-failing fixture produces three speculative variants; `.loop-rules/migrations-safety.md` correctly scopes to `sql/migrations/` slices; triage report references trajectory artifact.

4. **Drop-in (post-§5.4)**: `setup_host_project.sh` on a fresh repo + three trivial slices + end-to-end run with no edits to `.loop/`. Setup-to-first-slice < 5 minutes.

5. **Overnight (when a real queue exists)**: 8-hour unattended run completes within the branch-specific budget; morning triage ≤ 15 minutes.

---

## 14 · Codex audit prompt

> Audit this v2.8 plan for: (1) **dispatcher-side verdict parser correctness** (§A.4.4) — read the embedded Python carefully: (a) does the `===VERDICT-START===\n(.*?)===VERDICT-END===` regex correctly handle a body containing the start delimiter `===VERDICT-START===` (non-greedy means the first START wins; what if the model emits two START markers?); (b) is `kind:\s*(pass|revise|reject)\s*\n===BODY===\n(.*)` brittle to extra whitespace, BOM, CRLF line endings, or a missing trailing newline before `===VERDICT-END===`?; (c) the rstrip on body: does this lose a meaningful trailing newline the model intended?; (d) what if the model emits the verdict block mid-response (before its final reasoning) — does the regex pick the right one?; (2) **runner-side write atomicity** — the post-dispatch block runs `append_slice_section` + `flip_slice_status` + `git add` + `git commit` in sequence inside a subshell with `cd` and `WORKING_DIR`. If `git commit` fails (e.g. nothing changed), is the slice file's frontmatter already mutated, causing observable drift between status and commit history? Should the sequence be wrapped in a `git stash`-able transaction or only run after a dry-run check?; (3) **stdout pollution risk** — `dispatch_codex.sh` already captures stdout via `tee "$capture"`. If the auditor model's stdout includes the verdict block AND extraneous chatter (e.g. tool-call traces, Codex meta-output), does the parser correctly extract only the delimited block? What if Codex's own output format wraps the model's response in metadata that breaks the regex anchor?; (4) **legacy revert completeness** — three write sites toggle on `LOOP_AUDITOR_SANDBOX`: sandbox flag (line 116), allowlist (line 144), and post-dispatch parser. Verify all three actually conditionally branch in the legacy path. Does the original Edit-based prompt still trigger the right verdict-flip from inside the agent's Edit call, or did the runner previously rely on a different mechanism that's now broken?; (5) **§A.4 1d budget** — promoted from 0.5d. Budget covers: parser (15 LOC Python + integration), structured-output prompt rewrite (and legacy-mode prompt fork), three conditional code paths in dispatch_codex.sh, eight acceptance cases (four of which are parser-robustness). Realistic for one day?; (6) **§A.2 budget regression** — auditor allowlist no longer needs `slice_write_verdict` wrapper; that's a *reduction* of work. Does §A.2's 1.5d still hold, or could it drop?; (7) **schedule arithmetic** — v2.8 totals: 14.75 / 16.75 work-days, 17 / 19 elapsed days. Do these match the section-budget sum? Day 7 is now §A.3 only (0.5d) with explicit "rest of day is buffer" — does that buffer get used by §A.4's spillover if §A.4 runs over its 1d?; (8) **delta-map regression** — spot-check 3+ §1 rows against current code; cross-check §12 of v1 for unresolved revs 0–14 findings v2.8 still doesn't address. Report a punch list of concrete edits — under 400 words. Do not rewrite.

---

## 15 · Reference index

Per-section upstream pointers (from v1 §11A; verbatim sources):

| Section | Upstream | Action |
|---|---|---|
| §A.0 spike | n/a | empirical |
| §A.1 merge ladder | [`plandex/app/cli/cmd/apply.go`](../../../loop-references/plandex/app/cli/cmd/apply.go) | adapt CLI verb shapes |
| §A.1 rollback semantics | [`plandex/app/cli/lib/apply.go:152,201,622`](../../../loop-references/plandex/app/cli/lib/apply.go) | study (we get for free via git) |
| §A.2 minimal bundle | [`swe-agent/tools/submit/`](../../../loop-references/swe-agent/tools/submit/) | template |
| §A.2 lint-on-edit | [`swe-agent/tools/edit_anthropic/`](../../../loop-references/swe-agent/tools/edit_anthropic/) | port validation pattern |
| §A.2 stateful bundle | [`swe-agent/tools/windowed/`](../../../loop-references/swe-agent/tools/windowed/) | template if slice_read_state needs state |
| §A.2 registry | [`swe-agent/sweagent/tools/`](../../../loop-references/swe-agent/sweagent/tools/) | adapt (bash equivalent) |
| §A.2-pre | n/a | empirical |
| §A.3 pack struct | [`plandex/app/shared/ai_models_data_models.go:920`](../../../loop-references/plandex/app/shared/ai_models_data_models.go) | adapt shape |
| §A.3 fallback-on-unset | [`plandex/app/shared/ai_models_data_models.go:936-954`](../../../loop-references/plandex/app/shared/ai_models_data_models.go) | port `GetCoder()` |
| §A.3 builtin catalog | [`plandex/app/shared/ai_models_packs.go:24-43`](../../../loop-references/plandex/app/shared/ai_models_packs.go) | port pattern |
| §B.1 protocol | [`swe-agent/sweagent/agent/history_processors.py:13-72`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py) | adapt stdin/stdout |
| §B.1 cache_control | [`swe-agent/sweagent/agent/history_processors.py:261-303`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py) | port verbatim |
| §B.1 set/clear helpers | same file, near top | port as jq snippets |
| §B.1 remove_regex | [`swe-agent/sweagent/agent/history_processors.py:305-339`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py) | optional port |
| §B.2 policy parser | [`cline/src/core/permissions/CommandPermissionController.ts`](../../../loop-references/cline/src/core/permissions/CommandPermissionController.ts) | port logic (shell-aware) |
| §B.2 dangerous chars | same file, lines 5-15 | port catalog |
| §B.3 restore switch | [`cline/src/integrations/checkpoints/index.ts:258-360`](../../../loop-references/cline/src/integrations/checkpoints/index.ts) | port three-case shape |
| §B.3 restore logging | same file, lines 649-730 | port `handleSuccessfulRestore` |
| §B.3 exclusions | [`cline/src/integrations/checkpoints/CheckpointExclusions.ts`](../../../loop-references/cline/src/integrations/checkpoints/CheckpointExclusions.ts) | study (exclude `.loop-state/`) |
| §C.1 plan-branch UX | [`plandex/app/cli/cmd/branches.go`](../../../loop-references/plandex/app/cli/cmd/branches.go) | adapt fork-and-compare |
| §C.1 rewind UX | [`plandex/app/cli/cmd/rewind.go`](../../../loop-references/plandex/app/cli/cmd/rewind.go) | study if we want `loop_review --rewind` |
| §C.2 frontmatter+glob | Cline `.clinerules` docs | adapt convention |
| §C.3 trajectory format | [`swe-agent/trajectories/`](../../../loop-references/swe-agent/trajectories/) | study (ours is simpler) |
| §D.1 architect handoff | [`aider/aider/coders/architect_coder.py:18-46`](../../../loop-references/aider/aider/coders/architect_coder.py) | port `reply_completed()` |
| §D.1 editor model | [`aider/aider/models.py:625-640`](../../../loop-references/aider/aider/models.py) | port `get_editor_model()` |
| §D.1 cache implications | `architect_coder.py:32` | note (`cache_prompts = False`) |

---

## 16 · What v2 dropped from v1

- 12 revs of audit history (§12 of v1) — the *outcomes* are baked into v2's design; the back-and-forth is archival
- §3 four-layer architecture diagram — collapsed into the table in §3 here
- §5.1/5.2/5.3 submodule layout details — collapsed into §11 here (deferred to migration day)
- §8 "out of scope" enumeration — moved into §2 non-goals
- §11 source context — referenced in §0 (v1 link suffices)
- The rev15 audit prompt and rev0-14 audit responses — superseded by §14

What v2 *kept*: spike designs, model pack schema, history processor logic, approval policy YAML schema, three-scope naming, speculative cancel-on-success flow, rules loader, trajectory artifact, plan/act handoff, reference index. The *substance* of v1 is intact; only the framing and audit cruft are gone.
