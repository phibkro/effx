import { expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Result, Schema } from "effect";
import {
  composeRegistry,
  composeRegistryResult,
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
  expectTypeOf(composeRegistryResult([])).toEqualTypeOf<Result.Result<Registry, RegistryError>>();
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
    severityPolicy: {
      kind: "named",
      name: "phase",
      description: "Depends on the phase.",
      allowedSeverities: ["warning", "error"],
    },
  } as const;
  // @ts-expect-error Named policies require a typed severity resolver.

  defineDiagnostic(namedEntry, params, (facts) => facts.capability);
};

/** Compile-only fixtures: outcome unions come from the literal policy, not Severity. */
export const rejectsUndeclaredPolicyOutcomes = () => {
  const skewEntry = {
    ...entry,
    code: "EFFX0001",
    owner: "frontend",
    severity: "warning",
    severityPolicy: {
      kind: "named",
      name: "version-skew",
      description: "Same-major skew is info; different-major skew is warning.",
      allowedSeverities: ["info", "warning"],
    },
  } as const satisfies DiagnosticEntry;

  const accessEntry = {
    ...entry,
    code: "EFFX2504",
    owner: "access",
    severity: "warning",
    severityPolicy: {
      kind: "named",
      name: "strictAccess",
      description: "Strict access promotes warning to error.",
      allowedSeverities: ["warning", "error"],
    },
  } as const satisfies DiagnosticEntry;

  defineDiagnostic(
    skewEntry,
    params,
    (facts) => facts.capability,
    () => "info",
  );
  defineDiagnostic(
    accessEntry,
    params,
    (facts) => facts.capability,
    () => "error",
  );
  defineDiagnostic(
    skewEntry,
    params,
    (facts) => facts.capability,
    // @ts-expect-error EFFX0001 cannot become an error.
    () => "error",
  );
  defineDiagnostic(
    accessEntry,
    params,
    (facts) => facts.capability,
    // @ts-expect-error EFFX2504 cannot become informational.
    () => "info",
  );
  const allSeverities: () => Diagnostic["severity"] = () => "error";
  defineDiagnostic(
    skewEntry,
    params,
    (facts) => facts.capability,
    // @ts-expect-error A broad resolver cannot widen a literal entry policy.
    allSeverities,
  );

  const invalidPolicy: DiagnosticEntry["severityPolicy"] = {
    kind: "named",
    name: "empty",
    description: "No outcomes.",
    // @ts-expect-error Named policies require at least one outcome.
    allowedSeverities: [],
  };

  return invalidPolicy;
};
