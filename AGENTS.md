# Working instructions for agents in this repo (openf1 / F1 Chat)

The product is `web/` (Next.js 15 + Recharts) over a Neon Postgres warehouse of OpenF1 data, plus
an analyst pipeline in `web/scripts/analyst/` that turns a race into a canonical evidence packet,
a verified article and verified figures. Read `BRIEF.md` for the scope of the current run.

## Never read (large or irrelevant)
`data/`, `data_2024_nonrace/`, `logs/`, `*.log`, `helper-repos/`, `f1_codex_helpers/`, `fastf1_audit/`,
`fastf1_openf1_audit_toolkit/`, `.next/`, `web/.next/`, `node_modules/`, `venv/`, `__pycache__/`,
`corpus-artifacts/`, `corpus/inbox/`, `corpus/quarantine/`, `web/.env.local`.

## House rules
- **No database access.** The analyst packet on disk is the evidence; tasks in this run must not
  need Neon. Never print or copy environment variables or secrets.
- **Every number is traceable.** Prose claims go in `sidecar.json` with a packet path; figure text is
  templates with typed slots bound to packet paths (`figures.mjs`). If the packet cannot support a
  claim, attribute it or leave it out. Never invent quotes; race-control messages are quoted verbatim.
- **Honesty over polish.** Inferred endpoints, carried-forward positions, estimates and missing data
  are labelled as such, in the prose and on the figures.
- **Rights.** Corpus source text is never copied into anything committed. The target register is the
  distilled voice in `corpus/style/`, not any source author's text.
- **Surfaces stay consistent.** Adding a detector, template, chart type or fetch edge requires
  updating `web/scripts/health/a_surface_manifest.json`; keep `npm run typecheck` and the tests in
  `web/scripts/tests/` green. A `;` anywhere in deterministic SQL fails the single-statement guard.
- **Tools, not free-ranging.** Prefer running the pipeline scripts and gate commands over re-deriving
  results by hand. Do not run `npm install` or change lockfiles unless the task says so.
- The Browser QA role checks `/blog/<slug>` renders with its figures; do not claim browser checks
  you did not run.

## Orchestra runs

When work is dispatched by `orchestra` (see `orchestra.toml`, `PLAN.md`, `TASKS.md`):

- Claude plans and reviews; Codex implements one task per worktree on its own branch. The
  orchestrator commits and merges under each agent's identity, so agents do not commit, branch, or merge.
- Do not edit `PLAN.md`, `TASKS.md`, `BRIEF.md`, or anything under `.orchestra/`; the planner owns them.
- The verification gate is the `[gate]` block in `orchestra.toml` (or the planner's); run it before finishing.
- Tasks touching auth, secrets, infrastructure, CI, or destructive data operations pause for human
  approval before merge. Everything above in this file still applies.
