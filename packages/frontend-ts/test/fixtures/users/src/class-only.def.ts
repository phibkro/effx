import { A, Annotation } from "@effx/runtime";

/** A leaf definition module whose runtime target is `"class"`, which the public `define` type rejects (spec 0020 §0.4). */
export const ClassOnly = Annotation.define({
  name: "app.ClassOnly",
  // @ts-expect-error class targets are internal in v1; the frontend must still reject its builder use
  target: "class",
  args: [A.string],
});
