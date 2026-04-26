const DEFAULT_WINDOW = 200;
const MIN_N = 1;
const MAX_N = 1000;

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function parseN(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return DEFAULT_WINDOW;
  }
  const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(num)) return DEFAULT_WINDOW;
  if (!Number.isInteger(num)) return DEFAULT_WINDOW;
  if (num < MIN_N || num > MAX_N) return DEFAULT_WINDOW;
  return num;
}

export function aggregatePerfTraces(records, n) {
  const windowed = records.slice(-n);
  const returned = windowed.length;

  const valuesByStage = new Map();
  for (const record of windowed) {
    if (!record || !Array.isArray(record.spans)) continue;
    for (const span of record.spans) {
      if (!span || typeof span.name !== "string") continue;
      const elapsed = span.elapsedMs;
      if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0) continue;
      let bucket = valuesByStage.get(span.name);
      if (!bucket) {
        bucket = [];
        valuesByStage.set(span.name, bucket);
      }
      bucket.push(elapsed);
    }
  }

  const stages = {};
  for (const [name, vals] of valuesByStage) {
    if (vals.length === 0) continue;
    const sorted = vals.slice().sort((a, b) => a - b);
    const count = sorted.length;
    const p50 = sorted[Math.ceil(count * 0.5) - 1];
    const p95 = sorted[Math.ceil(count * 0.95) - 1];
    const max = sorted[count - 1];
    stages[name] = {
      count,
      p50_ms: round2(p50),
      p95_ms: round2(p95),
      max_ms: round2(max)
    };
  }

  return {
    window: { requested: n, returned },
    stages
  };
}

export async function handlePerfSummaryRequest({ env, traceFilePath, n, readFile }) {
  if (env === "production") {
    return { status: 404, body: "Not Found" };
  }

  let content;
  try {
    content = await readFile(traceFilePath, "utf8");
  } catch {
    return { status: 200, body: { window: { requested: n, returned: 0 }, stages: {} } };
  }

  const records = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed && Array.isArray(parsed.spans)) {
      records.push(parsed);
    }
  }

  return { status: 200, body: aggregatePerfTraces(records, n) };
}
