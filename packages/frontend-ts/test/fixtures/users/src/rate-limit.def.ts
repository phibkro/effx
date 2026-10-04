import { Context } from "effect";
import { A, Annotation } from "@effx/runtime";

/** The Effect key of `@RateLimit` (spec 0020 §8): its literal id is what a static lift matches. */
export class RateLimitPolicy extends Context.Service<
  RateLimitPolicy,
  { readonly perMinute: number; readonly burst?: number }
>()("app/RateLimit") {}

/** A leaf definition module (spec 0020): imports only effect and the runtime, safe to evaluate with the config. */
export const RateLimit = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int, burst: A.optional(A.int) },
  cardinality: "one",
  effect: { target: "endpoint", key: RateLimitPolicy },
});
