# Repo conventions for Codex agents

You are running inside the OpenF1 perf-roadmap repo. Most invocations are loop
dispatchers (audit roles); the dispatcher pre-loads the slice file and the diff
into your prompt. Operate on those — do not free-range.

## Read-scope rules

The dispatcher prompt already contains the slice file body and the relevant
`git diff` block. **Do not** re-read those files via tools.

Never read files under these paths (large, irrelevant to audit decisions):

- `data/`, `data_2024_nonrace/` — raw F1 data dumps (multi-GB)
- `logs/`, `*.log` — runtime logs
- `helper-repos/`, `f1_codex_helpers/` — vendored reference repos
- `fastf1_audit/`, `fastf1_openf1_audit_toolkit/` — large vendored tooling
- `.next/`, `web/.next/` — Next.js build artifacts
- `node_modules/`, `web/node_modules/`
- `venv/`, `__pycache__/`
- `openf1_full_extract.log`, `openf1-full-history-extract.py` (legacy)

If a gate command needs to read one of these, run the command — don't open the
file directly.

## Tool discipline

- Prefer running gate commands (the slice's "Gate commands" block) over reading
  source. The verdict turns on exit codes, not on you re-deriving correctness
  from source.
- For diff-scope checks use `git diff --name-only integration/perf-roadmap...HEAD`,
  not full-tree exploration.
- Do not run `npm install`, `pip install`, or anything that mutates lockfiles
  or env state unless the slice explicitly says so.
- One verdict commit per audit. Do not amend.

## Output discipline

- Verdicts go in the slice file's "Audit verdict" section using the format the
  role prompt specifies.
- No restated context, no narration of what you're about to do.
- Cite file:line and command exit codes; skip prose explanations of obvious
  passes.
