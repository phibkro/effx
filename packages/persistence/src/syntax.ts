import { A, Annotation } from "@effx/runtime";

/** Source-only persistence capability. The compiler never supplies an adapter or executes SQL. */
export const Port = Annotation.define({
  name: "persistence.Port",
  target: "operation",
  args: { port: A.string },
  cardinality: "one",
});

export const Persist = { Port };
