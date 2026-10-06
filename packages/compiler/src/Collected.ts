import { type Effect, Schema } from "effect";
import { SchemaRef, StableId, SymbolRef } from "@effx/ir";
import { Diagnostic, Location, type StageResult } from "./Diagnostic.ts";
import type { CompilerFault } from "./CompilerFault.ts";

/**
 * Frontend-neutral annotation argument. Decorators and builder chains both lower to this,
 * which is what makes the syntax-equivalence law testable.
 *
 * @internal
 */
export type AnnotationArg =
  | string
  | number
  | boolean
  | {
      readonly _tag: "Schema";
      readonly ref: SchemaRef;
      readonly fields?: ReadonlyArray<string>;
      readonly marker?: "headers";
    }
  | {
      readonly _tag: "Symbol";
      readonly ref: SymbolRef;
      readonly security?: boolean;
      readonly identifier?: string;
    }
  | { readonly _tag: "Lambda" }
  | ReadonlyArray<AnnotationArg>
  | { readonly [key: string]: AnnotationArg };

/** @internal */
export const AnnotationArg: Schema.Codec<AnnotationArg> = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.TaggedStruct("Schema", {
    ref: SchemaRef,
    fields: Schema.optionalKey(Schema.Array(Schema.String)),
    marker: Schema.optionalKey(Schema.Literal("headers")),
  }),
  Schema.TaggedStruct("Symbol", {
    ref: SymbolRef,
    security: Schema.optionalKey(Schema.Boolean),
    identifier: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct("Lambda", {}),
  Schema.Array(Schema.suspend((): Schema.Codec<AnnotationArg> => AnnotationArg)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<AnnotationArg> => AnnotationArg),
  ),
]);

/**
 * One applied annotation. `definition` is the export of the annotation's own definition (spec 0020): the
 * frontend records it for an applied user definition (decorator or `.with(...)`), never for a built-in or
 * the generic `Annotate(name, ...)`, so a default writer can import the definition
 * (`<Definition>.effect.key`) into generated code.
 *
 * @internal
 */
export const Annotation = Schema.Struct({
  name: Schema.String,
  args: Schema.Array(AnnotationArg),
  definition: Schema.optionalKey(SymbolRef),
});

/** @internal */
export type Annotation = typeof Annotation.Type;

/**
 * What the frontend could resolve a handler type constituent to.
 *
 * @internal
 */
export const TypeRef = Schema.TaggedUnion({
  Schema: {
    ref: SchemaRef,
    httpStatus: Schema.optionalKey(Schema.Int),
    errorTag: Schema.optionalKey(Schema.String),
  },
  Service: { id: StableId.StableId, symbol: SymbolRef },
  Opaque: { display: Schema.String },
});

/** @internal */
export type TypeRef = typeof TypeRef.Type;

/** @internal */
export const HandlerSignature = Schema.Struct({
  success: TypeRef,
  errors: Schema.Array(TypeRef),
  requirements: Schema.Array(TypeRef),
});

/** @internal */
export type HandlerSignature = typeof HandlerSignature.Type;

/** @internal */
export const DeclarationKind = Schema.Literals(["class", "staticMethod", "builder", "model"]);

/** @internal */
export type DeclarationKind = typeof DeclarationKind.Type;

/** @internal */
export const Declaration = Schema.Struct({
  /** Collector-assigned, unique within a project (e.g. `UserOperations.get`). */
  id: Schema.String,
  kind: DeclarationKind,
  module: Schema.String,
  export: Schema.String,
  member: Schema.optionalKey(Schema.String),
  annotations: Schema.Array(Annotation),
  /** No authored handler exists; an external HTTP raw binding is required. */
  binding: Schema.optionalKey(Schema.Literal("external")),
  handlerSignature: Schema.optionalKey(HandlerSignature),
  /** Start of the declaring syntax; goes to the manifest, never to the IR (ADR 0002/0003). */
  location: Schema.optionalKey(Location),
});

/** @internal */
export type Declaration = typeof Declaration.Type;

export const TargetProfile = Schema.Literals(["effect-4.0", "effect-4.0-rc"]);

export type TargetProfile = typeof TargetProfile.Type;

export const EmitMode = Schema.Literals(["contract", "handlers", "all"]);

export type EmitMode = typeof EmitMode.Type;

/** Declared naming policy; omission preserves legacy problem-contract IR. */
export const Naming = Schema.Struct({
  problemIdentifier: Schema.optionalKey(Schema.String),
});

export type Naming = typeof Naming.Type;

/** @internal */
export const ProjectResolution = Schema.Struct({
  naming: Schema.optionalKey(Naming),
  target: TargetProfile,
  emit: EmitMode,
  strictAccess: Schema.optionalKey(Schema.Boolean),
  allowImportingTsExtensions: Schema.Boolean,
  /** One output-independent base for local symbols in canonical IR. */
  canonicalImportBase: Schema.String,
  /** Actual directory where this pass emits files. */
  outputDir: Schema.String,
});

/** @internal */
export type ProjectResolution = typeof ProjectResolution.Type;

/** @internal */
export const SpreadSource = Schema.Struct({
  declarationId: Schema.String,
  operand: Schema.String,
  location: Location,
});

/** @internal */
export type SpreadSource = typeof SpreadSource.Type;

/** A type reference inside a mirrored constraint/default, addressed by its source span. */
export const GroupBindingReference = Schema.Struct({
  ref: SymbolRef,
  /** True when the clause needs the value binding (`typeof`); false when a type-only import suffices. */
  value: Schema.Boolean,
  where: Schema.Literals(["constraint", "default"]),
  /** Offsets of the whole resolved type-reference name inside its text, so printing replaces it exactly. */
  start: Schema.Finite,
  end: Schema.Finite,
});

export type GroupBindingReference = typeof GroupBindingReference.Type;

/** One mirrored type parameter of a handler factory; `constraint`/`default` keep their source syntax. */
export const GroupBindingTypeParameter = Schema.Struct({
  name: Schema.String,
  /** Source syntax of the constraint; empty when the parameter declares none. */
  constraint: Schema.String,
  /** Source syntax of the default; empty when the parameter declares none. */
  default: Schema.String,
  references: Schema.Array(GroupBindingReference),
});

export type GroupBindingTypeParameter = typeof GroupBindingTypeParameter.Type;

/** Backend-owned static references, deliberately outside the semantic IR. @internal */
export const GroupBinding = Schema.Struct({
  group: SymbolRef,
  handlers: SymbolRef,
  /** Type parameters the bound wrapper must mirror; empty when the factory is not generic. */
  handlersTypeParameters: Schema.Array(GroupBindingTypeParameter),
  /** The guard factory's own type parameters, so the tuple check instantiates its positional prefix. */
  guardsTypeParameters: Schema.Array(GroupBindingTypeParameter),
  guards: Schema.optionalKey(SymbolRef),
  guardFor: Schema.optionalKey(SymbolRef),
});

export type GroupBinding = typeof GroupBinding.Type;

/** @internal */
export const Collected = Schema.Struct({
  declarations: Schema.Array(Declaration),
  bindings: Schema.optionalKey(Schema.Array(GroupBinding)),
  /** Frontend diagnostics travel as data (spec 0002); the pipeline merges them. */
  diagnostics: Schema.Array(Diagnostic),
  /** Resolved source spreads are provenance, never semantic IR data. */
  spreads: Schema.optionalKey(Schema.Array(SpreadSource)),
  /** Project settings are compiler context, not nodes in the semantic IR. */
  project: Schema.optionalKey(ProjectResolution),
});

/**
 * The frontend may carry a non-serializable target resolver across the in-process pipeline.
 *
 * @internal
 */
export type Collected = typeof Collected.Type & {
  readonly resolveEffectModule?: (specifier: string) => boolean;
  /** Suspended whole-root proof owned by the frontend Program; never serialized or semantic IR. */
  readonly resolveHttpApiInventory?: (
    root: SymbolRef,
  ) => Effect.Effect<StageResult<ReadonlyArray<HttpApiGroupInventory>>, CompilerFault>;
};

/** Inventory keyed by the same canonical symbol as HttpGroup.rootSymbol. */
export interface HttpApiGroupInventory {
  readonly root: SymbolRef;
  readonly group: string;
  readonly endpoints: ReadonlyArray<string>;
}

export const ProjectConfig = Schema.Struct({
  naming: Schema.optionalKey(Naming),
  tsconfigPath: Schema.String,
  entry: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Where generated files go; default `<dirname(tsconfigPath)>/.effx/generated`. */
  outDir: Schema.optionalKey(Schema.String),
  /** One explicit source identity shared by contract/handler tsconfig projects. */
  projectRoot: Schema.optionalKey(Schema.String),
  target: Schema.optionalKey(TargetProfile),
  emit: Schema.optionalKey(EmitMode),
  strictAccess: Schema.optionalKey(Schema.Boolean),
});

export type ProjectConfig = typeof ProjectConfig.Type;

/** @internal */
export const symbolOf = (declaration: Declaration): SymbolRef => {
  if (declaration.member === undefined) {
    return { module: declaration.module, export: declaration.export };
  }

  return { module: declaration.module, export: declaration.export, member: declaration.member };
};
