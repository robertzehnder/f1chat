---
slice_id: 00-font-network-doc
phase: 0
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25T21:23:52-04:00
---

## Goal
Document the `next/font/google` network dependency and provide a self-host fallback option, so offline CI can decide which path to take.

## Inputs
- `web/src/app/layout.tsx` (uses `next/font/google`)
- [roadmap §1 build reproducibility risk](../roadmap_2026-04_performance_and_upgrade.md)

## Required services / env
None at author time.

## Steps
1. Add a "Build dependencies" section to `web/README.md` (create file if missing):
   - Note that `npm run build` requires network access to Google Fonts unless self-hosted fonts are wired up.
   - Document the optional self-host migration path: download fonts to `web/public/fonts/`, swap `next/font/google` for `next/font/local`.
2. If CI workflow exists (Phase 0 `00-ci-workflow`), add an environment note that builds run on GitHub-hosted runners with network access.

## Changed files expected
- `web/README.md`

## Artifact paths
None.

## Gate commands
```bash
test -f web/README.md
grep -q "next/font/google" web/README.md
```

## Acceptance criteria
- [ ] `web/README.md` exists with a "Build dependencies" section.
- [ ] Section documents both the network-dependent path and the self-host alternative.

## Out of scope
- Actually self-hosting the fonts (separate slice if/when offline CI requires it).

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

Branch: `slice/00-font-network-doc`

Changes:
- `web/README.md`: added "Build dependencies" section documenting the `next/font/google` network
  requirement and the self-host migration path (download fonts to `web/public/fonts/`, swap to
  `next/font/local`). Also included an environment note that the CI `web-build` job runs on
  GitHub-hosted runners (`ubuntu-latest`) which have network access, satisfying this dependency
  automatically.

Gate results:
- `test -f web/README.md` → exit 0
- `grep -q "next/font/google" web/README.md` → exit 0

Decisions:
- Step 2 (CI environment note) was incorporated inline in the "Build dependencies" section rather
  than as a separate section, since the `ci.yml` `web-build` job was already present and a single
  cohesive section is clearer than two fragmented notes.

## Audit verdict
(filled by auditor)
