#!/usr/bin/env bash
# scripts/loop/dispatch_repair.sh
# Auto-repair: when a slice is status=blocked and LOOP_AUTO_REPAIR=1, dispatch
# Claude (repair agent) to either fix the protocol bug or just flip the slice
# back to revising for another implementer attempt.
#
# Item 2 (round-12) — two-mode operation:
#  - slice-state mode: agent works in slice's worktree, edits slice file
#    only, dispatcher mirrors to integration.
#  - loop-infra mode: agent edits scripts/loop/* in main worktree under lock,
#    commits [loop-infra-repair] + dispatcher amends with Resume-as: trailer
#    + flips slice → blocked + commits [loop-infra-pending]. Both LOCAL only.
#    User must touch the .approved-loop-infra-repair/<slice_id>__attempt-<N>
#    sentinel and restart for the resume hook to push.
#
# Usage: dispatch_repair.sh <slice_id>
# Bounded: at most LOOP_MAX_REPAIRS (default 3) attempts per slice.

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be exported by runner}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be exported by runner}"

cd "$LOOP_MAIN_WORKTREE"

# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/repo_lock.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/worktree_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/slice_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/mirror_helper.sh"

slice_id="${1:?slice_id required}"
slice_file_main="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/claude_repair.md"
LOG="$LOOP_STATE_DIR/runner.log"
counter_file="$LOOP_STATE_DIR/repair_count_${slice_id}"

MAX_REPAIRS="${LOOP_MAX_REPAIRS:-3}"

[[ -f "$slice_file_main" ]]    || { echo "missing $slice_file_main" >&2; exit 2; }
[[ -f "$prompt_file" ]]   || { echo "missing $prompt_file" >&2; exit 2; }

stamp() { date -Iseconds; }
logmsg() { printf '[%s] dispatch_repair %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$LOG"; }

mkdir -p "$(dirname "$counter_file")"
count=$(cat "$counter_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$counter_file"

logmsg "repair attempt $count of $MAX_REPAIRS"

if [[ "$count" -gt "$MAX_REPAIRS" ]]; then
  logmsg "MAX_REPAIRS exceeded ($count > $MAX_REPAIRS); escalating to USER ATTENTION"
  exit 4
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH" >&2
  exit 3
fi

# Classify the repair mode based on the latest audit verdict.
mode=$(classify_repair_mode "$slice_id")
logmsg "classified as repair mode: $mode (attempt $count)"

case "$mode" in
  slice-state)
    # Run agent in slice worktree; mirror back to integration.
    worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.$$"
    trap 'rm -f "$worktree_path_file"' EXIT

    with_repo_lock "dispatch_repair:$slice_id:worktree-prep" \
      _ensure_slice_worktree_to_file "$slice_id" "$worktree_path_file" || {
      logmsg "failed to ensure worktree"
      exit 4
    }
    slice_worktree=$(cat "$worktree_path_file")

    logmsg "begin (slice-state)"

    (
      cd "$slice_worktree"
      claude --print \
        --append-system-prompt "$(cat "$prompt_file")" \
        --permission-mode acceptEdits \
        --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
You are the Claude REPAIR agent. The parent slice is blocked.

Slice file: diagnostic/slices/${slice_id}.md
Repair attempt: ${count} of ${MAX_REPAIRS}
Mode: slice-state (the audit verdict's High/Medium/Low items do NOT
       implicate scripts/loop/* protocol code).
Worktree: ${slice_worktree}
Branch: slice/${slice_id} (already checked out — do NOT switch branches)

Steps:
1. Read the parent slice's "Audit verdict" section verbatim.
2. Apply the appropriate action per the system prompt's decision tree:
   - Implementation-level: flip frontmatter status=revising, owner=claude. Commit with [slice:${slice_id}][repair-retry].
   - Genuinely ambiguous: append a short diagnosis to the slice's audit verdict, leave status=blocked. Commit with [slice:${slice_id}][repair-escalate].
3. Push.

CRITICAL CONSTRAINTS:
- Operate ONLY on slice/${slice_id} in this worktree.
- Touch ONLY diagnostic/slices/${slice_id}.md.
- DO NOT mirror to integration — the dispatcher does that.
- After you commit + push, exit.
EOF
    )
    agent_rc=$?

    # Mirror the slice file back to integration.
    # Expected terminal states for slice-state repair: revising | blocked.
    with_repo_lock "dispatch_repair:$slice_id:mirror" \
      mirror_slice_to_integration "$slice_id" "revising|blocked" \
      || logmsg "mirror returned non-zero"

    "$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" claude-repair || true

    logmsg "end (slice-state agent_rc=$agent_rc)"
    exit $agent_rc
    ;;

  loop-infra)
    # Agent edits scripts/loop/* in the MAIN worktree under lock.
    # The agent commits its work as [loop-infra-repair][slice:X][attempt:N].
    # Then the dispatcher amends to inject Resume-as: trailer (round-10 M-2),
    # flips slice → blocked locally, commits [loop-infra-pending], and
    # exits 4. The user must approve via sentinel + restart.
    logmsg "begin (loop-infra) attempt=$count"

    with_repo_lock "dispatch_repair:$slice_id:loop-infra:$count" bash <<INFRA_BLOCK
set -euo pipefail
cd "$LOOP_MAIN_WORKTREE"

# Ensure on integration so the agent's edits land here, not on a slice branch.
git checkout -q integration/perf-roadmap
git pull --ff-only --quiet || true

# Run the repair agent in the main worktree (loop-infra paths live here).
claude --print \\
  --append-system-prompt "\$(cat '$prompt_file')" \\
  --permission-mode acceptEdits \\
  --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
You are the Claude REPAIR agent in LOOP-INFRA mode. The parent slice's
audit verdict has triaged High/Medium/Low items pointing at scripts/loop/*
protocol code. You are running in the MAIN worktree on integration/perf-roadmap.

Slice file: diagnostic/slices/${slice_id}.md
Repair attempt: ${count} of ${MAX_REPAIRS}
Mode: loop-infra

Steps:
1. Read the parent slice's "Audit verdict" section.
2. Apply the protocol-level fix to the relevant scripts/loop/* or prompts/* file.
3. Commit ONLY your protocol changes (NOT the slice file) with subject:
     [loop-infra-repair][slice:${slice_id}][attempt:${count}] <one-sentence summary>
4. DO NOT push. The dispatcher will amend with a Resume-as: trailer and
   commit a [loop-infra-pending] flip; user approval pushes both.
5. After commit, exit. The dispatcher takes over from here.

CRITICAL CONSTRAINTS:
- Touch only scripts/loop/*, scripts/loop/prompts/*. DO NOT touch slice files.
- DO NOT push.
EOF

# Capture the agent's commit subject (the first line of HEAD).
agent_subject=\$(git log -1 --pretty=%s HEAD)

# Determine resume target (revising vs revising_plan) BEFORE flipping.
status_before=\$(awk '
  /^---\$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
  fm && \$1 == "status:" { sub(/^[^:]+: */, ""); print; exit }
' "diagnostic/slices/${slice_id}.md")

# Persist status_before in the slice's frontmatter for round-trip.
# (slice_helpers' determine_resume_target reads status_before_block; round-10 M-2.)
case "\$status_before" in
  awaiting_audit) resume_status="revising" ;;
  *)              resume_status="revising_plan" ;;
esac

# Amend the agent's commit to include the Resume-as: trailer + canonical subject.
agent_summary=\$(echo "\$agent_subject" | sed 's/^\\[loop-infra-repair\\][^ ]* *//; s/^\\[slice:[^]]*\\] *//; s/^\\[attempt:[^]]*\\] *//')
git commit --amend \\
  -m "[loop-infra-repair][slice:${slice_id}][attempt:${count}] \${agent_summary:-protocol repair}

Resume-as: \${resume_status}
" >/dev/null

# Compute diff_files for the slice-file note (round-8 H-2: must be local
# inside this case; under set -u we'd otherwise reference an unset var).
diff_files=\$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "(could not compute diff)")

# Flip slice file to blocked (in-place via slice_helpers).
WORKING_DIR="$LOOP_MAIN_WORKTREE" \\
  bash -c 'source "$LOOP_MAIN_WORKTREE/scripts/loop/slice_helpers.sh"; \\
           flip_slice_status "${slice_id}" blocked user'

# Append the explanation block.
WORKING_DIR="$LOOP_MAIN_WORKTREE" \\
  bash -c "source \\"$LOOP_MAIN_WORKTREE/scripts/loop/slice_helpers.sh\\"; \\
           append_slice_section '${slice_id}' \\
             '## Loop-infrastructure repair pending approval' \\
             \"The repair agent proposed protocol changes touching:
\$(printf '%s\\n' \\"\$diff_files\\" | sed 's/^/  - /')

Two local commits on integration (not pushed). Note the order — the
[loop-infra-pending] flip is committed AFTER the dispatcher amends the
[loop-infra-repair] commit, so HEAD is the pending flip:
  HEAD     [loop-infra-pending][slice:${slice_id}][attempt:${count}] — this blocked-state flip
  HEAD~1   [loop-infra-repair][slice:${slice_id}][attempt:${count}] — the protocol change

LIFECYCLE — runner has exited cleanly via circuit breaker. To resume:

  Approve (push both commits, slice unblocks):
    touch diagnostic/slices/.approved-loop-infra-repair/${slice_id}__attempt-${count}
    # Restart runner. The runner's loop-infra-approval-resume hook detects
    # the sentinel, pushes both original commits, flips the slice status,
    # commits the flip, pushes the [loop-infra-resumed] commit, then ONLY
    # removes the sentinel after the final push succeeds, and flips the
    # slice back to revising_plan or revising as the agent intended.

  Reject (drop both commits, slice unblocks back to its prior state):
    scripts/loop/reject_loop_infra_repair.sh ${slice_id}
    # The script verifies HEAD and HEAD~1 are the expected loop-infra pair
    # for this slice before the destructive reset, removes any sentinel,
    # and prints next steps. Restart runner afterwards.\""

git add diagnostic/slices/${slice_id}.md
git commit -m "[loop-infra-pending][slice:${slice_id}][attempt:${count}] block pending user approval" >/dev/null

# Do NOT push. Both local commits stay until user approval.
INFRA_BLOCK

    "$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" claude-repair || true

    logmsg "end (loop-infra; 2 local commits awaiting approval)"
    exit 4   # signals runner to exit via circuit breaker
    ;;

  *)
    logmsg "unknown repair mode: $mode"
    exit 1
    ;;
esac
