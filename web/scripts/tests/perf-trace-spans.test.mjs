import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const perfTraceSourcePath = path.resolve(webRoot, "src/lib/perfTrace.ts");
const chatRuntimeSourcePath = path.resolve(webRoot, "src/lib/chatRuntime.ts");

async function transpileAndImportPerfTrace() {
  const sourceText = await readFile(perfTraceSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-perftrace-spans-"));
  const outFile = path.join(dir, "perfTrace.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

function findFinallyBlock(source, fromIndex) {
  const finallyIndex = source.indexOf("finally", fromIndex);
  if (finallyIndex === -1) return null;
  const braceOpen = source.indexOf("{", finallyIndex);
  if (braceOpen === -1) return null;
  let depth = 1;
  for (let i = braceOpen + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { start: braceOpen, end: i, body: source.slice(braceOpen + 1, i) };
      }
    }
  }
  return null;
}

test("chatRuntime.ts has sequential, error-safe runtime_classify and resolve_db spans", async () => {
  const source = await readFile(chatRuntimeSourcePath, "utf8");

  const classifyStartMatch = /startSpan\(\s*["']runtime_classify["']\s*\)/.exec(source);
  assert.ok(
    classifyStartMatch,
    "chatRuntime.ts must contain startSpan(\"runtime_classify\")"
  );
  const resolveStartMatch = /startSpan\(\s*["']resolve_db["']\s*\)/.exec(source);
  assert.ok(
    resolveStartMatch,
    "chatRuntime.ts must contain startSpan(\"resolve_db\")"
  );

  const classifyStartIndex = classifyStartMatch.index;
  const resolveStartIndex = resolveStartMatch.index;

  const classifyEndMatch = /classifySpan\.end\(\s*\)/.exec(source.slice(classifyStartIndex));
  assert.ok(
    classifyEndMatch,
    "chatRuntime.ts must call classifySpan.end() after starting the runtime_classify span"
  );
  const classifyEndAbsoluteIndex = classifyStartIndex + classifyEndMatch.index;

  const classifyBlock = source.slice(classifyStartIndex, classifyEndAbsoluteIndex);
  assert.ok(
    !/\bawait\b/.test(classifyBlock),
    "the runtime_classify block must not contain `await` (classifyQuestion is synchronous)"
  );

  assert.ok(
    classifyEndAbsoluteIndex < resolveStartIndex,
    `runtime_classify .end() (index ${classifyEndAbsoluteIndex}) must precede resolve_db startSpan( (index ${resolveStartIndex}) — spans must be sequential and non-overlapping`
  );

  const classifyFinally = findFinallyBlock(source, classifyStartIndex);
  assert.ok(classifyFinally, "runtime_classify span must be followed by a finally block");
  assert.ok(
    classifyFinally.end < resolveStartIndex,
    "runtime_classify finally block must close before resolve_db startSpan"
  );
  assert.match(
    classifyFinally.body,
    /recordSpan\??\.?\(\s*classifySpan\.end\(\s*\)\s*\)/,
    "runtime_classify finally must invoke recordSpan?.(classifySpan.end())"
  );

  const resolveFinally = findFinallyBlock(source, resolveStartIndex);
  assert.ok(resolveFinally, "resolve_db span must be followed by a finally block");
  assert.match(
    resolveFinally.body,
    /recordSpan\??\.?\(\s*resolveDbSpan\.end\(\s*\)\s*\)/,
    "resolve_db finally must invoke recordSpan?.(resolveDbSpan.end())"
  );

  assert.match(
    source,
    /recordSpan\??:\s*\(record:\s*SpanRecord\)\s*=>\s*void/,
    "buildChatRuntime must accept a recordSpan: (record: SpanRecord) => void parameter"
  );
});

test("perfTrace span pattern is sequential and error-safe via recordSpan callback", async () => {
  let importResult = null;
  try {
    importResult = await transpileAndImportPerfTrace();
    const { startSpan } = importResult.mod;

    async function simulateRuntime(recordSpan, { rejectOnDb }) {
      const classifySpan = startSpan("runtime_classify");
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
      } finally {
        recordSpan(classifySpan.end());
      }

      const resolveDbSpan = startSpan("resolve_db");
      try {
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (rejectOnDb) {
          throw new Error("simulated DB resolution failure");
        }
      } finally {
        recordSpan(resolveDbSpan.end());
      }
    }

    const happyRecords = [];
    await simulateRuntime(happyRecords.push.bind(happyRecords), { rejectOnDb: false });
    assert.equal(happyRecords.length, 2, "happy path must record both spans");
    assert.equal(happyRecords[0].name, "runtime_classify");
    assert.equal(happyRecords[1].name, "resolve_db");
    assert.ok(
      happyRecords[0].elapsedMs < 50,
      `runtime_classify.elapsedMs must be < 50, got ${happyRecords[0].elapsedMs}`
    );
    assert.ok(
      happyRecords[1].elapsedMs >= 5 * happyRecords[0].elapsedMs,
      `resolve_db.elapsedMs (${happyRecords[1].elapsedMs}) must be >= 5x runtime_classify.elapsedMs (${happyRecords[0].elapsedMs})`
    );

    const errorRecords = [];
    await assert.rejects(
      simulateRuntime(errorRecords.push.bind(errorRecords), { rejectOnDb: true }),
      /simulated DB resolution failure/
    );
    const errorNames = errorRecords.map((r) => r.name);
    assert.ok(
      errorNames.includes("runtime_classify"),
      `error path must record runtime_classify (got ${JSON.stringify(errorNames)})`
    );
    assert.ok(
      errorNames.includes("resolve_db"),
      `error path must record resolve_db before propagating (got ${JSON.stringify(errorNames)})`
    );
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
