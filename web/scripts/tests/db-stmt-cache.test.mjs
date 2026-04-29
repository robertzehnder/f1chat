import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dbSourceUrl = new URL("../../src/lib/db.ts", import.meta.url);
const queriesSourceUrl = new URL("../../src/lib/queries.ts", import.meta.url);

test("sql<T>() body in db.ts calls pool.query with name: undefined", () => {
  const source = readFileSync(dbSourceUrl, "utf8");

  const start = source.indexOf("export async function sql<");
  assert.notEqual(start, -1, "could not find sql<T>() declaration in db.ts");

  const openBrace = source.indexOf("{", start);
  assert.notEqual(openBrace, -1, "could not find opening brace of sql<T>() in db.ts");

  let depth = 0;
  let bodyEnd = -1;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  assert.ok(bodyEnd !== -1, "could not locate sql<T>() body in db.ts");

  const body = source.slice(openBrace, bodyEnd + 1);
  assert.match(
    body,
    /pool\.query<[^>]+>\(\s*\{[\s\S]*?name\s*:\s*undefined[\s\S]*?\}\s*\)/,
    "sql() must call pool.query with name: undefined"
  );
});

test("no .query(...) call in db.ts or queries.ts grows a non-undefined name", () => {
  const namedRegex = /\.query\([^)]*\bname\s*:\s*(?!undefined\b)/s;
  for (const fileUrl of [dbSourceUrl, queriesSourceUrl]) {
    const source = readFileSync(fileUrl, "utf8");
    assert.equal(
      source.match(namedRegex),
      null,
      `${fileUrl.pathname} introduces a named prepared statement`
    );
  }
});
