/** A namespace-owned type and a value used through `typeof`, both reachable from a mirrored clause. */
export namespace Contexts {
  export interface Options {
    readonly maxBodyBytes: number;
  }

  export namespace Nested {
    export interface Deep {
      readonly value: number;
    }
  }
}

export const defaults = { maxBodyBytes: 4096 } as const;
