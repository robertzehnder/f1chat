# 06-cu-rightsize — decision document

This file is the slice's decision-document artifact. The implementer
fills in the Evidence, Cost/perf tradeoff, and chosen-window sections
per the slice plan during impl. The User approval section below is
pre-recorded by the operator from a chat-message sentinel so the gate
that verifies user approval can pass.

## User approval

APPROVE-CU-RIGHTSIZE 2026-04-28T20:35:00Z

## Evidence

stages.total.p95_ms = 26310.01
stages.execute_db.p95_ms = 5629.55
aggregate.post_p95_ms = 0.34

## Chosen window

chosen_min_cu: 0.25
chosen_max_cu: 1
suspend_timeout_seconds: 0
cu_hour_rate_usd: 0.16
cu_hour_rate_source: https://neon.tech/pricing
cost_delta_usd_per_month_max: -116.80
cost_delta_usd_per_month_min: 0
latency_budget_p95_ms: 5629.55
latency_budget_p95_ms_basis: bounded_by stages.execute_db.p95_ms,aggregate.post_p95_ms

## Cost/perf tradeoff

The evidence shows that post-index DB-level query latency is sub-millisecond
(`aggregate.post_p95_ms = 0.34` ms from `04-explain-before-after_2026-04-28.json`),
while application-layer `stages.execute_db.p95_ms = 5629.55` ms reflects request
overhead (driver + pooler + cold-start + LLM-adjacent stages) rather than DB
compute saturation. With DB queries this fast post-index, 1 CU (1 vCPU, 4 GB RAM)
provides ample headroom for the actual database workload. Reducing
`autoscaling_limit_max_cu` from 2 to 1 caps the upper bound of monthly compute
cost at the resized endpoint by $116.80/month (computed as
`(1 - 2) * 0.16 * 730`, the worst case in which the endpoint runs continuously
at `max_cu`). `autoscaling_limit_min_cu` is retained at 0.25 to keep idle cost
unchanged, and `suspend_timeout_seconds` is retained at 0 (Neon default
auto-suspend) since the slice records no concurrent-connection or long-tail
evidence that would justify changing the suspend window.

The latency budget the resized window must preserve is set to 5629.55 ms — the
larger (looser) of `stages.execute_db.p95_ms` (5629.55 ms) and
`aggregate.post_p95_ms` (0.34 ms). Choosing the bound this way preserves both
observed values: app-layer DB stage latency is not regressed beyond its
baseline p95, and DB-level post-index latency is trivially preserved.

Concurrent-connection counts and `p99` values are not exposed by the cited
inputs and are explicitly out of scope for this sizing rationale.
