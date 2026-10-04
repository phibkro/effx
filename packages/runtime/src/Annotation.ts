import type { Context, Schema } from "effect";
import type * as Builtins from "./builtins.js";

/** A value usable as an annotation argument: literal, Schema, service class, capability, focus, record, array, function. */
export type AnnotationValue = string | number | boolean | object;

/**
 * The runtime form of a spec 0001 annotation: same `name`, same argument structure, live values
 * instead of symbol references. Decorators and builders both produce these (spec 0002).
 */
export interface Annotation {
  readonly name: string;
  readonly args: ReadonlyArray<AnnotationValue>;
}

/** A `Context.Service` class (its static side carries `key`). */
export interface ServiceLike {
  readonly key: string;
}

/*
 * The per-annotation option types below are DERIVED from the built-in definitions
 * (`builtins.ts`, spec 0020 §3): the definition's `args` is the only declaration. The types the
 * definitions themselves consume (`ServiceLike`, `Focus`, `Capability`, `ProblemRegistry`,
 * `HttpAccessAnnotationSpec`, ...) stay hand-written: deriving them from the definitions that
 * mention them would make the type alias circular.
 */

/** `Query`/`Command` options. */
export type OperationOptions = Parameters<typeof Builtins.Query>[0];

/** The app owns key issuance and keeps the original HTTP request and precondition for retries. */
export interface CommandIdentityValue {
  readonly key: string;
  readonly input: object;
  readonly precondition: string | null;
}

/** An application-exported function referenced by source, never invoked by the compiler. */
export type ExportedFunctionSymbol = (request: never) => CommandIdentityValue;

/** Metadata available to an application-owned HTTP operation annotator. */
export interface HttpOperationMetadata {
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
}

/** An exported callable returning annotations merged onto the generated endpoint. */
export type HttpOperationAnnotator = (metadata: HttpOperationMetadata) => Context.Context<never>;

/** App-owned Message schemas; the generated Command only maps into their declared types. */
export type FoldkitCommandOptions = Parameters<typeof Builtins.FoldkitCommand>[0];

/** Live HTTP contract values are lowered to references by the source frontend. */
export type HttpContractOptions = Parameters<typeof Builtins.HttpContract>[0];

/** A named HTTP group is source metadata, independent of its operation declarations. */
export type HttpGroupOptions = Parameters<typeof Builtins.HttpGroup>[0];

/** Source-only declaration; the application owns evaluation and transaction timing. */
export type HttpAccessOptions = Parameters<typeof Builtins.HttpAccess>[0];

/**
 * `Http.Problems` options. The definition is not generic, so only the two `Code`-dependent fields
 * are written here; every other field is derived.
 */
export type HttpProblemsOptions<Code extends string = string> = Omit<
  Parameters<typeof Builtins.HttpProblems>[0],
  "registry" | "codes"
> & {
  readonly registry?: ProblemRegistry<Code>;
  readonly codes: ReadonlyArray<Code>;
};

/** `PersistentModel` options; the collector (or the decorator) supplies `schema`. */
export type PersistentModelOptions = Parameters<typeof Builtins.PersistentModel>[0];

/** Exported derivation function imported by the generated endpoint. */
export type ProblemRegistry<Code extends string = string> = (
  identifier: string,
  codes: readonly [Code, ...Code[]],
) => ReadonlyArray<Schema.Top>;

/** JSON-only values in application-defined requirement parameters. */
export type AccessJson =
  | null
  | string
  | number
  | boolean
  | ReadonlyArray<AccessJson>
  | { readonly [key: string]: AccessJson };

export type NonEmptyStrings = readonly [string, ...string[]];

export type AccessCapabilities =
  | { readonly _tag: "None" }
  | { readonly _tag: "One"; readonly capability: string }
  | { readonly _tag: "Any" | "All"; readonly capabilities: NonEmptyStrings };

export type AccessConcealment =
  | { readonly _tag: "Reveal" }
  | { readonly _tag: "NotFound"; readonly stages: NonEmptyStrings };

/** Values passed unchanged to the application annotator in generated endpoint code. */
export interface HttpAccessAnnotationSpec {
  readonly exposure: "External" | "Internal";
  readonly acceptedCredentials: NonEmptyStrings;
  readonly principalKinds: NonEmptyStrings;
  readonly capabilities: AccessCapabilities;
  readonly requirements: ReadonlyArray<{
    readonly id: string;
    readonly parameters?: Readonly<Record<string, AccessJson>>;
  }>;
  /** Application-exported value, resolved to a SymbolRef by the frontend. */
  readonly canonicalScopeResolver: object;
  readonly concealment: AccessConcealment;
  readonly decisionTime: "SnapshotRead" | "Transaction";
}

export interface Focus {
  readonly _tag: "Focus";
  readonly root: Schema.Top;
  readonly path: ReadonlyArray<string>;
}

export interface Capability {
  readonly _tag: "Capability";
  readonly name: string;
  readonly resource: Schema.Top;
  readonly focus?: Focus;
}

/**
 * Annotations recorded on decorated classes and static methods. `context.metadata` exists under
 * Bun but `Symbol.metadata` does not, so a WeakMap keyed by the decorated value is the registry.
 */
const registry = new WeakMap<object, Array<Annotation>>();

/**
 * Decorators are *applied* bottom-up although they are *written* top-down; prepending keeps
 * the recorded order equal to source order, which is what builder chains produce.
 */
export const record = <Target extends object>(target: Target, annotation: Annotation): void => {
  const existing = registry.get(target);

  if (existing === undefined) {
    registry.set(target, [annotation]);
  } else {
    existing.unshift(annotation);
  }
};

export const annotationsOf = <Target extends object>(target: Target): ReadonlyArray<Annotation> =>
  registry.get(target) ?? [];
