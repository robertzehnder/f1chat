---
slice_id: 00-dep-patches
phase: 0
status: pending
owner: claude
user_approval_required: yes
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Apply patch-level dependency updates and `npm audit fix` to clear the high-severity Next.js and moderate PostCSS advisories.

## Inputs
- [roadmap §1 Repo hygiene gaps](../roadmap_2026-04_performance_and_upgrade.md)
- [execution_plan §7 Phase 0 dep-patches](../execution_plan_2026-04_autonomous_loop.md)

## Required services / env
- `node` ≥ 20, `npm` ≥ 10.
- Network access to npm registry.

## Steps
1. In `web/`, run:
   - `npm install next@15.5.15 react@19.2.5 react-dom@19.2.5 postcss@8.5.10 autoprefixer@10.5.0`
   - `npm install --save-dev @types/pg@8.20.0`
2. Run `npm audit fix --omit=dev`.
3. Run `npm audit --omit=dev` and confirm no high-severity production advisories remain.
4. Run `npm run verify` (after `00-verify-script` lands; otherwise the three gates manually).

## Changed files expected
- `web/package.json`
- `web/package-lock.json`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run typecheck
cd web && npm run test:grading
cd web && npm run build
cd web && npm audit --omit=dev
```

## Acceptance criteria
- [ ] Five package versions match the targets above.
- [ ] `npm audit --omit=dev` reports zero high-severity production advisories.
- [ ] All gates exit 0.

## Out of scope
- Major-version bumps (Next 16, Tailwind 4, TypeScript 6) — separate later slices.

## Risk / rollback
Rollback: `git checkout HEAD -- web/package.json web/package-lock.json && cd web && npm ci`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by auditor)
