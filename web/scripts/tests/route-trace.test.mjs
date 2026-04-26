import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const routeSourcePath = path.resolve(webRoot, "src/app/api/chat/route.ts");

const STAGE_NAMES = [
  "request_intake",
  "runtime_classify",
  "resolve_db",
  "template_match",
  "sqlgen_llm",
  "execute_db",
  "repair_llm",
  "synthesize_llm",
  "sanity_check",
  "total"
];

test("chat route imports perfTrace, opens a finally block, and starts a span for every stage", async () => {
  const source = await readFile(routeSourcePath, "utf8");

  const importPattern = /import\s*\{[^}]*\b(?:startSpan|flushTrace)\b[^}]*\}\s*from\s*["']@\/lib\/perfTrace["']/;
  assert.match(
    source,
    importPattern,
    "route.ts must import startSpan/flushTrace from @/lib/perfTrace"
  );
  assert.ok(
    /\bstartSpan\b/.test(source.match(importPattern)?.[0] ?? "") &&
      /\bflushTrace\b/.test(source.match(importPattern)?.[0] ?? ""),
    "the @/lib/perfTrace import must include both startSpan and flushTrace"
  );

  for (const stage of STAGE_NAMES) {
    const stagePattern = new RegExp(`startSpan\\(\\s*["']${stage}["']\\s*\\)`);
    assert.match(
      source,
      stagePattern,
      `route.ts must contain at least one startSpan("${stage}") call site`
    );
  }

  assert.match(source, /\bflushTrace\s*\(/, "route.ts must call flushTrace(...)");

  assert.match(
    source,
    /\}\s*finally\s*\{/,
    "route.ts must contain at least one `} finally {` block so the trace flushes on every exit"
  );
});
