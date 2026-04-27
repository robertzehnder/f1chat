#!/usr/bin/env bash
# scripts/loop/state_transitions.sh
# Allow-list of valid (dispatch_type, status_before, status_after) tuples.
# Used by runner.sh's dispatch_with_guards to detect "verdict landed by status"
# (round-7 C-5): the dispatch is treated as success only if the slice frontmatter
# transitioned from the dispatch's expected entry state to a known terminal
# state for that dispatch type — regardless of the dispatcher's exit code.
#
# Source this file; do not exec it.

# Returns 0 if (dispatch_type, status_before, status_after) is a known terminal
# transition; 1 otherwise.
is_valid_terminal_transition() {
  local dispatch_type="$1" before="$2" after="$3"
  case "$dispatch_type" in
    plan_audit)
      [[ "$before" == "pending_plan_audit" ]] || return 1
      case "$after" in
        pending|revising_plan|blocked) return 0 ;;
        *) return 1 ;;
      esac ;;
    plan_revise)
      [[ "$before" == "revising_plan" ]] || return 1
      case "$after" in
        pending_plan_audit|blocked) return 0 ;;
        *) return 1 ;;
      esac ;;
    impl)
      [[ "$before" == "pending" || "$before" == "revising" ]] || return 1
      case "$after" in
        awaiting_audit|blocked) return 0 ;;
        *) return 1 ;;
      esac ;;
    impl_audit)
      [[ "$before" == "awaiting_audit" ]] || return 1
      case "$after" in
        ready_to_merge|revising|blocked) return 0 ;;
        *) return 1 ;;
      esac ;;
    merger)
      [[ "$before" == "ready_to_merge" ]] || return 1
      case "$after" in
        done|blocked) return 0 ;;
        *) return 1 ;;
      esac ;;
    repair)
      [[ "$before" == "blocked" ]] || return 1
      case "$after" in
        revising|revising_plan|blocked) return 0 ;;
        *) return 1 ;;
      esac ;;
    *)
      return 1 ;;
  esac
}
