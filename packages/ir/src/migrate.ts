import { Schema } from "effect";
import { type ApplicationIR, FORMAT, make } from "./ApplicationIR.ts";
import { Node, OperationKind } from "./Node.ts";
import { SchemaRef, SymbolRef } from "./Refs.ts";
import { StableId } from "./StableId.ts";

/** The persisted v1 input vocabulary. Do not add v2 edges to this schema. */
export const EdgeKindV1 = Schema.Literals([
  "InputOf",
  "SuccessOf",
  "ErrorOf",
  "Requires",
  "AuthorizedBy",
  "Focuses",
  "ExposedAs",
  "PersistsAs",
  "ViewOf",
]);

export const EdgeV1 = Schema.Struct({
  kind: EdgeKindV1,
  from: StableId,
  to: StableId,
  qualifier: Schema.optionalKey(Schema.String),
});

/** v1's persisted operation always carried a handler; external bindings are v2-only. */
const OperationV1 = Schema.TaggedStruct("Operation", {
  id: StableId,
  name: Schema.String,
  kind: OperationKind,
  input: SchemaRef,
  success: SchemaRef,
  errors: Node.cases.Operation.fields.errors,
  requirements: Node.cases.Operation.fields.requirements,
  handler: SymbolRef,
});

const NodeV1 = Schema.Union([
  Node.cases.Schema,
  Node.cases.Model,
  Node.cases.Service,
  OperationV1,
  Node.cases.Capability,
  Node.cases.Focus,
  Node.cases.Exposure,
  Node.cases.Extension,
]);

/** Read-only compatibility boundary, never the shape produced by IR builders or encoders. */
export const ApplicationIRV1 = Schema.Struct({
  format: Schema.Literal(FORMAT),
  version: Schema.Literal(1),
  nodes: Schema.Array(NodeV1),
  edges: Schema.Array(EdgeV1),
});

export type ApplicationIRV1 = typeof ApplicationIRV1.Type;

/** Pure version upgrade: no normalization, no dropped or rewritten nodes/edges. */
export const migrate = (ir: ApplicationIRV1 | ApplicationIR): ApplicationIR =>
  ir.version === 2 ? ir : make(ir.nodes, ir.edges);
