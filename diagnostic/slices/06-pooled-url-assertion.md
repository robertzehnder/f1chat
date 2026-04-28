---
slice_id: 06-pooled-url-assertion
phase: 6
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28T16:31:00Z
---

## Goal
Assert `DATABASE_URL` uses the Neon pooler connection string (port 6543 / `-pooler` suffix) in production. Throw a startup error if direct-connection URL is detected in `NODE_ENV=production`.

## Inputs
- `web/src/lib/db/driver.ts`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6

## Prior context
- `diagnostic/_state.md`

## Required services / env
- `DATABASE_URL` — must be a Neon pooler URL (host suffix `-pooler` and port `6543`) when `NODE_ENV=production`.
- Test fixtures (set per-test, no real Neon connection required):
  - Pooler URL example: `postgres://USER:PASS@ep-foo-bar-pooler.us-east-2.aws.neon.tech:6543/openf1?sslmode=require`
  - Direct URL example: `postgres://USER:PASS@ep-foo-bar.us-east-2.aws.neon.tech:5432/openf1?sslmode=require`
- No Neon API token or console access is required for this slice.

## Steps
1. Read the current implementation in `web/src/lib/db/driver.ts` (or `web/src/lib/db.ts` if `driver.ts` does not exist). Locate the module-load path that reads `process.env.DATABASE_URL` and creates the connection.
2. Add a startup assertion that runs once at module load: when `process.env.NODE_ENV === 'production'`, parse `process.env.DATABASE_URL` and throw a descriptive `Error` if the host does not contain the substring `-pooler` OR the port (URL `port`, defaulting to 5432 when omitted) is not `6543`. The error message must include the offending host and port and instruct the operator to switch to the Neon pooler URL.
3. Add an automated test at `web/scripts/tests/pooled-url-assertion.test.mjs` covering all four cases below (Acceptance criteria #1–#4) by importing the assertion as a pure function (extract it from the module-load side effect so it is unit-testable) — do NOT rely on side-effectful module load, do NOT add a docs file.
4. Pre-merge verification (staging, evidence required):
   - Set `NODE_ENV=production` and `DATABASE_URL` to the staging Neon pooler URL, then run `cd web && NODE_ENV=production DATABASE_URL=<staging-pooler-url> node -e "import('./src/lib/db/driver.ts').then(()=>console.log('OK: pooler url accepted'))"`. Expect exit 0 and stdout containing `OK: pooler url accepted`.
   - Set `NODE_ENV=production` and `DATABASE_URL` to the staging Neon **direct** URL (port 5432, no `-pooler`), then run the same `node -e` command. Expect non-zero exit and stderr matching `/Neon pooler URL required/i` (or the implementer's chosen wording, asserted by the test file).
   - Save the combined stdout+stderr of both invocations to `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` and reference that path in the implementation slice-completion note.

## Changed files expected
- `web/src/lib/db/driver.ts`
- `web/scripts/tests/pooled-url-assertion.test.mjs`

## Artifact paths
- `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` — combined stdout/stderr of the two staging `node -e` invocations from Steps §4.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/scripts/tests/pooled-url-assertion.test.mjs` asserts that the function THROWS when `NODE_ENV=production` and the URL host has no `-pooler` and port is `5432` (direct Neon URL).
- [ ] Same test file asserts that the function THROWS when `NODE_ENV=production` and the URL has `-pooler` host but port `5432` (mismatched), and again when the URL has port `6543` but host without `-pooler` (also mismatched).
- [ ] Same test file asserts that the function does NOT throw when `NODE_ENV=production` and the URL is a valid Neon pooler URL (`-pooler` host AND port `6543`).
- [ ] Same test file asserts that the function does NOT throw when `NODE_ENV !== 'production'` regardless of URL shape (covers `development`, `test`, and unset `NODE_ENV`).
- [ ] Test file is wired into `cd web && npm run test:grading` so it executes in the gate command, and the gate exits 0 locally.
- [ ] Staging verification artifact at `diagnostic/artifacts/phase-6/06-pooled-url-assertion-staging_2026-04-28.txt` exists and contains both the success line (`OK: pooler url accepted`) and a non-zero-exit error message from the direct-URL invocation.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Production-touching. Require user-approved sentinel before merge. Rollback: `git revert` + Neon-config revert if applicable.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace `Verify against a real Neon connection.` with a concrete pre-merge verification step that names the exact environment, command or check, and any required artifact or evidence; the current step is underspecified and not actionable for the implementer.
- [x] Make the acceptance criteria directly testable from this slice by specifying the expected automated assertion coverage for pooled versus direct production URLs instead of `implemented and tested per the goal`.
- [x] Align `Required services / env` with the actual slice scope: either remove the Neon API token / console requirement or add explicit plan steps that use it, because the current plan declares external access without any defined action.

### Low
- [x] Resolve the mismatch between `Add tests / docs as appropriate.` and `Changed files expected` by either naming any expected doc path or dropping docs from the step.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated within 24 hours, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] Rewrite Step 4's staging verification import target to the repo's actual DB entrypoint, because `web/src/lib/db/driver.ts` does not exist here and the artifact command cannot run as written.

### Medium
- [ ] Align `Changed files expected` with Step 1's fallback path: either name `web/src/lib/db.ts` as the expected implementation edit in this repo or require creating and using `web/src/lib/db/driver.ts` consistently across the plan.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` last updated `2026-04-28T15:43:27Z`, so no staleness note applies.
- Repo context check: `web/package.json` already runs `node --test scripts/tests/*.test.mjs` for `test:grading`, so no extra test-runner wiring is needed for a new `*.test.mjs` file.
