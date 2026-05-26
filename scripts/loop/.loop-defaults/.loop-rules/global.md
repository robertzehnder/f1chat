---
paths: ["**"]
---
# Global loop rules

These rules apply to every slice regardless of which files it touches.

## Editing discipline
- Prefer editing existing files to creating new ones.
- Don't add features, refactor, or introduce abstractions beyond what the slice requires.
- Don't add error handling, fallbacks, or validation for scenarios that can't happen.
- Don't write comments unless the *why* is non-obvious.

## Sandbox invariants
- All writes happen inside the proposal worktree (`.loop-worktrees/<slice-id>-proposal-<n>/`).
- The integration branch is read-only from the implementer's perspective.
- The submodule (`.loop/`), `.loop-rules/`, `.loop-config.yaml`, and `.loop-state/` are all read-only.

## Approval policy
- Migrations, infra files, secrets, and destructive commands are gated by `approval-policy.yaml`.
- The dispatcher enforces policy; the model's `requires_approval` flag is advisory.
