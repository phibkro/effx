import { Context } from "effect";
import { A, Annotation } from "@effx/runtime";

/** A key whose shape disagrees with the definition's arguments: the generated `.annotate` must fail `tsc`. */
export class MismatchPolicy extends Context.Service<
  MismatchPolicy,
  { readonly perMinute: string }
>()("app/Mismatch") {}

export const Mismatch = Annotation.define({
  name: "app.Mismatch",
  target: "operation",
  args: { perMinute: A.int },
  effect: { target: "endpoint", key: MismatchPolicy },
});
