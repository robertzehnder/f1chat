// Neutralize Step 2's module-load `assertPooledDatabaseUrl(process.env)` call BEFORE importing the
// transpiled db.ts. Set NODE_ENV=test and clear every *_DATABASE_URL / *_DB_* variable so the
// module-level invocation is a no-op and createPool() does not pick up ambient credentials.
process.env.NODE_ENV = "test";
delete process.env.NEON_DATABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.NEON_DB_HOST;
delete process.env.NEON_DB_USER;
delete process.env.NEON_DB_PASSWORD;
delete process.env.NEON_DB_NAME;
delete process.env.NEON_DB_PORT;
delete process.env.DB_HOST;
delete process.env.DB_USER;
delete process.env.DB_PASSWORD;
delete process.env.DB_NAME;
delete process.env.DB_PORT;

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const dbSourcePath = path.resolve(webRoot, "src/lib/db.ts");

const PG_STUB = `
export class Pool {
  constructor(opts) { this.options = opts; }
  query() { throw new Error("pg.Pool.query stub: not connected"); }
  connect() { throw new Error("pg.Pool.connect stub: not connected"); }
  end() { return Promise.resolve(); }
}
`;

async function loadAssertPooledDatabaseUrl() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-pooled-url-"));
  const dbSrc = await readFile(dbSourcePath, "utf8");
  const stubbed = dbSrc.replace(/from\s+["']pg["']/g, `from "./pg.stub.mjs"`);
  const transpiled = ts.transpileModule(stubbed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "pg.stub.mjs"), PG_STUB, "utf8");
  await writeFile(path.join(dir, "db.mjs"), transpiled.outputText, "utf8");
  const mod = await import(path.join(dir, "db.mjs"));
  return { dir, mod };
}

const POOLER_URL =
  "postgres://USER:PASS@ep-foo-bar-pooler.us-east-2.aws.neon.tech:6543/openf1?sslmode=require";
const DIRECT_URL =
  "postgres://USER:PASS@ep-foo-bar.us-east-2.aws.neon.tech:5432/openf1?sslmode=require";
const POOLER_HOST_WRONG_PORT =
  "postgres://USER:PASS@ep-foo-bar-pooler.us-east-2.aws.neon.tech:5432/openf1?sslmode=require";
const RIGHT_PORT_NO_POOLER =
  "postgres://USER:PASS@ep-foo-bar.us-east-2.aws.neon.tech:6543/openf1?sslmode=require";

let cachedModule;
async function getAssert() {
  if (!cachedModule) {
    cachedModule = await loadAssertPooledDatabaseUrl();
  }
  return cachedModule.mod.assertPooledDatabaseUrl;
}

test.after(async () => {
  if (cachedModule) {
    await rm(cachedModule.dir, { recursive: true, force: true });
  }
});

test("THROWS in production for a direct Neon URL (host without -pooler, port 5432)", async () => {
  const assertPooledDatabaseUrl = await getAssert();
  assert.throws(
    () => assertPooledDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: DIRECT_URL }),
    /Neon pooler URL required/i
  );
});

test("THROWS in production for -pooler host but wrong port (5432)", async () => {
  const assertPooledDatabaseUrl = await getAssert();
  assert.throws(
    () =>
      assertPooledDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: POOLER_HOST_WRONG_PORT
      }),
    /Neon pooler URL required/i
  );
});

test("THROWS in production for port 6543 but host without -pooler", async () => {
  const assertPooledDatabaseUrl = await getAssert();
  assert.throws(
    () =>
      assertPooledDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: RIGHT_PORT_NO_POOLER }),
    /Neon pooler URL required/i
  );
});

test("does NOT throw in production for a valid Neon pooler URL (-pooler host AND port 6543)", async () => {
  const assertPooledDatabaseUrl = await getAssert();
  assert.doesNotThrow(() =>
    assertPooledDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: POOLER_URL })
  );
});

test("does NOT throw when NODE_ENV !== 'production' regardless of URL shape (development, test, unset)", async () => {
  const assertPooledDatabaseUrl = await getAssert();
  for (const nodeEnv of ["development", "test", undefined]) {
    const fixture = { DATABASE_URL: DIRECT_URL };
    if (nodeEnv !== undefined) {
      fixture.NODE_ENV = nodeEnv;
    }
    assert.doesNotThrow(
      () => assertPooledDatabaseUrl(fixture),
      `should not throw when NODE_ENV=${String(nodeEnv)} even with direct URL`
    );
  }
});

test("precedence: NEON_DATABASE_URL takes priority over DATABASE_URL — valid pooler in NEON_DATABASE_URL with conflicting direct DATABASE_URL must NOT throw", async () => {
  const assertPooledDatabaseUrl = await getAssert();
  assert.doesNotThrow(() =>
    assertPooledDatabaseUrl({
      NODE_ENV: "production",
      NEON_DATABASE_URL: POOLER_URL,
      DATABASE_URL: DIRECT_URL
    })
  );
});

test("precedence: NEON_DATABASE_URL takes priority over DATABASE_URL — direct in NEON_DATABASE_URL with valid pooler in DATABASE_URL MUST throw (DATABASE_URL must NOT silently override)", async () => {
  const assertPooledDatabaseUrl = await getAssert();
  assert.throws(
    () =>
      assertPooledDatabaseUrl({
        NODE_ENV: "production",
        NEON_DATABASE_URL: DIRECT_URL,
        DATABASE_URL: POOLER_URL
      }),
    /Neon pooler URL required/i
  );
});
