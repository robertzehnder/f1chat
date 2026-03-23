# Source Audit Operational Runbook

This runbook defines how source-audit findings are reviewed, tracked, and converted into fixes or explicit policy.

## Scope

Use this runbook for:

- FastF1 vs OpenF1 source audits in `fastf1_audit/`
- warehouse anomaly tracking in `core.source_anomaly_tracking`
- weekend/session expectation coverage audits (`core.weekend_session_expectation_audit`)

## Inputs

- `fastf1_audit/reports/source_audit_report.md`
- `fastf1_audit/reports/source_theme_summary.csv`
- `fastf1_audit/reports/source_comparison_tests.csv`
- `fastf1_audit/reports/source_recommendation_summary.csv`
- `core.source_anomaly_tracking`
- `core.weekend_session_expectation_audit`
- latest benchmark health-check artifacts in `web/logs/`

## Operational cadence

- `weekly`: refresh source audit reports.
- `per release`: verify open anomalies and benchmark root-cause distribution before shipping.
- `after schema/runtime changes`: rerun audit + benchmark grading to catch regressions.

## Standard workflow

1. Refresh source-audit artifacts.
2. Triage findings by severity and ownership.
3. Record or update anomalies in governance tracking.
4. Choose disposition path (data ingestion, semantic contract, runtime adoption, synthesis/guardrails, benchmark policy).
5. Implement fixes with linked anomaly IDs.
6. Re-run benchmark grading and confirm root-cause reduction.
7. Close anomalies only after evidence is visible in both data checks and benchmark outputs.

## Run commands

From `openf1/fastf1_audit`:

```bash
./scripts/run_full_audit.sh
```

Or explicit steps:

```bash
./scripts/extract_fastf1.sh
./scripts/run_comparison.sh
./scripts/export_reports.sh
```

## Triage rubric

### Severity

- `high`: blocks core benchmark families or enables overclaiming without evidence.
- `medium`: causes degraded answer quality, inconsistent naming, or unstable routing.
- `low`: cosmetic/reporting/documentation issues with low user impact.

### Disposition class

- `missing_data`: ingestion/coverage issue.
- `semantic_gap`: semantic contract absent or incomplete.
- `adoption_gap`: semantic contract exists but runtime/templates still bypass it.
- `synthesis_gap`: answer text claims exceed evidence.
- `benchmark_policy_gap`: rubric/grading/reporting inconsistency.

## Governance tracking usage

Use `core.source_anomaly_tracking` as the consolidated anomaly feed.

Useful query:

```sql
SELECT
  anomaly_source,
  anomaly_type,
  severity,
  status,
  COUNT(*) AS issue_count
FROM core.source_anomaly_tracking
GROUP BY anomaly_source, anomaly_type, severity, status
ORDER BY severity DESC, issue_count DESC;
```

Use weekend expectation audit for session completeness context:

```sql
SELECT
  season_year,
  meeting_key,
  weekend_type,
  expected_session_count,
  observed_session_count,
  missing_expected_session_count,
  expectation_status
FROM core.weekend_session_expectation_audit
ORDER BY season_year DESC, meeting_key DESC;
```

## Converting findings into fixes

For each triaged finding:

1. Identify canonical target contract from `docs/semantic_contract_map.md`.
2. Decide if fix is data, semantic layer, runtime adoption, synthesis, or benchmark rubric.
3. Open implementation task with:
   - anomaly identifier/type
   - affected question family or runtime path
   - expected before/after benchmark signal
4. After implementation, rerun benchmark grading and verify:
   - reduced root-cause label count for targeted failure mode
   - no new regression in unrelated categories

## Closure criteria

Do not close an anomaly until all are true:

- data/contract check passes in SQL view or source report
- runtime/template path uses canonical contract (or documented fallback reason)
- benchmark output shows reduced target root-cause signal
- docs updated if policy/contract behavior changed

## Escalation rules

- Escalate immediately when findings impact:
  - strategy evidence claims (pit-cycle/undercut/overcut),
  - grid/finish-based claims,
  - widespread session completeness or placeholder filtering,
  - resolver normalization reliability.

## Related docs

- `docs/semantic_contract_map.md`
- `docs/semantic_runtime_adoption.md`
- `docs/helper_repo_adoption_status.md`
