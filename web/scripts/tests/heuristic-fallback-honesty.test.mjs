// F01/F07 (golden-set audit 2026-07-02): buildHeuristicSql must be
// context-first — never a context-free recent-sessions dump, never a
// single-driver read on a two-driver question, and NO catch-all default
// (return null so orchestration takes the honest-failure path).
//
// buildHeuristicSql is a pure string function but lives in queries.ts,
// which imports the pg driver. We slice the function source out and
// transpile it standalone so importing the test doesn't open a DB pool.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function loadFn() {
  const src = await readFile(path.resolve(webRoot, "src/lib/queries.ts"), "utf8");
  const start = src.indexOf("export function buildHeuristicSql");
  assert.ok(start >= 0, "buildHeuristicSql not found in queries.ts");
  // The signature has an inline type object `context?: { ... }`, so the
  // body brace is the first `{` encountered at paren-depth 0 AFTER the
  // parameter list `)` has closed. Track paren depth to find it.
  let parenDepth = 0;
  let seenParams = false;
  let braceStart = -1;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") {
      parenDepth += 1;
      seenParams = true;
    } else if (ch === ")") {
      parenDepth -= 1;
    } else if (ch === "{" && parenDepth === 0 && seenParams) {
      braceStart = i;
      break;
    }
  }
  assert.ok(braceStart > start, "could not locate function body brace");
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end > start, "could not slice buildHeuristicSql body");
  const fnSource = src.slice(start, end);
  const js = ts.transpileModule(fnSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const dir = await mkdtemp(path.join(__dirname, ".tmp-heuristic-"));
  const file = path.join(dir, "fn.mjs");
  await writeFile(file, js, "utf8");
  const mod = await import(file);
  return { fn: mod.buildHeuristicSql, dir };
}

test("no topical match → returns null (no recent-sessions catch-all)", async () => {
  const { fn, dir } = await loadFn();
  try {
    assert.equal(fn("show sector dominance between norris and piastri", { sessionKey: 9939 }), null);
    assert.equal(fn("what is the meaning of life", { sessionKey: 9939 }), null);
    // No sessionKey → never a global query.
    assert.equal(fn("show the fastest lap", {}), null);
    assert.equal(fn("show the fastest lap", undefined), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two-driver lap/pace question includes BOTH drivers", async () => {
  const { fn, dir } = await loadFn();
  try {
    const sql = fn("compare the lap pace of norris and piastri", { sessionKey: 9939, driverNumbers: [4, 81] });
    assert.ok(sql, "should produce SQL");
    assert.match(sql, /driver_number IN \(4, 81\)/);
    assert.match(sql, /GROUP BY driver_number, lap_number/, "must dedup the 2x-duplicate laps_enriched view");
    assert.match(sql, /session_key = 9939/);
    assert.match(sql, /AS location/, "must project venue columns for verification");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fastest question keeps the asked driver in the leaderboard", async () => {
  const { fn, dir } = await loadFn();
  try {
    const sql = fn("where was ocon fastest", { sessionKey: 9955, driverNumbers: [31] });
    assert.ok(sql);
    assert.match(sql, /r\.driver_number IN \(31\)/, "asked driver unioned into the top-5 leaderboard");
    assert.match(sql, /session_key = 9955/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("output contains no statement separators or banned keywords", async () => {
  const { fn, dir } = await loadFn();
  const BANNED = /\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|vacuum|analyze|refresh|call|do)\b/i;
  try {
    for (const sql of [
      fn("compare lap pace of a and b", { sessionKey: 9939, driverNumbers: [4, 81] }),
      fn("show the fastest lap", { sessionKey: 9939, driverNumbers: [4] }),
      fn("show the field lap times", { sessionKey: 9939 })
    ]) {
      assert.ok(sql);
      assert.ok(!sql.includes(";"), "no statement separator");
      assert.ok(!BANNED.test(sql), "no banned keyword");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
