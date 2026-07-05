# Loop Upgrade Plan — Multi-Model Autonomous Overnight Runs

**Date**: 2026-05-24
**Status**: rev15 · audit applied (Codex rev14 audit, 2026-05-24)
**Target codebase**: [`scripts/loop/`](../scripts/loop/) (current home; will extract to standalone submodule per §6)
**Constraint**: laptop-only · drop-in to multiple projects · long autonomous multi-model overnight runs · single human (me) doing morning triage

This plan wraps the upgrade list from the autonomous-loop conversation arc (deep-dives on Plandex /
SWE-agent / Cline / GSD Redux / Aider / OpenHands) into a concrete implementation roadmap. The
selection has been filtered through the constraint above — patterns useful for distribution
(npx installer, hub-spoke daemon, MCP packaging) are explicitly out of scope; patterns useful for
unattended-overnight (sandbox, deferred approval, speculative branches, cache control) are in.

### rev15 audit response (summary of changes vs rev14)

- **Setup no longer uses `_loop_refs_dir__host_root` for its host-root check** — rev14
  resolved the host root via the helper, which prefers
  `git rev-parse --show-superproject-working-tree`. That order is correct for the helper's
  normal caller (scripts running from inside `.loop/`, where the superproject IS the host),
  but wrong when the host project is itself a Git submodule of another superproject —
  the helper would return the outer superproject and setup's realpath-equality assertion
  would then fire spuriously even when the user ran setup from the correct host root.
  rev15 separates the two concerns: the helper stays unchanged for downstream callers, and
  setup does its own pwd-based resolution (`LOOP_HOST_ROOT` if set and valid, else
  `pwd -P`) plus the equality assertion. The helper is still sourced (for
  `_loop_refs_dir__has_canaries`), just not called for host-root. (audit MEDIUM)
- **Default `ref_root` now uses `pwd -P` canonical** — rev14's prose said the path was
  computed with realpath cleanup, but the script still used plain
  `pwd` in `ref_root="$(cd "$(pwd)/../.." && pwd)/loop-references"`. A host repo invoked
  via a symlinked path would compute a non-canonical ref_root, and the canary check on it
  could disagree with the resolver's canonical view. rev15 reuses the `pwd_canonical`
  variable (already computed for the host-root assertion) and switches the trailing `pwd`
  to `pwd -P`, making the symlink behavior consistent across setup and resolver. (audit LOW)

### rev14 audit response (summary of changes vs rev13)

- **Setup now asserts `pwd ≡ loop_host_root` before any mutation** — rev13 validated
  `loop_host_root` via the helper's fail-loud, but setup still wrote defaults / state /
  gitignore / slices relative to current `pwd`. If `LOOP_HOST_ROOT` was set to a path
  different from the script's invocation directory, setup would write one repo's tree
  while the downstream resolver would read another's `.loop-config.yaml`. rev14 adds a
  realpath equality check immediately after the helper-source block: if
  `realpath "$loop_host_root"` differs from `realpath "$PWD"`, setup exits with a
  clear "cd into the host root or unset LOOP_HOST_ROOT" message. No silent mismatch.
  (audit MEDIUM #1)
- **rev7 audit-history "Checks passed" annotated as later-narrowed** — rev7's audit
  claimed path math was verified, but rev9 later discovered the submodule host-root
  bug that invalidated part of that verification. The rev7 note now reads
  *"(later narrowed by rev9: the path math is correct for non-submodule callers,
  but rev7's check missed the `git rev-parse --show-toplevel` → submodule-root
  failure case — see rev9 audit)."* Future readers won't over-trust the rev7 status.
  (audit LOW #1)

### rev13 audit response (summary of changes vs rev12)

- **Setup helper guard moved up — fail-loud now actually fires before any mutations** —
  rev12 had the helper `test -f` / `source` / `_loop_refs_dir__host_root` block in the
  middle of setup, *after* required-files copy, `.loop-state/` creation, `.gitignore`
  edits, and `diagnostic/slices` creation. A bad `LOOP_HOST_ROOT` would fail loud, but
  only after setup had partially mutated the host. rev13 moves the guard block to
  immediately after flag parsing (step 2 in the order, before any filesystem mutation).
  The fail-loud claim in rev12's summary is now actually true. (audit MEDIUM #1)
- **§10 audit prompt's run-order claim aligned with the corrected script** — rev12's
  prompt described an expected order ("helper → host-root → required_files") that the
  script body did NOT implement. rev13 first moves the script (above) to match the
  claimed order, then updates the prompt to verify exactly that order. Both surfaces
  now describe the same flow. (audit MEDIUM #2)
- **`loop_host_root` annotated as side-effect-only** — rev12 declared
  `loop_host_root="$(_loop_refs_dir__host_root)"` but the variable is never read; the
  assignment exists only to trigger the helper's fail-loud side effect under `set -e`.
  Without an inline note, future cleanup could delete the assignment as dead code and
  silently lose the `LOOP_HOST_ROOT` fail-loud behavior. rev13 adds a comment line
  immediately above the assignment: *"# SIDE-EFFECT-ONLY ASSIGNMENT — DO NOT REMOVE. The
  call triggers fail-loud on bad LOOP_HOST_ROOT; the value itself is unused below."*
  (audit LOW #1)

### rev12 audit response (summary of changes vs rev11)

- **Setup now actually invokes `_loop_refs_dir__host_root` so `LOOP_HOST_ROOT` fail-loud
  propagates** — rev11 had setup `source` the helper for the canary check but never call
  `_loop_refs_dir__host_root` or `resolve_loop_refs_dir`. A typo'd `LOOP_HOST_ROOT=/typo`
  would be silently ignored during setup. rev12 adds an explicit call to
  `_loop_refs_dir__host_root` early in setup (right after the helper is sourced) so the
  fail-loud behavior triggers before any work is done. Setup exits with the helper's
  diagnostic message if the override is bad. (audit MEDIUM #1)
- **Bootstrap-safety guard before sourcing the helper** — rev11's setup ran
  `source .loop/scripts/loop/lib/loop_refs_dir.sh` after only checking `[ -d .loop ]`. If
  the submodule exists but is old/partial (no helper file), `set -e` exits with an opaque
  shell error. rev12 adds an explicit `test -f` precheck with a friendly diagnostic:
  *"loop_refs_dir.sh missing — update submodule (`git -C .loop pull`) or check loop version."*
  Same pattern reused for any future helper sourced by setup. (audit MEDIUM #2)
- **Stale "LOOP_REFERENCES_DIR set by setup" wording corrected** — rev11's path-resolution
  prose still said helper scripts read from "LOOP_REFERENCES_DIR set by setup," contradicting
  the rev8/rev9 clarification that setup writes `.loop-config.yaml` only, never exports the
  env var. rev12 fixes the early bullet to match the later (correct) explanation. (audit
  LOW #1)
- **§11A consolidated table now includes the rev9-rev11 mechanics** — the implementer
  checklist was missing `lib/loop_refs_dir.sh`, the canary policy, and the marker-file
  preflight harness (`PREFLIGHT_MARKER_FILE` / `PREFLIGHT_SIBLING_MARKER_FILE`). rev12
  adds rows for each so the table is a complete map of "what to build" rather than a
  rev0/rev5-era snapshot. (audit LOW #2)

### rev11 audit response (summary of changes vs rev10)

- **Setup persistence now uses the canary-children check** — rev10 added the canary check
  (`plandex/` + `swe-agent/`) to the resolver but setup still used bare `[ -d "$ref_root" ]`
  for its `ref_root_exists` decision. Setup could persist an empty `loop-references/` to
  config; resolver would then reject it and fall through to default, leaving the wrong
  persisted value visible. rev11 has setup source `lib/loop_refs_dir.sh` early and call
  `_loop_refs_dir__has_canaries` for its persistence gate, so the two paths agree on what
  "exists" means. (audit HIGH #1)
- **Two existence levels explicitly documented** — rev10's setup warning checked four
  child repos (`plandex`/`swe-agent`/`cline`/`aider`) while the resolver/canary check
  only required two. rev11 formalizes this as a deliberate split:
  - **Canary (2 repos: `plandex` + `swe-agent`)** — minimum-usable threshold. Used by
    `resolve_loop_refs_dir` and by setup's persistence gate. Below this, references aren't
    useful enough to record.
  - **Complete (4 repos: + `cline` + `aider`)** — full documentation threshold. Used by
    setup's `WARNING` block to nag the user to finish cloning. A partial clone with just
    the canaries resolves successfully but emits a "complete-clone recommended" warning.
  
  The split is documented at the top of §4's reference-paths section so the implementer
  understands why the two surfaces use different thresholds. (audit MEDIUM #1)
- **`LOOP_HOST_ROOT` fail-loud on invalid override** — rev10's helper silently fell
  through to git discovery if `LOOP_HOST_ROOT` was set but pointed at a nonexistent
  path; a typo would be masked by an unrelated git root. rev11 makes invalid
  `LOOP_HOST_ROOT` a fatal error: helper emits a clear message to stderr and returns
  exit 1. Unset env var still falls through normally; explicit-but-wrong values fail
  loudly. (audit MEDIUM #2)
- **§4.1.2-pre bumped to 1 day** — rev10's 0.5-day estimate predates the four-case
  harness, two fixture bundles, private `mktemp` plumbing, env-var marker mechanism,
  and submodule teardown. rev11 budgets §4.1.2-pre at 1 day; §9 schedule footer and
  total updated accordingly. (audit LOW #1)

### rev10 audit response (summary of changes vs rev9)

- **`loop_refs_dir.sh` host-root resolution fixed for submodule context** — rev9's helper
  used `git rev-parse --show-toplevel`, which returns the *submodule's* working tree when
  called from a script inside `.loop/`. That meant the helper would look for
  `.loop-config.yaml` *inside* the submodule (wrong) and compute the default path relative
  to the submodule root (also wrong). rev10 uses `git rev-parse
  --show-superproject-working-tree` first (returns the host repo when called from inside a
  submodule), falls back to `--show-toplevel` (when called from a non-submodule host repo),
  and supports an explicit `LOOP_HOST_ROOT` env-var override for unusual mount layouts.
  (audit HIGH #1)
- **Preflight uses private `mktemp -d` + explicit marker path** — rev9's marker mechanism
  globbed `${TMPDIR}/preflight_marker_*` and read the first hit, which is racy under
  concurrent preflight runs, vulnerable to PID recycling, and could false-pass on stale
  markers. rev10 creates a private `tmpdir=$(mktemp -d)` per test, exports
  `PREFLIGHT_MARKER_FILE="$tmpdir/main"` to the fixture, asserts that exact file. No
  globbing, no PID dependency. (audit MEDIUM #1)
- **Resolver existence check aligned with setup's child-repo check** — rev9's resolver
  only checked the root `loop-references/` directory exists, while setup warns when
  specific child repos (`plandex`, `swe-agent`, `cline`, `aider`) are missing. An empty
  `loop-references/` could satisfy the resolver but be useless. rev10 makes both check
  the same set: root directory + presence of `plandex/` AND `swe-agent/` as canary
  children (sufficient to know a real clone happened; rev9-rev6 audits established these
  as the load-bearing references). (audit MEDIUM #2)
- **"Three" → "Four" wording in §4.1.2-pre** — Case (d) was added in rev9 but the
  section's intro still said "three separate `claude -p` invocations." rev10 corrects
  to "four." (audit LOW #1)

### rev9 audit response (summary of changes vs rev8)

- **Preflight Case (a) uses filesystem-marker verification, not model readback** — rev8's
  acceptance check was *"agent's final message contains 'ok arg1=… arg2=…'"*. A model can
  paraphrase ("the script ran successfully and accepted both arguments"), omit detail, or
  hallucinate the format. rev9 replaces this with a deterministic side effect: the fixture
  writes `${TMPDIR:-/tmp}/preflight_marker_$$` containing `${1}|${2}`. The test harness
  inspects the marker file after `claude -p` returns — model output is irrelevant. (audit
  MEDIUM #1)
- **`--reset-references-dir` no longer persists known-missing paths** — rev8's reset path
  would write the default `coding/loop-references` into `.loop-config.yaml` even if that
  directory didn't exist; downstream scripts would then inherit a bad value. rev9 makes
  the reset path **only persist when the resolved directory actually exists**. If it
  doesn't, the script emits a loud warning and *removes* the existing key (if any) so
  downstream resolvers fall through to env-var or default-with-existence-check. (audit
  MEDIUM #2)
- **Canonical resolver `lib/loop_refs_dir.sh` added to submodule layout** — rev8 said
  helper scripts should read `loop_references_dir` from `.loop-config.yaml` "using `yq`
  or grep" but didn't ship the canonical helper. rev9 adds `scripts/loop/lib/loop_refs_dir.sh`
  to the §5.1 submodule layout with explicit precedence:
  1. `$LOOP_REFERENCES_DIR` if set in the environment
  2. `loop_references_dir:` key in `.loop-config.yaml` if present
  3. Default `<host-grandparent>/loop-references` if the directory exists
  4. Empty + warning if none of the above resolves to an existing directory
  
  All reference-aware scripts source this helper. The function it exports is
  `resolve_loop_refs_dir` returning the absolute path on stdout, exit 1 if unresolved.
  (audit MEDIUM #3)
- **Negative sibling fixture added to preflight** — rev8's `Bash(./.loop/tools/preflight_*)`
  wildcard candidate could match a sibling tool like `preflight_test_other`. rev9 adds
  Case (d) — a negative sibling fixture `.loop/tools/preflight_test_other/bin/preflight_test_other`
  whose invocation must be DENIED by the chosen pattern. If the pattern fails Case (d) (i.e.,
  matches the sibling), the wildcard form is excluded from candidacy in favor of the
  narrower exact-prefix form. (audit LOW #1)

### rev8 audit response (summary of changes vs rev7)

- **Preflight Case (a) now invokes the fixture with arguments + adds selection rule** — rev7
  invoked `preflight_test` with no arguments, so the no-args pattern
  `Bash(./.loop/tools/preflight_test/bin/preflight_test)` could pass and be selected as
  "simplest." But real slice tools like `slice_propose_change <slice-id> <patch-file>` take
  arguments; an arg-less pattern would block them. rev8 updates Case (a) to invoke the
  fixture with two arguments mirroring the shape of real tools, and adds an explicit
  selection rule: **the chosen pattern MUST match argument-bearing invocations** — the
  no-args form is excluded from candidacy. (audit MEDIUM #1)
- **`LOOP_REFERENCES_DIR` persistence semantics clarified** — rev7's prose said setup "sets"
  the env var and "persists it," but the script only writes the config key on first run
  (no overwrite). It doesn't `export` the env var for the running shell. rev8 corrects the
  §4 reference-paths section: setup "writes the resolved path to `.loop-config.yaml` once
  on first run; does not overwrite an existing value; does not export to the shell." Also
  adds an opt-in `--reset-references-dir` flag for the override case so a user who genuinely
  changed install location can update the persisted value without hand-editing the YAML.
  (audit LOW #1)
- **rev7 summary aligned with executable teardown block** — rev7's summary in §12 said the
  teardown includes "host-side `git submodule update`," but the actual block in §4.1.2-pre
  uses `git add .loop && git commit` (the correct command for recording a submodule gitlink
  update; `git submodule update` is a *pull* operation that doesn't make host commits).
  rev8 fixes the summary wording to match what the block actually does. (audit LOW #2)

### rev7 audit response (summary of changes vs rev6)

- **Reference-path resolution fixed** — rev6's setup-script formula
  `ref_root="$(cd .loop && cd .. && pwd)/../loop-references"` resolves to
  `<host-repo-parent>/loop-references` (one level too shallow). From an OpenF1 host at
  `coding/f1/openf1/`, the script computed `coding/f1/loop-references`; the actual location is
  `coding/loop-references` (two levels up from the host repo, *not* one). rev7 corrects the
  formula and adds an env-var override (`LOOP_REFERENCES_DIR`) so non-default install locations
  are explicit. The §4 helper-script snippet for in-repo scripts is also corrected from 3 `..`
  levels to 5 (or, preferentially, replaced with the env-var pattern). (audit HIGH #1)
- **§4.1.2-pre preflight has three distinct test cases now** — rev6 collapsed allowed-wrapper
  success, `Edit` denial, and `Bash(ls)` denial into a single prompt that only really tested
  the Edit-denial path. rev7 splits them into three separate `claude -p` invocations, each
  with a prompt explicitly targeting the case under test. Each case has its own pass/fail
  acceptance line. (audit MEDIUM #1)
- **Preflight teardown command corrected for submodule** — rev6's
  `git rm -rf .loop/tools/preflight_test` from host doesn't work because `.loop/` is a
  submodule with its own git tree. rev7 specifies `git -C .loop rm -rf tools/preflight_test`
  + a commit inside the submodule, plus a host-side `git add .loop && git commit` to record
  the new submodule gitlink in the host repo. (`git submodule update` would be wrong here —
  that's a *pull* operation, not a way to record an in-submodule change in the host.)
  (audit MEDIUM #2)
- **`.loop-worktrees/` verification added** — rev6's setup script appended `.loop-worktrees/`
  to host `.gitignore` but the verification block only checked `.loop-state/`. rev7 adds the
  `.loop-worktrees/` line check to both the script's final verification and the §7 setup
  acceptance list. (audit LOW #1)
- **§4 scope header reflects Branch C contingency** — rev6 said
  *"~16.5 working days total"* in the §4 intro while the schedule math footer correctly noted
  18.5 days for Branch C. rev7's header says
  *"~16.5 working days total (A/B) · 18.5 days (Branch C SDK fallback)"* matching the
  schedule footer. (audit LOW #2)

### rev6 audit response (summary of changes vs rev5)

- **Reference paths clarified + preflight added** — rev5's `../../../loop-references/` paths
  resolve correctly from the plan file's own directory (standard markdown behavior) but
  resolve INCORRECTLY when evaluated from the repo cwd or an editor with the wrong base. rev6
  adds (1) an explicit "Reference repo location" note at the top of §4 pinning the install
  path, (2) a preflight step in `setup_host_project.sh` that verifies references are reachable
  and prints a clear "where to put them" message if not, (3) a one-line `realpath` resolution
  helper documented for implementers using a non-default location. Each reference block now
  also says the *absolute* expected location for clarity. (audit HIGH #1)
- **Setup script truly self-healing per-file** — rev5's `cp -rn .loop/.loop-defaults/.loop-rules .`
  was not idempotent across partial-prior-run states: if `.loop-rules/` existed without
  `approval-policy.yaml`, the no-clobber flag could leave the policy file missing. rev6
  enumerates each required file individually with explicit per-file presence checks and a
  final assertion that errors-with-exit-code-2 if any required default is still missing after
  the script runs. (audit HIGH #2)
- **`.loop-rules/` documented as human-owned** — rev5's `forbidden.paths` blocks agent writes
  to `.loop-rules/**` (correct for security), but §4.3.2 didn't say who edits the rules.
  rev6 explicitly documents that `.loop-rules/` is **human-owned**: setup script seeds it
  from defaults; subsequent edits are manual. The agent reads rules but never writes there.
  This resolves the apparent conflict between policy and deliverable — there's no conflict;
  rev5 just under-documented the ownership model. (audit HIGH #3)
- **§4.1.2-pre preflight uses production path, not `tmp/preflight/`** — rev5's preflight tested
  `./tmp/preflight/safe_op` against `--allowed-tools` patterns, but the production allowlist
  uses `./.loop/tools/<name>/bin/<name>` which has more path segments. rev6 stands up a
  throwaway `.loop/tools/preflight_test/bin/preflight_test` in the actual production path
  shape so the verified pattern is the pattern we ship. (audit MEDIUM #1)
- **Aider's cache≈0 propagated to §7.4 budget** — rev5's §4.4.1 note about implementer-role
  cache being zero (empty-history handoffs have nothing to cache) wasn't propagated to the
  §4.0 spike budget table. rev6 adds a "Tier 4 adjustment" row to the budget table making
  the trade-off explicit: if Tier 4 ships, planner-side cache savings stay; implementer-side
  cache savings drop to ~0. The §7.4 budgets get conditional-on-Tier-4 versions. (audit
  MEDIUM #2)
- **§4.2.1 duration is now branch-conditional** — rev5 listed §4.2.1 as 1 day in §9 but
  §4.0's Branch C (SDK fallback) is explicitly 3 days. rev6's §4.2.1 header says
  *"1 day (Branches A/B) · 3 days (Branch C SDK fallback)"* and the week plan annotates the
  contingency: if Branch C is selected, Week 2 ends Day 7 instead of Day 5; total goes to
  18.5 days. (audit MEDIUM #3)
- **Command parser dependency clarified — no `shlex.split()`** — rev5 said
  `shlex.split()` "does the same job" as Cline's `shell-quote`. It does not: `shlex` tokenizes
  but doesn't classify operators, redirects, subshells, or here-docs. rev6 replaces the
  recommendation with a real shell parser: **`bashlex`** (Python package, produces a bash AST)
  or a small Node helper using `shell-quote` directly. The token-classification requirement
  is now explicit: the parser must distinguish *command segments* from *operators / redirects
  / subshells* and validate per-segment, not just tokenize. (audit MEDIUM #4)

### rev5 implementation-reference pass (per-item upstream pointers)

Every §4 item now carries an "Implementation reference" block naming the specific upstream
files and functions the implementer should study or port. Three categories:

- **Port** — copy nearly verbatim (with renaming for our naming convention).
- **Adapt** — learn the pattern, rewrite in our idiom (different language, simpler infra).
- **Study** — read for context; we're not copying, but the upstream solved a problem we'll hit.

Reference repos live at [`../../../loop-references/`](../../../loop-references/). Each citation
uses a relative path from this plan, so opening any reference is one click in most editors.

### rev4 verification pass (summary of corrections from reading the cloned reference repos)

Reference repos are at [`../../../loop-references/`](../../../loop-references/). Each correction
below cites the file in the actual upstream that disagreed with the plan.

- **§4.1.2 SWE-agent tool bundles — N-commands-per-bundle**: rev3 implied one command per
  `tools/<name>/`. Verified at
  [`swe-agent/tools/windowed/config.yaml`](../../../loop-references/swe-agent/tools/windowed/config.yaml):
  a single bundle declares `goto`, `open`, `create`, `scroll_up`, `scroll_down` together. rev4
  notes that bundles can declare multiple related commands; our slice_* bundles can group
  related verbs (e.g. `slice_run_typecheck` + `slice_run_adapter_tests` in one `slice_run/`
  bundle if it simplifies the YAML).
- **§4.1.2 SWE-agent bundle layout — `lib/` is rare**: rev3 listed `lib/` as part of the bundle
  layout. Verified: only `bin/` + `config.yaml` + optional `install.sh` are common; `lib/` is
  not used by any of the 15 bundles in `swe-agent/tools/`. rev4 drops `lib/` from the canonical
  layout (still allowed, just not standard).
- **§4.1.2 SWE-agent bundle — `state_command` for stateful tools**: stateful bundles like
  `windowed` declare `state_command: "_state"` at the top level (alongside `tools:`). Used
  when a tool maintains cross-turn state (e.g., the file-viewer's current line position). Our
  `slice_propose_change` and `slice_read_state` may need this if we want stateful tracking of
  which slice is "active"; rev4 documents the field.
- **§4.2.1 history processor YAML — role naming corrected**: rev3 wrote
  `roles: [planner, implementer, summarizer]`. Verified at
  [`swe-agent/sweagent/agent/history_processors.py:261-286`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py):
  the field is **`tagged_roles`** (not `roles`) and the values are **message roles** (`"user"`,
  `"tool"`) not pack-defined agent roles. The pack-role distinction is implicit (the processor
  runs from within a planner dispatch, so it tags that conversation's user messages). rev4
  corrects the YAML and explains the distinction.
- **§4.2.1 default `last_n_messages` — upstream default is 2, not 4**: SWE-agent's
  `CacheControlHistoryProcessor` defaults to `last_n_messages = 2` with the comment *"should
  be set to 2 (caching for multi-turn conversations); when resampling and running concurrent
  instances, you want to set it to 1"*. Our plan's `4` isn't wrong (it's a design choice
  matched to our deeper revision spirals) but rev4 calls out that we're intentionally
  deviating from upstream and notes the trade-off.
- **§4.2.2 Cline command permission — citation strengthened**: rev3 framed the dispatcher
  policy as our invention contrasted against Cline's "model self-label." Verified at
  [`cline/src/core/permissions/CommandPermissionController.ts`](../../../loop-references/cline/src/core/permissions/CommandPermissionController.ts):
  Cline **does** dispatcher-enforce via `CLINE_COMMAND_PERMISSIONS` env var (JSON with
  `allow`/`deny`/`allowRedirects`), parses commands with `shell-quote`, handles `&&`/`||`/`|`/`;`,
  detects redirects and subshells, validates each segment against allow/deny rules. Our design
  is closer to Cline's actual implementation than rev3 claimed; rev4 cites the controller as
  prior art and lifts its segment-parsing approach (we should use a similar shell-aware parser
  rather than naive regex). This is a *strengthening*, not a contradiction.
- **§4.2.3 restore-type naming — align with Cline's upstream**: rev3 named the three scopes
  `restore_files / restore_history / restore_both`. Verified at
  [`cline/src/integrations/checkpoints/index.ts:240-258`](../../../loop-references/cline/src/integrations/checkpoints/index.ts):
  Cline uses **`"task"` / `"workspace"` / `"taskAndWorkspace"`**. rev4 documents the mapping
  (ours → upstream) and recommends adopting Cline's names so future research stays mappable:
  - `restore_files` → `workspace`
  - `restore_history` → `task`
  - `restore_both` → `taskAndWorkspace`
- **§4.4.1 Aider architect/editor — handoff mechanism documented**: rev3 said the architect
  produces a plan and the implementer executes. Verified at
  [`aider/aider/coders/architect_coder.py`](../../../loop-references/aider/aider/coders/architect_coder.py):
  the mechanism is "architect's response IS the editor's prompt; editor starts with
  `cur_messages = []` and `done_messages = []`". The editor doesn't see the architect's
  conversation — only the final plan output. rev4 adopts this exact handoff: our `dispatch_planner`
  produces a numbered work-plan markdown blob; `dispatch_implementer` receives that blob as its
  *only* prior context (empty history). Cleaner audit boundary too — Codex audits the implementer
  against the plan, not against the planner's full reasoning trace.
- **§4.1.1 Plandex sandbox — git-native variant noted**: verified that
  [`plandex/app/cli/cmd/apply.go`](../../../loop-references/plandex/app/cli/cmd/apply.go) +
  [`reject.go`](../../../loop-references/plandex/app/cli/cmd/reject.go) implement the sandbox
  via server-side state with an explicit `ApplyRollbackPlan` computed before applying. Our
  proposal-branch approach is a simpler **git-native variant of the same pattern**: instead of
  a server-tracked diff set, we use a worktree+branch the merger fast-forwards. rev4 makes
  this credit explicit. (Per-file granular reject via `pdx reject <file>` is a feature we
  don't need; slice-level reject is sufficient.)

### rev3 audit response (summary of changes vs rev2)

- **Tools moved to submodule top-level `.loop/tools/`** — rev2's allowlist referenced
  `Bash(./.loop/tools/slice_*)` but the submodule layout placed tools under
  `.loop/scripts/loop/tools/`. rev3 promotes tools to the submodule top level (alongside
  `setup_host_project.sh` and `loop_review.sh`) so the agent-facing surface is at a clean,
  short path that matches the allowlist. The `scripts/loop/` directory keeps the bash
  *internals* (runner, dispatchers, lib/); tools are the public surface and get their own
  directory. (audit HIGH #1)
- **`.loop-rules/approval-policy.yaml` shipped in defaults** — rev2 referenced it but didn't
  add it to `.loop-defaults/.loop-rules/`. rev3 lists it explicitly in the defaults layout and
  the setup script copies it; setup acceptance verifies its presence in the host project.
  (audit HIGH #2)
- **`.loop/**` and `.loop-rules/**` are now `forbidden`, not `require_approval`** — rev2's
  policy allowed the agent to touch the submodule itself with human approval, which breaks the
  read-only-submodule invariant. rev3 moves both paths into the `forbidden` list (not even
  queueable; tool returns an error). The host's per-project rule files can still be edited by
  a human directly; just not by the agent. (audit MEDIUM #3)
- **Setup script creates `.loop-state/` and writes `.gitignore`** — rev3 extends
  `setup_host_project.sh` to `mkdir -p .loop-state` and append `.loop-state/` plus
  `.loop-worktrees/` to the host project's `.gitignore` (idempotent grep-before-append).
  (audit MEDIUM #4)
- **§4.2.1 is explicitly branch-selected by §4.0** — rev2 still described `cache_control:
  ephemeral` insertion as the implementation. rev3 reframes §4.2.1 as a *placeholder* whose
  concrete shape is selected by the §4.0 spike's branch-decision table. The "fixed" version
  ships only if the spike picks that row. (audit MEDIUM #5)
- **Current-state wording corrected to Claude-only implementer** — rev2 left a leftover
  "Claude implements, Codex verifies — or vice versa" line in §2. rev3 makes it definitive:
  Claude implements, Codex audits, no role-swapping. (audit LOW #6)
- **Schedule math reconciled** — rev3 recounts: Tier-0 cache spike 1d + §4.1.2-pre 0.5d +
  Tier-1 5d + Tier-2 5d + Tier-3 3d + migration/verification 2d = **16.5 working days**.
  §4 header, week plan, and end-of-§9 line all show 16.5 days. (audit LOW #7)

### rev2 audit response (summary of changes vs rev1)

- **Codex role restricted to auditor (read-only); implementer role is Claude-only** — rev1's
  proposed Codex implementer enforcement via `--sandbox=workspace-write --ask-for-approval=on-request`
  is not equivalent to Claude's `--allowed-tools` because Codex's sandbox controls filesystem
  writes but not the command/tool surface, and `on-request` lets the model decide when to ask.
  rev2 scopes Codex to **auditor role only** with `--sandbox=read-only --ask-for-approval=never`,
  matching the existing OpenF1 pattern where Codex audits and Claude implements. Implementer
  enforcement therefore lives entirely on the Claude side via the proven `--allowed-tools` flag.
  (audit HIGH #1)
- **New Tier-0.5 CLI-flag preflight** — rev1 asserted that
  `Bash(.loop/tools/slice_*:*)` would work as a Claude `--allowed-tools` pattern, but the colon
  form isn't shown in `claude --help`'s examples (which use `Bash(git *)` style). rev2 adds a
  preflight spike — separate from but adjacent to the cache spike — that empirically tests the
  exact pattern syntax against Claude Code's CLI before §4.1.2 commits to it. Acceptance:
  allowed wrapper invocations pass; `Bash(ls)` and `Edit` calls fail at the CLI boundary.
  (audit HIGH #2)
- **Runtime state moved out of submodule to host-owned `.loop-state/`** — rev1 wrote
  `pending_approvals/`, `dispatches/`, and other runtime state to `scripts/loop/state/` inside
  the submodule, which contradicts the "no edits to submodule files" acceptance criterion.
  rev2 introduces a `LOOP_STATE_DIR` env var (default `<host>/.loop-state/`) and routes all
  mutable state through it. The submodule's `scripts/loop/state/` is removed; legacy paths
  become symlinks during the OpenF1 migration. (audit HIGH #3)
- **§7 acceptance criteria now reference the spike-selected budget** — rev1 hard-gated on
  ~$50/run and ≥50% savings, contradicting Tier-0's branch-decision table which allows $60 / $75
  outcomes. rev2 phrases §7.2 and §7.4 in terms of "the budget and savings target selected by
  the §4.0 spike branch decision." (audit MEDIUM #4)
- **Cache fallback names corrected roles** — rev1's fallback said "use Anthropic SDK for
  auditor + summarizer" but the pack assigns auditor to OpenAI (Codex). rev2 corrects the
  fallback to **planner + implementer + summarizer** (the three Claude roles); auditor stays on
  OpenAI and doesn't participate in Anthropic prompt-cache savings. (audit MEDIUM #5)
- **Per-slice mutex around merge / cancel / approval mutation** — rev1's cancel-on-success in
  §4.3.1 could race with sibling variants mid-audit or mid-merge. rev2 specifies a slice-level
  lock acquired around the cancel path; mutation of `pending_approvals/`, branch deletion, and
  worktree teardown all happen under the lock. Uses the existing `repo_lock.sh` plumbing
  generalized to per-slice mutex keys. (audit MEDIUM #6)
- **Architecture table updated** — rev1's §3 Layer 2 row still said "Model-emitted
  `requires_approval`", contradicting the dispatcher-enforced policy in §4.2.2. rev2 corrects
  the table. (audit LOW #7)

### rev1 audit response (summary of changes vs rev0)

- **Tool-surface enforcement is now CLI-level, not prompt-level** — rev0 said "the base Bash tool
  is not exposed" but didn't specify how. rev1 makes the enforcement concrete via Claude Code's
  `--allowed-tools` / `--disallowed-tools` flags and Codex CLI's sandbox/approval-mode flags. The
  agent CLI itself refuses to call tools outside the allowlist; the loop's safety doesn't depend on
  the model honoring docstrings. This is enforcement at the agent-runtime boundary without
  requiring MCP, container, or OS-level wrappers. (audit HIGH #1)
- **`requires_approval` is dispatcher-enforced from the patch/command, not model self-label** —
  rev0 trusted the model's `requires_approval: true` to trigger queueing. rev1 inverts: the
  dispatcher inspects the proposed patch contents / command string against a rule-based policy
  (path globs, command regexes) and queues for approval based on what the change *is*, not what
  the model *says it is*. The model's self-label remains as an optional additional signal but is
  no longer the gate. (audit HIGH #2)
- **New Tier-0 cache-control spike** — rev0 scoped §4.2.1 as a 1-day implementation. rev1 adds a
  prerequisite §4.0 spike to prove (a) cache_creation/cache_read tokens actually appear in the
  cost ledger via the Claude Code CLI's reporting, and (b) what shape of prompt history triggers
  cache hits. If the spike fails (CLI doesn't surface cache mechanics), §4.2.1 changes to "use
  Anthropic SDK directly for synthesis/audit roles" and the $50 overnight target is revised.
  (audit HIGH #3)
- **Speculative × approval interaction defined** — rev1 §4.3.1 specifies: each speculative
  variant runs through dispatcher policy independently. If variant A's proposal trips approval,
  A is queued individually; variants B and C continue running. If B passes audit and is merged,
  A's queue entry is auto-cancelled (cancel-on-success). The slice as a whole is *not* blocked by
  one risky variant. (audit MEDIUM #4)
- **Non-fast-forward merge behavior defined** — rev1 §4.1.1 specifies the merger's fallback
  ladder: fast-forward → auto-rebase if no conflicts → rerun audit on rebased proposal → if
  rebase has conflicts, fail closed with `status: awaiting_rebase` for human triage. (audit
  MEDIUM #5)
- **Setup script path consistent** — moved to `.loop/setup_host_project.sh` (submodule top-level)
  so the documented invocation matches the mounted path. (audit LOW #6)

---

## 1 · Goals & non-goals

### Goals
1. **Reject is free.** A rejected slice can be discarded with zero cleanup cost. No `git revert` on
   the integration branch; no manual fixup.
2. **The agent literally cannot bypass safety.** Risky operations are unavailable as tools, not
   merely discouraged in prompts.
3. **Stubborn failures produce evidence, not waste.** A slice that fails its audit twice forks into
   speculative variants the next morning is reviewable as a comparison.
4. **Overnight runs are cost-disciplined.** Prompt-cache breakpoints in place; planner role uses a
   cheaper model than the implementer role by default.
5. **The loop drops into a new project in ≤ 30 seconds.** Submodule + a small per-project config
   directory; zero edits to the loop's own files.
6. **Morning triage is readable in ≤ 15 minutes.** Each slice's artifact is a frontmatter block +
   diff + structured tool-use log + audit verdict.

### Non-goals (deliberately)
- **No distribution to other users.** No npx installer, no marketplace listing, no semver
  discipline. Personal-use tool.
- **No hub-spoke daemon, no WebSocket plumbing, no web UI.** Single bash runner, multi-process is
  fine, but no socket-server design.
- **No MCP packaging or cross-runtime install.** Claude + Codex CLIs only; if a future agent CLI
  matters, we revisit then.
- **No Docker / container sandbox.** Worktree + branch is sufficient isolation for code-only work
  against trusted dependencies.
- **No general-purpose tree-sitter project map.** OpenF1 (~200 files) doesn't justify it; reassess
  for the next project if it's a monorepo.
- **No event-stream / trajectory-as-primary-artifact rewrite.** Slice-file state machine remains
  the source of truth.

---

## 2 · Current-state assessment

What [`scripts/loop/`](../scripts/loop/) already does well (preserve):
- Slice-file state machine with `status`, `owner`, `verdict` frontmatter.
- Worktree-per-slice isolation; atomic commit per slice.
- Two-vendor audit pattern: **Claude implements + plans, Codex audits** (no role-swapping;
  enforcement reasons — see rev2 / §4.1.2 for why).
- Watchdog, triage, repair, auto-reject loops.
- Cost ledger via `pricing.json` + `check_budget.sh` + `post_dispatch_cost.sh`.
- Test-grading gate, line-count gate, CI verify gate.
- Codex usage-limit backoff.
- Repo lock for concurrency.

What's missing (this plan fixes):
- **Generic tool surface**: Claude/Codex see `Bash` / `Edit` / `Write` / `Read` — the same surface
  they'd have anywhere. Nothing constrains them to the loop's intended verbs.
- **No sandbox**: every dispatch commits directly into the slice's worktree on the integration
  branch. Audit happens *after* the commit lands.
- **Single-model config**: model assignment is hardcoded across dispatch scripts; multi-model
  experimentation requires editing scripts.
- **Ad-hoc prompt rebuilding**: revise cycles re-paste history; no cache-control structure; no
  composable transformations.
- **Binary approval**: a slice runs fully autonomously or is blocked manually. No deferred-review
  middle ground for the overnight scenario.
- **Failed slices overwrite themselves**: revise cycles overwrite the prior attempt's branch.
- **`dispatch_repair.sh` is one verb**: no distinction between "rewind code only" vs "rewind
  history only" vs "rewind both".
- **Monolithic CLAUDE.md / AGENTS.md**: full-context, always-on; no per-project modularity.

---

## 3 · Architecture — the layered safety model

Four layers, each catching a different failure class. Today only Layer 4 exists.

| Layer | Mechanism | Catches |
|---|---|---|
| 1. Tool surface (CLI-enforced) | Claude `--allowed-tools` / `--disallowed-tools` allowlist; Codex restricted to read-only audit role (SWE-agent ACI pattern) | "Agent literally can't invoke dangerous tools" |
| 2. Dispatcher-enforced policy | Wrapper-script policy check on patch content + argv (Cline `.clinerules`-style); model's `requires_approval` is an optional hint, not the gate | "Action is unsafe regardless of what the model thinks" |
| 3. Proposal sandbox | `slice/<id>/proposal` branch + worktree, merger-only fast-forward (Plandex) | "Slice finished; auditor reviews the full proposed change before any merge" |
| 4. Two-vendor audit | Existing Codex audit (read-only sandbox) | "Auditor independently verifies the proposal" |

Plus two orthogonal axes:
- **Model packs** (Plandex): role→model bundles selectable per slice or per run.
- **History processors** (SWE-agent): composable trajectory transformations including cache-control.

---

## 4 · Scope

Three tiers plus a Tier-0 spike and a §4.1.2-pre CLI preflight,
**~17 working days total (Branches A/B) · 19 days (Branch C SDK fallback per §4.0)**.
Each tier is independently shippable.

**Reference repo location** — all implementation references in this section assume reference
repos live at:

```
<host-repo-parent-parent>/loop-references/{plandex, swe-agent, cline, aider, gsd-redux}
```

For this plan, that resolves to `/Users/robertzehnder/Documents/coding/loop-references/`,
which is **two levels above the host project root** (`f1/openf1/`), i.e. a sibling of `f1/`.

**Path resolution by context**:

- **Markdown links** in this document use `../../../loop-references/` — three `..` levels
  because the plan file is at `openf1/diagnostic/loop_upgrade_plan_*.md`, so three levels up
  reaches `coding/`, then `/loop-references/`. This is what editors evaluate when you click a
  link; it works.
- **Setup script** (running from host repo root, i.e. `openf1/`): first canonicalize the
  current directory with `pwd_canonical="$(pwd -P)"` (also used by the host-root equality
  assertion), then compute `ref_root="$(cd "$pwd_canonical/../.." && pwd -P)/loop-references"`.
  The `pwd -P` on both sides keeps the resolved path symlink-free end-to-end, so a host
  invoked through a symlinked path still produces a canonical `ref_root` that the resolver's
  canary check (also symlink-naive) will agree with. **Not** `cd .loop && cd .. ..` — that
  drops the absolute by one level (rev6 bug). Two `..` from host root reaches `coding/`.
- **Helper scripts in `.loop/scripts/loop/`** (deeper inside the submodule): five `..` levels
  from `$(dirname "$0")` reach `coding/`. Or — preferred — source `lib/loop_refs_dir.sh`
  and call `resolve_loop_refs_dir`, which reads the resolved path from
  `.loop-config.yaml` (setup writes it there on first run; setup does **NOT** export
  `LOOP_REFERENCES_DIR` into the shell). Depth counting is then unnecessary.
- **Override for non-default locations**: set `LOOP_REFERENCES_DIR=/abs/path/to/loop-references`
  before invoking the setup script. Semantics, precisely:
  - **First run**: setup writes `loop_references_dir: <value>` to `.loop-config.yaml`.
  - **Re-run with env var unchanged**: setup notices the key already exists in config and
    does NOT touch it (no overwrite).
  - **Re-run with env var pointing somewhere new**: setup *also* does not touch the existing
    key — the explicit-config invariant takes precedence over fresh env vars. To force an
    update, pass `--reset-references-dir` to `setup_host_project.sh`, which clears the key
    and re-derives it from the current env var (or the default if unset).
  - **Setup does NOT `export` `LOOP_REFERENCES_DIR`** into the user's shell — the persisted
    config file is the source of truth. Helper scripts read the value from `.loop-config.yaml`
    using `yq` or grep, not from the live environment.
  - This way, the config file is the canonical record of where the references live; the env
    var is only used as a one-shot input during setup.

**Canonical resolver `scripts/loop/lib/loop_refs_dir.sh`**:

All scripts that need to read reference repos source this helper. It exports
`resolve_loop_refs_dir` with precedence:

1. `$LOOP_REFERENCES_DIR` (live env var) if set AND the directory passes the canary-children
   existence check.
2. `loop_references_dir:` key from `<host>/.loop-config.yaml` if present AND the path passes
   the canary-children existence check.
3. Default `<host-grandparent>/loop-references` if it passes the canary-children check.
4. Otherwise: emit a warning to stderr, return exit code 1, do NOT print anything to stdout.

**Two existence thresholds — canary vs complete** (resolves rev10 audit MEDIUM #1 cleanly):

The plan uses two distinct existence checks, on purpose:

- **Canary threshold (2 repos: `plandex/` + `swe-agent/`)** — the *minimum useful* state.
  Both `resolve_loop_refs_dir` and setup's persistence gate (`ref_root_exists`) use this
  check. A candidate path is "real enough to persist or resolve" iff both canary
  sub-directories exist. Empty `loop-references/` does NOT pass.
- **Complete threshold (4 repos: + `cline/` + `aider/`)** — the *full documentation* state.
  Setup's `WARNING` block uses this check to nag the user when references are partially
  cloned. Below this threshold, the resolver still succeeds (canary check passes) but the
  user sees a "consider cloning the other two repos" message.

The split prevents resolver and setup from disagreeing on what "exists" means (rev10's bug)
while keeping the user-facing setup helpful about cloning completeness. The shared canary
helper `_loop_refs_dir__has_canaries` lives in `lib/loop_refs_dir.sh` and is sourced by
setup so the persistence gate uses the same function as the resolver.

**Host-root resolution** (addresses rev9 audit HIGH #1): when the helper is sourced from a
script inside `.loop/` (a submodule), `git rev-parse --show-toplevel` returns the
*submodule's* root, not the host repo's. The resolver uses
`--show-superproject-working-tree` first (returns the host superproject when called from a
submodule); falls back to `--show-toplevel` (when called from a non-submodule host repo);
respects `LOOP_HOST_ROOT` as an explicit override.

Reference implementation:
```bash
# scripts/loop/lib/loop_refs_dir.sh
# Source from any reference-aware script:  source "$(dirname "$0")/lib/loop_refs_dir.sh"
# Then call:  refs=$(resolve_loop_refs_dir) || { echo "no refs"; exit 1; }

_loop_refs_dir__has_canaries() {
  # Returns 0 iff "$1" exists AND contains plandex/ AND swe-agent/.
  [ -d "$1" ] && [ -d "$1/plandex" ] && [ -d "$1/swe-agent" ]
}

_loop_refs_dir__host_root() {
  # Resolution order for host root:
  #   1. LOOP_HOST_ROOT env override — if SET but invalid, FAIL LOUD (a typo would otherwise
  #      be silently masked by git discovery picking a different repo root).
  #   2. git rev-parse --show-superproject-working-tree (correct when called from inside
  #      .loop/ submodule — returns the parent (host) working tree).
  #   3. git rev-parse --show-toplevel (correct when called from a non-submodule host repo).
  #   4. pwd as last resort.
  if [ -n "${LOOP_HOST_ROOT:-}" ]; then
    if [ -d "$LOOP_HOST_ROOT" ]; then
      printf '%s' "$LOOP_HOST_ROOT"; return 0
    fi
    echo "loop_refs_dir: LOOP_HOST_ROOT='$LOOP_HOST_ROOT' is set but does not exist." >&2
    echo "  Refusing to fall through to git discovery — fix the env var or unset it." >&2
    return 1
  fi
  local super
  super="$(git rev-parse --show-superproject-working-tree 2>/dev/null)"
  if [ -n "$super" ]; then
    printf '%s' "$super"; return 0
  fi
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$top" ]; then
    printf '%s' "$top"; return 0
  fi
  pwd
}

resolve_loop_refs_dir() {
  local candidate=""

  # 1. Env override.
  if [ -n "${LOOP_REFERENCES_DIR:-}" ] && _loop_refs_dir__has_canaries "$LOOP_REFERENCES_DIR"; then
    printf '%s' "$LOOP_REFERENCES_DIR"
    return 0
  fi

  # 2. Persisted config.
  local host_root
  host_root="$(_loop_refs_dir__host_root)" || return 1   # propagate LOOP_HOST_ROOT fail-loud
  if [ -f "$host_root/.loop-config.yaml" ]; then
    candidate="$(grep '^loop_references_dir:' "$host_root/.loop-config.yaml" \
      | head -n1 | sed 's/^loop_references_dir:[[:space:]]*//' | tr -d '"')"
    if [ -n "$candidate" ] && _loop_refs_dir__has_canaries "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  fi

  # 3. Default.
  candidate="$(cd "$host_root/../.." && pwd)/loop-references"
  if _loop_refs_dir__has_canaries "$candidate"; then
    printf '%s' "$candidate"
    return 0
  fi

  # 4. Unresolved.
  echo "loop_refs_dir: unable to resolve — set LOOP_REFERENCES_DIR or run .loop/setup_host_project.sh" >&2
  return 1
}
```

All §4 implementation references are documentation, not runtime deps. Scripts that DO need
the references at runtime (only hypothetical so far — the loop itself doesn't read them; only
the implementer when reading the plan does) should source this helper rather than reimplement
the precedence logic.

The setup script (§5.3) preflights this: it verifies the references are reachable from the
expected location (or the env-override location) and prints a clear "where to put them and
how to clone them" message if not found. Implementation references are NOT runtime
dependencies — they're consulted only when reading the plan, so a missing references tree
is a warning, not a hard error.

### 4.0 Tier 0 — Cache-control feasibility spike · 1 day (prerequisite to §4.2.1)

**Why this exists (addresses audit HIGH #3)**: rev0's §4.2.1 assumed prompt-cache breakpoints
could be inserted into the prompt-history JSON the Claude Code CLI consumes, and that
`cache_creation_input_tokens` / `cache_read_input_tokens` would appear in the cost ledger. Neither
assumption was verified. Claude Code's CLI may auto-cache the system prompt + tools and not
expose user-message cache control; or the cost ledger may not surface cache-hit metrics. The
$50/overnight target in §7.4 depends on cache savings being real and measurable. **This spike
runs before §4.2.1 is scheduled.**

**Spike deliverable**: a 1-day investigation that answers three questions empirically:

1. **Does the Claude Code CLI accept `cache_control: ephemeral` markers in user messages**, or
   does it auto-cache only the system prompt and tools? Test by replaying a fixture
   revision-spiral conversation through the CLI with and without explicit cache markers; compare
   `cache_creation_input_tokens` and `cache_read_input_tokens` in the response metadata.
2. **What's the actual cache-hit rate on revision spirals** with the current dispatch script
   structure? Run a fixture slice that revises 5 times and measure cache reads on turns 2-5.
3. **Does the cost ledger (`post_dispatch_cost.sh`) currently surface cache-hit metrics**, or
   does it only count gross input/output tokens? If the latter, the cost ledger needs extending
   before §4.2.1 can claim the savings.

**Branch decision** based on spike outcome:

| Spike outcome | §4.2.1 implementation | §7.4 target |
|---|---|---|
| CLI accepts markers + cache works + ledger surfaces hits | Implement as scoped (1 day) | $50 stands (Tiers 1-3 only); see Tier-4 adjustment below |
| CLI auto-caches system+tools only, no marker support | §4.2.1 becomes "structure prompt history to maximize auto-cache hits" (≤1 day, smaller savings) | Revise to $75 (Tiers 1-3 only); see Tier-4 adjustment below |
| Cache mechanics fundamentally unobservable through CLI | §4.2.1 becomes "use Anthropic SDK directly for the **planner + implementer + summarizer** Claude roles via a small Node helper" (3 days). Auditor is OpenAI (Codex) per the model pack and does not participate in Anthropic prompt caching. | Revise to $60 (Tiers 1-3 only); see Tier-4 adjustment below |

**Tier 4 adjustment** (only applies if Tier 4 §4.4.1 ships):

Aider's architect→editor handoff (which §4.4.1 adopts) starts the implementer with empty
conversation history (`cur_messages = []`). Aider correspondingly sets `cache_prompts = False`
on the editor coder — there's nothing reusable across editor invocations. **This means
implementer-role cache savings drop to ~0 once Tier 4 ships**, because every implementer
dispatch has no shared prefix from the prior call.

| Branch | Tiers 1-3 target | + Tier 4 adjustment (implementer cache → 0) |
|---|---|---|
| A (marker-supported) | $50 | $50 + planner-side savings retained · implementer-side cache savings forfeited · revised **~$58** |
| B (auto-cache only) | $75 | implementer auto-cache also forfeited · revised **~$80** |
| C (SDK fallback) | $60 | implementer SDK call has no prior to cache · revised **~$66** |

The adjustment magnitude is empirical and the Tier-0 spike should re-measure with a Tier-4
dispatch path simulated. If Tier 4 is deferred, the original $50/$60/$75 targets stand. The
§7.4 acceptance criterion now reads in two columns (Tiers 1-3 / + Tier 4) so the
implementer can pick the row matching the actual scope shipped.

**Acceptance**: a short markdown report at `diagnostic/cache_control_spike_2026-XX-XX.md` with
(a) the empirical numbers, (b) the branch decision, (c) any required changes to §4.2.1 or §7.4
documented before Tier-2 starts. The plan is updated (rev2) if the decision moves the budget.

### 4.1 Tier 1 — Foundation (5 days)

#### 4.1.1 Proposal-branch sandbox · 2 days

**Deliverable**: every `dispatch_claude.sh` / `dispatch_codex.sh` works on a branch named
`slice/<id>/proposal-<n>` in a dedicated worktree. The integration branch is touched *only* by
`dispatch_merger.sh`, which fast-forwards proposal → integration on PASS.

**File changes**:
- `scripts/loop/slice_helpers.sh` — add `create_proposal_worktree()`, `cleanup_proposal_worktree()`.
- `scripts/loop/dispatch_claude.sh` / `dispatch_codex.sh` — wrap dispatch in proposal-worktree
  setup/teardown.
- `scripts/loop/dispatch_merger.sh` — see merge-ladder below.
- `scripts/loop/dispatch_slice_audit.sh` — auditor reads `git diff integration..proposal` instead
  of `HEAD~1..HEAD`.

**Merge-ladder (addresses audit MEDIUM #5: non-FF behavior)**:

```
PASS verdict received →
  attempt: git merge --ff-only proposal-branch
    success → done; delete proposal branch
    fail (non-FF, integration drifted) →
      attempt: git rebase integration (inside proposal worktree)
        clean (no conflicts) →
          rerun audit on rebased proposal
            audit PASS → retry --ff-only merge → done
            audit FAIL → status: awaiting_rebase_audit (human triage)
        conflicts →
          abort rebase; status: awaiting_rebase (human triage)
          proposal branch preserved for inspection
REJECT verdict received →
  delete proposal branch + worktree; status: rejected
```

The fail-closed path (`awaiting_rebase` / `awaiting_rebase_audit`) is the same triage queue as
§4.2.2's approval queue — human reviews in the morning.

**Slice frontmatter additions**:
```yaml
proposal_branch: slice/<id>/proposal-<n>
proposal_worktree: .loop-worktrees/<id>-proposal-<n>
merge_attempts:                      # appended on each merger run
  - attempt: 1
    strategy: ff-only
    result: non_ff | success | fail
  - attempt: 2
    strategy: rebase
    result: clean | conflict
```

**Acceptance**: a rejected slice produces zero changes on the integration branch. `git log
integration --oneline` shows no entry for rejected slice attempts. The proposal worktree directory
is gone after teardown. A deliberately-induced drift (commit something to integration after the
proposal branched off) triggers the rebase path and is observable in the slice's `merge_attempts`
log; if the rebase has a conflict, the proposal is preserved and the slice lands in
`awaiting_rebase`.

**Implementation reference**:
- *Adapt the lifecycle pattern* from
  [`plandex/app/cli/cmd/apply.go`](../../../loop-references/plandex/app/cli/cmd/apply.go) and
  [`reject.go`](../../../loop-references/plandex/app/cli/cmd/reject.go) (~50 lines each). The CLI
  surface is a clean template for our merger-side flow: `apply` ↔ `dispatch_merger.sh PASS`,
  `reject` ↔ slice REJECT verdict.
- *Study the rollback-pre-computation pattern* in
  [`plandex/app/cli/lib/apply.go:152, 201, 622`](../../../loop-references/plandex/app/cli/lib/apply.go)
  — `var toRollback *types.ApplyRollbackPlan` is computed **before** `ApplyFiles` runs, so if
  apply fails partway, the rollback plan is already in hand. Our git-native variant gets this
  property for free (the integration branch's HEAD before fast-forward = the rollback target),
  but the pattern is worth understanding for the conflict / rebase fallback. Our
  `merge_attempts` log serves the same role as Plandex's rollback plan.
- *Don't port*: Plandex's server-side state management — we use git branches as the state
  layer. The CLI command shapes (subcommand names, flag conventions) and the lifecycle order
  are what's transferable.

#### 4.1.2 Custom tool surface with CLI-level enforcement (SWE-agent ACI) · 2 days

**Enforcement design (addresses audit HIGH #1 + #2)**:

The custom tool surface is not a prompt convention — it is enforced at the agent-CLI invocation
boundary. Two important scope decisions:

1. **Implementer role is Claude-only.** Codex CLI's `--sandbox=workspace-write` controls
   filesystem writes but **does not restrict the command/tool surface** to specific wrappers;
   `--ask-for-approval=on-request` leaves the approval decision to the model. Without an
   external command filter, Codex as implementer would have a weaker enforcement boundary than
   Claude. rev2 sidesteps this by keeping the existing OpenF1 division: Claude implements;
   Codex audits.
2. **Auditor role uses `--sandbox=read-only`.** Codex's auditor role doesn't write — it reads
   `git diff integration..proposal` and emits a verdict. Read-only sandbox is sufficient
   enforcement here; no allowlist of write tools needed because no writes are possible.

For **Claude Code** (`dispatch_claude.sh` — implementer + planner roles):
- Pass `--allowed-tools "<allow-pattern>"` and `--disallowed-tools "<deny-pattern>"`. Exact
  patterns are validated by Tier-0.5 preflight (below) before commit.
- Tentative allowlist (subject to preflight validation):
  - `Read`, `Grep`, `Glob` (read-only file ops)
  - `Bash(./.loop/tools/slice_*)` — wrapper script invocations (preflight will determine the
    exact pattern form Claude Code accepts; candidate alternatives are `Bash(./.loop/tools/slice_propose_change/bin/slice_propose_change *)`,
    `Bash(.loop/tools/slice_*)`, or per-tool individual entries)
- Tentative denylist (belt-and-suspenders):
  - `Edit`, `Write`, `MultiEdit`, `NotebookEdit`
  - `Bash(rm:*)` / `Bash(rm *)` (preflight determines syntax)
  - `Bash(sudo:*)`, `Bash(git push:*)`, `Bash(npm publish:*)`
- The slice_* commands are bash scripts under `.loop/tools/<name>/bin/`, each enforcing the
  dispatcher policy (§4.2.2) on its inputs.

For **Codex CLI** (`dispatch_codex.sh` — auditor role only):
- Pass `-C "$proposal_worktree" --sandbox=read-only --ask-for-approval=never`. Audit is
  read-only; never asks for approval (any need to "approve a read" is itself a sign of a bug).
- Codex reads `git diff integration..proposal` plus prior audit history; emits PASS / REVISE /
  REJECT verdict.

**Why this is enforcement, not convention**: the agent CLI's tool-call dispatcher rejects calls
outside the allowlist *before* invoking the model's tool. Even if the model emits
`Edit{file=".env"}`, Claude Code returns a tool error to the model; no edit happens. The
model's prompt-side description of available tools is consistent with this allowlist but is not
the gating mechanism.

#### 4.1.2-pre · CLI-flag syntax preflight · 1 day (prerequisite to §4.1.2)

rev0 estimated this at 3 hours. By rev10 it grew to two fixture bundles + four CLI test
cases + private mktemp/marker plumbing + submodule teardown + pattern selection — closer
to a full day. rev11 budgets accordingly.

**Why this exists (addresses audit HIGH #2)**: the exact `--allowed-tools` pattern form for
prefix-matching bash invocations is not shown in `claude --help`. Examples given are
`Bash(git *)` (space-separated). The colon form in rev1 (`Bash(...:*)` ) was speculative. The
core safety claim of §4.1.2 depends on this syntax working; the plan can't ship §4.1.2 without
empirical confirmation.

**Spike deliverable** (~3 hours):

1. Stand up a **production-shaped** fixture — exactly the path the real allowlist will use.
   This catches pattern-syntax differences caused by the extra path segments:
   ```
   .loop/tools/preflight_test/
     config.yaml                    # declares one bash tool: preflight_test
     bin/preflight_test             # trivial script that echoes "ok"
   ```
   (rev5 used `tmp/preflight/`, which has fewer path segments than the production
   `.loop/tools/<name>/bin/<name>`; a pattern that worked in the simpler path could fail in
   the production path.)
2. For each candidate `--allowed-tools` pattern (production-shaped paths), run **four
   separate `claude -p` invocations** — each exercising one acceptance condition. All four
   reuse the same private `tmpdir=$(mktemp -d)` so the marker assertions can't cross-
   contaminate, but the `trap` for cleanup spans all four cases (set once at the top, run
   on exit):

   **Case (a) — allowed wrapper SUCCEEDS WITH ARGUMENTS** (filesystem-marker verification):

   The acceptance condition is verified by a **deterministic filesystem side effect**, not by
   parsing the agent's reply. Model paraphrasing, omission, and hallucination are out of the
   verification loop entirely.

   Fixture `bin/preflight_test` (reads the marker path from a passed env var and writes
   `${1}|${2}` to it — no globbing, no PID dependency):
   ```bash
   #!/usr/bin/env bash
   # .loop/tools/preflight_test/bin/preflight_test
   if [ -z "${PREFLIGHT_MARKER_FILE:-}" ]; then
     echo "ERROR: PREFLIGHT_MARKER_FILE not set" >&2
     exit 1
   fi
   printf '%s|%s' "$1" "$2" > "$PREFLIGHT_MARKER_FILE"
   echo "ok arg1=$1 arg2=$2 (marker: $PREFLIGHT_MARKER_FILE)"
   ```

   Test harness (bash, around the `claude -p` invocation) — uses a **private `mktemp -d`**
   so concurrent preflight runs, PID recycling, and unrelated stale markers can't
   produce false pass/fail:
   ```bash
   # Pre-test: create a private temp directory and marker path.
   tmpdir="$(mktemp -d)"
   trap 'rm -rf "$tmpdir"' EXIT
   marker_file="$tmpdir/main_marker"
   export PREFLIGHT_MARKER_FILE="$marker_file"   # the fixture reads this env var

   # Invoke Claude.
   claude -p "Run ./.loop/tools/preflight_test/bin/preflight_test with arguments SLICE-001 sample-input.patch" \
     --allowed-tools "<candidate>" \
     --disallowed-tools "Edit,Write,MultiEdit" \
     >/dev/null 2>&1
   claude_exit=$?

   # Post-test: inspect the specific marker path we created.
   if [ "$claude_exit" -ne 0 ]; then
     echo "FAIL: claude exited $claude_exit"; exit 1
   fi
   if [ ! -f "$marker_file" ]; then
     echo "FAIL: marker file not created at $marker_file — wrapper was never invoked"; exit 1
   fi
   marker_content="$(cat "$marker_file")"
   if [ "$marker_content" != "SLICE-001|sample-input.patch" ]; then
     echo "FAIL: arguments not passed through correctly: got '$marker_content'"; exit 1
   fi
   echo "PASS: (a)"
   ```

   Pattern PASSES (a) only if **the specific marker file exists at the path we created**
   AND contains the exact two arguments separated by `|`. The agent's message text is
   irrelevant — the model could say "I refused to run the script" and the test would still
   pass if the marker proves the CLI dispatched the call. Conversely, an unrelated stale
   marker in `$TMPDIR` cannot create a false pass because we only inspect our private path.

   **Selection rule** (important — addresses rev7 audit MEDIUM #1): the chosen pattern MUST
   support argument-bearing invocations. The bare no-args form
   `Bash(./.loop/tools/preflight_test/bin/preflight_test)` is **explicitly excluded from
   candidacy** even if it would pass an arg-less variant of Case (a). Real slice tools
   (`slice_propose_change <slice-id> <patch-file>`, `slice_run_typecheck <slice-id>`, etc.)
   require argument passthrough; selecting a bare-form pattern would block them.

   **Case (b) — disallowed `Edit` FAILS**:
   ```
   claude -p "Edit ./tmp/fixture.txt to change 'foo' to 'bar' using the Edit tool" \
     --allowed-tools "<candidate>" \
     --disallowed-tools "Edit,Write,MultiEdit"
   ```
   Expected: agent attempts `Edit`; CLI returns a tool error; no file modification occurs.
   Pattern PASSES (b) only if the file is unchanged after the run.

   **Case (c) — disallowed `Bash(ls)` FAILS**:
   ```
   claude -p "List the files in the current directory by running ls" \
     --allowed-tools "<candidate>" \
     --disallowed-tools "Edit,Write,MultiEdit"
   ```
   Expected: agent attempts `Bash(ls)`; the allowlist pattern (which only matches
   `preflight_test`) does NOT include `ls`; CLI returns a tool error. Pattern PASSES (c) only
   if the agent does not produce a directory listing.

   **Case (d) — negative SIBLING fixture FAILS** (wildcard-pattern containment check):

   Stand up a second fixture with a similar prefix, to verify the chosen pattern does NOT
   over-match siblings:
   ```
   .loop/tools/preflight_test_other/
     config.yaml
     bin/preflight_test_other         # reads PREFLIGHT_SIBLING_MARKER_FILE env var
   ```

   Fixture `bin/preflight_test_other` (uses a distinct env var so the test harness can
   distinguish "sibling ran" from "main ran"):
   ```bash
   #!/usr/bin/env bash
   if [ -z "${PREFLIGHT_SIBLING_MARKER_FILE:-}" ]; then
     echo "ERROR: PREFLIGHT_SIBLING_MARKER_FILE not set" >&2
     exit 1
   fi
   printf 'sibling_ran' > "$PREFLIGHT_SIBLING_MARKER_FILE"
   ```

   Test harness (extends the private `tmpdir` from Case (a)):
   ```bash
   sibling_marker="$tmpdir/sibling_marker"
   export PREFLIGHT_SIBLING_MARKER_FILE="$sibling_marker"

   claude -p "Run ./.loop/tools/preflight_test_other/bin/preflight_test_other with arguments X Y" \
     --allowed-tools "<candidate>" \
     --disallowed-tools "Edit,Write,MultiEdit" \
     >/dev/null 2>&1

   if [ -f "$sibling_marker" ]; then
     echo "FAIL: (d) — sibling fixture ran when it should have been denied"; exit 1
   fi
   echo "PASS: (d)"
   ```

   Verification: the sibling marker file should NOT exist. Pattern PASSES (d) only if the
   CLI denied the sibling's invocation entirely.

   **Implication**: a wildcard pattern like `Bash(./.loop/tools/preflight_*)` will FAIL
   Case (d) because it matches both bundles. Patterns that pass Case (d) are the narrower
   forms — `Bash(./.loop/tools/preflight_test/bin/preflight_test *)` or
   `Bash(./.loop/tools/preflight_test/*)`. **The wildcard form is acceptable for production
   only if Case (d) is replaced with a deliberate "siblings allowed" semantic** — currently
   that's NOT what we want, so wildcard forms are excluded.

   Candidate patterns to test (in order of simplicity; all must permit arguments AND
   reject sibling-prefix tools):
   - `Bash(./.loop/tools/preflight_test/bin/preflight_test *)`         *(arg-bearing, narrow — preferred)*
   - `Bash(./.loop/tools/preflight_test/*)`                            *(arg-bearing, prefix-narrow — fallback)*
   - ~~`Bash(./.loop/tools/preflight_*)`~~                             *(arg-bearing but OVER-BROAD per Case (d) — EXCLUDED)*
   - `Bash(.loop/tools/preflight_test/bin/preflight_test *)`           *(no leading `./` — arg-bearing, narrow — also acceptable)*
   - ~~`Bash(./.loop/tools/preflight_test/bin/preflight_test)`~~       *(bare form — EXCLUDED per Case (a) selection rule; would block real tools that take args)*

3. The canonical pattern is the SIMPLEST that passes ALL FOUR cases (a) + (b) + (c) + (d)
   AND permits argument passthrough. Record it in
   `diagnostic/cli_preflight_2026-XX-XX.md`.

4. Tear down both fixtures (the main `preflight_test` AND the negative `preflight_test_other`).
   Because `.loop/` is a submodule with its own git tree, the teardown must operate inside
   the submodule, not the host:
   ```
   git -C .loop rm -rf tools/preflight_test tools/preflight_test_other
   git -C .loop commit -m "remove preflight fixtures"
   # In the host repo, record the new submodule gitlink:
   git add .loop && git commit -m "submodule: drop preflight fixtures"
   ```
   Also clean any leftover markers in `$TMPDIR`:
   `rm -f "${TMPDIR:-/tmp}"/preflight_marker_* "${TMPDIR:-/tmp}"/preflight_test_other_marker_*`

   Alternatively, do the preflight in the `claude-codex-loop` repo's working tree directly
   (before mounting it as a submodule in any host project); then no host-side teardown
   is needed.

**Acceptance**: a short markdown report at `diagnostic/cli_preflight_2026-XX-XX.md` documenting
the verified pattern. §4.1.2 references that pattern, not the speculative one. If no pattern
form successfully restricts to a directory prefix, §4.1.2 enumerates each tool individually
(verbose but works) and the day-count for §4.1.2 grows by 0.5 days.

**Tool bundles** live under `.loop/tools/<name>/` (submodule top level — agent-facing surface,
distinct from the bash internals under `scripts/loop/`):

```
.loop/tools/                            # in the submodule: at the top level
  slice_read_state/
    config.yaml
    bin/slice_read_state
  slice_propose_change/
    config.yaml
    bin/slice_propose_change            # writes ONLY to proposal worktree
  slice_run_typecheck/
    config.yaml
    bin/slice_run_typecheck
  slice_run_adapter_tests/
    config.yaml
    bin/slice_run_adapter_tests
  slice_request_audit/
    config.yaml
    bin/slice_request_audit
  slice_view_history/
    config.yaml
    bin/slice_view_history
```

The agent's `--allowed-tools` flag references these at `.loop/tools/<name>/bin/<name>` (relative
to the host project root, the agent's CWD). The path is short and matches the submodule
mountpoint exactly, so the allowlist pattern verified by §4.1.2-pre maps directly to runtime
behavior.

**Tool manifest schema** (`config.yaml`) — verified against SWE-agent's actual bundles
([`swe-agent/tools/windowed/config.yaml`](../../../loop-references/swe-agent/tools/windowed/config.yaml)
shows multi-command + stateful bundles;
[`swe-agent/tools/submit/config.yaml`](../../../loop-references/swe-agent/tools/submit/config.yaml)
shows the minimal form):

```yaml
# A bundle MAY declare multiple related commands under one `tools:` key
# (e.g. SWE-agent's windowed bundle bundles goto/open/create/scroll_up/scroll_down).
# Our slice_propose_change is single-purpose so it stands alone.
tools:
  slice_propose_change:
    signature: "slice_propose_change <slice-id> <patch-file>"
    docstring: "Apply a unified diff to the active slice's proposal worktree. Writes are confined to the proposal branch and cannot touch the integration branch."
    arguments:
      - name: slice-id
        type: string
        required: true
      - name: patch-file
        type: path
        required: true
      - name: requires_approval
        type: bool
        required: false
        default: false

# Optional top-level field for stateful tools — used when a bundle needs to track
# cross-turn state (e.g. SWE-agent's windowed bundle remembers the current file & line).
# Most slice_* tools are stateless, but slice_read_state may use this to track which
# slice is "active" without forcing the agent to repeat the ID on every call.
#
# state_command: "_state"
```

**Standard bundle layout** (verified against the 15 bundles in `swe-agent/tools/`):
```
tools/<bundle-name>/
  config.yaml              # always
  bin/<command>            # always — one or more executables
  install.sh               # optional — runs on bundle registration (e.g. install deps)
```

`lib/` is NOT a standard sub-directory in the upstream bundles — drop it from our layout
unless a specific tool needs shared helpers.

**Implementation reference**:
- *Port as templates* — three SWE-agent bundles cover the patterns we need:
  - [`swe-agent/tools/submit/`](../../../loop-references/swe-agent/tools/submit/) — minimal
    template (1 command, no state, no install.sh). Use as the starter skeleton for our
    `slice_request_audit` (simplest of the slice_* tools).
  - [`swe-agent/tools/edit_anthropic/`](../../../loop-references/swe-agent/tools/edit_anthropic/)
    — write-bundle with `install.sh` + linter integration. The `bin/str_replace_editor` script
    implements safer edits than raw write — useful pattern to mirror in `slice_propose_change`
    (validate the patch shape before applying).
  - [`swe-agent/tools/windowed/`](../../../loop-references/swe-agent/tools/windowed/) —
    multi-command bundle with `state_command`. Template for any slice tool that needs
    cross-turn state (e.g. `slice_read_state` if we want to track active slice ID without
    repeating it on each call).
- *Adapt the registry pattern* from
  [`swe-agent/sweagent/tools/`](../../../loop-references/swe-agent/sweagent/tools/) — the Python
  loader that scans the `tools/` directory, parses each `config.yaml`, and registers the
  declared commands into the agent's tool list. Our bash equivalent only needs to:
  1. Enumerate `.loop/tools/*/config.yaml`
  2. Concatenate each `signature` + `docstring` into a markdown block the implementer prompt
     includes as the agent's tool description
  3. Generate the `--allowed-tools` flag value from the union of declared commands
- *Study* [`swe-agent/tools/registry/`](../../../loop-references/swe-agent/tools/registry/) for
  the YAML schema validation logic if we want stricter manifests later. Not needed for v1.

**Prompt change**: `scripts/loop/prompts/claude_implementer.md` rewritten so the agent receives the
tool-bundle docstrings as its capability list. The prompt's description of available tools is
consistent with the `--allowed-tools` flag (so the model isn't surprised by tool errors) but the
flag, not the prompt, is what enforces.

**Acceptance**:
1. A manual smoke test of `dispatch_claude.sh` against a fixture slice shows the agent using the
   custom verbs in its tool-use trace.
2. **Negative test**: a fixture slice whose prompt explicitly asks the agent to call `Edit` or
   `Write` directly (bypassing the wrapper) results in CLI-level tool-call rejection — visible in
   the dispatch's trajectory artifact as a tool error from the Claude Code runtime, not from a
   wrapper script. No file write occurs.
3. **Boundary test**: a fixture slice whose prompt asks the agent to run `Bash(rm -rf .git)`
   results in a CLI-level rejection (matched by the `--disallowed-tools` deny entry); no shell
   invocation occurs.

#### 4.1.3 Model packs · 1 day

**Deliverable**: named bundles of (role → model) selectable at runtime.

**File**: `scripts/loop/packs.yaml`:
```yaml
packs:
  nightly-cost-optimized:
    planner:    { provider: anthropic, model: claude-sonnet-4-6 }
    implementer:{ provider: anthropic, model: claude-sonnet-4-6 }
    auditor:    { provider: openai,    model: gpt-5-codex }
    summarizer: { provider: anthropic, model: claude-haiku-4-5 }

  premium-quality:
    planner:    { provider: anthropic, model: claude-opus-4-7 }
    implementer:{ provider: anthropic, model: claude-opus-4-7 }
    auditor:    { provider: openai,    model: gpt-5-codex }
    summarizer: { provider: anthropic, model: claude-sonnet-4-6 }

  daytime-debug:
    planner:    { provider: anthropic, model: claude-sonnet-4-6 }
    implementer:{ provider: anthropic, model: claude-sonnet-4-6 }
    auditor:    { provider: anthropic, model: claude-sonnet-4-6 }  # single-vendor for fast iteration
    summarizer: { provider: anthropic, model: claude-haiku-4-5 }
```

**Wiring**: `LOOP_PACK=<name>` env var; `scripts/loop/slice_helpers.sh` exports `LOOP_MODEL_PLANNER`,
`LOOP_MODEL_IMPLEMENTER`, `LOOP_MODEL_AUDITOR`, etc. Dispatch scripts read those env vars.

**Acceptance**: `LOOP_PACK=premium-quality scripts/loop/runner.sh --once` uses Opus for the
implementer dispatch. Verifiable via the cost ledger entry showing the right model name.

**Implementation reference**:
- *Adapt the `ModelPack` struct shape* from
  [`plandex/app/shared/ai_models_data_models.go:920`](../../../loop-references/plandex/app/shared/ai_models_data_models.go).
  Plandex's pack has named role fields (`Planner`, `Coder`, `PlanSummary`, `Builder`, `Namer`,
  `CommitMsg`, `ExecStatus`, `Architect`) with each role pointing at a `ModelRoleConfig`. Our
  YAML pack mirrors this shape with our role names (`planner`, `implementer`, `auditor`,
  `summarizer`); the structure is the part to copy. Plandex's richer 8-role set is overkill;
  4 is enough for our v1.
- *Port the fallback-on-unset pattern* from
  [`plandex/app/shared/ai_models_data_models.go:936-954`](../../../loop-references/plandex/app/shared/ai_models_data_models.go)
  — `GetCoder()` returns the Coder's config if set, otherwise falls back to Planner's;
  `GetArchitect()` does the same. Lets a minimal pack declare only `planner` + `auditor` and
  let everything else default to Planner. Our `slice_helpers.sh` should implement this as a
  bash lookup with a `LOOP_MODEL_*` env var defaulting to `LOOP_MODEL_PLANNER` if unset.
- *Port the built-in catalog pattern* from
  [`plandex/app/shared/ai_models_packs.go:24-43`](../../../loop-references/plandex/app/shared/ai_models_packs.go):
  `var BuiltInModelPacks = []*ModelPack{...}` + `var BuiltInModelPacksByName = make(map[string]*ModelPack)`
  + `var DefaultModelPack *ModelPack`. Our YAML packs file (`.loop/packs/*.yaml`) is the
  declarative equivalent; a startup-time check should validate every reachable model is
  responsive (per §6 risk row).
- *Study* [`plandex/app/cli/cmd/model_packs.go`](../../../loop-references/plandex/app/cli/cmd/model_packs.go)
  + [`set_model.go`](../../../loop-references/plandex/app/cli/cmd/set_model.go) for UX cues —
  `pdx model-packs` lists, `pdx set-model <pack>` switches. Our `.loop/loop_review.sh` could
  grow `--pack <name>` and `--list-packs` flags using the same conventions.

### 4.2 Tier 2 — Cost + safety (5 days)

#### 4.2.1 History processor pipeline + cache-control · 1 day (Branches A/B) · 3 days (Branch C)

Duration is branch-conditional on the §4.0 spike outcome. Branches A (marker-supported) and B
(auto-cache only) are bash + jq implementations that fit in one day. Branch C (SDK fallback)
requires a small Node helper invoking the Anthropic SDK directly for the planner / implementer /
summarizer roles; estimated 3 days for the helper + integration + testing.

**Important**: the concrete shape of this deliverable is **selected by the §4.0 spike's branch
decision**. What's described below is the *marker-supported* branch (the optimistic outcome).
The other two branches are documented inline alongside it.

**Deliverable (common to all branches)**: trajectory shaping moves from ad-hoc concatenation in
`dispatch_plan_revise.sh` to a declarative pipeline. The pipeline's *processors* differ per
spike outcome.

**Branch A — marker-supported (§4.0 row 1, target $50)**:

`scripts/loop/history_processors.yaml` (schema verified against SWE-agent's pydantic models at
[`sweagent/agent/history_processors.py:261`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py)):
```yaml
default:
  - type: cache_control                # inserts cache_control: ephemeral on user/tool messages
    last_n_messages: 4                  # upstream default is 2; we use 4 to cover deeper revision spirals
    tagged_roles: ["user", "tool"]      # *message* roles to tag (NOT pack roles like planner/implementer)
  - type: remove_regex
    remove: ["^DEBUG:.*$"]
    keep_last: 5
```

**Note on role naming**: `tagged_roles` refers to *message roles* (`"user"`, `"tool"`,
`"assistant"`, `"system"`) in the conversation, not to pack-defined agent roles
(`planner`, `implementer`, etc.). The pack-role-specific behavior is implicit: when the
processor runs from within a planner dispatch, it tags that conversation's user messages;
when it runs from within an implementer dispatch, it tags those user messages. Only Claude
roles benefit (auditor uses Codex and doesn't honor Anthropic cache markers); since this
processor is wired into the Claude-side dispatchers only, no role filter is needed in the
YAML itself.

**`last_n_messages: 4` vs upstream's 2**: SWE-agent's default of `2` is tuned for two-turn
caching ("most cases"). Our revision-spiral scenario typically runs 5-7 turns of
plan→audit→revise per slice; setting `4` keeps cache breakpoints across the last two
revise-audit pairs without re-paying input cost on each cycle. The §4.0 spike's empirical
results will refine this number.

Implementation: `scripts/loop/lib/history_processor.sh` reads the YAML and rewrites the
prompt-history JSON the Claude Code CLI consumes, inserting `cache_control: ephemeral` blocks
on the last N user/tool messages (mirroring the upstream's `_set_cache_control`/`_clear_cache_control`
semantics).

**Implementation reference**:
- *Adapt the protocol pattern* from
  [`swe-agent/sweagent/agent/history_processors.py:13-72`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py)
  — `AbstractHistoryProcessor(Protocol)` defines the `__call__(history: History) -> History`
  shape. Our bash equivalent: each processor type is a script under
  `scripts/loop/lib/processors/<type>.sh` that takes a history JSON on stdin and emits a
  history JSON on stdout. Pipeline-able with `|`.
- *Port the cache-control logic verbatim* from
  [`swe-agent/sweagent/agent/history_processors.py:261-303`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py)
  — `CacheControlHistoryProcessor.__call__` iterates `reversed(history)`, clears existing cache
  markers, sets new ones on the last N matching messages. ~40 lines of straightforward logic;
  port to bash/jq with minor renaming. Branch A of §4.0 uses this directly; Branches B and C
  adapt it.
- *Port the helper functions* `_set_cache_control` / `_clear_cache_control` (same file, near
  the top). These are the actual JSON-mutation primitives. In our bash port these become
  `jq` snippets like
  `jq '.content[-1].cache_control = {"type":"ephemeral"}'` (set) and
  `jq 'del(.content[].cache_control)'` (clear).
- *Adapt the RemoveRegex processor* from
  [`swe-agent/sweagent/agent/history_processors.py:305-339`](../../../loop-references/swe-agent/sweagent/agent/history_processors.py)
  — useful for stripping `DEBUG: …` lines, verbose tool output, etc. Easy port: `sed`/`jq` on
  the message-content strings.
- *Skip* the `ImageParsingHistoryProcessor` (line 340+) — we don't pass images through the
  loop and SWE-agent uses it for browser screenshots.
- *Study* the `LastNObservations` processor (line 85-178) — the upstream notes "modern SotA
  models can fit a lot of context, so generally not needed anymore." We probably don't need
  it for our depth of revision spirals; cache-control is the higher-leverage processor.

**Branch B — auto-cache only (§4.0 row 2, target $75)**:

Processors restructure prompt history to *maximize* Claude Code's automatic system-prompt +
tools caching: stable prefix kept first, mutable context appended, no explicit markers. The
`cache_control` processor type is renamed `stable_prefix_first` and reorders messages instead
of inserting markers.

**Branch C — SDK fallback (§4.0 row 3, target $60)**:

A small Node helper at `scripts/loop/lib/anthropic_sdk_dispatch.mjs` invokes the Anthropic
SDK directly for the planner / implementer / summarizer roles (Claude only). The CLI path is
preserved for any role/scenario where SDK access isn't worth the complexity (auditor remains
Codex CLI). `history_processors.yaml` becomes input to the SDK helper's message-builder.

**Acceptance**: a revision-spiral slice (5+ revisions on the same prompt) shows reduced
`input_tokens` cost in the cost ledger after the second turn. Empirical target: ≥ 50% input-token
savings on revisions 3+ when cache-control is active.

#### 4.2.2 Dispatcher-enforced approval + deferred-review queue · 3 days

**Enforcement design (addresses audit HIGH #2)**: rev0 trusted the model's `requires_approval`
self-label to gate sensitive operations. rev1 inverts the trust model:

- **The dispatcher inspects the proposed change** (patch contents for file edits, command string
  for shell calls) against a **rule-based policy** before the slice_* wrapper script applies it.
- The policy decision — not the model's self-label — is what gates execution.
- The model's optional `requires_approval: true` annotation remains as an *additional* signal:
  if either the policy OR the model flags the action, it's queued. Never just the model.

**Policy file**: `.loop-rules/approval-policy.yaml` (project-level, overridable):

```yaml
require_approval:
  # File paths the proposed patch touches → match against `git diff --name-only` for the patch
  paths:
    - "sql/migrations/**"
    - ".env*"
    - "infra/**"
    - "web/src/lib/db/**"
    - ".loop-packs.yaml"      # editable with human approval; not security-critical

  # Patch content patterns (matched against the patch hunks)
  patch_patterns:
    - "DROP\\s+TABLE"
    - "TRUNCATE"
    - "DELETE\\s+FROM"            # gate even with WHERE for caution
    - "ALTER\\s+TABLE.*DROP"
    - "rm\\s+-rf"
    - "force-with-lease|force\\s*$"

  # Shell command prefixes (the slice_run_shell or equivalent wrapper inspects the argv)
  shell_prefixes:
    - "rm -rf"
    - "sudo"
    - "git push"
    - "git reset --hard"
    - "git rebase"
    - "npm publish"
    - "DROP "

  # Operations always blocked outright (not even queueable; tool returns an error).
  # Anything that would let the agent mutate its own enforcement boundary lives here, NOT
  # in require_approval — human approval of a self-mutation request is still self-mutation
  # and breaks the read-only-submodule invariant.
  forbidden:
    paths:
      - ".loop/**"            # the submodule itself — read-only from runtime
      - ".loop-rules/**"      # the rule files defining policy — agent must never edit
      - ".loop-config.yaml"   # host config (API keys, model pinning)
      - ".loop-state/**"      # runtime state — must only be written via the loop's own helpers
    patterns:
      - "git push.*--force[^-]"     # naked --force without --force-with-lease
      - "rm -rf /"
      - "rm -rf \\.git"
      - "rm -rf \\.loop"            # belt-and-suspenders: also catch CLI-level attempts
```

**Mechanism**:

1. Custom tools (§4.1.2) accept the proposed change as an argument (e.g. a patch file for
   `slice_propose_change`, an argv array for `slice_run_shell`).
2. The wrapper script calls `lib/policy_check.sh <change>` (modelled after Cline's
   [`CommandPermissionController`](../../../loop-references/cline/src/core/permissions/CommandPermissionController.ts):
   shell-quote-style command parsing that handles `&&`/`||`/`|`/`;` segments, subshells,
   redirects, and per-segment allow/deny matching — naive regex matching of the raw command
   string would miss `cmd1 && rm -rf /`) which evaluates the change against
   `.loop-rules/approval-policy.yaml`. The check returns one of: `pass | require_approval | forbidden`.
3. On `pass`: the wrapper applies the change.
4. On `require_approval`: the wrapper persists the proposed action plus its policy hit reason to
   `${LOOP_STATE_DIR}/pending_approvals/<slice-id>-<turn>.json` (defaults to
   `<host-project>/.loop-state/pending_approvals/`); marks the slice
   `status: awaiting_human_review`; returns success-but-queued to the model; runner advances.
5. On `forbidden`: the wrapper returns a tool error to the model; slice continues but the model
   sees a refusal; if it persists, audit will catch it.
6. The model's optional `requires_approval: true` field still queues even if no rule fires
   (gives the model a way to flag "this looks weird, ask the human").
7. Morning triage tool `.loop/loop_review.sh` lists pending approvals; user runs
   `.loop/loop_review.sh --approve <slice-id>` to release or `--reject <slice-id>` to discard.

**Why this is enforcement, not convention**: the wrapper script is the only path from the agent
to actual changes (because of §4.1.2's CLI allowlist). The wrapper runs the policy check
unconditionally. The model cannot bypass policy because the model never holds the lever.

**Acceptance**:
1. A test slice attempts a `DROP TABLE` SQL change. The wrapper's `policy_check.sh` matches the
   `patch_patterns` rule and queues the action; `pending_approvals/` contains the entry; the
   slice's status is `awaiting_human_review`; the runner advances to the next slice without
   blocking.
2. **Negative test for trust-the-model bug**: a test slice's prompt instructs the model to omit
   `requires_approval` (or to set it to `false`) for an action that touches `sql/migrations/`.
   The wrapper still queues the action because the policy matched the path. Verified by inspecting
   `pending_approvals/`.
3. **Forbidden test**: a test slice attempts `git push --force origin main` (no `--force-with-lease`).
   The wrapper returns a tool error; nothing is queued; nothing happens to the remote.
4. Morning `.loop/loop_review.sh` lists each pending action with its policy-hit reason, the proposed
   change, and the slice's audit history.

**Implementation reference**:
- *Port the parsing approach* from
  [`cline/src/core/permissions/CommandPermissionController.ts`](../../../loop-references/cline/src/core/permissions/CommandPermissionController.ts).
  The relevant primitives:
  - `ParsedCommand` interface (lines 18-22): `segments` + `subshells` + `hasRedirects`. We
    need the same shape.
  - `parseConfig()` (lines 50-71): reads env var, parses JSON allow/deny lists. Our bash
    equivalent reads `.loop-rules/approval-policy.yaml`.
  - `validateCommand()` (lines 77+): the core algorithm — parse the command, walk each
    segment, check against allow/deny, recurse into subshells. **Port this logic carefully**
    — naive regex on the raw command string misses `cmd1 && rm -rf /`.
  - `REDIRECT_OPERATORS` set + `COMMAND_SEPARATOR_OPERATORS` set + `LINE_SEPARATOR_REGEX`
    (lines 5-15): the dangerous-character catalog.
- *Choose a real shell parser — NOT `shlex.split()`*. Python's `shlex.split` tokenizes a
  command string but does NOT classify operators (`&&`, `||`, `|`, `;`), redirects (`>`,
  `>>`, `<`, `>&`), subshells (`$(...)`), heredocs, or backtick expansion. For a security
  gate, tokens-without-structure is insufficient — it can't tell that the `&&` in
  `cmd1 && rm -rf /` is a separator that splits two independent commands. Two viable
  options:
  - **`bashlex`** (Python package, ~5 KLOC, generates a bash AST). Closest to Cline's
    `shell-quote` for our purposes. Install via `pip install bashlex`. The AST has explicit
    node types for `CommandNode`, `OperatorNode`, `RedirectNode`, etc. — exactly what the
    security gate needs.
  - **Node helper using `shell-quote`** — invoke Cline's actual dependency directly from a
    small Node helper script. Adds Node as a hard dependency for the security gate (we
    already have Node for `web/`, so the marginal cost is low).
  Either way, the implementation must use the parser's structured output to walk segments
  and validate each — naive substring/regex matching on the raw command string is the
  documented anti-pattern (`cmd1 && rm -rf /` bypasses naive matching).
- *Don't claim `shlex.split()` is sufficient*. It is not. Earlier rev5 of this plan made
  that claim; rev6 corrects it.
- *Adapt the dangerous-character detection* from CommandPermissionController (backticks
  outside single quotes; newlines outside quotes). These catch obfuscation attempts the
  approval-policy regex wouldn't catch.
- *Skip*: Cline's environment-variable-based config plumbing (`CLINE_COMMAND_PERMISSIONS` env
  var with embedded JSON). Our YAML file at `.loop-rules/approval-policy.yaml` is cleaner for
  our use case and the file-watcher pattern is unnecessary.

#### 4.2.3 Three-scope restore · 1 day

**Deliverable**: `dispatch_repair.sh` splits into three verbs.

**Scripts**:
Adopting Cline's upstream terminology (verified at
[`cline/src/integrations/checkpoints/index.ts`](../../../loop-references/cline/src/integrations/checkpoints/index.ts):
`task` / `workspace` / `taskAndWorkspace`) so future research stays mappable:

- `scripts/loop/loop_restore_workspace.sh <slice>` — `git checkout integration -- <files>` in
  the proposal worktree; keep slice's history JSON; agent re-runs with audit feedback in
  context. (Equivalent to Cline's `"workspace"`.)
- `scripts/loop/loop_restore_task.sh <slice>` — truncate prompt history JSON to first turn;
  keep proposal-branch code; agent re-runs from current state with a fresh perspective.
  (Equivalent to Cline's `"task"`.)
- `scripts/loop/loop_restore_taskAndWorkspace.sh <slice>` — both of the above. (Equivalent to
  Cline's `"taskAndWorkspace"`.)

**Triage integration**: `triage_blocked_slice.sh` picks restore mode based on failure pattern:
- Same audit verdict repeated → `loop_restore_task.sh` (agent stuck in a loop; reset history)
- Audit verdict different each time but consistently REJECT → `loop_restore_taskAndWorkspace.sh`
- Audit said REVISE with specific guidance → `loop_restore_workspace.sh` (preserve history for context)

**Acceptance**: triage logs in `${LOOP_STATE_DIR}/triage_actions.jsonl` show the chosen restore
mode for each recovery; manual inspection of a pre-built fixture confirms each verb does what the
comment claims.

**Implementation reference**:
- *Port the three-case switch* from
  [`cline/src/integrations/checkpoints/index.ts:258-360`](../../../loop-references/cline/src/integrations/checkpoints/index.ts)
  — the `switch (restoreType) { case "task": … case "workspace": … case "taskAndWorkspace": … }`
  is exactly the shape our three scripts implement. Lines ~649-730 show `handleSuccessfulRestore`
  which keeps a structured restore-log entry per invocation; we should mirror this in
  `triage_actions.jsonl`.
- *Adapt the workspace-restore primitive* — Cline uses shadow-git to revert files. Our
  equivalent: `git checkout integration -- <files>` inside the proposal worktree, which is
  cheaper than shadow-git but covers the same case (revert code, keep conversation).
- *Don't port* Cline's `CheckpointTracker` /
  [`CheckpointGitOperations.ts`](../../../loop-references/cline/src/integrations/checkpoints/CheckpointGitOperations.ts)
  shadow-repo machinery. Per-tool-use checkpoint granularity is finer than we need; our
  proposal-branch + commit-on-merger pattern is the right grain.
- *Study* [`CheckpointExclusions.ts`](../../../loop-references/cline/src/integrations/checkpoints/CheckpointExclusions.ts)
  — if our `.loop-state/` lives inside the host project, our worktree restore needs to
  exclude it from the `git checkout`, otherwise a workspace-restore could clobber the
  approval queue. The exclusion list Cline uses is a useful template.

### 4.3 Tier 3 — Leverage on failures (3 days)

#### 4.3.1 Speculative branches · 2 days

**Deliverable**: slice failures past a threshold fork into N parallel proposal branches with varied
prompts.

**Trigger**: slice `revision_count >= 2` AND no successful audit yet.

**Mechanism**: `dispatch_speculative_fork.sh` creates `slice/<id>/v<N>-{conservative, aggressive,
alt-planner}` proposal branches. Each branch runs through dispatch with a different prompt seed
(temperature variance, different planner model from the pack, or different problem framing). All
three audits run; the first to pass wins; the others are kept for human comparison.

**Interaction with approval queue (addresses audit MEDIUM #4)**:

Each speculative variant runs through the dispatcher's policy check (§4.2.2) **independently**.
The slice as a whole is *not* blocked by one risky variant. Specifically:

| Variant outcome | What happens to that variant | What happens to the slice |
|---|---|---|
| Variant policy = `pass`, audit = PASS | Merged via §4.1.1 merge-ladder | If merged first: slice `done`; cancels other variants' queues |
| Variant policy = `pass`, audit = REJECT | Variant marked `rejected`; branch deleted | Slice waits on remaining variants |
| Variant policy = `require_approval` | Variant entry added to `pending_approvals/`; variant marked `awaiting_human_review`; branch preserved | Slice waits on remaining variants; if a non-approval variant passes first, the queued approval is auto-cancelled |
| Variant policy = `forbidden` | Variant fails closed immediately; branch deleted; variant marked `forbidden` | Slice waits on remaining variants |

**Cancel-on-success (slice-locked)**: when any variant reaches `done`, the merger acquires a
per-slice mutex before walking the variant list. The mutex protects all sibling mutations from
races with in-flight audits/merges of other variants.

Mutex implementation: extend the existing `scripts/loop/repo_lock.sh` to accept a key argument:
`acquire_slice_lock <slice-id>` / `release_slice_lock <slice-id>`. The lock file lives at
`${LOOP_STATE_DIR}/locks/slice-<id>.lock` (flock-based on Linux/macOS).

Operations that MUST hold the slice lock:
- Final fast-forward of a proposal branch into integration (`dispatch_merger.sh`).
- Cancellation of sibling variants (`dispatch_speculative_fork.sh` cancel-on-success path).
- Mutation of `pending_approvals/` entries belonging to this slice.
- Setting slice `status: done` or `status: all_variants_queued`.

Concrete cancel-on-success flow (inside the lock):

```
acquire_slice_lock <slice-id>
trap "release_slice_lock <slice-id>" EXIT
for variant in $(jq -r '.speculative_variants[] | select(.status != "done") | .branch' slice.json); do
  case "$(variant_status $variant)" in
    pending|in_progress)
      kill_dispatch_for_variant $variant
      git worktree remove --force <variant-worktree>
      git branch -D $variant
      mark_variant_status $variant cancelled_by_winner ;;
    awaiting_human_review)
      rm -f ${LOOP_STATE_DIR}/pending_approvals/<slice-id>-<variant>.json
      mark_variant_status $variant cancelled_by_winner
      git worktree remove --force <variant-worktree>
      git branch -D $variant ;;
    awaiting_rebase|awaiting_rebase_audit)
      # Mid-merge of a competing variant: leave it alone; first to finish wins.
      # The losing merger will detect status==done on its post-merge re-read and bail out.
      continue ;;
  esac
done
update_slice_status done
release_slice_lock <slice-id>
```

The competing-merger case (a sibling variant is mid-`git merge --ff-only` when our variant
wins) is handled by the losing merger re-reading slice status under the same lock after its
own merge attempt and bailing out with `status: superseded_by_winner` if `done` was set.

This way, a risky variant whose approval-queue entry is sitting overnight gets harmlessly
cancelled when a safer sibling variant passes audit and merges — without races and without
leaving orphan worktrees or stale approval entries.

**Stuck case**: if all three variants are simultaneously in `awaiting_human_review` (no
safe-by-construction variant exists), the slice frontmatter goes to `status: all_variants_queued`
and the morning triage view groups them so the human can compare and approve at most one.

**Implementation reference**:
- *Adapt the plan-branch concept* from
  [`plandex/app/cli/cmd/branches.go`](../../../loop-references/plandex/app/cli/cmd/branches.go)
  + [`checkout.go`](../../../loop-references/plandex/app/cli/cmd/checkout.go) — Plandex's
  "plan branches" are forks of a plan's internal state, not git branches. We use git
  branches as our state layer, so our `slice/<id>/v3-conservative` etc. are real git refs.
  The naming convention and the "fork from same root, compare outcomes" pattern come from
  Plandex.
- *Adapt the listing UX* — Plandex's `pdx branches` shows a tree of plan-branches with
  status. Our `loop_review.sh --list-variants <slice-id>` should show similar: which variant
  is in flight, which passed, which got queued for approval.
- *Don't port* Plandex's plan-branch persistence (server-side database). Our git branches
  ARE the persistence layer; cancel-on-success uses `git branch -D` and worktree teardown.
- *Study* [`plandex/app/cli/cmd/rewind.go`](../../../loop-references/plandex/app/cli/cmd/rewind.go)
  for the "step-level rewind" UX. We don't need step-level rewind (our slice is the unit), but
  the CLI conventions for "rewind to before N" could inform `loop_review.sh --rewind-slice <id>`.

**Slice frontmatter additions**:
```yaml
speculative_variants:
  - branch: slice/<id>/v3-conservative
    seed: temperature=0.2
    status: pending|pass|reject
  - branch: slice/<id>/v3-aggressive
    seed: temperature=0.6
    status: pending|pass|reject
  - branch: slice/<id>/v3-alt-planner
    seed: planner=claude-opus-4-7
    status: pending|pass|reject
chosen_variant: slice/<id>/v3-conservative   # set when one passes
```

**Acceptance**: a fixture slice designed to fail twice gets three forks on the third attempt;
morning view shows all three in the slice frontmatter with their audit verdicts.

#### 4.3.2 `.loop-rules/` path-scoped rules · 0.5 days

**Deliverable**: project-level rule directory with glob-scoped activation.

**Ownership model (resolves rev5 §4.3.2-vs-policy conflict)**: `.loop-rules/` is
**human-owned**. The agent **reads** rules at dispatch time (via the loader described below)
but **never writes** to `.loop-rules/**` — the path is in `forbidden.paths` in §4.2.2's
approval policy precisely because rule files define the agent's policy boundary; allowing
the agent to mutate them would let it expand its own enforcement envelope.

Concretely:
- **Setup script** (`setup_host_project.sh`, §5.3) seeds `.loop-rules/` from
  `.loop-defaults/.loop-rules/` on first run AND heals missing files on subsequent runs.
- **Subsequent edits** are manual — the human adds/modifies rule files directly with a normal
  editor (or proposes an edit via a separate human-driven PR if `.loop-rules/` is in version
  control).
- **The agent** can only read `.loop-rules/`. Any tool call that attempts a write — directly
  or via patch — returns a `forbidden` error per §4.2.2's policy (verified by an acceptance
  test in §7).
- **Rule discovery for agent suggestions**: if a human wants the agent to propose a new
  rule (e.g. after noticing a recurring failure pattern), the agent writes the suggestion
  into a slice's audit-history JSON or a normal markdown note — *not* into `.loop-rules/`.
  The human then manually promotes vetted suggestions.

**Layout**:
```
.loop-rules/                                   # human-owned; agent has read-only access
  global.md                      # frontmatter: paths: ["**"]
  migrations-safety.md           # frontmatter: paths: ["sql/migrations/**"]
  chart-adapter-conventions.md   # frontmatter: paths: ["web/src/lib/mapInsight/**"]
  approval-policy.yaml           # §4.2.2 — not markdown; the policy schema lives here
```

**Mechanism**: `scripts/loop/lib/rules_loader.sh` — globs the active slice's file list against each
rule's `paths` frontmatter, concatenates matching rule bodies into the agent's system prompt.

**Acceptance**: a slice touching `sql/migrations/` includes `migrations-safety.md` in its prompt;
a slice touching only `web/src/components/` does not. Verified via the dispatch's persisted prompt
artifact.

**Implementation reference**:
- *Adapt the frontmatter+glob pattern* from Cline's `.clinerules` convention (see Cline docs
  at [`cline/sdk/`](../../../loop-references/cline/sdk/) for examples and any test fixtures
  containing `.clinerules` files; the implementation lives in Cline's core but the user-facing
  convention is what we're copying).
- *Adapt the markdown-with-frontmatter loader* — many open-source projects (Cline, Cursor,
  Aider all support it via different paths) parse YAML frontmatter from markdown files. Our
  bash equivalent uses `yq` (or a small Python helper) to extract the `paths:` list and
  match against the slice's touched files.
- *Study* Cline's auto-detection of `.cursorrules`, `.windsurfrules`, `AGENTS.md` as
  alternative rule formats. We can defer cross-format detection until a host project
  genuinely needs it.

#### 4.3.3 Per-dispatch trajectory artifact · 0.5 days

**Deliverable**: each `dispatch_claude.sh` / `dispatch_codex.sh` run persists its tool-use trace
to `${LOOP_STATE_DIR}/dispatches/<slice-id>/<turn-n>.jsonl` (defaults to
`<host-project>/.loop-state/dispatches/<slice-id>/<turn-n>.jsonl`).

**Mechanism**: pipe `claude --json` (and Codex equivalent) output through a tee that splits to
both the live runner and the per-dispatch JSON file. No model change required.

**Acceptance**: after any dispatch, the JSONL file exists with one record per tool use, in order;
`triage_blocked_slice.sh` references it in its triage report.

**Implementation reference**:
- *Study the trajectory format* in
  [`swe-agent/trajectories/`](../../../loop-references/swe-agent/trajectories/) (example
  trajectory JSONs in the repo) — the structure is one event per line, each event carrying
  `action`, `observation`, `agent_state`. Our equivalent is simpler: one tool-call per JSONL
  record with input + output.
- *Skip* SWE-agent's full event-stream design — we only need the trace, not the replay
  capability. The Claude Code CLI's `--json` output already emits structured per-turn JSON;
  tee it to disk and we're done.

### 4.4 Tier 4 — Quality of life (1 day, optional)

#### 4.4.1 Plan/Act mode-as-state · 1 day

Slice frontmatter gains `mode: plan | act`. `dispatch_planner.sh` uses pack's `planner` model and
only exposes read tools; `dispatch_implementer.sh` uses `implementer` model and exposes write
tools. Transition is an explicit slice-state event.

**Handoff mechanism** (modelled after Aider's `ArchitectCoder.reply_completed` at
[`aider/aider/coders/architect_coder.py`](../../../loop-references/aider/aider/coders/architect_coder.py)):
the planner's final response IS the implementer's *only* prior context. The implementer
dispatch creates a fresh conversation with `cur_messages = []` and the planner's plan blob as
the user message. This:

- Gives Codex a clean audit boundary — it audits the implementer's diff against the planner's
  plan, not against the planner's full reasoning trace.
- Lets the implementer model be smaller (different concerns) without re-paying input cost on
  the architect's exploration.
- Mirrors Aider's `editor_coder.run(with_message=content)` mechanic exactly.

**Implementation reference**:
- *Port the handoff mechanic verbatim* from
  [`aider/aider/coders/architect_coder.py:18-46`](../../../loop-references/aider/aider/coders/architect_coder.py)
  — `reply_completed()`. ~30 lines. The key moves are:
  - `editor_model = self.main_model.editor_model or self.main_model` (fallback if no separate
    editor model declared — mirrors our `GetCoder()` pattern from §4.1.3)
  - `editor_coder.cur_messages = []` + `editor_coder.done_messages = []` (start with empty
    history)
  - `editor_coder.run(with_message=content, preproc=False)` (the planner's full response IS
    the prompt; no preprocessing)
- *Port the editor-model wiring* from
  [`aider/aider/models.py:625-640`](../../../loop-references/aider/aider/models.py)
  — `get_editor_model()` shows how a separate editor model is selected per main model. Our
  equivalent: `LOOP_MODEL_IMPLEMENTER` overrides `LOOP_MODEL_PLANNER` for the implementer
  dispatch; absent override, both use the planner's model.
- *Adopt the cache-disable for editor handoffs* — Aider sets `kwargs["cache_prompts"] = False`
  for the editor (line 32) because there's nothing cacheable across editor invocations
  (every invocation starts empty). **This has direct §4.0 implications**: the implementer-role
  cache budget is essentially zero because handoffs reset. Our §7.4 budget calculation should
  treat implementer-role cost as not-cache-discounted while planner-role cost IS. Update the
  §4.0 spike's $ targets to reflect this if Branch A is selected.
- *Skip* Aider's `summarize_from_coder=False`, `map_tokens=0`, etc. configuration noise —
  these tune Aider-specific behaviors irrelevant to our loop.

Defer if Tier 1-3 are tight; this is a refinement on top of model packs (§4.1.3).

---

## 5 · Drop-in packaging shape

### 5.1 Submodule structure

Repo: `claude-codex-loop/` (private repo or local-path submodule; mounted as `.loop/` in host).
Top-level files are agent-facing; everything else is internals.

```
setup_host_project.sh          # one-time bootstrap, run from host root (§5.3)
loop_review.sh                 # morning triage entry point
tools/                         # SWE-agent-style tool bundles — agent-facing surface (§4.1.2)
  slice_read_state/
    config.yaml
    bin/slice_read_state
  slice_propose_change/
  slice_run_typecheck/
  slice_run_adapter_tests/
  slice_request_audit/
  slice_view_history/
packs/                         # default model packs (§4.1.3)
  nightly-cost-optimized.yaml
  premium-quality.yaml
  daytime-debug.yaml
history_processors/            # default processor pipeline (§4.2.1, branch-selected by §4.0)
  default.yaml
scripts/loop/                  # bash internals — NOT agent-facing
  runner.sh
  dispatch_claude.sh
  dispatch_codex.sh
  dispatch_merger.sh
  dispatch_slice_audit.sh
  dispatch_plan_revise.sh
  dispatch_repair.sh
  dispatch_speculative_fork.sh
  prompts/
    claude_planner.md
    claude_implementer.md
    claude_plan_auditor.md
    claude_plan_reviser.md
    codex_slice_auditor.md
  lib/
    history_processor.sh
    rules_loader.sh
    policy_check.sh             # §4.2.2 dispatcher policy
    slice_helpers.sh
    worktree_helpers.sh
    repo_lock.sh                # generalized: acquire_slice_lock <slice-id>
    state_paths.sh              # resolves LOOP_STATE_DIR; default <host>/.loop-state/
    loop_refs_dir.sh            # resolves loop_references_dir; precedence: env → config → default
.loop-defaults/                 # files copied (not symlinked) into host on first setup
  .loop-rules/
    global.md
    migrations-safety.md
    approval-policy.yaml        # §4.2.2 default policy — shipped here so host has it after setup
  .loop-packs.yaml              # template; host overrides
  .loop-config.yaml             # host-specific env, e.g. CLAUDE_API_KEY_REF
  .gitignore.fragment           # entries to merge into host's .gitignore
README.md
```

The agent's `--allowed-tools` allowlist references tools at `./.loop/tools/<name>/bin/<name>`,
which is the host-relative path that matches the mount point exactly.

### 5.2 Host project structure

Any project that adopts the loop adds:
```
.loop/                          # git submodule pointing at claude-codex-loop/ (or symlink) — READ-ONLY from host's perspective
.loop-rules/                    # per-project safety + style rules (copied from .loop-defaults/)
.loop-packs.yaml                # per-project pack overrides (extends submodule defaults)
.loop-tools/                    # per-project extra tools (optional)
.loop-config.yaml               # per-project env vars (which API keys, which models)
.loop-state/                    # ALL runtime state (pending_approvals, dispatches, triage_actions, repair_count, etc.) — gitignored
diagnostic/                     # roadmap, plans, slice files (where you already keep them)
  slices/                       # current slice queue
```

**Read-only-submodule invariant**: nothing the loop writes at runtime lands inside `.loop/`. All
mutable state (approvals, dispatches, runner.log, watchdog.log, cost_ledger.jsonl,
triage_actions.jsonl, repair counters) is rooted at `${LOOP_STATE_DIR:-./.loop-state}`. The
submodule can be a clean git checkout; the runner doesn't modify it. Verified by §7's
drop-in test acceptance.

### 5.3 New-project setup script

Lives at the **submodule top level** (not nested under `scripts/loop/`), so the documented
invocation matches the mount point. File: `.loop/setup_host_project.sh`:

```bash
#!/usr/bin/env bash
# Run from host project root after `git submodule add <loop-repo> .loop`.
# Invocation: ./.loop/setup_host_project.sh [--reset-references-dir]
# Idempotent + self-healing: safe to re-run; per-file checks ensure no required
# default goes missing across partial prior runs.
set -euo pipefail
[ -d .loop ] || { echo ".loop submodule missing"; exit 1; }

# Parse flags.
reset_refs_dir=false
for arg in "$@"; do
  case "$arg" in
    --reset-references-dir) reset_refs_dir=true ;;
    *) echo "ERROR: unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# --- Helper sourcing (bootstrap-safe) ----------------------------------------
# Run BEFORE any filesystem mutation. If the .loop submodule is old/partial, fail
# loud here with a friendly diagnostic so the host repo isn't half-mutated when we
# discover the problem. Note: setup does NOT use the helper's host-root resolver
# (`_loop_refs_dir__host_root`) because that resolver prefers
# `--show-superproject-working-tree` — correct for the helper's normal caller
# (scripts running from inside `.loop/`, where the superproject IS the host), but
# WRONG when the host project is itself a Git submodule of another superproject
# (the helper would return the outer superproject, not the host). For setup,
# the host project IS the cwd; we validate that directly below. The helper is
# still sourced (rather than skipped) so we can reuse `_loop_refs_dir__has_canaries`
# for the references-dir preflight further down.
helper_path=".loop/scripts/loop/lib/loop_refs_dir.sh"
if [ ! -f "$helper_path" ]; then
  echo "ERROR: $helper_path missing." >&2
  echo "  The .loop submodule is present but missing required helpers." >&2
  echo "  Try: git -C .loop pull origin main   (or check loop version compatibility)" >&2
  exit 3
fi
# shellcheck source=scripts/loop/lib/loop_refs_dir.sh
source "$helper_path"

# --- Setup-specific host-root resolution -------------------------------------
# Setup's contract: invoked from the host project root. We validate that contract
# explicitly rather than discovering the root via git, because git discovery cannot
# distinguish "host project that is a submodule" from "submodule inside a host
# project."
#
# Resolution:
#   - LOOP_HOST_ROOT set: must exist (fail loud on bad path); canonicalize via cd+pwd -P.
#   - LOOP_HOST_ROOT unset: use pwd -P (canonical cwd, symlink-resolved).
# Then assert it equals our canonical pwd. The assertion catches both:
#   - user cd'd into a subdirectory (would write defaults to the wrong place)
#   - LOOP_HOST_ROOT points elsewhere than pwd (silent two-repo drift)
if [ -n "${LOOP_HOST_ROOT:-}" ]; then
  if [ ! -d "$LOOP_HOST_ROOT" ]; then
    echo "ERROR: LOOP_HOST_ROOT='$LOOP_HOST_ROOT' is set but does not exist." >&2
    echo "  Fix the env var or unset it." >&2
    exit 4
  fi
  loop_host_root="$(cd "$LOOP_HOST_ROOT" && pwd -P)"
else
  loop_host_root="$(pwd -P)"
fi

pwd_canonical="$(pwd -P)"
if [ "$loop_host_root" != "$pwd_canonical" ]; then
  echo "ERROR: resolved host root differs from current directory." >&2
  echo "  resolved host root: $loop_host_root" >&2
  echo "  current directory:  $pwd_canonical" >&2
  echo "  Setup writes defaults/state/gitignore/slices relative to PWD, but downstream" >&2
  echo "  helpers read config from the resolved host root. Mismatch would create silent" >&2
  echo "  two-repo drift. Fix: cd '$loop_host_root' && ./.loop/setup_host_project.sh" >&2
  echo "  OR: unset LOOP_HOST_ROOT and re-run from the desired host root." >&2
  exit 4
fi

# --- Required defaults catalog -----------------------------------------------
# Each entry: relative-path-in-host : relative-path-in-defaults
# Per-file enumeration (not `cp -rn dir dir`) ensures missing files get healed
# even if the parent directory already exists.
required_files=(
  ".loop-rules/global.md:.loop-defaults/.loop-rules/global.md"
  ".loop-rules/migrations-safety.md:.loop-defaults/.loop-rules/migrations-safety.md"
  ".loop-rules/approval-policy.yaml:.loop-defaults/.loop-rules/approval-policy.yaml"   # §4.2.2 prereq
  ".loop-packs.yaml:.loop-defaults/.loop-packs.yaml"
  ".loop-config.yaml:.loop-defaults/.loop-config.yaml"
)

# 1. Per-file copy with explicit presence check.
mkdir -p .loop-rules
for pair in "${required_files[@]}"; do
  host_path="${pair%%:*}"
  src_path=".loop/${pair#*:}"
  if [ ! -f "$host_path" ]; then
    if [ ! -f "$src_path" ]; then
      echo "ERROR: default missing from submodule: $src_path" >&2
      exit 2
    fi
    mkdir -p "$(dirname "$host_path")"
    cp "$src_path" "$host_path"
    echo "  copied: $host_path"
  fi
done

# 2. Create runtime state tree (NEVER inside .loop/).
mkdir -p .loop-state/{pending_approvals,dispatches,locks}

# 3. Append .loop-state/ and .loop-worktrees/ to host .gitignore (idempotent).
touch .gitignore
for entry in '.loop-state/' '.loop-worktrees/'; do
  grep -qxF "$entry" .gitignore || echo "$entry" >> .gitignore
done

# 4. Slice queue directory.
mkdir -p diagnostic/slices

# 5. Reference-repos preflight (warning, not fatal — references are docs, not runtime deps).
#    Resolution order: explicit env override → default <host-parent-parent>/loop-references.
#    From host repo root (cwd), going up two levels reaches the coding/ grandparent;
#    /loop-references is its sibling-of-host-parent. Pre-rev7 used `cd .loop && cd ..` which
#    only goes up ONE level — that resolves to <host-parent>/loop-references which is wrong.
if [ -n "${LOOP_REFERENCES_DIR:-}" ]; then
  ref_root="$LOOP_REFERENCES_DIR"
else
  # Use the canonical pwd computed above (pwd -P) so a host invoked via a
  # symlinked path still produces a canonical ref_root; trailing `pwd -P` keeps
  # the resolved path symlink-free.
  ref_root="$(cd "$pwd_canonical/../.." && pwd -P)/loop-references"
fi

# Persist the resolved location so downstream scripts can read it without recomputing.
# Behavior:
#   - First run + path EXISTS: append `loop_references_dir: <value>` to .loop-config.yaml.
#   - First run + path MISSING: emit warning; do NOT persist (downstream falls through to
#     env-var or default-with-existence-check via lib/loop_refs_dir.sh).
#   - Existing key present (no --reset): DO NOT overwrite (config is canonical).
#   - --reset-references-dir + path EXISTS: clear the existing key and re-add with new value.
#   - --reset-references-dir + path MISSING: clear the existing key and DO NOT re-add; emit
#     loud warning. Downstream then falls through to env-var or default. This prevents the
#     reset path from persisting a known-bad value that would mislead downstream resolvers.
# Use the canonical canary-children helper (sourced above, at the top of the script
# before any mutations) for the persistence gate so setup and resolver agree on what
# "exists enough to persist" means.
ref_root_exists=false
_loop_refs_dir__has_canaries "$ref_root" && ref_root_exists=true

if [ -f .loop-config.yaml ]; then
  if $reset_refs_dir; then
    # Always clear the existing key on --reset.
    grep -v '^loop_references_dir:' .loop-config.yaml > .loop-config.yaml.tmp || true
    mv .loop-config.yaml.tmp .loop-config.yaml
    if $ref_root_exists; then
      echo "loop_references_dir: $ref_root" >> .loop-config.yaml
      echo "  reset: loop_references_dir → $ref_root"
    else
      echo "  WARNING: --reset-references-dir cleared the existing key, but the resolved"
      echo "  path '$ref_root' does NOT exist. Config key left absent; downstream resolvers"
      echo "  will fall through to env-var or default. Re-run setup once references are in place."
    fi
  elif ! grep -q '^loop_references_dir:' .loop-config.yaml; then
    if $ref_root_exists; then
      echo "loop_references_dir: $ref_root" >> .loop-config.yaml
    else
      echo "  Note: skipping persistence of loop_references_dir — '$ref_root' does not exist."
      echo "  Run setup again after cloning the references, or pass --reset-references-dir."
    fi
  fi
fi

# Two-level existence check:
#   - Canary (plandex + swe-agent): minimum-usable; resolver and persistence gate use this.
#   - Complete (+ cline + aider): full docs; setup warns if missing, doesn't gate.
# The canary check already drives ref_root_exists above; this block adds the
# complete-clone warning when references are partial.
if ! $ref_root_exists; then
  echo ""
  echo "  WARNING: loop-references/ canary check failed at $ref_root"
  echo "    Required (canary): plandex/ AND swe-agent/ — both must exist."
  echo "    Override with LOOP_REFERENCES_DIR=/abs/path before re-running this script."
  echo "    To clone the upstream references to the default location:"
  echo "      mkdir -p \"$ref_root\""
  echo "      cd \"$ref_root\""
  echo "      git clone --depth=1 https://github.com/plandex-ai/plandex.git"
  echo "      git clone --depth=1 https://github.com/SWE-agent/SWE-agent.git swe-agent"
  echo "      git clone --depth=1 https://github.com/cline/cline.git"
  echo "      git clone --depth=1 https://github.com/Aider-AI/aider.git"
  echo "      git clone --depth=1 https://github.com/open-gsd/get-shit-done-redux.git gsd-redux"
  echo "    (~370 MB total. Optional — only needed when reading the plan's implementation refs.)"
elif [ ! -d "$ref_root/cline" ] || [ ! -d "$ref_root/aider" ]; then
  # Canary passed but full set isn't there — emit a softer "complete clone recommended" note.
  echo ""
  echo "  NOTE: loop-references/ canary OK (plandex + swe-agent) but partial clone."
  echo "    Missing: $([ ! -d "$ref_root/cline" ] && printf 'cline ')$([ ! -d "$ref_root/aider" ] && printf 'aider ')"
  echo "    Resolver will succeed; some §4 implementation-reference blocks won't be fully clickable."
  echo "    To complete the clone:"
  [ ! -d "$ref_root/cline" ] && echo "      cd \"$ref_root\" && git clone --depth=1 https://github.com/cline/cline.git"
  [ ! -d "$ref_root/aider" ] && echo "      cd \"$ref_root\" && git clone --depth=1 https://github.com/Aider-AI/aider.git"
fi

# 6. Final assertion — every required file MUST exist after setup; loud failure otherwise.
echo ""
echo "Post-setup verification:"
status=0
for pair in "${required_files[@]}"; do
  host_path="${pair%%:*}"
  if [ -f "$host_path" ]; then
    echo "  ok:   $host_path"
  else
    echo "  FAIL: $host_path is missing"
    status=2
  fi
done
[ -d .loop-state/pending_approvals ]  && echo "  ok:   .loop-state/pending_approvals/"  || { echo "  FAIL: .loop-state/pending_approvals/"; status=2; }
[ -d .loop-state/dispatches ]         && echo "  ok:   .loop-state/dispatches/"         || { echo "  FAIL: .loop-state/dispatches/"; status=2; }
[ -d .loop-state/locks ]              && echo "  ok:   .loop-state/locks/"              || { echo "  FAIL: .loop-state/locks/"; status=2; }
grep -qxF '.loop-state/' .gitignore     && echo "  ok:   .gitignore has .loop-state/"     || { echo "  FAIL: .gitignore missing .loop-state/"; status=2; }
grep -qxF '.loop-worktrees/' .gitignore && echo "  ok:   .gitignore has .loop-worktrees/" || { echo "  FAIL: .gitignore missing .loop-worktrees/"; status=2; }
[ -d diagnostic/slices ]                && echo "  ok:   diagnostic/slices/"              || { echo "  FAIL: diagnostic/slices/"; status=2; }
[ $status -eq 0 ] || exit $status

echo ""
echo "Host project bootstrapped successfully."
echo "Next: edit .loop-config.yaml to point at your API keys / pack."
```

**Setup acceptance** (part of §7 drop-in test): the script's final verification block exits
with status 0 and all `ok:` lines print. Specifically the following must hold on first AND
re-run after a deliberately-deleted file (e.g. `rm .loop-rules/approval-policy.yaml &&
.loop/setup_host_project.sh` must restore it):
- `test -f .loop-rules/approval-policy.yaml` (the critical §4.2.2 prereq)
- `test -f .loop-rules/global.md`
- `test -f .loop-rules/migrations-safety.md`
- `test -f .loop-packs.yaml`
- `test -f .loop-config.yaml`
- `test -d .loop-state/pending_approvals`
- `test -d .loop-state/dispatches`
- `test -d .loop-state/locks`
- `grep -qxF '.loop-state/' .gitignore`
- `grep -qxF '.loop-worktrees/' .gitignore`
- `test -d diagnostic/slices`

Setup time on a new project: ~30 seconds. The submodule's repo layout has this script at its
own root, alongside `scripts/loop/` and `.loop-defaults/`:

```
claude-codex-loop/                # submodule repo root (mounted as .loop/ in host)
  setup_host_project.sh           # ← the script
  loop_review.sh                  # morning triage entry point (also top-level)
  scripts/loop/                   # all the bash internals
  .loop-defaults/                 # template files copied into host on first setup
  README.md
```

Host-project invocations after setup:
- `./.loop/setup_host_project.sh` — one-time bootstrap
- `./.loop/scripts/loop/runner.sh` — start the runner
- `./.loop/loop_review.sh --list` — morning triage
- `./.loop/loop_review.sh --approve <slice-id>` — release a queued action

### 5.4 OpenF1 migration path

OpenF1 currently has the loop inline at `scripts/loop/`. The migration:
1. Create `claude-codex-loop/` as a sibling repo; `git mv` the current `scripts/loop/` into it.
2. Apply Tier 1-3 changes to the new repo.
3. In OpenF1: `git submodule add ../claude-codex-loop .loop`; remove old `scripts/loop/`; run
   `setup_host_project.sh`; update CLAUDE.md references.

The migration is mechanical and can happen at the end (after Tier 3 is verified working in-place).

---

## 6 · Risk surface + rollback

| Change | Failure mode | Rollback |
|---|---|---|
| §4.1.1 proposal-branch sandbox | Worktree leak on crash → disk fills | Existing `worktree_helpers.sh` already prunes; add prune to runner's startup hook |
| §4.1.2 custom tool surface | Agent can't accomplish a needed action | Keep `--escape-hatch-bash` flag exposing raw bash; default OFF for runner, ON for manual debug |
| §4.1.3 model packs | Misconfigured pack causes 4xx from provider | Validate pack at runner startup; refuse to start if any model in active pack is unreachable |
| §4.2.1 cache control | Wrong cache-breakpoint placement bloats prompts | A/B test: run 10 fixture slices with and without cache; abort if cost-per-slice rises |
| §4.2.2 deferred-review queue | Approvals queue grows faster than I can review | Add `max_pending_approvals` cap; runner pauses queue dispatch if cap exceeded |
| §4.2.3 three-scope restore | Wrong restore picked → loses too much state | Log restore-mode choice prominently in triage report; one-tier-up `taskAndWorkspace` is always safe |
| §4.3.1 speculative branches | 3× cost on every speculative round | Cap at one speculative round per slice; gate behind `LOOP_ALLOW_SPECULATIVE=1` env var |
| §4.3.2 path-scoped rules | Glob too greedy → wrong rules activate | Add `--dry-run-rules <slice-id>` to print which rules would activate without running |
| §4.3.3 trajectory artifact | Disk usage from JSONL accumulation | Add rotating cleanup: delete `${LOOP_STATE_DIR}/dispatches/<slice>/` after slice reaches `done` |

---

## 7 · Acceptance criteria (whole plan)

Before declaring the upgrade done:

1. **End-of-Tier-1 state**: Agent in dispatch cannot touch the integration branch; proposal
   sandbox catches all writes; one full overnight run on OpenF1's current slice queue completes
   with the new tool surface and a configurable model pack.

2. **End-of-Tier-2 state**: Cost ledger shows input-token savings on revision spirals meeting
   the **savings target selected by the §4.0 spike branch decision** (≥ 50% if the
   marker-supported branch; smaller and explicitly documented if the auto-cache or SDK-fallback
   branch). At least one fixture slice demonstrates `requires_approval` queueing without
   blocking the runner.

3. **End-of-Tier-3 state**: A deliberately-failing fixture slice produces three speculative
   variants; `.loop-rules/` correctly scopes rules to a slice's touched files; a triage report
   references the per-dispatch trajectory artifact and is readable in under 5 minutes.

4. **Overnight test**: One unattended 8-hour run on the OpenF1 roadmap with the
   `nightly-cost-optimized` pack completes without manual intervention; morning triage takes
   ≤ 15 minutes; **total cost stays within the budget selected by the §4.0 spike branch
   decision, using the column matching the scope actually shipped**:

   | Branch | Tiers 1-3 only | + Tier 4 (empty-history handoff) |
   |---|---|---|
   | A (marker-supported) | $50 | ~$58 |
   | B (auto-cache only) | $75 | ~$80 |
   | C (SDK fallback) | $60 | ~$66 |

   If the §4.0 spike has not yet run when §7 is evaluated, the budget defaults to the most
   conservative cell in the table (`B + Tier 4 = ~$80`).

5. **Drop-in test**: Run `setup_host_project.sh` on a fresh repo; queue three trivial slices;
   complete a run end-to-end with no edits to the loop submodule's files. Setup-to-first-slice
   elapsed time ≤ 5 minutes.

6. **Loop submodule extraction**: OpenF1 references the loop via git submodule; loop tests still
   pass; no OpenF1-specific knowledge inside the submodule.

---

## 8 · Out of scope (deliberately repeated for the audit)

- Hub-spoke daemon, WebSocket protocol, multi-client capability brokerage.
- `npx` installer, cross-runtime conversion, Cursor/Windsurf/Gemini support.
- MCP server packaging of the tool bundles.
- Docker / containerized sandbox per task.
- Tree-sitter project map.
- Event-stream architecture / trajectory-as-primary-artifact rewrite.
- BMAD-style 12-role agent personas.
- Cline's per-tool-use shadow-git checkpointing (proposal sandbox at slice grain is the chosen
  granularity).
- Mini-swe-agent's "back to raw bash" thesis (defeats §4.1.2).
- Web UI, IDE plugin, status-line integration.

If any of those becomes load-bearing later, it gets its own plan revision.

---

## 9 · Implementation order

Week 1 — Spikes + foundation (~7 days):
- Day 1: §4.0 Tier-0 cache-control feasibility spike (result may revise Week 2)
- Day 2: §4.1.2-pre CLI-flag syntax preflight (four-case harness with marker plumbing;
  result determines §4.1.2 pattern form)
- Day 3-4: §4.1.1 proposal-branch sandbox (with merge-ladder + non-FF handling)
- Day 5-6: §4.1.2 custom tool surface (uses the verified pattern from the preflight)
- Day 7: §4.1.3 model packs

Week 2 — Cost + safety (~5-7 days; Day 1 scope depends on Tier-0 outcome):
- Day 1: §4.2.1 history processor pipeline + cache control (Branches A/B)
  - **OR Day 1-3 if Branch C** (SDK fallback). Week 2 slides to Day 7 if C is selected.
- Day 2 (or 4 if Branch C): §4.2.2 dispatcher-enforced approval + deferred-review queue (3 days)
- Day 5 (or 7 if Branch C): §4.2.3 three-scope restore (1 day)

Week 3 — Leverage on failures (~3 days):
- Day 1-2: §4.3.1 speculative branches (with cancel-on-success + approval-queue interaction)
- Day 3: §4.3.2 `.loop-rules/` + §4.3.3 trajectory artifact

Week 4 — Migration + verification (~2 days):
- Day 1: §5.4 OpenF1 → submodule migration
- Day 2: §7 acceptance criteria verification (overnight run + drop-in test)

Optional Tier 4 (§4.4.1 mode-as-state) folds in after week 2 if the model-pack refactor exposes a
clean seam; otherwise defer.

**Total: 17 working days (Branches A/B) · 19 days (Branch C SDK fallback)**.

Breakdown (A/B baseline): Tier-0 cache spike 1d + §4.1.2-pre CLI preflight **1d** + Tier-1
sandbox+tools+packs 5d + Tier-2 cache+approval+restore 5d + Tier-3 speculative+rules+trajectory
3d + migration/verification 2d = 17d.

Branch C adjustment: §4.2.1 grows from 1d → 3d (Node helper for Anthropic SDK direct calls);
+2d. Total: 19d.

(rev0 estimated ~13d; rev1 added Tier-0 cache spike (+1d); rev2 added §4.1.2-pre preflight
(+0.5d) and per-slice mutex work absorbed into §4.3.1's existing 2d; rev3 reconciles the totals
that drifted; rev6 makes the Branch C contingency explicit; **rev11 grows §4.1.2-pre from 0.5d
to 1d** to reflect the four-case harness, two fixtures, mktemp plumbing, and submodule teardown
added across rev7-rev10.)

---

## 10 · Codex audit prompt

> Re-audit this rev15 plan for: (1) whether the rev15 audit response section correctly
> closes each rev14 finding (cross-check item-by-item against the rev14 audit in §12);
> rev0-rev13 findings should also still be closed, (2) whether splitting host-root
> resolution (helper unchanged, setup does its own pwd-based check) is the right
> design — specifically: now that setup ignores `--show-superproject-working-tree`,
> is the helper's resolver still load-bearing for ANY caller in this plan? If only
> downstream callers from inside `.loop/` use it, is `--show-superproject-working-tree`
> still the right first preference there, or could a helper-internal mode (`--from-host`
> flag) make the contract less subtle?, (3) whether the rev15 setup script correctly
> handles all five host-root scenarios: (a) `LOOP_HOST_ROOT` unset, run from host
> root, host not a submodule (normal case); (b) `LOOP_HOST_ROOT` unset, run from
> host root, host IS a submodule of an outer superproject (rev14 broke this; verify
> rev15 fixes it); (c) `LOOP_HOST_ROOT` unset, run from a host subdirectory
> (assertion should fail loudly); (d) `LOOP_HOST_ROOT` set + valid + matches pwd
> (passes); (e) `LOOP_HOST_ROOT` set but invalid (rev15 fails loud — verify the
> diagnostic is actionable), (4) whether `ref_root` symlink behavior is now
> consistent end-to-end: setup writes `pwd -P`-canonical path to config; resolver
> reads config back and runs `_loop_refs_dir__has_canaries` on it — does any
> intermediate code re-derive the path via a non-canonical route?, (5) whether
> the rev15 default-ref_root computation (`cd "$pwd_canonical/../.." && pwd -P`)
> still computes the right grandparent when `pwd_canonical` is on a different
> filesystem than the user's original cwd (e.g. on macOS where `/tmp → /private/tmp`),
> (6) any §4 deliverable whose day-estimate is still stale (§4.2.2 `bashlex` budget
> from rev6; §4.1.2-pre 1-day from rev11; §4.0 spike 1-day), (7) rev0-rev13 closure
> regressions, (8) whether the helper's `_loop_refs_dir__host_root` function still
> needs the `pwd` fallback (line 4 of the resolver) now that setup never calls it
> outside a git repo — or is that fallback only relevant to hypothetical future
> non-git callers?, (9) the §11A consolidated table: does it still accurately
> describe what setup does, given rev15's split? Report a punch list of concrete
> edits — section by section — under 400 words. Do not rewrite the plan.

---

## 11A · Consolidated reference index (per-item upstream files)

The inline "Implementation reference" blocks throughout §4 carry the detail. This table is the
flat overview an implementer can use as a working checklist — open the cited file alongside
each section as you go.

| Section | Type | Upstream | Action |
|---|---|---|---|
| §4.0 cache spike | empirical | n/a | Run preflight; no port |
| §4.1.1 sandbox lifecycle | adapt | `plandex/app/cli/cmd/apply.go` + `reject.go` | CLI verb shapes + rollback-pre-compute pattern |
| §4.1.1 rollback semantics | study | `plandex/app/cli/lib/apply.go:152,201,622` | `ApplyRollbackPlan` (we get this free via git) |
| §4.1.2 minimal bundle | port template | `swe-agent/tools/submit/` | Starter skeleton for `slice_request_audit` |
| §4.1.2 lint-on-edit | port pattern | `swe-agent/tools/edit_anthropic/bin/str_replace_editor` | Validation-before-apply for `slice_propose_change` |
| §4.1.2 stateful bundle | port template | `swe-agent/tools/windowed/` | Multi-command + `state_command` for `slice_read_state` |
| §4.1.2 registry/loader | adapt | `swe-agent/sweagent/tools/` | Bash equivalent: enumerate, parse, register |
| §4.1.2-pre preflight | empirical | n/a | Test `--allowed-tools` pattern syntax — four cases (a/b/c/d), private `mktemp -d` + `trap`, env-var markers `PREFLIGHT_MARKER_FILE` and `PREFLIGHT_SIBLING_MARKER_FILE`, two fixture bundles, submodule teardown via `git -C .loop rm` |
| §4.1.3 pack struct | adapt | `plandex/app/shared/ai_models_data_models.go:920` | `ModelPack` shape with named role fields |
| §4.1.3 fallback-on-unset | port | `plandex/app/shared/ai_models_data_models.go:936-954` | `GetCoder()` defaults to Planner |
| §4.1.3 built-in catalog | port | `plandex/app/shared/ai_models_packs.go:24-43` | `BuiltInModelPacks` map pattern |
| §4.1.3 CLI UX | study | `plandex/app/cli/cmd/model_packs.go` | List/set/show subcommands |
| §4.2.1 processor protocol | adapt | `swe-agent/sweagent/agent/history_processors.py:13-72` | Stdin→stdout pipeline per processor |
| §4.2.1 cache_control | port verbatim | `swe-agent/sweagent/agent/history_processors.py:261-303` | The `__call__` method, ~40 lines |
| §4.2.1 set/clear helpers | port | same file, near top | `_set_cache_control` / `_clear_cache_control` as jq snippets |
| §4.2.1 remove_regex | adapt | `swe-agent/sweagent/agent/history_processors.py:305-339` | Optional; sed/jq port |
| §4.2.2 policy controller | port logic | `cline/src/core/permissions/CommandPermissionController.ts` | Shell-aware segment parser + per-segment validation |
| §4.2.2 dangerous chars | port catalog | same file, lines 5-15 | `REDIRECT_OPERATORS` + `COMMAND_SEPARATOR_OPERATORS` + `LINE_SEPARATOR_REGEX` |
| §4.2.3 restore switch | port shape | `cline/src/integrations/checkpoints/index.ts:258-360` | Three-case `switch (restoreType)` |
| §4.2.3 restore logging | port | same file, lines 649-730 | `handleSuccessfulRestore` structured log entry |
| §4.2.3 exclusions | study | `cline/src/integrations/checkpoints/CheckpointExclusions.ts` | What NOT to revert (state directory, etc.) |
| §4.3.1 plan-branch UX | adapt | `plandex/app/cli/cmd/branches.go` + `checkout.go` | Fork-and-compare semantics; we use git branches |
| §4.3.1 rewind UX | study | `plandex/app/cli/cmd/rewind.go` | If we want `loop_review.sh --rewind-slice <id>` |
| §4.3.2 frontmatter rules | adapt convention | Cline `.clinerules` docs + sdk test fixtures | YAML-frontmatter glob-scoped markdown |
| §4.3.3 trajectory format | study | `swe-agent/trajectories/` | Per-turn JSON structure; ours is simpler |
| §4.4.1 architect handoff | port verbatim | `aider/aider/coders/architect_coder.py:18-46` | `reply_completed()` mechanic |
| §4.4.1 editor-model wiring | port | `aider/aider/models.py:625-640` | `get_editor_model()` fallback chain |
| §4.4.1 cache implications | note | `architect_coder.py:32` | `cache_prompts = False` — implementer-role cache budget ≈ 0 |
| §4 / §5 references-dir resolver | port (own work) | `scripts/loop/lib/loop_refs_dir.sh` (this plan, embedded) | `resolve_loop_refs_dir` with env→config→default precedence; canary check (`plandex` + `swe-agent`); host-root via `--show-superproject-working-tree`; fail-loud on bad `LOOP_HOST_ROOT` |
| §4 / §5 canary policy | own work | `loop_refs_dir.sh` + `setup_host_project.sh` | 2-canary (`plandex` + `swe-agent`) = minimum-usable; 4-complete (+ `cline` + `aider`) = full-docs warning. Shared `_loop_refs_dir__has_canaries` helper sourced into setup so persistence gate ≡ resolver gate. |
| §5.3 setup bootstrap-safety | own work | `setup_host_project.sh` | `test -f` precheck before `source`, friendly diagnostic if helper missing. Helper is sourced ONLY for `_loop_refs_dir__has_canaries` (used by the references-dir preflight); setup does its OWN host-root resolution (`LOOP_HOST_ROOT` if set + valid, else `pwd -P`) plus a `pwd_canonical` equality assertion. Setup deliberately does NOT call `_loop_refs_dir__host_root` because that resolver prefers `--show-superproject-working-tree`, which is right for `.loop/`-internal callers but wrong when the host project is itself a submodule of an outer superproject (rev14 bug, closed in rev15). |

---

## 11 · Source context

This plan was assembled from a conversation arc with deep-dives on six existing systems:
- Plandex (sandbox, branches, rewind, model packs)
- SWE-agent (Agent-Computer Interface, tool bundles, history processors)
- Cline (Plan/Act mode, checkpoints, `requires_approval`, `.clinerules`, hub-spoke)
- GSD Redux (cross-runtime installer, atomic-commit discipline)
- Aider (Architect/Editor split, git-as-source-of-truth)
- OpenHands (event-stream — explicitly rejected as a paradigm-rewrite)

Imports from each are limited to mechanisms that compose with the existing OpenF1 loop's two-vendor
audit pattern (Claude implements, Codex verifies). Patterns that would dilute that pattern
(single-agent event streams, hub-spoke daemons, cross-runtime installer plumbing) are out of scope.

---

## 12 · Audit history

### rev0 audit (Codex, 2026-05-24)

- HIGH: "Agent literally cannot bypass safety" not satisfied — custom tool surface relies on
  prompt convention, not enforcement. Plan explicitly rejected MCP/cross-runtime packaging but
  didn't specify any other enforcement mechanism (OS wrapper, CLI flags, etc.).
- HIGH: `requires_approval` trusted the model's self-label. Dispatcher needs to enforce from the
  actual patch/command content, not the model's optional flag.
- HIGH: Cache-control feasibility unverified. The §4.2.1 1-day scope and the $50 overnight target
  in §7.4 both depend on cache mechanics working through the Claude Code CLI; neither was tested.
  Needs a Tier-0 spike before being scheduled.
- MEDIUM: Speculative branches × approval queue interaction undefined. Does one risky variant
  block the whole slice, only that variant, or get disqualified?
- MEDIUM: Proposal merge assumed fast-forward only — no behavior for integration drift / non-FF /
  rebase conflicts.
- LOW: Setup script path inconsistent — described at `scripts/loop/setup_host_project.sh` but the
  submodule is mounted at `.loop/`, so the invocation path was wrong.

All 6 closed in rev1.

### rev1 audit (Codex, 2026-05-24)

- HIGH: Codex implementer enforcement not equivalent to Claude's allowlist —
  `--sandbox=workspace-write --ask-for-approval=on-request` controls filesystem writes and
  model-requested approvals, not the command/tool surface; `on-request` leaves the approval
  decision to the model.
- HIGH: Claude allowlist pattern `Bash(.loop/tools/slice_*:*)` uses a colon form not shown in
  `claude --help` examples (which use `Bash(git *)` style). Core safety claim depends on this
  syntax being correct; needs an empirical preflight.
- HIGH: Runtime state written under loop/submodule paths (`scripts/loop/state/...`) contradicts
  the "no edits to submodule files" acceptance criterion. Need a host-owned state directory.
- MEDIUM: §7 hard-gates on ~$50/run and ≥50% savings while Tier-0 explicitly allows $60/$75
  outcomes. Acceptance criteria must reference the spike-selected budget.
- MEDIUM: Cache fallback names wrong roles. "Auditor + summarizer" doesn't match the pack's
  Codex-auditor + Claude-everything-else split.
- MEDIUM: Speculative cancel-on-success has no explicit slice mutex; sibling variants mid-audit
  or mid-merge can race with the cancellation path.
- LOW: §3 architecture table still says "Model-emitted `requires_approval`" for layer 2,
  contradicting dispatcher-enforced policy in §4.2.2.

All 7 closed in rev2.

### rev2 audit (Codex, 2026-05-24)

- HIGH: Tool path inconsistent with allowlist — §4.1.2 referenced `Bash(./.loop/tools/slice_*)`
  but the submodule layout placed tools under `.loop/scripts/loop/tools/...`.
- HIGH: Default approval policy `.loop-rules/approval-policy.yaml` was referenced by §4.2.2 but
  not shipped in `.loop-defaults/.loop-rules/`; setup script didn't copy it.
- MEDIUM: `.loop/**` was in `require_approval`, not `forbidden` — meant a human-approved
  proposal could still mutate the submodule, breaking the read-only invariant. `.loop-rules/**`
  had the same problem.
- MEDIUM: Setup script didn't create `.loop-state/` or add it to host `.gitignore`, despite
  rev2 making `.loop-state/` the required runtime state root.
- MEDIUM: §4.2.1 still described `cache_control: ephemeral` as the fixed implementation,
  while §4.0 explicitly said the spike might choose auto-cache or SDK-fallback branches.
- LOW: §2 current-state text said "Claude implements, Codex verifies — or vice versa",
  contradicting rev2's Claude-only implementer decision.
- LOW: Schedule math drift — §4 header said ~14d, week plan summed ~16.5d, end-of-§9 said ~16d.

All 7 closed in rev3.

### rev3 verification pass (self-audit via reference repos, 2026-05-24)

Not a Codex audit — a code-reading pass against the five cloned reference repos at
`loop-references/`. Findings closed in rev4:

- §4.1.2: SWE-agent bundles can declare MULTIPLE commands per `config.yaml`; my plan implied 1:1.
- §4.1.2: `lib/` sub-dir is rare in upstream bundles (0 of 15); removed from canonical layout.
- §4.1.2: Optional top-level `state_command` field for stateful tools; documented.
- §4.2.1: YAML field is `tagged_roles` (not `roles`); values are message-roles (`user`, `tool`),
  not pack-roles. Corrected.
- §4.2.1: Upstream default `last_n_messages = 2`; we use 4 intentionally for deeper spirals.
  Documented the deviation.
- §4.2.2: Cline DOES dispatcher-enforce (via `CommandPermissionController`), not just trust the
  model. Plan now cites the controller as prior art and adopts its shell-quote-style parsing.
- §4.2.3: Cline's restore types are `task` / `workspace` / `taskAndWorkspace`. Plan renamed to
  match upstream.
- §4.4.1: Aider's architect/editor handoff = "architect's response IS editor's only prompt;
  editor starts with empty history." Plan adopts this exact mechanic.
- §4.1.1: Plandex's sandbox is server-side state with explicit rollback plan; our proposal-branch
  approach is a git-native variant of the same pattern. Credit made explicit.

All 9 findings closed in rev4.

### rev4 self-review (implementation-reference gap, 2026-05-24)

Not a Codex audit — a follow-up self-review of rev4 noting that the verification pass produced
upstream-file citations but didn't tell the implementer **what to do with each cited file**.
rev5 fills that gap by adding inline "Implementation reference" blocks to every §4 item
(port / adapt / study labels with line ranges) and a consolidated §11A table for cross-section
overview. No design changes; ~25 additional reference blocks across the plan.

The rev6 audit prompt in §10 asks Codex to verify each reference block points at real code and
that nothing was missed.

### rev5 audit (Codex, 2026-05-24)

- HIGH: `../../../loop-references/` paths resolve from the plan file's location (markdown
  default) but NOT from the repo cwd; implementers running scripts from the repo root would
  hit `/Users/.../Documents/loop-references/` (wrong). Either pin path resolution or preflight.
- HIGH: Setup script `cp -rn .loop/.loop-defaults/.loop-rules .` not self-healing — if
  `.loop-rules/` exists without `approval-policy.yaml`, no-clobber preserves the gap. Per-file
  presence check needed.
- HIGH: `.loop-rules/**` is in `forbidden.paths` but §4.3.2 ships `.loop-rules/` as a
  deliverable — who edits the files? Ownership model needs documenting.
- MEDIUM: §4.1.2-pre preflight tests `./tmp/preflight/...` not the production
  `./.loop/tools/<name>/bin/<name>` path. Allowlist patterns may behave differently with
  more path segments.
- MEDIUM: Aider's `cache_prompts = False` insight not propagated to §7.4 / §4.0 budget table.
  Implementer-role cache savings drop to ~0 if Tier 4 ships.
- MEDIUM: §4.2.1 duration mismatch — header was "1 day", but §4.0 Branch C explicitly says 3
  days for SDK fallback. Week plan didn't reconcile.
- MEDIUM: Command-policy reference recommended `shlex.split()` as equivalent to Cline's
  `shell-quote`. It is not — `shlex` tokenizes without classifying operators / redirects /
  subshells. Real parser required.

All 7 closed in rev6.

### rev6 audit (Codex, 2026-05-24)

- HIGH: Reference-path resolution still wrong in script-side computation. rev6's
  `ref_root="$(cd .loop && cd .. && pwd)/../loop-references"` produces
  `<host-parent>/loop-references` from an `f1/openf1/` host → `coding/f1/loop-references`,
  which doesn't exist. Actual location is `coding/loop-references` (two levels up, not one).
  The helper-script form `../../../loop-references` in `scripts/loop/` is also wrong
  (resolves to host root, not the coding grandparent).
- MEDIUM: §4.1.2-pre preflight collapsed three test cases (allowed-success, Edit-denial,
  Bash(ls)-denial) into a single `claude -p` invocation that only really tested the
  Edit-denial path. Need three separate runs.
- MEDIUM: Preflight teardown `git rm -rf .loop/tools/preflight_test` doesn't work from host
  repo because `.loop/` is a submodule with its own git tree. Need `git -C .loop rm ...` or
  cleanup in the submodule repo before mounting.
- LOW: Setup appends `.loop-worktrees/` to `.gitignore` but verification + acceptance only
  check `.loop-state/`. Worktree ignore guarantee untested.
- LOW: §4 scope header says "16.5 working days total" without acknowledging the 18.5-day
  Branch C contingency that's correctly documented in the schedule footer.

All 5 closed in rev7.

### rev7 audit (Codex, 2026-05-24)

Checks passed (auditor manually verified): path math is correct
(`/Users/robertzehnder/Documents/coding/loop-references/` resolves consistently from markdown
links, setup-script `$(pwd)/../../loop-references`, and the 5-`..` helper-script form);
`.loop-worktrees/` verification is consistent; Branch C 18.5d header is consistent.

**(Later narrowed by rev9 audit, 2026-05-24)**: the rev7 path-math verification was
correct for the *callers tested at the time* (markdown links + setup-script running from
host root + helper-script depth counting). It did NOT cover the case where the resolver
is sourced into a script running with cwd inside `.loop/`, where
`git rev-parse --show-toplevel` returns the submodule root, not the host. rev9 found and
fixed that case via `--show-superproject-working-tree`. Future readers: do not over-trust
this rev7 "Checks passed" as a general guarantee — read rev9 + rev10 + rev14 for the
complete host-root resolution story.

- MEDIUM: §4.1.2-pre Case (a) ran `preflight_test` with no arguments, so the bare no-args
  pattern could be selected as "simplest" while still blocking real arg-taking slice tools
  like `slice_propose_change <slice-id> <patch-file>`.
- LOW: `LOOP_REFERENCES_DIR` persistence wording in §4 said setup "sets and persists" the
  env var, but the script (a) doesn't `export` it, (b) doesn't update existing config keys
  on re-run with a new env value, (c) only appends on first run.
- LOW: rev7's own summary in §12 said the submodule teardown includes
  "host-side `git submodule update`," but the executable block uses `git add .loop &&
  git commit` (which is the correct command — `git submodule update` is a *pull* and
  doesn't make host commits).

No high-severity blockers. All 3 closed in rev8.

### rev8 audit (Codex, 2026-05-24)

Checks passed: bare no-arg candidate is excluded; reset semantics no longer overclaim;
submodule teardown wording uses the correct `git add .loop && git commit` flow.

- MEDIUM: §4.1.2-pre Case (a) still relies on the model's final answer to prove stdout
  + argument passthrough. Model could paraphrase / omit / hallucinate. Need a deterministic
  filesystem side effect (marker file).
- MEDIUM: `--reset-references-dir` can persist a known-missing path — if env var is unset
  AND the default path doesn't exist, setup still writes the bad path to config. Either
  guard persistence on existence or write a status marker.
- MEDIUM: No canonical downstream resolver for `loop_references_dir`. §4 says scripts
  should read config + env "using yq or grep" but no `lib/loop_refs_dir.sh` exists in
  §5.1 with documented precedence.
- LOW: Wildcard candidate `Bash(./.loop/tools/preflight_*)` is over-broad — matches
  sibling tools with the same prefix. If kept, the preflight needs a negative sibling
  fixture to prove the chosen pattern denies siblings.

All 4 closed in rev9.

### rev9 audit (Codex, 2026-05-24)

Checks passed: model readback removed from preflight; missing reference paths no longer
persisted by reset; canonical resolver exists; broad `preflight_*` candidate excluded via
sibling negative test.

- HIGH: `loop_refs_dir.sh` uses `git rev-parse --show-toplevel`, which returns the
  *submodule's* working tree when called from `.loop/scripts/loop/...`. The helper reads
  the wrong `.loop-config.yaml` and computes the default path from the wrong root.
- MEDIUM: Marker-file preflight isn't deterministic under concurrency / stale markers /
  PID reuse — it globs `${TMPDIR}/preflight_marker_*` and reads the first hit.
- MEDIUM: Setup/resolver existence checks are inconsistent — setup warns about missing
  child repos, but resolver only checks root dir exists. An empty `loop-references/`
  could be persisted and treated as resolved.
- LOW: §4.1.2-pre intro still says "three separate `claude -p` invocations" after Case (d)
  was added in rev9 (should be four).

All 4 closed in rev10.

### rev10 audit (Codex, 2026-05-24)

Checks passed: submodule host-root bug fixed via `--show-superproject-working-tree`; private
`mktemp` marker closes the stale-marker/PID-glob issue.

- HIGH: Setup persistence uses bare `[ -d "$ref_root" ]`, not the new canary-children check.
  An empty `loop-references/` can still be persisted to `.loop-config.yaml`, reopening the
  rev9 inconsistency.
- MEDIUM: Setup warns on 4 child repos (plandex/swe-agent/cline/aider); resolver accepts the
  2-canary subset. Partial clone resolves successfully but setup still warns — needs an
  intentional split or alignment.
- MEDIUM: `_loop_refs_dir__host_root` silently ignores invalid `LOOP_HOST_ROOT` and falls
  through to git discovery. Explicit overrides should fail loud — a typo would otherwise
  be masked.
- LOW: §4.1.2-pre is no longer a 0.5d spike — fixtures + four cases + mktemp + teardown
  push it to closer to 1d. Bump the estimate.

All 4 closed in rev11.

### rev11 audit (Codex, 2026-05-24)

Checks passed: setup persistence uses shared canary predicate; 2-canary vs 4-complete split
is explicit; §4.1.2-pre is now 1 day with totals updated to 17/19.

- MEDIUM: Setup sources the helper for canary check but never calls
  `_loop_refs_dir__host_root` or `resolve_loop_refs_dir`. A bad `LOOP_HOST_ROOT=/typo` is
  silently ignored during setup — the rev11 fail-loud claim doesn't propagate to setup.
- MEDIUM: New `source .loop/scripts/loop/lib/loop_refs_dir.sh` line isn't bootstrap-safe
  for old/partial `.loop` checkouts. If `.loop/` exists but helper file doesn't, `set -e`
  exits with an opaque shell error rather than a friendly diagnostic.
- LOW: Path-resolution prose still says helper scripts read `LOOP_REFERENCES_DIR` "set by
  setup," contradicting rev8/rev9's clarification that setup writes config but doesn't
  export.
- LOW: §11A consolidated table is missing rows for `loop_refs_dir.sh`, the canary policy,
  and the marker-file preflight mechanics added in rev9-rev11.

All 4 closed in rev12.

### rev12 audit (Codex, 2026-05-24)

Checks passed: stale `LOOP_REFERENCES_DIR` wording fixed; §11A now includes resolver,
canary policy, bootstrap-safety, expanded preflight mechanics.

- MEDIUM: Setup fail-loud guard is still too late — rev12's summary claimed
  `_loop_refs_dir__host_root` runs "before any work is done," but the script had already
  copied default files, created `.loop-state/`, edited `.gitignore`, and created
  `diagnostic/slices` before the helper sourcing block. A bad `LOOP_HOST_ROOT` would
  half-mutate the host.
- MEDIUM: §10 expected run order inconsistent with script body — prompt asked the
  rev13 auditor to verify an ordering the embedded script did not actually implement.
- LOW: `loop_host_root` is side-effect-only without inline annotation — future cleanup
  could remove it as dead code and silently lose the `LOOP_HOST_ROOT` fail-loud
  behavior.

All 3 closed in rev13.

### rev13 audit (Codex, 2026-05-24)

Checks passed: rev12 ordering bug fixed — helper precheck/source/host-root validation
now happens before file copies. Side-effect-only assignment annotated; §10 prompt now
matches embedded setup order.

- MEDIUM: `LOOP_HOST_ROOT` is fail-loud, but setup ignores the resolved `loop_host_root`
  for its own mutations — writes defaults/state/gitignore/slices relative to `pwd`. If
  `LOOP_HOST_ROOT` is valid but different from `pwd`, setup writes one repo while
  downstream resolvers read another. Need realpath equality assertion or `cd`.
- LOW: Audit history's rev7 "path math is correct" Checks-passed line was later
  narrowed by rev9's submodule host-root finding. Add an annotation so future readers
  don't over-trust.

All 2 closed in rev14. The rev15 audit prompt in §10 asks Codex to walk the four
`LOOP_HOST_ROOT` × `pwd` scenarios, check macOS `pwd -P` symlink behavior, and verify
the `${loop_host_root:?}` ordering interaction with the new realpath assertion.

### rev14 audit (Codex, 2026-05-24)

Checks passed: rev13 ordering bug fixed (helper sourced before mutations); rev13's
realpath-equality assertion narrows `LOOP_HOST_ROOT` × `pwd` mismatch from silent
drift to fail-loud; the `loop_host_root` value is now actually consumed, not
side-effect-only.

- MEDIUM: `_loop_refs_dir__host_root` uses `git rev-parse
  --show-superproject-working-tree` before `--show-toplevel` unconditionally. That
  order is right when the helper runs from inside `.loop/` (the resolver's normal
  caller), but wrong when setup is run from a host project that is itself a Git
  submodule of an outer superproject — the helper returns the OUTER superproject,
  not the host, and setup's realpath-equality assertion fires spuriously even on
  a correctly invoked setup. Either make setup use a setup-specific host-root
  check (`--show-toplevel` first / pwd-based), add a helper mode/flag for "called
  from host root," or explicitly declare nested host repos unsupported.
- LOW: Prose says setup computes default `ref_root` with realpath cleanup, but the
  embedded script still uses plain `pwd` (not `pwd -P` / `realpath`). On a host
  invoked via a symlinked path, the persisted `ref_root` would be non-canonical
  and could disagree with the resolver's canonical view.

All 2 closed in rev15. The rev16 audit prompt in §10 walks the five
`LOOP_HOST_ROOT` × `pwd` × submodule scenarios, asks whether the helper's
host-root resolver is still load-bearing for any in-plan caller post-split, and
checks symlink-canonicalization consistency end-to-end.
