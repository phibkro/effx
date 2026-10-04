export * as StableId from "./StableId.ts";

export { SchemaRef, SymbolRef } from "./Refs.ts";

export {
  Node,
  Transport,
  View,
  OperationKind,
  HttpMethod,
  type SchemaNode,
  type ModelNode,
  type ServiceNode,
  type OperationNode,
  type HttpGroupNode,
  type CapabilityNode,
  type FocusNode,
  type ExposureNode,
  type ExtensionNode,
} from "./Node.ts";

export { Edge, EdgeKind } from "./Edge.ts";

export { ApplicationIR, FORMAT, VERSION, empty, make } from "./ApplicationIR.ts";

export { ApplicationIRV1, EdgeKindV1, EdgeV1, migrate } from "./migrate.ts";

export { normalize, normalizeNode } from "./normalize.ts";

export {
  JsonCodec,
  StringCodec,
  encode,
  decode,
  decodeString,
  canonical,
  canonicalJson,
  semanticHash,
} from "./canonical.ts";

export * as IRGraph from "./graph.ts";

export type { GraphIndex, MissingTarget } from "./graph.ts";

export * as IRArbitrary from "./arbitrary.ts";
