import type { FactContractGrain, FactContractRow } from "./factContract";
import { serializeRowsToFactContract } from "./factContract";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// (a) FactContractGrain exact-union equality.
type _GrainExact = Expect<
  Equal<FactContractGrain, "session" | "lap" | "stint" | "driver" | "meeting" | "other">
>;

// (b) FactContractRow rejects non-JSON-serializable value kinds.
// @ts-expect-error — bigint is not assignable to FactContractValue
const _badBigint: FactContractRow = { v: 1n };
// @ts-expect-error — undefined is not assignable to FactContractValue
const _badUndefined: FactContractRow = { v: undefined };
// @ts-expect-error — function values are not assignable to FactContractValue
const _badFunction: FactContractRow = { v: () => 0 };
// @ts-expect-error — symbol is not assignable to FactContractValue
const _badSymbol: FactContractRow = { v: Symbol("x") };

// (c) Nested readonly surfaces reject mutation.
const _result = serializeRowsToFactContract({
  contractName: "core.test",
  grain: "session",
  keys: { session_key: 1 },
  rows: [{ a: 1 }],
});
// @ts-expect-error — keys entries are readonly via Readonly<Record<string, ...>>
_result.keys.session_key = 2;
// @ts-expect-error — rows is ReadonlyArray<FactContractRow>; push is not in its interface
_result.rows.push({ a: 2 });

export {};
