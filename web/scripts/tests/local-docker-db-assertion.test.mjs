// Neutralize Step 2's module-load `assertPooledDatabaseUrl(process.env)` and
// `assertLocalDockerDb(process.env)` calls BEFORE importing the transpiled db.ts.
// Set NODE_ENV=test and clear every *_DATABASE_URL / *_DB_* variable so both
// module-level invocations are no-ops and createPool() does not pick up ambient creds.
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

async function loadAssertLocalDockerDb() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-local-docker-"));
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

const ALLOWED_HOSTS = ["127.0.0.1", "localhost", "::1", "db", "postgres"];
const POOLER_URL =
  "postgres://USER:PASS@ep-foo-bar-pooler.us-east-2.aws.neon.tech:6543/openf1?sslmode=require";

let cachedModule;
async function getAssert() {
  if (!cachedModule) {
    cachedModule = await loadAssertLocalDockerDb();
  }
  return cachedModule.mod.assertLocalDockerDb;
}

function assertMessageNamesHostAndAllowedSet(err, offendingHost) {
  const msg = String(err?.message ?? err);
  assert.ok(
    msg.includes(offendingHost),
    `error message must contain offending host '${offendingHost}', got: ${msg}`
  );
  for (const allowed of ALLOWED_HOSTS) {
    assert.ok(
      msg.includes(allowed),
      `error message must contain allowed host '${allowed}', got: ${msg}`
    );
  }
}

test.after(async () => {
  if (cachedModule) {
    await rm(cachedModule.dir, { recursive: true, force: true });
  }
});

test("THROWS in dev when DB_HOST is a remote host and no Neon URL/host is set", async () => {
  const assertLocalDockerDb = await getAssert();
  let caught;
  try {
    assertLocalDockerDb({ NODE_ENV: "development", DB_HOST: "db.example.com" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected assertLocalDockerDb to throw");
  assertMessageNamesHostAndAllowedSet(caught, "db.example.com");
});

test("does NOT throw for each allowed host (127.0.0.1, localhost, ::1, db, postgres)", async () => {
  const assertLocalDockerDb = await getAssert();
  for (const host of ALLOWED_HOSTS) {
    assert.doesNotThrow(
      () => assertLocalDockerDb({ NODE_ENV: "development", DB_HOST: host }),
      `should not throw for allowed host '${host}'`
    );
  }
});

test("does NOT throw when NODE_ENV=production regardless of DB_HOST", async () => {
  const assertLocalDockerDb = await getAssert();
  assert.doesNotThrow(() =>
    assertLocalDockerDb({ NODE_ENV: "production", DB_HOST: "db.example.com" })
  );
});

test("does NOT throw when NEON_DATABASE_URL is set even with otherwise-invalid DB_HOST (Neon-URL branch wins)", async () => {
  const assertLocalDockerDb = await getAssert();
  assert.doesNotThrow(() =>
    assertLocalDockerDb({
      NODE_ENV: "development",
      NEON_DATABASE_URL: POOLER_URL,
      DB_HOST: "db.example.com"
    })
  );
});

test("does NOT throw when DATABASE_URL is set even with otherwise-invalid DB_HOST (generic-URL branch wins)", async () => {
  const assertLocalDockerDb = await getAssert();
  assert.doesNotThrow(() =>
    assertLocalDockerDb({
      NODE_ENV: "development",
      DATABASE_URL: POOLER_URL,
      DB_HOST: "db.example.com"
    })
  );
});

test("does NOT throw when NEON_DB_HOST is set even with otherwise-invalid DB_HOST (Neon-host branch wins)", async () => {
  const assertLocalDockerDb = await getAssert();
  assert.doesNotThrow(() =>
    assertLocalDockerDb({
      NODE_ENV: "development",
      NEON_DB_HOST: "ep-foo.us-east-2.aws.neon.tech",
      DB_HOST: "db.example.com"
    })
  );
});

test("does NOT throw when DB_HOST is unset (defaults to 127.0.0.1)", async () => {
  const assertLocalDockerDb = await getAssert();
  assert.doesNotThrow(() => assertLocalDockerDb({ NODE_ENV: "development" }));
});

test("THROWS when NEON_DATABASE_URL is whitespace-only and DB_HOST is remote (whitespace must NOT bypass)", async () => {
  const assertLocalDockerDb = await getAssert();
  let caught;
  try {
    assertLocalDockerDb({
      NODE_ENV: "development",
      NEON_DATABASE_URL: "   ",
      DB_HOST: "db.example.com"
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected assertLocalDockerDb to throw on whitespace-only NEON_DATABASE_URL");
  assertMessageNamesHostAndAllowedSet(caught, "db.example.com");
});

test("THROWS when DATABASE_URL is whitespace-only and DB_HOST is remote (whitespace must NOT bypass)", async () => {
  const assertLocalDockerDb = await getAssert();
  let caught;
  try {
    assertLocalDockerDb({
      NODE_ENV: "development",
      DATABASE_URL: "\t",
      DB_HOST: "db.example.com"
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected assertLocalDockerDb to throw on whitespace-only DATABASE_URL");
  assertMessageNamesHostAndAllowedSet(caught, "db.example.com");
});

test("THROWS when NEON_DB_HOST is whitespace-only and DB_HOST is remote (whitespace must NOT bypass)", async () => {
  const assertLocalDockerDb = await getAssert();
  let caught;
  try {
    assertLocalDockerDb({
      NODE_ENV: "development",
      NEON_DB_HOST: "   ",
      DB_HOST: "db.example.com"
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected assertLocalDockerDb to throw on whitespace-only NEON_DB_HOST");
  assertMessageNamesHostAndAllowedSet(caught, "db.example.com");
});
