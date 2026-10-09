import type { Annotation as AnnotationRecord } from "../Annotation.js";
import { define } from "./define.js";

export { A } from "./arg.js";

export type {
  Arg,
  CapabilityMarker,
  InjectedArg,
  JsonValue,
  OptionalArg,
  RootSymbolMarker,
  SchemaMarker,
  SourceOptionalArg,
  SymbolMarker,
} from "./arg.js";

export { AppliedTypeId, DefinitionTypeId, rest } from "./define.js";

export type {
  Applied,
  AppliedBrand,
  ArgsInput,
  Definition,
  DefinitionBrand,
  DefinitionData,
  DefinitionDiagnostic,
  DefineOptions,
  EffectClause,
  InternalTarget,
  LiveParameters,
  ReadParameters,
  PublicTarget,
  RestArgs,
  Target,
} from "./define.js";

export type { ArgsPlan, FieldKeys, Plan, SymbolCheck } from "./plan.js";

/** The runtime record of one annotation (`{ name, args }`), and the namespace of annotation authoring. */
export interface Annotation extends AnnotationRecord {}

export const Annotation = { define } as const;
