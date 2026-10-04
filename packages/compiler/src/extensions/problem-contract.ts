import { Option, Result, Schema } from "effect";
import { IRGraph, StableId, SymbolRef, type OperationNode } from "@effx/ir";
import { Contribution, type Analysis, type Extension, type Interpreter } from "../Extension.ts";
import { SymbolArg, decodeArgs } from "../args.ts";
import { error, type Diagnostic } from "../Diagnostic.ts";
import { notAnOperation } from "./core.ts";

/** JSON-only payload attached to an operation; no application module is evaluated. */
export const ProblemContractData = Schema.Struct({
  registry: SymbolRef,
  codes: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  /** Override only the schema identity; endpoint identifiers remain independent. */
  identifier: Schema.optionalKey(Schema.String),
  map: Schema.optionalKey(Schema.Record(Schema.String, Schema.NonEmptyString)),
  /** Statically sourced error tags, keyed by SchemaRef export. */
  errorTags: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /** Error tags whose handler type has a statically sourced HTTP status. */
  statusAnnotated: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type ProblemContractData = typeof ProblemContractData.Type;

type ProblemContractDraft = { -readonly [K in keyof ProblemContractData]: ProblemContractData[K] };

const ProblemsArgs = Schema.Tuple([
  Schema.Struct({
    registry: SymbolArg,
    codes: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
    identifier: Schema.optionalKey(Schema.String),
    map: Schema.optionalKey(Schema.Record(Schema.String, Schema.NonEmptyString)),
  }),
]);

const problems: Interpreter = (annotation, declaration, ctx) => {
  if (Option.isNone(ctx.operationId))
    return Contribution.diagnostics(notAnOperation(annotation, declaration));

  if (declaration.annotations.filter((item) => item.name === "Http.Problems").length > 1) {
    return Contribution.diagnostics(
      error("EFFX2402", `${declaration.id}: duplicate @Http.Problems annotations`),
    );
  }

  return Result.match(decodeArgs(ProblemsArgs, annotation, declaration), {
    onFailure: (diagnostic) => Contribution.diagnostics(diagnostic),
    onSuccess: ([args]) => {
      const operationId = Option.getOrThrow(ctx.operationId);
      const id = StableId.make("ext", `problem-contract/${StableId.nameOf(operationId)}`);
      const signatureErrors = declaration.handlerSignature?.errors ?? [];

      const errorTags = Object.fromEntries(
        signatureErrors.flatMap((entry) =>
          entry._tag === "Schema" && entry.errorTag !== undefined
            ? [[entry.ref.export, entry.errorTag]]
            : [],
        ),
      );

      const statusAnnotated = signatureErrors.flatMap((entry) =>
        entry._tag === "Schema" && entry.httpStatus !== undefined
          ? [entry.errorTag ?? entry.ref.export]
          : [],
      );

      const data: ProblemContractDraft = {
        registry: args.registry.ref,
        codes: args.codes,
      };

      if (args.identifier !== undefined) data.identifier = args.identifier;

      if (args.map !== undefined) data.map = args.map;

      if (Object.keys(errorTags).length > 0) data.errorTags = errorTags;

      if (statusAnnotated.length > 0) data.statusAnnotated = statusAnnotated;

      return Contribution.make(
        [{ _tag: "Extension", id, extension: "problem-contract", tag: "ProblemContract", data }],
        [{ kind: "ExtensionOf", from: id, to: operationId, qualifier: "ProblemContract" }],
      );
    },
  });
};

const analyzeProblems: Analysis = (ir, index) => {
  const diagnostics: Array<Diagnostic> = [];

  for (const operation of ir.nodes) {
    if (operation._tag !== "Operation") continue;

    const contracts = IRGraph.incoming(index, operation.id, "ExtensionOf")
      .filter((edge) => edge.qualifier === "ProblemContract")
      .flatMap((edge) => {
        const node = IRGraph.nodeOf(index, edge.from);

        return Option.isSome(node) &&
          node.value._tag === "Extension" &&
          node.value.extension === "problem-contract" &&
          node.value.tag === "ProblemContract"
          ? [node.value]
          : [];
      });

    if (contracts.length === 0) continue;

    if (
      contracts.length > 1 ||
      ir.nodes.filter(
        (node) =>
          node._tag === "Extension" &&
          node.id === contracts[0]!.id &&
          node.tag === "ProblemContract",
      ).length > 1
    ) {
      diagnostics.push(error("EFFX2402", `${operation.name}: duplicate @Http.Problems contracts`));
    }

    const exposedOverHttp = IRGraph.outgoing(index, operation.id, "ExposedAs").some((edge) => {
      const exposure = IRGraph.nodeOf(index, edge.to);

      return (
        Option.isSome(exposure) &&
        exposure.value._tag === "Exposure" &&
        exposure.value.transport._tag === "http"
      );
    });

    if (!exposedOverHttp)
      diagnostics.push(
        error("EFFX2402", `${operation.name}: @Http.Problems requires an HTTP exposure`),
      );

    for (const contract of contracts) {
      const decoded = Schema.decodeUnknownResult(ProblemContractData)(contract.data);

      if (Result.isFailure(decoded)) {
        diagnostics.push(
          error(
            "EFFX2402",
            `${operation.name}: malformed ProblemContract data — ${decoded.failure.message}`,
          ),
        );
        continue;
      }

      if (
        decoded.success.identifier !== undefined &&
        !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(decoded.success.identifier)
      )
        diagnostics.push(
          error(
            "EFFX2402",
            `${operation.name}: @Http.Problems identifier must be a nonempty safe identifier`,
          ),
        );
      const { codes, map, statusAnnotated, errorTags } = decoded.success;

      if (new Set(codes).size !== codes.length)
        diagnostics.push(
          error("EFFX2402", `${operation.name}: @Http.Problems codes must be unique`),
        );
      diagnostics.push(...mappingDiagnostics(operation, codes, map, statusAnnotated, errorTags));
    }
  }

  return diagnostics;
};

const mappingDiagnostics = (
  operation: OperationNode,
  codes: ReadonlyArray<string>,
  map: Readonly<Record<string, string>> | undefined,
  statusAnnotated: ReadonlyArray<string> | undefined,
  errorTags: Readonly<Record<string, string>> | undefined,
): ReadonlyArray<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = [];

  const errors = new Set(
    operation.errors.values.map((ref) => errorTags?.[ref.export] ?? ref.export),
  );

  for (const [tag, code] of Object.entries(map ?? {})) {
    if (!codes.includes(code))
      diagnostics.push(
        error(
          "EFFX2206",
          `${operation.name}: @Http.Problems maps ${tag} to ${code}, which is absent from codes`,
        ),
      );

    if (!errors.has(tag))
      diagnostics.push(
        error(
          "EFFX2205",
          `${operation.name}: @Http.Problems maps ${tag}, which is not an operation error`,
        ),
      );
  }

  for (const ref of operation.errors.values) {
    const tag = errorTags?.[ref.export] ?? ref.export;

    if (map?.[tag] === undefined && !statusAnnotated?.includes(tag))
      diagnostics.push(
        error(
          "EFFX2205",
          `${operation.name}: ${tag} has no @Http.Problems mapping or sourced HTTP status`,
        ),
      );
  }

  return diagnostics;
};

/** @Http.Problems contributes a JSON contract; analysis never runs the registry. */
export const problemContract: Extension = {
  name: "problem-contract",
  interpreters: { "Http.Problems": problems },
  analyses: [analyzeProblems],
  generators: [],
};
