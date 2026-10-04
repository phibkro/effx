import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import { Effect, Option, Schema } from "effect";
import { IRGraph, StableId, canonical, make, type ExtensionNode, type SchemaRef } from "@effx/ir";
import {
  Extensions,
  analyze,
  compileCollected,
  interpret,
  type CompileResult,
  type CompilerFault,
} from "@effx/compiler";
import type { AnnotationArg, Collected, Declaration } from "../src/Collected.ts";
import { HttpContractData } from "../src/extensions/http-contract.ts";

const lookup: SchemaRef = {
  module: "organization/schemas",
  export: "AppointmentCandidateLookup",
  symbolId: StableId.make("schema", "organization/AppointmentCandidateLookup"),
};

const response: SchemaRef = {
  module: "organization/schemas",
  export: "AppointmentCandidateLookupResult",
  symbolId: StableId.make("schema", "organization/AppointmentCandidateLookupResult"),
};

const schema = (ref: SchemaRef): AnnotationArg => ({ _tag: "Schema", ref });

const path = "/api/organization/appointments/candidate-lookup";

type Method = "Get" | "Post" | "Put" | "Patch" | "Delete";

type Kind = "Query" | "Command";

const declaration = (
  kind: Kind,
  method: Method,
  options?: Readonly<Record<string, AnnotationArg>>,
): Declaration => ({
  id: "Organization.lookupAppointmentCandidate",
  kind: "staticMethod",
  module: "organization/operations",
  export: "Organization",
  member: "lookupAppointmentCandidate",
  annotations: [
    {
      name: kind,
      args: [
        { name: "Organization.LookupCandidate", input: schema(lookup), success: schema(response) },
      ],
    },
    { name: `Http.${method}`, args: [path] },
    ...(options === undefined
      ? []
      : [
          {
            name: "Http.Contract",
            args: [{ group: "organization", success: schema(response), ...options }],
          },
        ]),
  ],
  handlerSignature: {
    success: { _tag: "Schema", ref: response },
    errors: [],
    requirements: [],
  },
});

const collected = (
  kind: Kind,
  method: Method,
  options?: Readonly<Record<string, AnnotationArg>>,
): Collected => ({
  declarations: [declaration(kind, method, options)],
  diagnostics: [],
});

const codes = (diagnostics: ReadonlyArray<{ readonly code: string; readonly severity: string }>) =>
  diagnostics
    .flatMap((diagnostic) => (diagnostic.severity === "error" ? [diagnostic.code] : []))
    .toSorted();

const diagnose = (
  kind: Kind,
  method: Method,
  options?: Readonly<Record<string, AnnotationArg>>,
) => {
  const ir = Option.getOrThrow(
    interpret(collected(kind, method, options), Extensions.builtin).value,
  );

  return codes(analyze(ir, IRGraph.toGraph(ir), Extensions.builtin));
};

// IR decoders preserve this boolean rather than turning it into transport behavior.
const _flagType: HttpContractData["payloadIsQuery"] = false;

void _flagType;

describe("Query over POST", () => {
  it.effect("an explicit POST payload stays a POST body in emitted HttpApi", () =>
    Effect.gen(function* () {
      const source = collected("Query", "Post", { payload: schema(lookup), payloadIsQuery: true });
      const ir = Option.getOrThrow(interpret(source, Extensions.builtin).value);

      const extension = Option.getOrThrow(
        Option.fromUndefinedOr(
          ir.nodes.find(
            (node): node is ExtensionNode =>
              node._tag === "Extension" && node.tag === "HttpContract",
          ),
        ),
      );

      const data = Schema.decodeUnknownOption(HttpContractData)(extension.data);
      assert.strictEqual(Option.getOrThrow(data).payloadIsQuery, true);
      assert.deepStrictEqual(Option.getOrThrow(data).payload, lookup);

      const compileEffect = compileCollected(source, Extensions.builtin);
      expectTypeOf<Effect.Success<typeof compileEffect>>().toEqualTypeOf<CompileResult>();
      expectTypeOf<Effect.Error<typeof compileEffect>>().toEqualTypeOf<CompilerFault>();
      expectTypeOf<Effect.Services<typeof compileEffect>>().toEqualTypeOf<never>();
      const result = yield* compileEffect;
      assert.deepStrictEqual(
        result.diagnostics.filter((d) => d.severity === "error"),
        [],
      );

      const http = Option.getOrThrow(
        Option.fromUndefinedOr(
          Option.getOrThrow(result.files.value).find((file) => file.path === "http.ts"),
        ),
      );

      assert.include(
        http.contents,
        `HttpApiEndpoint.post("Organization.LookupCandidate", "${path}", {`,
      );
      assert.include(http.contents, "payload: AppointmentCandidateLookup,");
      assert.notInclude(http.contents, "query: AppointmentCandidateLookup");
      assert.notInclude(http.contents, "HttpApiEndpoint.get(");
    }),
  );

  it.effect("default false preserves the original rejection even when POST has a payload", () =>
    Effect.sync(() => {
      for (const options of [
        undefined,
        { payload: schema(lookup) },
        { payload: schema(lookup), payloadIsQuery: false },
      ]) {
        assert.deepStrictEqual(diagnose("Query", "Post", options), ["EFFX2401"]);
      }

      const source = collected("Query", "Post", { payload: schema(lookup) });
      const ir = Option.getOrThrow(interpret(source, Extensions.builtin).value);

      const extension = Option.getOrThrow(
        Option.fromUndefinedOr(
          ir.nodes.find(
            (node): node is ExtensionNode =>
              node._tag === "Extension" && node.tag === "HttpContract",
          ),
        ),
      );

      const data = Schema.decodeUnknownOption(HttpContractData)(extension.data);
      assert.strictEqual(Option.getOrThrow(data).payloadIsQuery, false);
    }),
  );

  it.effect("flag without explicit payload raises EFFX2402 and does not suppress EFFX2401", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(diagnose("Query", "Post", { payloadIsQuery: true }), [
        "EFFX2401",
        "EFFX2402",
      ]);
    }),
  );

  it.effect("only Query POST accepts the flag; other mutating methods remain disallowed", () =>
    Effect.sync(() => {
      for (const method of ["Put", "Patch", "Delete"] as const) {
        assert.deepStrictEqual(
          diagnose("Query", method, { payloadIsQuery: true, payload: schema(lookup) }),
          ["EFFX2401", "EFFX2402"],
        );
      }

      assert.deepStrictEqual(diagnose("Query", "Get", { payloadIsQuery: true }), ["EFFX2402"]);
      assert.deepStrictEqual(
        diagnose("Command", "Post", { payloadIsQuery: true, payload: schema(lookup) }),
        ["EFFX2402"],
      );
    }),
  );

  it.effect("a detached contract cannot exempt a Query POST", () =>
    Effect.sync(() => {
      const ir = Option.getOrThrow(
        interpret(
          collected("Query", "Post", { payloadIsQuery: true, payload: schema(lookup) }),
          Extensions.builtin,
        ).value,
      );

      const detached = make(
        ir.nodes,
        ir.edges.filter((edge) => edge.kind !== "ExtensionOf"),
      );

      assert.deepStrictEqual(
        codes(
          Extensions.core.analyses.flatMap((analysis) =>
            analysis(detached, IRGraph.toGraph(detached), { strictAccess: false }),
          ),
        ),
        ["EFFX1003", "EFFX2401"],
      );
    }),
  );

  it.effect(
    "builder and decorator annotations produce identical contract IR without executing a handler",
    () =>
      Effect.sync(() => {
        const decorated = collected("Query", "Post", {
          payloadIsQuery: true,
          payload: schema(lookup),
        });

        const source = decorated.declarations[0]!;

        const builder: Collected = {
          declarations: [
            {
              ...source,
              id: "builder#1",
              kind: "builder",
              annotations: source.annotations.toReversed(),
            },
          ],
          diagnostics: [],
        };

        const first = interpret(decorated, Extensions.builtin);
        const second = interpret(builder, Extensions.builtin);
        assert.deepStrictEqual(first.diagnostics, []);
        assert.deepStrictEqual(second.diagnostics, []);
        assert.strictEqual(
          canonical(Option.getOrThrow(first.value)),
          canonical(Option.getOrThrow(second.value)),
        );
      }),
  );
});
