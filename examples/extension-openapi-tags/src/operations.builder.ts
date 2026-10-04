import { Operation } from "@effx/runtime";
import { Effect } from "effect";
import { failOnApplicationImport } from "../test/import-trap.ts";
import { Found, Lookup } from "./schemas.ts";

// Compile with entry ["src/operations.builder.ts"], separately from the decorator entry.
export const deprecatedLookup = Operation.query({
  name: "Example.Lookup",
  input: Lookup,
  success: Found,
})
  .annotate("example.deprecated", { reason: "Use Example.Find instead" })
  .handler((input: typeof Lookup.Type) => Effect.succeed({ id: input.id }));

failOnApplicationImport("builder");
