import { sql } from "../db";

// @ts-expect-error sql() requires (text: string, values?: unknown[]); a QueryConfig object is not assignable to string.
void sql({ text: "SELECT 1", values: [], name: "foo" });

export {};
