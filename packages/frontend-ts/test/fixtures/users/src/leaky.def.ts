import { A, Annotation } from "@effx/runtime";
import { User } from "./user.ts";

/** NOT a leaf: it evaluates an application module (a model declaration) when loaded. */
export const Leaky = Annotation.define({
  name: "app.Leaky",
  target: "operation",
  args: { who: A.string },
});

export const leakyWitness = User;
