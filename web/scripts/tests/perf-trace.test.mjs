import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const perfTraceSourcePath = path.resolve(webRoot, "src/lib/perfTrace.ts");
const traceLogPath = path.resolve(webRoot, "logs/chat_query_trace.jsonl");

async function transpileAndImportPerfTrace() {
  const sourceText = await readFile(perfTraceSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-perftrace-"));
  const outFile = path.join(dir, "perfTrace.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

async function readFileOrNull(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

test("perfTrace records elapsed ms per span and flushTrace writes a structured JSON line", async () => {
  const originalContent = await readFileOrNull(traceLogPath);
  await mkdir(path.dirname(traceLogPath), { recursive: true });

  let importResult = null;
  try {
    importResult = await transpileAndImportPerfTrace();
    const { startSpan, flushTrace } = importResult.mod;

    assert.equal(typeof startSpan, "function", "startSpan must be a function");
    assert.equal(typeof flushTrace, "function", "flushTrace must be a function");

    const span = startSpan("request_intake");
    assert.equal(span.name, "request_intake");
    assert.equal(typeof span.startedAt, "number");
    assert.equal(typeof span.end, "function");

    const target = Date.now() + 3;
    while (Date.now() < target) {
      // busy-wait to ensure observable elapsed time across coarse clocks
    }

    const record = span.end();
    assert.equal(record.name, "request_intake");
    assert.equal(typeof record.startedAt, "number");
    assert.ok(record.elapsedMs > 0, `Expected elapsedMs > 0, got ${record.elapsedMs}`);

    const secondCall = span.end();
    assert.equal(secondCall.elapsedMs, record.elapsedMs, "Span.end() must be idempotent");

    assert.throws(() => startSpan("not_a_real_stage"), /unknown stage name/);

    const requestId = `perf-trace-test-${process.pid}-${Date.now()}`;
    await flushTrace(requestId, [record]);

    const after = await readFile(traceLogPath, "utf8");
    const baselineLength = originalContent === null ? 0 : originalContent.length;
    const tail = after.substring(baselineLength);
    const lines = tail.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 1, `Expected exactly one new trace line, got ${lines.length}`);

    const entry = JSON.parse(lines[0]);
    assert.equal(typeof entry.ts, "string");
    assert.ok(!Number.isNaN(Date.parse(entry.ts)), "entry.ts must be ISO-parsable");
    assert.equal(entry.requestId, requestId);
    assert.ok(Array.isArray(entry.spans));
    assert.equal(entry.spans.length, 1);
    assert.equal(entry.spans[0].name, "request_intake");
    assert.equal(typeof entry.spans[0].startedAt, "number");
    assert.ok(entry.spans[0].elapsedMs > 0);
  } finally {
    if (originalContent === null) {
      await rm(traceLogPath, { force: true });
    } else {
      await writeFile(traceLogPath, originalContent, "utf8");
    }
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
