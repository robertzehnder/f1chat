// Phase 18-B: validate flushTrace's forceFlush + idempotent dedupe contract.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

async function loadPerfTrace(envOverrides = {}) {
  // Build a fresh module per test so the in-memory dedupe Set is empty.
  const dir = await mkdtemp(path.join(__dirname, ".tmp-flushtrace-"));
  const src = await readFile(path.resolve(webRoot, "src/lib/perfTrace.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  await writeFile(path.join(dir, "perfTrace.mjs"), out, "utf8");
  // Snapshot/restore env so tests don't leak.
  const before = {};
  for (const k of Object.keys(envOverrides)) before[k] = process.env[k];
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Per-test trace dir so appendFile lands somewhere we can inspect.
  process.env.OPENF1_WEB_LOG_DIR = dir;
  const mod = await import(path.join(dir, "perfTrace.mjs"));
  return {
    mod,
    dir,
    cleanup: async () => {
      for (const k of Object.keys(envOverrides)) {
        if (before[k] === undefined) delete process.env[k];
        else process.env[k] = before[k];
      }
      delete process.env.OPENF1_WEB_LOG_DIR;
      await rm(dir, { recursive: true, force: true });
    }
  };
}

const SAMPLE_SPANS = [
  { name: "total", startedAt: 0, elapsedMs: 100 }
];

test("default sampling off: flushTrace returns false, file not written", async () => {
  const { mod, dir, cleanup } = await loadPerfTrace({
    OPENF1_CHAT_DEBUG_TRACE: undefined,
    OPENF1_PERFTRACE_SAMPLE_RATE: undefined
  });
  try {
    const ok = await mod.flushTrace("req-1", SAMPLE_SPANS);
    assert.equal(ok, false);
    let contents = "";
    try {
      contents = await readFile(path.join(dir, "chat_query_trace.jsonl"), "utf8");
    } catch {
      contents = "";
    }
    assert.equal(contents, "");
  } finally {
    await cleanup();
  }
});

test("forceFlush=true bypasses sampling and appends", async () => {
  const { mod, dir, cleanup } = await loadPerfTrace({
    OPENF1_CHAT_DEBUG_TRACE: undefined,
    OPENF1_PERFTRACE_SAMPLE_RATE: undefined
  });
  try {
    const ok = await mod.flushTrace("req-2", SAMPLE_SPANS, { forceFlush: true });
    assert.equal(ok, true);
    const contents = await readFile(path.join(dir, "chat_query_trace.jsonl"), "utf8");
    assert.match(contents, /"requestId":"req-2"/);
    assert.match(contents, /"spans":\[/);
  } finally {
    await cleanup();
  }
});

test("OPENF1_PERFTRACE_SAMPLE_RATE=1 lets sampling pass", async () => {
  const { mod, dir, cleanup } = await loadPerfTrace({
    OPENF1_CHAT_DEBUG_TRACE: undefined,
    OPENF1_PERFTRACE_SAMPLE_RATE: "1"
  });
  try {
    const ok = await mod.flushTrace("req-3", SAMPLE_SPANS);
    assert.equal(ok, true);
    const contents = await readFile(path.join(dir, "chat_query_trace.jsonl"), "utf8");
    assert.match(contents, /"requestId":"req-3"/);
  } finally {
    await cleanup();
  }
});

test("idempotent dedupe: two flushes for same requestId append once", async () => {
  const { mod, dir, cleanup } = await loadPerfTrace({
    OPENF1_CHAT_DEBUG_TRACE: undefined,
    OPENF1_PERFTRACE_SAMPLE_RATE: undefined
  });
  try {
    const a = await mod.flushTrace("req-4", SAMPLE_SPANS, { forceFlush: true });
    const b = await mod.flushTrace("req-4", SAMPLE_SPANS, { forceFlush: true });
    assert.equal(a, true);
    assert.equal(b, false);
    const contents = await readFile(path.join(dir, "chat_query_trace.jsonl"), "utf8");
    const lines = contents.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "expected exactly one appended line");
  } finally {
    await cleanup();
  }
});

test("write error leaves dedupe Set unmarked so retry is allowed", async () => {
  const { mod, dir, cleanup } = await loadPerfTrace({
    OPENF1_CHAT_DEBUG_TRACE: undefined,
    OPENF1_PERFTRACE_SAMPLE_RATE: undefined
  });
  try {
    // Make the trace file path unwritable on first attempt: point env at a
    // path whose parent we'll create as a regular file (mkdir will fail).
    const blockedParent = path.join(dir, "blocker");
    await writeFile(blockedParent, "x", "utf8");
    process.env.OPENF1_WEB_LOG_DIR = path.join(blockedParent, "deeper");
    const a = await mod.flushTrace("req-5", SAMPLE_SPANS, { forceFlush: true });
    assert.equal(a, false, "first attempt should fail with caught FS error");
    // Now restore a writable dir and retry — should succeed (Set stayed unmarked).
    process.env.OPENF1_WEB_LOG_DIR = dir;
    const b = await mod.flushTrace("req-5", SAMPLE_SPANS, { forceFlush: true });
    assert.equal(b, true, "retry must succeed because dedupe Set was not marked on prior error");
  } finally {
    await cleanup();
  }
});
