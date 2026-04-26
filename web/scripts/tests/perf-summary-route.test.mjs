import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  aggregatePerfTraces,
  parseN,
  handlePerfSummaryRequest
} from "../../src/lib/perfSummary.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function makeFixtureFile(lines) {
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-perf-summary-"));
  const filePath = path.join(dir, "chat_query_trace.jsonl");
  await writeFile(filePath, lines.join("\n") + "\n", "utf8");
  return { dir, filePath };
}

test("handlePerfSummaryRequest in dev returns 200 and only counts perfTrace entries", async () => {
  const appendQueryTraceLine = JSON.stringify({
    ts: "2026-04-26T00:00:00.000Z",
    requestId: "abc",
    status: "ok",
    queryPath: "deterministic",
    sql: "select 1"
  });
  const perfTraceLine = JSON.stringify({
    ts: "2026-04-26T00:00:01.000Z",
    requestId: "def",
    spans: [
      { name: "request_intake", startedAt: 1, elapsedMs: 5 },
      { name: "total", startedAt: 1, elapsedMs: 42 }
    ]
  });
  const malformedLine = "{not valid json";

  const { dir, filePath } = await makeFixtureFile([
    appendQueryTraceLine,
    perfTraceLine,
    malformedLine
  ]);

  let callCount = 0;
  const stubReadFile = async (p, encoding) => {
    callCount += 1;
    return await readFile(p, encoding);
  };

  try {
    const result = await handlePerfSummaryRequest({
      env: "development",
      traceFilePath: filePath,
      n: 200,
      readFile: stubReadFile
    });

    assert.equal(result.status, 200);
    assert.equal(callCount, 1, "readFile should be called once in dev mode");
    assert.equal(typeof result.body, "object");
    assert.equal(result.body.window.requested, 200);
    assert.equal(result.body.window.returned, 1, "only one perfTrace record in window");
    assert.deepEqual(Object.keys(result.body.stages).sort(), ["request_intake", "total"]);

    const intake = result.body.stages.request_intake;
    assert.equal(intake.count, 1);
    assert.equal(intake.p50_ms, 5);
    assert.equal(intake.p95_ms, 5);
    assert.equal(intake.max_ms, 5);

    const total = result.body.stages.total;
    assert.equal(total.count, 1);
    assert.equal(total.p50_ms, 42);
    assert.equal(total.p95_ms, 42);
    assert.equal(total.max_ms, 42);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("handlePerfSummaryRequest in production returns 404 without invoking readFile", async () => {
  const perfTraceLine = JSON.stringify({
    spans: [{ name: "total", startedAt: 1, elapsedMs: 10 }]
  });
  const { dir, filePath } = await makeFixtureFile([perfTraceLine]);

  let callCount = 0;
  const stubReadFile = async (p, encoding) => {
    callCount += 1;
    return await readFile(p, encoding);
  };

  try {
    const result = await handlePerfSummaryRequest({
      env: "production",
      traceFilePath: filePath,
      n: 200,
      readFile: stubReadFile
    });

    assert.equal(result.status, 404);
    assert.equal(callCount, 0, "readFile must not be called in production mode");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("handlePerfSummaryRequest with missing trace file returns empty 200 body", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-perf-summary-missing-"));
  const filePath = path.join(dir, "does-not-exist.jsonl");

  const stubReadFile = async (p, encoding) => {
    return await readFile(p, encoding);
  };

  try {
    const result = await handlePerfSummaryRequest({
      env: "development",
      traceFilePath: filePath,
      n: 200,
      readFile: stubReadFile
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      window: { requested: 200, returned: 0 },
      stages: {}
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("aggregatePerfTraces computes nearest-rank ceiling percentiles, rounds to 2 decimals, omits absent stages", () => {
  // 10 integer values 1..10 (in shuffled order) so we also verify the implementation
  // sorts ascending before indexing.
  const order = [3, 7, 1, 9, 5, 10, 2, 8, 4, 6];
  const records = order.map((v) => ({
    spans: [{ name: "execute_db", startedAt: 0, elapsedMs: v }]
  }));

  const result = aggregatePerfTraces(records, 200);
  assert.equal(result.window.requested, 200);
  assert.equal(result.window.returned, 10);

  const stage = result.stages.execute_db;
  assert.equal(stage.count, 10);
  // sorted ascending: 1..10
  // p50 nearest-rank ceil: idx ceil(10*0.50)-1 = 5-1 = 4 → 5
  // p95: idx ceil(10*0.95)-1 = 10-1 = 9 → 10
  // max: 10
  assert.equal(stage.p50_ms, 5);
  assert.equal(stage.p95_ms, 10);
  assert.equal(stage.max_ms, 10);

  // Stages not present in any record must be omitted (no zero-count entries).
  assert.equal(result.stages.repair_llm, undefined);
  assert.equal(result.stages.synthesize_llm, undefined);
});

test("aggregatePerfTraces rounds p50/p95/max to 2 decimals via Math.round(x*100)/100", () => {
  // Values chosen to avoid floating-point landmines around .x5 boundaries.
  const result = aggregatePerfTraces(
    [
      { spans: [{ name: "total", startedAt: 0, elapsedMs: 1.234 }] },
      { spans: [{ name: "total", startedAt: 0, elapsedMs: 2.346 }] },
      { spans: [{ name: "total", startedAt: 0, elapsedMs: 3.451 }] }
    ],
    10
  );
  const total = result.stages.total;
  // sorted ascending: 1.234, 2.346, 3.451
  // p50: idx ceil(3*0.50)-1 = 2-1 = 1 → 2.346 → round2 = 2.35
  // p95: idx ceil(3*0.95)-1 = 3-1 = 2 → 3.451 → round2 = 3.45
  // max: 3.451 → 3.45
  assert.equal(total.count, 3);
  assert.equal(total.p50_ms, 2.35);
  assert.equal(total.p95_ms, 3.45);
  assert.equal(total.max_ms, 3.45);
});

test("aggregatePerfTraces with one record yields p50 === p95 === max === single value", () => {
  const result = aggregatePerfTraces(
    [{ spans: [{ name: "total", startedAt: 0, elapsedMs: 7.123456 }] }],
    50
  );
  const total = result.stages.total;
  assert.equal(total.count, 1);
  assert.equal(total.p50_ms, 7.12);
  assert.equal(total.p95_ms, 7.12);
  assert.equal(total.max_ms, 7.12);
  assert.equal(result.window.requested, 50);
  assert.equal(result.window.returned, 1);
});

test("aggregatePerfTraces window.returned equals min(records.length, n)", () => {
  const records = Array.from({ length: 5 }, (_, i) => ({
    spans: [{ name: "total", startedAt: 0, elapsedMs: i + 1 }]
  }));

  const wide = aggregatePerfTraces(records, 100);
  assert.equal(wide.window.requested, 100);
  assert.equal(wide.window.returned, 5);

  const narrow = aggregatePerfTraces(records, 3);
  assert.equal(narrow.window.requested, 3);
  assert.equal(narrow.window.returned, 3);
  // Last 3 records have elapsedMs 3, 4, 5
  assert.equal(narrow.stages.total.count, 3);
  assert.equal(narrow.stages.total.max_ms, 5);
});

test("aggregatePerfTraces skips invalid span entries individually", () => {
  const result = aggregatePerfTraces(
    [
      {
        spans: [
          { name: "total", startedAt: 0, elapsedMs: 10 },
          { name: "total", startedAt: 0, elapsedMs: NaN },
          { name: "total", startedAt: 0, elapsedMs: -1 },
          { name: "total", startedAt: 0, elapsedMs: Infinity },
          { name: 123, elapsedMs: 5 },
          { elapsedMs: 5 },
          { name: "total" }
        ]
      }
    ],
    50
  );
  assert.equal(result.stages.total.count, 1);
  assert.equal(result.stages.total.max_ms, 10);
});

test("parseN returns 200 fallback for invalid or out-of-range values (no clamping)", () => {
  const fallbackCases = [null, undefined, "", "abc", NaN, "-5", "0", "5000", "1.5"];
  for (const input of fallbackCases) {
    assert.equal(
      parseN(input),
      200,
      `parseN(${JSON.stringify(input)}) should fall back to 200`
    );
  }
});

test("parseN returns the integer for in-range string inputs", () => {
  assert.equal(parseN("1"), 1);
  assert.equal(parseN("500"), 500);
  assert.equal(parseN("1000"), 1000);
});

test("route default trace file path matches getTraceFilePath in perfTrace.ts", async () => {
  const webRoot = path.resolve(__dirname, "..", "..");
  const routeSource = await readFile(
    path.join(webRoot, "src/app/api/admin/perf-summary/route.ts"),
    "utf8"
  );
  const perfTraceSource = await readFile(
    path.join(webRoot, "src/lib/perfTrace.ts"),
    "utf8"
  );

  // Both files must derive base dir from the same env var.
  assert.match(routeSource, /OPENF1_WEB_LOG_DIR/);
  assert.match(perfTraceSource, /OPENF1_WEB_LOG_DIR/);
  // Both must reference the shared filename.
  assert.match(routeSource, /chat_query_trace\.jsonl/);
  assert.match(perfTraceSource, /chat_query_trace\.jsonl/);
});
