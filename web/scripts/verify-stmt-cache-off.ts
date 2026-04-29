import { sql, pool } from "../src/lib/db.js";

async function main(): Promise<void> {
  const N = 20;
  const indices = Array.from({ length: N }, (_, i) => i);

  const rowsPerCall = await Promise.all(
    indices.map((i) => sql<{ x: number }>("SELECT $1::int AS x", [i]))
  );

  for (let i = 0; i < N; i += 1) {
    const rows = rowsPerCall[i];
    if (rows.length !== 1) {
      throw new Error(`call ${i}: expected 1 row, got ${rows.length}`);
    }
    if (rows[0].x !== i) {
      throw new Error(`call ${i}: expected x=${i}, got x=${rows[0].x}`);
    }
  }

  console.log(`stmt-cache-off verifier: ${N} parallel sql() calls succeeded`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("stmt-cache-off verifier failed:", err);
    try {
      await pool.end();
    } catch {
      // ignore
    }
    process.exit(1);
  });
