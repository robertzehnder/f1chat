---
slice_id: 06-warm-keeper-cron
phase: 6
status: done
owner: -
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-27T16:42:34Z
---

## Goal
Add a cron / scheduled function that pings Neon every 4 minutes to keep the pool warm and prevent cold-start latency on user requests.

## Inputs
- `web/src/lib/db/driver.ts`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6

## Prior context
- `diagnostic/_state.md`

## Required services / env
Production `DATABASE_URL` (Neon pooler). For Neon-config slices, requires Neon API token or console access.

## Steps
1. Read the current implementation if any.
2. Apply the change per the slice goal.
3. Add tests / docs as appropriate.
4. Verify against a real Neon connection.

## Changed files expected
- `web/src/app/api/internal/warm/route.ts`
- `.github/workflows/warm-keeper.yml`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Change is implemented and tested per the goal.
- [ ] Production-side behavior verified in the staging environment before merge.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Production-touching. Require user-approved sentinel before merge. Rollback: `git revert` + Neon-config revert if applicable.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Slice-completion note
SKIPPED by user decision (2026-04-27). Always-on warm-keeper cron would add
~$25-30/month to Neon compute by preventing autosuspend (4-min ping cycle
keeps the 0.25 CU compute active 24/7 → 730 CU-hr/mo × $0.16 ≈ $29/mo).
Cold-start latency on first request after idle (~1-2s) is acceptable for
the current traffic pattern. Revisit if user data shows cold starts hurt
UX. Cheaper alternative if revisited: lengthen Neon autosuspend (5min →
30min) in the console — pays only for actual usage.

## Audit verdict
N/A — slice marked done without implementation per user direction.
