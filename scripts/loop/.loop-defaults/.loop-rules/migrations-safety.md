---
paths: ["sql/migrations/**", "web/src/lib/db/migrations/**"]
---
# Migration safety rules

These rules apply only to slices touching SQL migrations.

## Required
- New migrations are additive by default: add columns NULLable, backfill in a separate migration, then drop the NULLable constraint in a third migration.
- Any DROP / TRUNCATE / ALTER ... DROP / DELETE FROM (even with WHERE) must be gated through `approval-policy.yaml`.
- Migrations must include both `up` and `down` SQL. Down must restore the schema to its prior state.

## Forbidden without explicit human approval
- DROP TABLE
- DROP COLUMN (use rename → backfill → drop pattern across multiple migrations instead)
- TRUNCATE on tables larger than 1k rows
- Any change to `auth`, `payments`, or `audit_log` tables

## Verification
- Every migration PR includes the migration's expected row-count impact (estimate from staging).
- Locking behavior is documented (e.g. "ACCESS EXCLUSIVE on <table> for ~Xs at 5M rows").
