import { Schema } from "effect";

/**
 * Reserved for IO and invariant failures (unreadable project, broken cache, generator bug).
 * Source problems are `Diagnostic`s, never faults.
 */
export class CompilerFault extends Schema.TaggedError<CompilerFault>()("CompilerFault", {
  stage: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
