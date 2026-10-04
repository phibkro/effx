/**
 * @title Declaring an annotation
 *
 * `Annotation.define` declares a user annotation once: its name, where it may attach and the
 * argument shape. The derived decorator and builder argument are typed from `args`, and the
 * compiler lowers and decodes the same description. Keep this file a leaf module: it may
 * import only `effect` and `@effx/runtime` (spec 0020, EFFX1306), so loading it never loads
 * application code.
 */
import { A, Annotation } from "@effx/runtime";
import { Context } from "effect";

// An Effect annotation key: the generated HttpApi endpoint carries the value, typed by `tsc`, and a
// hand-written middleware reads it back with `Context.getOption(endpoint.annotations, RateLimitPolicy)`.
// The literal id is what a static lift matches (spec 0020 section 4).
export class RateLimitPolicy extends Context.Service<
  RateLimitPolicy,
  { readonly perMinute: number; readonly burst?: number }
>()("app/RateLimit") {}

export const RateLimit = Annotation.define({
  // Namespaced and unique across all extensions (EFFX1302 on a clash).
  name: "app.RateLimit",
  // v1 user annotations attach to operations only (spec 0020 section 0.4).
  target: "operation",
  // `A.*` is the closed set of argument shapes the TypeScript frontend can read from source
  // without running your code. `tsc` checks the shape at the use site; value constraints such as a
  // minimum are decoded by the compiler (EFFX1102).
  args: { perMinute: A.int, burst: A.optional(A.int) },
  // The compiler rejects a second `@RateLimit` on one operation.
  cardinality: "one",
  // Optional default writer: generated endpoints get `.annotate(RateLimit.effect.key, { ... })`.
  // `tsc` checks the written value against the key's shape in the generated file.
  effect: { target: "endpoint", key: RateLimitPolicy },
});
