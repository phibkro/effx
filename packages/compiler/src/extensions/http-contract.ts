import { Option, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { IRGraph, StableId } from "@effx/ir";
import { type Analysis, Contribution, type Extension } from "../Extension.ts";
import type { Diagnostic } from "../Diagnostic.ts";
import { HttpDiagnostics } from "../diagnostics/http.ts";
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
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "InvalidData", subject: node.id }));
      continue;
    }

    const data = decoded.value;
    const edges = IRGraph.outgoing(index, node.id, "ExtensionOf");

    if (edges.length !== 1 || edges[0]?.qualifier !== "HttpContract") {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "InvalidEdge", subject: node.id }));
      continue;
    }

    const owner = Option.getOrUndefined(IRGraph.nodeOf(index, edges[0].to));

    if (owner?._tag !== "Operation") {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "NotOperation", subject: node.id }));
      continue;
    }

    const exposures = IRGraph.outgoing(index, owner.id, "ExposedAs").flatMap((edge) => {
      const target = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return target?._tag === "Exposure" && target.transport._tag === "http"
        ? [target.transport]
        : [];
    });

    if (exposures.length !== 1) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "ExposureCount", subject: node.id }));
      continue;
    }

    const transport = exposures[0]!;

    if (
      data.payloadIsQuery &&
      (owner.kind !== "Query" || transport.method !== "POST" || data.payload === undefined)
    ) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "PayloadIsQuery", subject: node.id }));
    }

    if (transport.method === "GET" && data.payload !== undefined) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "GetPayload", subject: node.id }));
    }

    if (data.conditional && (transport.method !== "GET" || data.responseHeaders === undefined)) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "Conditional", subject: node.id }));
    }

    if (data.mediaType !== undefined && data.payload === undefined) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "MediaType", subject: node.id }));
    }

    if (data.status !== undefined && (data.status < 100 || data.status > 599)) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "Status", subject: node.id }));
    }

    if (!identifier.test(data.root) || !groupIdentifier.test(data.group)) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "Identifiers", subject: node.id }));
    }

    const rawPathNames = routeParamNames(transport.path);

    const pathNames = (
      data.paramsKeys === undefined
        ? rawPathNames
        : routeParamNames(transport.path, new Set(data.paramsKeys))
    ).toSorted();

    if (rawPathNames.length > 0 !== (data.params !== undefined)) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "ParamsRequired", subject: node.id }));
    } else if (data.params !== undefined) {
      if (
        data.paramsKeys === undefined ||
        pathNames.join("\0") !== [...data.paramsKeys].toSorted().join("\0")
      ) {
        diagnostics.push(
          HttpDiagnostics.EFFX2402.emit({ _tag: "ParamsMismatch", subject: node.id }),
        );
      }
    }

    if (data.metadata?.commandIdentity !== undefined) {
      if (owner.kind !== "Command")
        diagnostics.push(
          HttpDiagnostics.EFFX2402.emit({ _tag: "CommandIdentityKind", subject: node.id }),
        );

      const headers = data.headersKeys ?? [];

      if (
        data.headers === undefined ||
        !headers.some((header) => header.toLowerCase() === "idempotency-key") ||
        !headers.some((header) => header.toLowerCase() === "if-match")
      )
        diagnostics.push(
          HttpDiagnostics.EFFX2402.emit({ _tag: "CommandIdentityHeaders", subject: node.id }),
        );
    }

    const operationId = data.metadata?.operationId;

    if (operationId === undefined) {
      if (owner.handler === undefined)
        diagnostics.push(HttpDiagnostics.EFFX2403.emit({ _tag: "MissingId", subject: owner.name }));
    } else {
      const prefix = `${data.group}.`;
      const key = operationId.startsWith(prefix) ? operationId.slice(prefix.length) : "";

      if (!endpointIdentifier.test(key)) {
        diagnostics.push(
          HttpDiagnostics.EFFX2403.emit({
            _tag: "InvalidId",
            subject: owner.name,
            group: data.group,
          }),
        );
      } else {
        const qualified = `${data.root}:${data.group}:${key}`;
        const previous = endpointKeys.get(qualified);

        if (previous !== undefined && previous !== owner.name)
          diagnostics.push(
            HttpDiagnostics.EFFX2403.emit({
              _tag: "DuplicateKey",
              subject: owner.name,
              operationId,
              previous,
            }),
          );
        else endpointKeys.set(qualified, owner.name);
      }
    }

    const groupKey = `${data.root}:${data.group}`;
    const external = owner.handler === undefined;
    const previousBinding = groupBindings.get(groupKey);

    if (previousBinding !== undefined && previousBinding.external !== external)
      diagnostics.push(
        HttpDiagnostics.EFFX2403.emit({
          _tag: "MixedBindings",
          subject: owner.name,
          root: data.root,
          group: data.group,
          previous: previousBinding.name,
        }),
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
          HttpDiagnostics.EFFX2402.emit({
            _tag: "ExternalGroup",
            subject: owner.name,
            root: data.root,
            group: data.group,
            missing: "group",
          }),
        );
      else if (group._tag === "HttpGroup" && group.rootSymbol === undefined)
        diagnostics.push(
          HttpDiagnostics.EFFX2402.emit({
            _tag: "ExternalGroup",
            subject: owner.name,
            root: data.root,
            group: data.group,
            missing: "root",
          }),
        );
    }

    const siblings = IRGraph.incoming(index, owner.id, "ExtensionOf").filter(
      (edge) => edge.qualifier === "HttpContract",
    );

    if (siblings.length > 1)
      diagnostics.push(
        HttpDiagnostics.EFFX2402.emit({ _tag: "DuplicateContracts", subject: node.id }),
      );
    const rootName = data.root.replace(/[^A-Za-z0-9_$]/gu, "");
    const priorRoot = rootNames.get(rootName);

    if (priorRoot !== undefined && priorRoot !== data.root) {
      diagnostics.push(
        HttpDiagnostics.EFFX2402.emit({
          _tag: "RootCollision",
          subject: node.id,
          previous: priorRoot,
        }),
      );
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
        HttpDiagnostics.EFFX2403.emit({ _tag: "MissingContract", subject: operation.name }),
      );
  }

  return diagnostics;
};

export const httpContractExtension: Extension = extension("http-contract", [httpContract], {
  analyses: [validate],
});
