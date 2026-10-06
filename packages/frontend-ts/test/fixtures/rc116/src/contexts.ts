/** Cross-module types referenced by generated generic clauses under their written local names. */
export interface Options {
  readonly maxBodyBytes: number;
}

export type RetryPolicy = number;

export interface SelfConstrained<C> {
  readonly value: C;
}
