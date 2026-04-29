export type FactContractGrain =
  | "session"
  | "lap"
  | "stint"
  | "driver"
  | "meeting"
  | "other";

export type FactContractScalar = string | number | boolean | null;

export type FactContractValue =
  | FactContractScalar
  | { readonly [key: string]: FactContractValue }
  | ReadonlyArray<FactContractValue>;

export type FactContractRow = { readonly [key: string]: FactContractValue };

export type FactContract = {
  contractName: string;
  grain: FactContractGrain;
  keys: Readonly<Record<string, string | number | null>>;
  rows: ReadonlyArray<FactContractRow>;
  rowCount: number;
  coverage?: { warnings: ReadonlyArray<string> };
};

export type SemanticContractSerializer<TInput> = (input: TInput) => FactContract;

/** Top-level Object.freeze only; nested keys/rows/coverage.warnings are not deep-frozen. */
export function serializeRowsToFactContract(input: {
  contractName: string;
  grain: FactContractGrain;
  keys: Readonly<Record<string, string | number | null>>;
  rows: ReadonlyArray<FactContractRow>;
  coverage?: { warnings: ReadonlyArray<string> };
}): FactContract {
  const result: FactContract = {
    contractName: input.contractName,
    grain: input.grain,
    keys: input.keys,
    rows: input.rows,
    rowCount: input.rows.length,
    ...(input.coverage !== undefined ? { coverage: input.coverage } : {}),
  };
  return Object.freeze(result);
}
