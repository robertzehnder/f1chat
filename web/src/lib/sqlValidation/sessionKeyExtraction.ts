// Phase 19 outcome-fix Fix 6 (codex audit pass 6): shared module that
// extracts literal session_key values from SQL. Originally lived
// inline in orchestration.ts; hoisted here so the grader
// (chat-health-check-baseline.mjs) can reuse it for the WHERE-clause
// precedence resolution step in the proven-data-unavailable
// classifier without importing from app/api/.
//
// Captures `session_key = 9839`, `session_key = 9839,9840`,
// `session_key IN (9839, 9840)`, plus mixed forms. Returns sorted
// unique values.

export function extractSessionKeyLiterals(sql: string): number[] {
  const values = new Set<number>();

  // session_key = N
  const eqPattern = /\bsession_key\s*=\s*(\d+)\b/gi;
  for (const match of sql.matchAll(eqPattern)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) values.add(Math.trunc(parsed));
  }

  // session_key IN (N, N, ...) — capture the parenthesised list, then
  // pull integers out.
  const inPattern = /\bsession_key\s+IN\s*\(([^)]+)\)/gi;
  for (const match of sql.matchAll(inPattern)) {
    const inner = match[1] ?? "";
    for (const numMatch of inner.matchAll(/\b(\d+)\b/g)) {
      const parsed = Number(numMatch[1]);
      if (Number.isFinite(parsed)) values.add(Math.trunc(parsed));
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}
