// Phase 19 outcome-fix Fix 6 (codex audit pass 5+6): tests for the
// proven-data-unavailable classifier in chat-health-check-baseline.mjs.
// Asserts the snapshot precedence rule + fail-safe behavior + DB-free
// guarantee.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baselinePath = path.resolve(__dirname, "..", "chat-health-check-baseline.mjs");

const { classifyZeroRowOutcome, gradeHealthCheckResults } = await import(baselinePath);

function makeItem(overrides = {}) {
  return {
    id: 1,
    rowCount: 0,
    sessionKey: 9839,
    sql: "SELECT * FROM raw.car_data WHERE session_key = 9839 AND lap_number = 30",
    answer: "No rows matched.",
    ...overrides
  };
}

const SNAPSHOT_FULL = {
  "9839": {
    "raw.car_data": 12345,
    "raw.location": 9876,
    "raw.laps": 1500,
    "raw.weather": 200,
    "raw.overtakes": 12
  },
  "9840": {
    "raw.car_data": 0, // proven-empty session
    "raw.location": 0,
    "raw.laps": 0,
    "raw.weather": 0,
    "raw.overtakes": 0
  }
};

test("(a) clean SQL with WHERE session_key = 9840 + snapshot reports 0 rows → proven_data_unavailable", () => {
  const item = makeItem({
    sql: "SELECT * FROM raw.car_data WHERE session_key = 9840 AND lap_number = 30",
    sessionKey: 9839 // intentionally different — WHERE-clause path #1 should win
  });
  const v = classifyZeroRowOutcome(item, SNAPSHOT_FULL);
  assert.equal(v, "proven_data_unavailable");
});

test("(b) clean SQL with no session_key literal, item.sessionKey fallback resolves 0 rows → proven_data_unavailable", () => {
  const item = makeItem({
    sql: "SELECT * FROM raw.car_data WHERE lap_number = 30",
    sessionKey: 9840
  });
  const v = classifyZeroRowOutcome(item, SNAPSHOT_FULL);
  assert.equal(v, "proven_data_unavailable");
});

test("(c) clean SQL with multi-session WHERE IN (...) → unknown (fail-safe)", () => {
  const item = makeItem({
    sql: "SELECT * FROM raw.car_data WHERE session_key IN (9839, 9840) AND lap_number = 30"
  });
  const v = classifyZeroRowOutcome(item, SNAPSHOT_FULL);
  assert.equal(v, "unknown");
});

test("(d) clean SQL with no session_key literal AND no item.sessionKey → unknown", () => {
  const item = makeItem({
    sql: "SELECT * FROM raw.car_data WHERE lap_number = 30",
    sessionKey: null
  });
  const v = classifyZeroRowOutcome(item, SNAPSHOT_FULL);
  assert.equal(v, "unknown");
});

test("(e) snapshot reports populated upstream + tight literal filter and 0 rows → wrong_filter (stays C)", () => {
  const item = makeItem({
    sql: "SELECT * FROM raw.car_data WHERE session_key = 9839 AND lap_number = 30 AND driver_number = 1"
    // session 9839 has 12345 rows in raw.car_data per snapshot
  });
  const v = classifyZeroRowOutcome(item, SNAPSHOT_FULL);
  assert.equal(v, "wrong_filter");
});

test("(f) malformed SQL (sql empty / 'query not executed') → unknown", () => {
  const empty = classifyZeroRowOutcome(
    { id: 1, rowCount: 0, sql: "", sessionKey: 9839 },
    SNAPSHOT_FULL
  );
  assert.equal(empty, "unknown");

  const notExecuted = classifyZeroRowOutcome(
    {
      id: 1,
      rowCount: 0,
      sql: "-- query not executed (proprietary no-data refusal)",
      sessionKey: 9839
    },
    SNAPSHOT_FULL
  );
  assert.equal(notExecuted, "unknown");
});

test("(g) snapshot path missing/empty → classifier returns 'unknown' (fail-safe)", () => {
  const noSnapshot = classifyZeroRowOutcome(makeItem({ sessionKey: 9840 }), null);
  assert.equal(noSnapshot, "unknown");

  const emptyObj = classifyZeroRowOutcome(makeItem({ sessionKey: 9840 }), {});
  assert.equal(emptyObj, "unknown");
});

test("(h) rowCount > 0 → unknown (not a zero-row case)", () => {
  const item = makeItem({ rowCount: 5, sessionKey: 9840 });
  const v = classifyZeroRowOutcome(item, SNAPSHOT_FULL);
  assert.equal(v, "unknown");
});

test("gradeHealthCheckResults promotes C → B for proven_data_unavailable, leaves C for wrong_filter", () => {
  const items = [
    {
      id: 1001,
      category: "Test",
      question: "test question (proven unavailable)",
      sql: "SELECT * FROM raw.car_data WHERE session_key = 9840",
      rowCount: 0,
      sessionKey: 9840,
      answer: "No rows matched this question with the current context."
    },
    {
      id: 1002,
      category: "Test",
      question: "test question (wrong filter)",
      sql: "SELECT * FROM raw.car_data WHERE session_key = 9839 AND lap_number = 30",
      rowCount: 0,
      sessionKey: 9839,
      answer: "No rows matched this question with the current context."
    }
  ];
  const rubricById = new Map();
  const graded = gradeHealthCheckResults(items, rubricById, {
    completenessSnapshot: SNAPSHOT_FULL
  });
  assert.equal(graded[0].baselineGrade, "B", "proven_data_unavailable should promote C → B");
  assert.equal(graded[1].baselineGrade, "C", "wrong_filter should stay at C");
});

test("gradeHealthCheckResults without snapshot leaves C as C (fail-safe)", () => {
  const items = [
    {
      id: 1001,
      category: "Test",
      question: "test question",
      sql: "SELECT * FROM raw.car_data WHERE session_key = 9840",
      rowCount: 0,
      sessionKey: 9840,
      answer: "No rows matched this question with the current context."
    }
  ];
  const rubricById = new Map();
  const graded = gradeHealthCheckResults(items, rubricById /* no options */);
  assert.equal(graded[0].baselineGrade, "C", "no snapshot → no promotion");
});

test("DB-free guarantee: chat-health-check-baseline.mjs imports no DB driver", async () => {
  // Read the source and assert no `pg` / `psycopg2` / `@neondatabase`
  // imports. If a future refactor adds DB I/O to the grader, this
  // test fails.
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(baselinePath, "utf8");
  assert.ok(!/from\s+["']pg["']/.test(src), "grader must not import pg");
  assert.ok(!/from\s+["']@neondatabase/.test(src), "grader must not import @neondatabase");
  assert.ok(!/require\(\s*["']pg["']/.test(src), "grader must not require pg");
});
