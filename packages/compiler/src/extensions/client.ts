import { Option, Schema } from "effect";
import { IRGraph } from "@effx/ir";
import { type Analysis, type Extension } from "../Extension.ts";
import { error, type Diagnostic } from "../Diagnostic.ts";
import { clientGenerator } from "../generate/client.ts";
import { AccessContractData } from "./access-contract.ts";
import { HttpContractData } from "./http-contract.ts";

/** A ForApi service exposes its entire root, so visibility must be uniform within that root. */
const analyzeRootVisibility: Analysis = (ir, index) => {
  const diagnostics: Array<Diagnostic> = [];
  const roots = new Map<string, "Internal" | "External">();
  const mixed = new Set<string>();

  for (const operation of ir.nodes) {
    if (operation._tag !== "Operation") continue;

    const hasHttp = IRGraph.outgoing(index, operation.id, "ExposedAs").some((edge) => {
      const node = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return node?._tag === "Exposure" && node.transport._tag === "http";
    });

    if (!hasHttp) continue;

    const extensions = IRGraph.incoming(index, operation.id, "ExtensionOf").flatMap((edge) => {
      const node = Option.getOrUndefined(IRGraph.nodeOf(index, edge.from));

      return node?._tag === "Extension" ? [node] : [];
    });

    const contract = extensions.find(
      (node) => node.extension === "http-contract" && node.tag === "HttpContract",
    );

    const access = extensions.find(
      (node) => node.extension === "access-contract" && node.tag === "AccessContract",
    );

    const contractData =
      contract === undefined
        ? undefined
        : Option.getOrUndefined(Schema.decodeUnknownOption(HttpContractData)(contract.data));

    const accessData =
      access === undefined
        ? undefined
        : Option.getOrUndefined(Schema.decodeUnknownOption(AccessContractData)(access.data));

    const root = contractData?.root ?? "effx";
    const exposure = accessData?.exposure ?? "External";
    const previous = roots.get(root);

    if (previous !== undefined && previous !== exposure && !mixed.has(root)) {
      diagnostics.push(
        error("EFFX2505", `${root}: an HTTP root cannot mix Internal and External operations`),
      );
      mixed.add(root);
    }

    roots.set(root, exposure);
  }

  return diagnostics;
};

/** Generates only external HTTP clients; mixed roots fail analysis before generation. */
export const client: Extension = {
  name: "client",
  interpreters: {},
  analyses: [analyzeRootVisibility],
  generators: [clientGenerator],
};
