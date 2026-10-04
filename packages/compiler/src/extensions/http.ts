import type { Extension } from "../Extension.ts";
import { httpGenerator } from "../generate/http.ts";
import { guardsGenerator } from "../generate/guards.ts";
import { httpInterpreters } from "./transports.ts";

/** `@Http.*` emits ordinary HttpApi routes and type-only guard bindings when needed. */
export const http: Extension = {
  name: "http",
  interpreters: httpInterpreters,
  analyses: [],
  generators: [httpGenerator, guardsGenerator],
};
