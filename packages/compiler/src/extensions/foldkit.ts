import { Option, Result, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { IRGraph, StableId } from "@effx/ir";
import { Contribution, type Analysis, type Extension } from "../Extension.ts";
import { type Diagnostic, error } from "../Diagnostic.ts";
import { extension, implement } from "../annotation.ts";
import { UiCommandData } from "../generate/http-contracts.ts";
import { foldkitGenerator } from "../generate/foldkit.ts";
import { AccessContractData } from "./access-contract.ts";
import { notAnOperation } from "./not-an-operation.ts";

/** Source-only Message references; neither the compiler nor the decorator evaluates the app. */
const command = implement(Builtins.FoldkitCommand, {
  notOperation: notAnOperation,
  duplicate: { code: "EFFX2601" },
  read: ([options], { ctx }) => {
    const operation = Option.getOrThrow(ctx.operationId);
    const id = StableId.make("ext", `foldkit/${StableId.nameOf(operation)}`);

    const data: UiCommandData = {
      success: options.success.ref,
      failure: options.failure.ref,
    };

    return Contribution.make(
      [{ _tag: "Extension", id, extension: "foldkit", tag: "UiCommand", data }],
      [{ kind: "ExtensionOf", from: id, to: operation, qualifier: "UiCommand" }],
    );
  },
});

/** A Command may only bind to one published HTTP operation. Legacy roots default to external. */
const analyzeCommands: Analysis = (ir, index): ReadonlyArray<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = [];

  for (const node of ir.nodes) {
    if (node._tag !== "Extension" || node.extension !== "foldkit" || node.tag !== "UiCommand")
      continue;

    const decoded = Schema.decodeUnknownResult(UiCommandData)(node.data);

    if (Result.isFailure(decoded)) {
      diagnostics.push(
        error("EFFX2601", `${node.id}: invalid UiCommand data — ${decoded.failure.message}`),
      );
      continue;
    }

    const edges = IRGraph.outgoing(index, node.id, "ExtensionOf");

    if (edges.length !== 1 || edges[0]?.qualifier !== "UiCommand") {
      diagnostics.push(error("EFFX2601", `${node.id}: requires one UiCommand owner edge`));
      continue;
    }

    const owner = Option.getOrUndefined(IRGraph.nodeOf(index, edges[0].to));

    if (owner?._tag !== "Operation") {
      diagnostics.push(error("EFFX2601", `${node.id}: must attach to an operation`));
      continue;
    }

    const siblings = IRGraph.incoming(index, owner.id, "ExtensionOf").filter(
      (edge) => edge.qualifier === "UiCommand",
    );

    if (
      siblings.length !== 1 ||
      ir.nodes.filter((candidate) => candidate._tag === "Extension" && candidate.id === node.id)
        .length !== 1
    )
      diagnostics.push(error("EFFX2601", `${owner.name}: duplicate Foldkit.Command declarations`));

    const http = IRGraph.outgoing(index, owner.id, "ExposedAs").filter((edge) => {
      const exposure = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return exposure?._tag === "Exposure" && exposure.transport._tag === "http";
    });

    if (http.length !== 1) {
      diagnostics.push(
        error("EFFX2601", `${owner.name}: Foldkit.Command requires exactly one HTTP exposure`),
      );
      continue;
    }

    const internal = IRGraph.incoming(index, owner.id, "ExtensionOf").some((edge) => {
      if (edge.qualifier !== "AccessContract") return false;
      const access = Option.getOrUndefined(IRGraph.nodeOf(index, edge.from));

      if (access?._tag !== "Extension" || access.extension !== "access-contract") return false;
      const data = Schema.decodeUnknownOption(AccessContractData)(access.data);

      return Option.isSome(data) && data.value.exposure === "Internal";
    });

    if (internal)
      diagnostics.push(
        error("EFFX2601", `${owner.name}: Foldkit.Command requires an external HTTP root`),
      );
  }

  return diagnostics;
};

export const foldkitExtension: Extension = extension("foldkit", [command], {
  analyses: [analyzeCommands],
  generators: [foldkitGenerator],
});
