import { Option, Result, Schema } from "effect";
import { IRGraph, StableId, SymbolRef } from "@effx/ir";
import { Contribution, type Analysis, type Extension, type Interpreter } from "../Extension.ts";
import { SymbolArg, decodeArgs } from "../args.ts";
import { error, warning, type Diagnostic } from "../Diagnostic.ts";
import { notAnOperation } from "./core.ts";
import { HttpContractData } from "./http-contract.ts";

const Names = Schema.UniqueArray(Schema.NonEmptyString).check(Schema.isMinLength(1));

const PrincipalKinds = Schema.UniqueArray(
  Schema.Literals(["Anonymous", "Person", "ServicePrincipal", "CapabilityHolder"]),
).check(Schema.isMinLength(1));

const CapabilityExpression = Schema.TaggedUnion({
  None: {},
  One: { capability: Schema.NonEmptyString },
  Any: { capabilities: Names },
  All: { capabilities: Names },
});

const Concealment = Schema.TaggedUnion({
  Reveal: {},
  NotFound: { stages: Names },
});

const Requirement = Schema.Struct({
  id: Schema.NonEmptyString,
  parameters: Schema.optionalKey(Schema.JsonObject),
});

const AccessOptions = Schema.Struct({
  annotator: SymbolArg,
  exposure: Schema.Literals(["External", "Internal"]),
  acceptedCredentials: Names,
  principalKinds: PrincipalKinds,
  capabilities: CapabilityExpression,
  requirements: Schema.Array(Requirement),
  canonicalScopeResolver: SymbolArg,
  concealment: Concealment,
  decisionTime: Schema.Literals(["SnapshotRead", "Transaction"]),
});

/** JSON-only semantic declaration. Neither symbol is invoked by the compiler. */
export const AccessContractData = Schema.Struct({
  ...AccessOptions.fields,
  annotator: SymbolRef,
  canonicalScopeResolver: SymbolRef,
});

export type AccessContractData = typeof AccessContractData.Type;

const access: Interpreter = (annotation, declaration, ctx) => {
  if (Option.isNone(ctx.operationId))
    return Contribution.diagnostics(notAnOperation(annotation, declaration));

  if (declaration.annotations.filter((item) => item.name === "Http.Access").length > 1)
    return Contribution.diagnostics(
      error("EFFX2500", `${declaration.id}: duplicate @Http.Access annotations`),
    );

  return Result.match(decodeArgs(Schema.Tuple([AccessOptions]), annotation, declaration), {
    onFailure: (diagnostic) => Contribution.diagnostics(diagnostic),
    onSuccess: ([options]) => {
      const operation = Option.getOrThrow(ctx.operationId);
      const id = StableId.make("ext", `access-contract/${StableId.nameOf(operation)}`);

      const data: AccessContractData = {
        annotator: options.annotator.ref,
        exposure: options.exposure,
        acceptedCredentials: options.acceptedCredentials,
        principalKinds: options.principalKinds,
        capabilities: options.capabilities,
        requirements: options.requirements,
        canonicalScopeResolver: options.canonicalScopeResolver.ref,
        concealment: options.concealment,
        decisionTime: options.decisionTime,
      };

      return Contribution.make(
        [{ _tag: "Extension", id, extension: "access-contract", tag: "AccessContract", data }],
        [{ kind: "ExtensionOf", from: id, to: operation, qualifier: "AccessContract" }],
      );
    },
  });
};

const analyzeAccess: Analysis = (ir, index, context) => {
  const diagnostics: Array<Diagnostic> = [];

  for (const operation of ir.nodes) {
    if (operation._tag !== "Operation") continue;

    const hasHttpExposure = IRGraph.outgoing(index, operation.id, "ExposedAs").some((edge) => {
      const exposure = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return exposure?._tag === "Exposure" && exposure.transport._tag === "http";
    });

    const contracts = IRGraph.incoming(index, operation.id, "ExtensionOf")
      .filter((edge) => edge.qualifier === "AccessContract")
      .flatMap((edge) => {
        const node = Option.getOrUndefined(IRGraph.nodeOf(index, edge.from));

        return node?._tag === "Extension" &&
          node.extension === "access-contract" &&
          node.tag === "AccessContract"
          ? [node]
          : [];
      });

    if (contracts.length === 0) {
      if (hasHttpExposure)
        diagnostics.push(
          (context?.strictAccess ? error : warning)(
            "EFFX2504",
            `${operation.name}: HTTP exposure requires @Http.Access`,
          ),
        );
      continue;
    }

    if (
      contracts.length > 1 ||
      ir.nodes.filter(
        (node) =>
          node._tag === "Extension" &&
          node.id === contracts[0]!.id &&
          node.extension === "access-contract" &&
          node.tag === "AccessContract",
      ).length > 1
    )
      diagnostics.push(error("EFFX2500", `${operation.name}: duplicate @Http.Access contracts`));

    for (const contract of contracts) {
      const decoded = Schema.decodeUnknownResult(AccessContractData)(contract.data);

      if (Result.isFailure(decoded)) {
        diagnostics.push(
          error(
            "EFFX2500",
            `${operation.name}: malformed AccessContract data — ${decoded.failure.message}`,
          ),
        );
        continue;
      }

      const data = decoded.success;

      if (operation.kind === "Command" && data.decisionTime === "SnapshotRead")
        diagnostics.push(
          error("EFFX2501", `${operation.name}: Command access cannot decide in a read snapshot`),
        );

      if (operation.kind === "Query" && data.decisionTime === "Transaction")
        diagnostics.push(
          warning("EFFX2502", `${operation.name}: Query access declares a transaction decision`),
        );

      if (data.acceptedCredentials.some((credential) => credential !== "None")) {
        const hasSecurityMarker = IRGraph.incoming(index, operation.id, "ExtensionOf").some(
          (edge) => {
            if (edge.qualifier !== "HttpContract") return false;
            const node = Option.getOrUndefined(IRGraph.nodeOf(index, edge.from));

            if (
              node?._tag !== "Extension" ||
              node.extension !== "http-contract" ||
              node.tag !== "HttpContract"
            )
              return false;
            const http = Schema.decodeUnknownOption(HttpContractData)(node.data);

            return (
              Option.isSome(http) &&
              (http.value.securityMiddleware ?? []).some((security) =>
                http.value.middleware.some(
                  (middleware) =>
                    middleware.module === security.module &&
                    middleware.export === security.export &&
                    middleware.member === security.member,
                ),
              )
            );
          },
        );

        if (!hasSecurityMarker)
          diagnostics.push(
            error(
              "EFFX2503",
              `${operation.name}: protected access requires an Http.Contract security middleware marker`,
            ),
          );
      }
    }
  }

  return diagnostics;
};

export const accessContractExtension: Extension = {
  name: "access-contract",
  interpreters: { "Http.Access": access },
  analyses: [analyzeAccess],
  generators: [],
};
