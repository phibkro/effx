import { Effect, Option, Predicate, Schema } from "effect";
import {
  type ApplicationIR,
  type GraphIndex,
  type ExtensionNode,
  type Node,
  SchemaRef,
  type StableId,
} from "@effx/ir";
import type { CompilerFault } from "../CompilerFault.ts";
import { AccessContractData } from "../extensions/access-contract.ts";
import { HttpContractData } from "../extensions/http-contract.ts";
import { ProblemContractData } from "../extensions/problem-contract.ts";
import { type Exposed, type HttpTransport, exposed, identifier, operationName } from "./emit.ts";

/** The two app-owned Message schemas named by an opted-in Foldkit operation. */
export const UiCommandData = Schema.Struct({ success: SchemaRef, failure: SchemaRef });

export type UiCommandData = typeof UiCommandData.Type;

export interface HttpItem extends Exposed<HttpTransport> {
  readonly contract: HttpContractData | undefined;
  readonly problems: ProblemContractData | undefined;
  readonly access: AccessContractData | undefined;
  readonly uiCommand: UiCommandData | undefined;
  readonly root: string;
  readonly group: string;
}

/** Endpoint names are independent of stable IDs; legacy local operations retain their keys. */
export const endpointKey = (item: HttpItem): string =>
  item.contract?.metadata?.operationId?.slice(item.group.length + 1) ??
  operationName(item.operation);

const isHttp = Predicate.isTagged("http");

/** Preserve root export spelling, including existing punctuation handling. */
const classPart = (name: string): string => {
  const part = identifier(name);

  return part.charAt(0).toUpperCase() + part.slice(1);
};

/** Only HTTP group parts treat route punctuation as word boundaries. */
export const groupExportPart = (group: string): string =>
  classPart(
    group.replace(
      /[-_.]+([A-Za-z0-9_$])?/gu,
      (_, next: string | undefined) => next?.toUpperCase() ?? "",
    ),
  );

/** Split-mode group contracts export the same group symbol regardless of enclosing root. */
export const groupApiName = (group: string): string => `${groupExportPart(group)}Api`;

export const groupApiHandlersName = (group: string): string => `${groupApiName(group)}Handlers`;

export const groupClassName = (root: string, group: string): string =>
  root === "effx" && group === "operations"
    ? "HttpOperations"
    : `${root === "effx" ? "" : classPart(root)}${groupExportPart(group)}Group`;

export const rootClassName = (root: string): string =>
  root === "effx" ? "Api" : `${classPart(root)}Api`;

export const handlerName = (root: string, group: string): string =>
  root === "effx" && group === "operations"
    ? "ApiHandlers"
    : `${root === "effx" ? "" : classPart(root)}${groupExportPart(group)}Handlers`;

export const guardTypeName = (root: string, group: string): string =>
  `${handlerName(root, group).slice(0, -"Handlers".length)}Guards`;

export const clientName = (root: string): string =>
  root === "effx" ? "Client" : `${classPart(root)}Client`;

const isExtension = Predicate.isTagged("Extension");

/** Builds one typed lookup from validated ExtensionOf edges, not from JSON naming conventions. */
export const toHttpItems = (
  ir: ApplicationIR,
  all: ReadonlyArray<Exposed>,
): ReadonlyArray<HttpItem> => {
  const extensions = new Map<StableId.StableId, ExtensionNode>(
    ir.nodes.flatMap((node) => (isExtension(node) ? [[node.id, node] as const] : [])),
  );

  const byOperation = new Map<
    StableId.StableId,
    {
      contract?: HttpContractData;
      problems?: ProblemContractData;
      access?: AccessContractData;
      uiCommand?: UiCommandData;
    }
  >();

  for (const edge of ir.edges) {
    if (edge.kind !== "ExtensionOf") continue;
    const node = extensions.get(edge.from);

    if (node === undefined) continue;
    const previous = byOperation.get(edge.to) ?? {};

    if (node.extension === "http-contract" && node.tag === "HttpContract") {
      const data = Option.getOrUndefined(Schema.decodeUnknownOption(HttpContractData)(node.data));

      if (data !== undefined) byOperation.set(edge.to, { ...previous, contract: data });
    } else if (node.extension === "problem-contract" && node.tag === "ProblemContract") {
      const data = Option.getOrUndefined(
        Schema.decodeUnknownOption(ProblemContractData)(node.data),
      );

      if (data !== undefined) byOperation.set(edge.to, { ...previous, problems: data });
    } else if (node.extension === "access-contract" && node.tag === "AccessContract") {
      const data = Option.getOrUndefined(Schema.decodeUnknownOption(AccessContractData)(node.data));

      if (data !== undefined) byOperation.set(edge.to, { ...previous, access: data });
    } else if (node.extension === "foldkit" && node.tag === "UiCommand") {
      const data = Option.getOrUndefined(Schema.decodeUnknownOption(UiCommandData)(node.data));

      if (data !== undefined) byOperation.set(edge.to, { ...previous, uiCommand: data });
    }
  }

  return all.flatMap((item): ReadonlyArray<HttpItem> => {
    if (!isHttp(item.transport)) return [];

    const details = byOperation.get(item.operation.id);
    const contract = details?.contract;

    return [
      {
        ...item,
        transport: item.transport,
        contract,
        problems: details?.problems,
        access: details?.access,
        uiCommand: details?.uiCommand,
        root: contract?.root ?? "effx",
        group: contract?.group ?? "operations",
      },
    ];
  });
};

export const httpItems = (
  ir: ApplicationIR,
  index: GraphIndex,
): Effect.Effect<ReadonlyArray<HttpItem>, CompilerFault> =>
  Effect.map(exposed(ir, index), (all) => toHttpItems(ir, all));

export interface HttpGroup {
  readonly root: string;
  readonly group: string;
  readonly metadata: Extract<Node, { readonly _tag: "HttpGroup" }> | undefined;
  readonly items: ReadonlyArray<HttpItem>;
}

export const httpGroups = (
  items: ReadonlyArray<HttpItem>,
  ir?: ApplicationIR,
): ReadonlyArray<HttpGroup> => {
  const metadata = new Map<string, Extract<Node, { readonly _tag: "HttpGroup" }>>(
    (ir?.nodes ?? []).flatMap((node) =>
      node._tag === "HttpGroup" ? [[`${node.root}\u0000${node.group}`, node] as const] : [],
    ),
  );

  const groups = new Map<
    string,
    { root: string; group: string; metadata: HttpGroup["metadata"]; items: Array<HttpItem> }
  >();

  for (const item of items) {
    const key = `${item.root}\u0000${item.group}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        root: item.root,
        group: item.group,
        metadata: metadata.get(key),
        items: [item],
      });
    } else {
      existing.items.push(item);
    }
  }

  return [...groups.values()].toSorted(
    (a, b) => a.root.localeCompare(b.root) || a.group.localeCompare(b.group),
  );
};
