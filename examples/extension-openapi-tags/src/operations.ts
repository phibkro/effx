import { Annotate, Query } from "@effx/runtime";
import { Effect } from "effect";
import { failOnApplicationImport } from "../test/import-trap.ts";
import { Found, Lookup } from "./schemas.ts";

export class DeprecatedOperations {
  @Query({ name: "Example.Lookup", input: Lookup, success: Found })
  @Annotate("example.deprecated", { reason: "Use Example.Find instead" })
  static lookup(input: typeof Lookup.Type) {
    return Effect.succeed({ id: input.id });
  }
}

// Executing this application module is always an error. The AOT frontend reads source only.
failOnApplicationImport("operations");
