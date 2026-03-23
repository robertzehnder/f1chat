const BANNED_SQL = /\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i;
const READ_ONLY_START = /^(with|select)\b/i;

export function normalizeSql(input: string): string {
  return input.trim().replace(/;\s*$/, "");
}

export function assertReadOnlySql(input: string): string {
  const normalized = normalizeSql(input);
  if (!normalized) {
    throw new Error("SQL is empty.");
  }
  if (!READ_ONLY_START.test(normalized)) {
    throw new Error("Only SELECT/CTE queries are allowed.");
  }
  if (normalized.includes(";")) {
    throw new Error("Only a single SQL statement is allowed.");
  }
  if (BANNED_SQL.test(normalized)) {
    throw new Error("Unsafe SQL keyword detected.");
  }
  return normalized;
}

export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}
