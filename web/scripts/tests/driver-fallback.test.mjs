import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");

const driverSourcePath = path.resolve(webRoot, "src/lib/db/driver.ts");
const queriesSourcePath = path.resolve(webRoot, "src/lib/queries.ts");
const querySafetySourcePath = path.resolve(webRoot, "src/lib/querySafety.ts");

const TS_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true
};

async function compileBundle() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-driver-fallback-"));

  const compile = async (srcPath, outName, transform) => {
    let src = await readFile(srcPath, "utf8");
    if (transform) src = transform(src);
    const out = ts.transpileModule(src, { compilerOptions: TS_OPTIONS });
    await writeFile(path.join(dir, outName), out.outputText, "utf8");
  };

  await compile(driverSourcePath, "driver.mjs");
  await compile(querySafetySourcePath, "querySafety.mjs");
  await compile(queriesSourcePath, "queries.mjs", (src) =>
    src
      .replace(/from\s+["']\.\/db["']/g, `from "./driver.mjs"`)
      .replace(/from\s+["']\.\/querySafety["']/g, `from "./querySafety.mjs"`)
      .replace(/from\s+["']\.\/types["']/g, `from "./types.mjs"`)
  );
  await writeFile(path.join(dir, "types.mjs"), "export {};\n", "utf8");

  return dir;
}

function buildBaseEnv() {
  const passthrough = new Set([
    "PATH",
    "HOME",
    "TMPDIR",
    "USER",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "NODE",
    "NODE_PATH",
    "NVM_DIR",
    "NVM_BIN",
    "SHELL"
  ]);
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (passthrough.has(key)) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function runChild(scriptPath, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: webRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function runCase(dir, caseName, env, body) {
  const scriptPath = path.join(dir, `case-${caseName}.mjs`);
  await writeFile(scriptPath, body, "utf8");
  return runChild(scriptPath, env);
}

const driverModulePath = (dir) =>
  JSON.stringify(path.join(dir, "driver.mjs"));
const queriesModulePath = (dir) =>
  JSON.stringify(path.join(dir, "queries.mjs"));

const fallbackBody = (dir) => `
import { sql, chooseDriver, pool } from ${driverModulePath(dir)};
import { runReadOnlySql } from ${queriesModulePath(dir)};

const drv = await chooseDriver();
if (drv.kind !== "pglite") {
  console.error("Expected pglite driver, got " + drv.kind);
  process.exit(1);
}

const drivers = await sql("SELECT driver_number, full_name FROM core.driver");
if (!Array.isArray(drivers) || drivers.length < 1) {
  console.error("core.driver returned no rows");
  process.exit(1);
}
if (drivers[0].driver_number == null || !drivers[0].full_name) {
  console.error("core.driver row missing driver_number/full_name");
  process.exit(1);
}

const replays = await sql("SELECT * FROM contract.replay_contract_registry");
if (!Array.isArray(replays) || replays.length < 1) {
  console.error("contract.replay_contract_registry returned no rows");
  process.exit(1);
}

const pitRows = await sql("SELECT * FROM contract.pit_cycle_summary");
const phaseRows = await sql("SELECT * FROM contract.lap_phase_summary");
if (pitRows.length < 1 && phaseRows.length < 1) {
  console.error("Neither pit_cycle_summary nor lap_phase_summary returned rows");
  process.exit(1);
}

const ro = await runReadOnlySql("SELECT driver_number FROM core.driver", { maxRows: 5 });
if (!ro || ro.rowCount < 1) {
  console.error("runReadOnlySql under pglite returned no rows");
  process.exit(1);
}

console.log("OK");
process.exit(0);
`;

const optOutBody = (dir) => `
import { sql, chooseDriver, pool } from ${driverModulePath(dir)};

let threw = false;
let captured = null;
try {
  await sql("SELECT 1");
} catch (err) {
  threw = true;
  captured = err;
}
if (!threw) {
  console.error("Expected sql('SELECT 1') to reject (opt-out, unreachable DB)");
  process.exit(1);
}
const message = captured && captured.message ? captured.message : String(captured);
if (!/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|terminat|connect/i.test(message)) {
  console.error("Unexpected error message: " + message);
  process.exit(1);
}

const drv = await chooseDriver();
if (drv.kind !== "neon") {
  console.error("Expected neon driver kind on opt-out, got " + drv.kind);
  process.exit(1);
}
if (drv.pool !== pool) {
  console.error("Pool identity mismatch: chooseDriver().pool is not the singleton pool");
  process.exit(1);
}

console.log("OK");
process.exit(0);
`;

const productionBody = (dir) => `
import { sql, chooseDriver } from ${driverModulePath(dir)};

let threw = false;
let captured = null;
try {
  await sql("SELECT 1");
} catch (err) {
  threw = true;
  captured = err;
}
if (!threw) {
  console.error("Expected sql('SELECT 1') to reject in production with unreachable DB");
  process.exit(1);
}
const message = captured && captured.message ? captured.message : String(captured);
if (!/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|terminat|connect/i.test(message)) {
  console.error("Unexpected error message: " + message);
  process.exit(1);
}

const drv = await chooseDriver();
if (drv.kind !== "neon") {
  console.error("Production must keep neon driver, got " + drv.kind);
  process.exit(1);
}

console.log("OK");
process.exit(0);
`;

const FALLBACK_LOG_REGEX = /\[db\] using local PGlite fallback/;

let bundleDir;

test.before(async () => {
  bundleDir = await compileBundle();
});

test.after(async () => {
  if (bundleDir) {
    await rm(bundleDir, { recursive: true, force: true });
  }
});

test("Case A: DB_*-branch probe-failure + opt-in engages PGlite", async () => {
  const env = {
    ...buildBaseEnv(),
    NODE_ENV: "test",
    OPENF1_LOCAL_FALLBACK: "1",
    DB_HOST: "127.0.0.1",
    DB_PORT: "1",
    DB_USER: "x",
    DB_PASSWORD: "x",
    DB_NAME: "x"
  };
  const result = await runCase(bundleDir, "A", env, fallbackBody(bundleDir));
  assert.equal(
    result.code,
    0,
    `Case A failed (code=${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(
    result.stderr,
    FALLBACK_LOG_REGEX,
    `Case A: fallback log line missing\nstderr:\n${result.stderr}`
  );
});

test("Case B: DATABASE_URL unreachable + opt-in engages PGlite", async () => {
  const env = {
    ...buildBaseEnv(),
    NODE_ENV: "test",
    OPENF1_LOCAL_FALLBACK: "1",
    DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/none"
  };
  const result = await runCase(bundleDir, "B", env, fallbackBody(bundleDir));
  assert.equal(
    result.code,
    0,
    `Case B failed (code=${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(
    result.stderr,
    FALLBACK_LOG_REGEX,
    `Case B: fallback log line missing\nstderr:\n${result.stderr}`
  );
});

test("Case C: DATABASE_URL unreachable + opt-out preserves lazy-failure", async () => {
  const env = {
    ...buildBaseEnv(),
    NODE_ENV: "test",
    DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/none"
  };
  const result = await runCase(bundleDir, "C", env, optOutBody(bundleDir));
  assert.equal(
    result.code,
    0,
    `Case C failed (code=${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.doesNotMatch(
    result.stderr,
    FALLBACK_LOG_REGEX,
    `Case C: fallback log line must NOT be emitted in opt-out mode\nstderr:\n${result.stderr}`
  );
});

test("Case D: production guard refuses PGlite even with OPENF1_LOCAL_FALLBACK=1", async () => {
  const env = {
    ...buildBaseEnv(),
    NODE_ENV: "production",
    OPENF1_LOCAL_FALLBACK: "1",
    DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/none"
  };
  const result = await runCase(bundleDir, "D", env, productionBody(bundleDir));
  assert.equal(
    result.code,
    0,
    `Case D failed (code=${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.doesNotMatch(
    result.stderr,
    FALLBACK_LOG_REGEX,
    `Case D: fallback log line must NOT be emitted in production\nstderr:\n${result.stderr}`
  );
});

test("Case E: NEON_DB_HOST unreachable + opt-in engages PGlite", async () => {
  const env = {
    ...buildBaseEnv(),
    NODE_ENV: "test",
    OPENF1_LOCAL_FALLBACK: "1",
    NEON_DB_HOST: "127.0.0.1",
    NEON_DB_PORT: "1",
    NEON_DB_USER: "x",
    NEON_DB_PASSWORD: "x",
    NEON_DB_NAME: "x"
  };
  const result = await runCase(bundleDir, "E", env, fallbackBody(bundleDir));
  assert.equal(
    result.code,
    0,
    `Case E failed (code=${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(
    result.stderr,
    FALLBACK_LOG_REGEX,
    `Case E: fallback log line missing\nstderr:\n${result.stderr}`
  );
});

test("Case F: runReadOnlySql under PGlite returns rows (covered by A/B/E)", () => {
  // Co-located with Cases A, B, E above — each invokes runReadOnlySql via
  // fallbackBody and asserts it returns >=1 row. This sentinel test exists
  // so the slice's six numbered cases all surface in the test output.
  assert.ok(true);
});
