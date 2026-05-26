---
id: viz-04-visualization-contracts
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-04-visualization-contracts/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Every visual has a documented row-data contract + a known SQL source. Contract enforced by typecheck + live-data SQL check.

## Context

- Combined plan Phase 4
- Depends on viz-02 (coverage matrix) and viz-03a (discriminated specs).
- Live SQL check is informational only — exits 0 even if no live DB.

## Changed files expected

- `web/src/lib/visualizationContracts.ts`
- `web/scripts/tests/visualization-contract.test.ts` (extended)
- `web/scripts/health/visualization-contract-sql-check.ts`

## Steps

1. Create `web/src/lib/visualizationContracts.ts`:
   ```ts
   export interface VisualContract {
     visual_id: string;
     required_row_fields: { name: string; type: 'string' | 'number'; pattern?: RegExp }[];
     optional_row_fields: { name: string; type: 'string' | 'number' }[];
     synthesis_fields: ('title'|'subtitle'|'body'|'metrics'|'key_takeaways'|'related_questions'|'hero'|'verdict'|'refusal')[];
     backend_source: string;
     adapter_notes?: string;
   }
   export const VISUAL_CONTRACTS: Record<string, VisualContract> = { … };
   ```
2. Populate one entry per chart type (17 total) referencing the coverage matrix.
3. Extend `visualization-contract.test.ts` to assert each contract's `required_row_fields` are produced by the corresponding fixture's row shape.
4. Add `web/scripts/health/visualization-contract-sql-check.ts`:
   - Reads each contract's `backend_source` SQL.
   - When `DATABASE_URL` is set, runs the SQL against the live DB.
   - Verifies the returned row shape satisfies the contract.
   - Marks contracts that don't have a live-data path as `(fixture-only)`.
   - Exits 0 (informational; not a gate).

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run test:adapter
cd web && npx tsx scripts/health/visualization-contract-sql-check.ts
```

## Acceptance criteria

- All 17 chart types have a contract entry.
- All 21 implemented fixtures satisfy their declared contract.
- Live SQL check produces a report enumerating which contracts have a working live path.
