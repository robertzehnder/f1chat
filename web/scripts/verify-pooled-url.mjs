// Pre-merge staging verification harness for slice 06-pooled-url-assertion.
//
// Loads `assertPooledDatabaseUrl` from `web/src/lib/db.ts` using the same in-process
// `typescript` transpile pattern as the unit test, then invokes it against the real
// process.env. Per the slice's Step 4 module-load interaction note, the import itself
// runs `assertPooledDatabaseUrl(process.env)` before `createPool()`, so a direct-URL
// fixture may already throw at import time. That throw must propagate (or be surfaced
// as a non-zero exit with the assertion message intact). For pooler-URL fixtures the
// module-load assertion passes and `createPool()` constructs a lazy `pg.Pool` (no TCP
// connection); the harness must NOT call pool.query / pool.connect / pool.end.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");
const dbSourcePath = path.resolve(webRoot, "src/lib/db.ts");

async function loadDbModule() {
  // Write the transpiled module under web/scripts/ so Node's resolver can
  // walk up to web/node_modules and find the real `pg` package.
  const dir = await mkdtemp(path.join(__dirname, ".tmp-verify-pooled-url-"));
  const dbSrc = await readFile(dbSourcePath, "utf8");
  const transpiled = ts.transpileModule(dbSrc, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "db.mjs"), transpiled.outputText, "utf8");
  return import(path.join(dir, "db.mjs"));
}

const mod = await loadDbModule();
mod.assertPooledDatabaseUrl(process.env);
console.log("OK: pooler url accepted");
