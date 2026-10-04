import { Schema } from "effect";
import { SchemaRef, SymbolRef } from "./Refs.ts";
import { StableId } from "./StableId.ts";

export const OperationKind = Schema.Literals(["Query", "Command"]);

export type OperationKind = typeof OperationKind.Type;

export const HttpMethod = Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export type HttpMethod = typeof HttpMethod.Type;

/** A set-valued field that is either inferred from the handler or declared (ADR 0005). */
const Declared = <S extends Schema.Constraint>(value: S) =>
  Schema.Struct({ values: Schema.Array(value), inferred: Schema.Boolean });

export const View = Schema.Struct({ name: Schema.String, schema: SchemaRef });

export type View = typeof View.Type;

export const Transport = Schema.Union([
  Schema.TaggedStruct("http", { method: HttpMethod, path: Schema.String }),
  Schema.TaggedStruct("rpc", { name: Schema.String }),
  Schema.TaggedStruct("cli", { command: Schema.Array(Schema.String) }),
]);

export type Transport = typeof Transport.Type;

export const Node = Schema.TaggedUnion({
  Schema: { id: StableId, ref: SchemaRef },
  Model: {
    id: StableId,
    name: Schema.String,
    schema: SchemaRef,
    table: Schema.optionalKey(Schema.String),
    views: Schema.Array(View),
  },
  Service: { id: StableId, name: Schema.String, symbol: SymbolRef },
  Operation: {
    id: StableId,
    name: Schema.String,
    kind: OperationKind,
    input: SchemaRef,
    success: SchemaRef,
    errors: Declared(SchemaRef),
    requirements: Declared(StableId),
    binding: Schema.optionalKey(Schema.Literal("external")),
    handler: Schema.optionalKey(SymbolRef),
  },
  HttpGroup: {
    id: StableId,
    root: Schema.String,
    rootSymbol: Schema.optionalKey(SymbolRef),
    group: Schema.String,
    title: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
    displayName: Schema.optionalKey(Schema.String),
  },
  Capability: {
    id: StableId,
    name: Schema.String,
    resource: StableId,
    focus: Schema.optionalKey(StableId),
  },
  Focus: { id: StableId, root: StableId, path: Schema.Array(Schema.String) },
  Exposure: { id: StableId, operation: StableId, transport: Transport },
  Extension: { id: StableId, extension: Schema.String, tag: Schema.String, data: Schema.Json },
}).check(
  Schema.makeFilter((node) => {
    if (node._tag !== "Operation") return undefined;

    if (node.binding === "external") {
      return node.handler === undefined
        ? undefined
        : { path: ["handler"], issue: "external operations cannot have a local handler" };
    }

    return node.handler === undefined
      ? { path: ["handler"], issue: "local operations require a handler" }
      : undefined;
  }),
);

export type Node = typeof Node.Type;

export type SchemaNode = typeof Node.cases.Schema.Type;

export type ModelNode = typeof Node.cases.Model.Type;

export type ServiceNode = typeof Node.cases.Service.Type;

export type OperationNode = typeof Node.cases.Operation.Type;

export type HttpGroupNode = typeof Node.cases.HttpGroup.Type;

export type CapabilityNode = typeof Node.cases.Capability.Type;

export type FocusNode = typeof Node.cases.Focus.Type;

export type ExposureNode = typeof Node.cases.Exposure.Type;

export type ExtensionNode = typeof Node.cases.Extension.Type;
