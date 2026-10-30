import { Context, Effect, Schema } from "effect";

/** The native boundary returns failures to the portable command, which emits diagnostics. */
export class AlloyExecutionError extends Schema.TaggedError<
  AlloyExecutionError,
  { readonly brand: unique symbol }
>()("AlloyExecutionError", {
  reason: Schema.Literals(["Unavailable", "Execution"]),
  detail: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export interface AlloyRunRequest {
  readonly model: string;
  readonly outputDirectory: string;
  readonly workingDirectory: string;
  readonly kind: "assertions" | "reachability" | "vectors";
}

export interface AlloyRunReceipt {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

/** One capability; package code neither resolves executables nor owns native processes. */
export class AlloyExecution extends Context.Service<
  AlloyExecution,
  {
    readonly version: Effect.Effect<AlloyRunReceipt, AlloyExecutionError>;
    readonly run: (request: AlloyRunRequest) => Effect.Effect<AlloyRunReceipt, AlloyExecutionError>;
  }
>()("effx/cli/AlloyExecution") {}
