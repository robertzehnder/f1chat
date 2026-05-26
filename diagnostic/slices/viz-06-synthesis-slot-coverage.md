---
id: viz-06-synthesis-slot-coverage
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-06-synthesis-slot-coverage/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Every card's non-chart slots (title, body, metrics, takeaways, chips, hero, verdict, refusal) are reliably populated by structured synthesis, not stuffed into chart body text. Zod schema per shape + parse-rate telemetry.

## Context

- Combined plan Phase 6
- 6 shape templates exist at [buildSynthesisPrompt.ts:332-349](../../web/src/lib/synthesis/buildSynthesisPrompt.ts#L332-L349).
- Depends on viz-03b (slot refactor must land first).

## Changed files expected

- `web/src/lib/synthesis/buildSynthesisPrompt.ts`
- `web/src/lib/synthesis/synthesisSchema.ts` (new)
- `web/src/lib/mapInsight.ts`
- `web/src/lib/anthropic.ts` (or wherever synthesis is dispatched)

## Steps

1. For each of the 6 synthesis templates, check the JSON schema it requests against the screenshot's visible slots.
2. Verify `applyResponseSemantics` in `mapInsight.ts` correctly merges structured responses into `DraftInsight`.
3. Add `lib/synthesis/synthesisSchema.ts` — one Zod schema per shape; export a `validateSynthesisResponse(shape, payload)` helper.
4. Route LLM JSON through the schema; on parse failure, log + degrade gracefully to a body-only card.
5. Add parse-rate telemetry: count of well-formed / degraded / errored synthesis responses, per shape. Append to `.loop-state/cost_ledger.jsonl` or a sibling telemetry file.
6. Confirm screenshot #22 (Imola composite — verdict + line + tiles) round-trips through the `composite` template successfully (use M20 fixture as test).

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

## Acceptance criteria

- All 6 shape templates have a Zod schema; parse-rate is logged.
- M20 composite fixture renders the verdict + chart + metrics + takeaways together.
- No screenshot-mapped card renders as chart-only body text in the parity harness (will be verified in viz-07a).
