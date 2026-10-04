import { Option, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { type ExtensionNode, IRGraph, StableId } from "@effx/ir";
import { type Analysis, Contribution, type Extension } from "../Extension.ts";
import { type Diagnostic, error } from "../Diagnostic.ts";
import { SchemaArg, SymbolArg } from "../args.ts";
import { extension, implement } from "../annotation.ts";
import { routeParamNames } from "../route-params.ts";
import { notAnOperation } from "./not-an-operation.ts";

const ContractMetadata = Schema.Struct({
  annotator: Schema.optionalKey(SymbolArg.fields.ref),
  operationId: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  commandIdentity: Schema.optionalKey(SymbolArg.fields.ref),
});

/** Transport-specific IR payload. References remain importable symbols, not serialized Schema ASTs. */
export const HttpContractData = Schema.Struct({
  root: Schema.String,
  group: Schema.String,
  params: Schema.optionalKey(SchemaArg.fields.ref),
  paramsKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  query: Schema.optionalKey(SchemaArg.fields.ref),
  headers: Schema.optionalKey(SchemaArg.fields.ref),
  /** Statically recorded required header fields (without evaluating the schema). */
  headersKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  payload: Schema.optionalKey(SchemaArg.fields.ref),
  payloadIsQuery: Schema.optionalKey(Schema.Boolean),
  success: SchemaArg.fields.ref,
  status: Schema.optionalKey(Schema.Int),
  mediaType: Schema.optionalKey(Schema.String),
  responseHeaders: Schema.optionalKey(SchemaArg.fields.ref),
  conditional: Schema.Boolean,
  middleware: Schema.Array(SymbolArg.fields.ref),
  securityMiddleware: Schema.optionalKey(Schema.Array(SymbolArg.fields.ref)),
  metadata: Schema.optionalKey(ContractMetadata),
});

export type HttpContractData = typeof HttpContractData.Type;

type HttpContractDraft = { -readonly [K in keyof HttpContractData]: HttpContractData[K] };

type ContractMetadataDraft = {
  -readonly [K in keyof typeof ContractMetadata.Type]: (typeof ContractMetadata.Type)[K];
};

const httpContract = implement(Builtins.HttpContract, {
  notOperation: notAnOperation,
  read: ([options], { ctx }) => {
    const operation = Option.getOrThrow(ctx.operationId);
    const id = StableId.make("ext", `http-contract/${StableId.nameOf(operation)}`);

    const data: HttpContractDraft = {
      root: options.root ?? "effx",
      group: options.group,
      success: options.success.ref,
      conditional: options.conditional ?? false,
      payloadIsQuery: options.payloadIsQuery ?? false,
      middleware: (options.middleware ?? []).map((marker) => marker.ref),
      securityMiddleware: (options.middleware ?? []).flatMap((marker) =>
        marker.security === true ? [marker.ref] : [],
      ),
    };

    if (options.params !== undefined) data.params = options.params.ref;

    if (options.params?.fields !== undefined) data.paramsKeys = options.params.fields;

    if (options.query !== undefined) data.query = options.query.ref;

    if (options.headers !== undefined) data.headers = options.headers.ref;

    if (options.headers?.fields !== undefined) data.headersKeys = options.headers.fields;

    if (options.payload !== undefined) data.payload = options.payload.ref;

    if (options.status !== undefined) data.status = options.status;

    if (options.mediaType !== undefined) data.mediaType = options.mediaType;

    if (options.responseHeaders !== undefined) data.responseHeaders = options.responseHeaders.ref;

    if (options.metadata !== undefined) {
      const metadata: ContractMetadataDraft = {};

      if (options.metadata.annotator !== undefined)
        metadata.annotator = options.metadata.annotator.ref;

      if (options.metadata.operationId !== undefined)
        metadata.operationId = options.metadata.operationId;

      if (options.metadata.summary !== undefined) metadata.summary = options.metadata.summary;

      if (options.metadata.description !== undefined)
        metadata.description = options.metadata.description;

      if (options.metadata.tags !== undefined) metadata.tags = options.metadata.tags;

      if (options.metadata.commandIdentity !== undefined)
        metadata.commandIdentity = options.metadata.commandIdentity.ref;
      data.metadata = metadata;
    }

    return Contribution.make(
      [{ _tag: "Extension", id, extension: "http-contract", tag: "HttpContract", data }],
      [{ kind: "ExtensionOf", from: id, to: operation, qualifier: "HttpContract" }],
    );
  },
});

const identifier = /^[A-Za-z_$][A-Za-z0-9_$-]*$/u;

const groupIdentifier = /^[A-Za-z_$][A-Za-z0-9_$._-]*$/u;

const endpointIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const diagnostic = (node: ExtensionNode, message: string): Diagnostic =>
  error("EFFX2402", `${node.id}: ${message}`);

const validate: Analysis = (ir, index) => {
  const diagnostics: Array<Diagnostic> = [];
  const rootNames = new Map<string, string>();
  const endpointKeys = new Map<string, string>();
  const groupBindings = new Map<string, { readonly name: string; readonly external: boolean }>();

  for (const node of ir.nodes) {
    if (
      node._tag !== "Extension" ||
      node.extension !== "http-contract" ||
      node.tag !== "HttpContract"
    )
      continue;
    const decoded = Schema.decodeUnknownOption(HttpContractData)(node.data);

    if (Option.isNone(decoded)) {
      diagnostics.push(diagnostic(node, "invalid HttpContract extension data"));
      continue;
    }

    const data = decoded.value;
    const edges = IRGraph.outgoing(index, node.id, "ExtensionOf");

    if (edges.length !== 1 || edges[0]?.qualifier !== "HttpContract") {
      diagnostics.push(
        diagnostic(node, "expected one ExtensionOf edge with HttpContract qualifier"),
      );
      continue;
    }

    const owner = Option.getOrUndefined(IRGraph.nodeOf(index, edges[0].to));

    if (owner?._tag !== "Operation") {
      diagnostics.push(diagnostic(node, "HTTP contract must attach to an operation"));
      continue;
    }

    const exposures = IRGraph.outgoing(index, owner.id, "ExposedAs").flatMap((edge) => {
      const target = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return target?._tag === "Exposure" && target.transport._tag === "http"
        ? [target.transport]
        : [];
    });

    if (exposures.length !== 1) {
      diagnostics.push(diagnostic(node, "requires exactly one HTTP exposure"));
      continue;
    }

    const transport = exposures[0]!;

    if (
      data.payloadIsQuery &&
      (owner.kind !== "Query" || transport.method !== "POST" || data.payload === undefined)
    ) {
      diagnostics.push(
        diagnostic(
          node,
          "payloadIsQuery requires a Query over POST with an explicit payload schema",
        ),
      );
    }

    if (transport.method === "GET" && data.payload !== undefined) {
      diagnostics.push(diagnostic(node, "GET cannot declare an explicit payload"));
    }

    if (data.conditional && (transport.method !== "GET" || data.responseHeaders === undefined)) {
      diagnostics.push(diagnostic(node, "conditional requires GET and responseHeaders"));
    }

    if (data.mediaType !== undefined && data.payload === undefined) {
      diagnostics.push(diagnostic(node, "mediaType requires an explicit payload schema"));
    }

    if (data.status !== undefined && (data.status < 100 || data.status > 599)) {
      diagnostics.push(diagnostic(node, "status must be an HTTP status from 100 to 599"));
    }

    if (!identifier.test(data.root) || !groupIdentifier.test(data.group)) {
      diagnostics.push(diagnostic(node, "root and group must be safe identifiers"));
    }

    const rawPathNames = routeParamNames(transport.path);

    const pathNames = (
      data.paramsKeys === undefined
        ? rawPathNames
        : routeParamNames(transport.path, new Set(data.paramsKeys))
    ).toSorted();

    if (rawPathNames.length > 0 !== (data.params !== undefined)) {
      diagnostics.push(diagnostic(node, "path params require a params schema and vice versa"));
    } else if (data.params !== undefined) {
      if (
        data.paramsKeys === undefined ||
        pathNames.join("\0") !== [...data.paramsKeys].toSorted().join("\0")
      ) {
        diagnostics.push(
          diagnostic(node, "params schema fields must match path parameters exactly"),
        );
      }
    }

    if (data.metadata?.commandIdentity !== undefined) {
      if (owner.kind !== "Command")
        diagnostics.push(diagnostic(node, "commandIdentity requires a Command operation"));

      const headers = data.headersKeys ?? [];

      if (
        data.headers === undefined ||
        !headers.some((header) => header.toLowerCase() === "idempotency-key") ||
        !headers.some((header) => header.toLowerCase() === "if-match")
      )
        diagnostics.push(
          diagnostic(node, "commandIdentity requires headers with idempotency-key and if-match"),
        );
    }

    const operationId = data.metadata?.operationId;

    if (operationId === undefined) {
      if (owner.handler === undefined)
        diagnostics.push(
          error("EFFX2403", `${owner.name}: externally bound HTTP requires metadata.operationId`),
        );
    } else {
      const prefix = `${data.group}.`;
      const key = operationId.startsWith(prefix) ? operationId.slice(prefix.length) : "";

      if (!endpointIdentifier.test(key)) {
        diagnostics.push(
          error(
            "EFFX2403",
            `${owner.name}: operationId must be ${prefix}<identifier-safe endpoint key>`,
          ),
        );
      } else {
        const qualified = `${data.root}:${data.group}:${key}`;
        const previous = endpointKeys.get(qualified);

        if (previous !== undefined && previous !== owner.name)
          diagnostics.push(
            error(
              "EFFX2403",
              `${owner.name}: duplicate HTTP endpoint key ${operationId} (also ${previous})`,
            ),
          );
        else endpointKeys.set(qualified, owner.name);
      }
    }

    const groupKey = `${data.root}:${data.group}`;
    const external = owner.handler === undefined;
    const previousBinding = groupBindings.get(groupKey);

    if (previousBinding !== undefined && previousBinding.external !== external)
      diagnostics.push(
        error(
          "EFFX2403",
          `${owner.name}: mixed local/external bindings in ${data.root}/${data.group} (also ${previousBinding.name})`,
        ),
      );
    else groupBindings.set(groupKey, { name: owner.name, external });

    if (external) {
      const group = ir.nodes.find(
        (candidate) =>
          candidate._tag === "HttpGroup" &&
          candidate.root === data.root &&
          candidate.group === data.group,
      );

      if (group === undefined)
        diagnostics.push(
          error(
            "EFFX2402",
            `${owner.name}: external HTTP group ${data.root}/${data.group} needs @Http.Group`,
          ),
        );
      else if (group._tag === "HttpGroup" && group.rootSymbol === undefined)
        diagnostics.push(
          error(
            "EFFX2402",
            `${owner.name}: external HTTP group ${data.root}/${data.group} needs a concrete HttpApi root`,
          ),
        );
    }

    const siblings = IRGraph.incoming(index, owner.id, "ExtensionOf").filter(
      (edge) => edge.qualifier === "HttpContract",
    );

    if (siblings.length > 1)
      diagnostics.push(diagnostic(node, "more than one HttpContract on one operation"));
    const rootName = data.root.replace(/[^A-Za-z0-9_$]/gu, "");
    const priorRoot = rootNames.get(rootName);

    if (priorRoot !== undefined && priorRoot !== data.root) {
      diagnostics.push(diagnostic(node, `root export collides with ${priorRoot}`));
    }

    rootNames.set(rootName, data.root);
  }

  for (const operation of ir.nodes) {
    if (operation._tag !== "Operation" || operation.handler !== undefined) continue;

    const hasHttp = IRGraph.outgoing(index, operation.id, "ExposedAs").some((edge) => {
      const target = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return target?._tag === "Exposure" && target.transport._tag === "http";
    });

    if (
      hasHttp &&
      !IRGraph.incoming(index, operation.id, "ExtensionOf").some(
        (edge) => edge.qualifier === "HttpContract",
      )
    )
      diagnostics.push(
        error(
          "EFFX2403",
          `${operation.name}: externally bound HTTP requires a contract and metadata.operationId`,
        ),
      );
  }

  return diagnostics;
};

export const httpContractExtension: Extension = extension("http-contract", [httpContract], {
  analyses: [validate],
});
