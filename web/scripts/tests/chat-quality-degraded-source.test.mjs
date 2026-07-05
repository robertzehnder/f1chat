// F24 (golden-set audit 2026-07-02): assessChatQuality must NOT grade B
// when rowCount>0 comes from a degraded fallback source, or when the
// answer text itself declares it can't answer — that was how the P0
// fabricated-absence class shipped invisibly as grade-B responses.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

async function load() {
  const src = await readFile(path.resolve(webRoot, "src/lib/chatQuality.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const dir = await mkdtemp(path.join(__dirname, ".tmp-cq-"));
  const file = path.join(dir, "cq.mjs");
  await writeFile(file, js, "utf8");
  const mod = await import(file);
  return { assessChatQuality: mod.assessChatQuality, dir };
}

const base = (overrides = {}) => ({
  question: "How did Mercedes split strategies at Spa 2025?",
  answer: "Russell and Hamilton ran different tyre sequences.",
  generationSource: "deterministic_template",
  result: { rowCount: 6, truncated: false },
  runtime: null,
  error: null,
  ...overrides
});

test("normal deterministic success with rows still grades B", async () => {
  const { assessChatQuality, dir } = await load();
  try {
    assert.equal(assessChatQuality(base()).grade, "B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("degraded fallback source with rows grades C, not B", async () => {
  const { assessChatQuality, dir } = await load();
  try {
    for (const src of ["heuristic_after_template_failure", "heuristic_after_sql_timeout", "heuristic_fallback"]) {
      const r = assessChatQuality(base({ generationSource: src }));
      assert.equal(r.grade, "C", `${src} → C`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("answer that declares data absent grades C even with rows (the P0 shape)", async () => {
  const { assessChatQuality, dir } = await load();
  try {
    const r = assessChatQuality(
      base({
        answer:
          "The available data does not include a Spa 2025 session; the most recent Belgian GP appears to not be ingested."
      })
    );
    assert.equal(r.grade, "C");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
