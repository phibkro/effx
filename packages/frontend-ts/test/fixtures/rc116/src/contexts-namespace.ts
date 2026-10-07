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

  /** A namespace-owned value referenced through `typeof`. */
  export const defaults = { maxBodyBytes: 4096 };

  /** A namespace-owned class whose public static property is referenced through `typeof`. */
  export class Defaults {
    static readonly value = { maxBodyBytes: 2048 };
  }
}

export const defaults = { maxBodyBytes: 4096 } as const;
