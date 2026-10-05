import { expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import {
  composeRegistry,
  defineDiagnostic,
  type Diagnostic,
  type DiagnosticEntry,
  type Registry,
  type RegistryError,
} from "../src/index.ts";

const entry = {
  code: "EFFX1001",
  owner: "kernel",
  title: "Required capability",
  severity: "error",
  severityPolicy: { kind: "fixed" },
  explanation: "Declare the capability.",
  examples: [
    {
      before: "handler",
      after: "handler.requires(Service)",
      explanation: "Declare the requirement.",
    },
  ],
} as const satisfies DiagnosticEntry;

const params = Schema.Struct({ capability: Schema.String });

const definition = defineDiagnostic(entry, params, (facts) => `Missing ${facts.capability}`);

it("pins registry channels and literal factory params", () => {
  expectTypeOf(composeRegistry([])).toEqualTypeOf<Effect.Effect<Registry, RegistryError, never>>();
  expectTypeOf(definition.entry.code).toEqualTypeOf<"EFFX1001">();
  expectTypeOf(definition.paramsSchema).toEqualTypeOf<typeof params>();
  expectTypeOf(definition.emit).parameter(0).toEqualTypeOf<{ readonly capability: string }>();
  expectTypeOf(definition.emit({ capability: "Database" })).toEqualTypeOf<
    Diagnostic & { readonly code: "EFFX1001" }
  >();
});

class ParameterService extends Context.Service<ParameterService, { readonly prefix: string }>()(
  "@effx/diagnostics/test/ParameterService",
) {}

/** Compile-only fixture: the caller's decoder retains a schema's requirements. */
export const preservesSchemaRequirements = (
  serviceSchema: Schema.Codec<string, string, ParameterService>,
) => {
  const dependent = defineDiagnostic(entry, serviceSchema, (value) => value);
  const decode = Schema.decodeEffect(dependent.paramsSchema)("input");
  expectTypeOf(decode).toEqualTypeOf<Effect.Effect<string, Schema.SchemaError, ParameterService>>();
  expectTypeOf(decode).not.toMatchTypeOf<Effect.Effect<string, Schema.SchemaError, never>>();

  return decode;
};

/** Compile-only negative fixtures; never executed as tests or production code. */
export const rejectsIndependentDiagnosticFields = () => {
  // @ts-expect-error A raw code is not an entry reference.
  defineDiagnostic("EFFX1001", params, (facts) => facts.capability);
  // @ts-expect-error A free-form message cannot replace structured params.
  definition.emit("arbitrary message");
  // @ts-expect-error Params must carry their declared facts.
  definition.emit({ capability: 1 });
  // @ts-expect-error Severity is owned by the entry/policy.
  definition.emit({ capability: "Database" }, { severity: "warning" });
  defineDiagnostic(
    entry,
    params,
    (facts) => facts.capability,
    // @ts-expect-error Fixed entries prohibit a severity resolver.
    () => "warning",
  );

  const namedEntry = {
    ...entry,
    severityPolicy: { kind: "named", name: "phase", description: "Depends on the phase." },
  } as const;
  // @ts-expect-error Named policies require a typed severity resolver.

  defineDiagnostic(namedEntry, params, (facts) => facts.capability);
};
