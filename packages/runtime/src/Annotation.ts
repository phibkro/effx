import type { Context, Schema } from "effect";

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

export interface OperationOptions {
  readonly name?: string;
  readonly input: Schema.Top;
  readonly success: Schema.Top;
}

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
export interface FoldkitCommandOptions {
  readonly success: Schema.Top;
  readonly failure: Schema.Top;
}

/** Live HTTP contract values are lowered to references by the source frontend. */
export interface HttpContractOptions {
  readonly root?: string;
  readonly group?: string;
  readonly params?: Schema.Top;
  readonly query?: Schema.Top | true;
  readonly headers?: Schema.Top;
  readonly payload?: Schema.Top;
  /** POST body carrying read-only query input; the compiler checks verb and operation. */
  readonly payloadIsQuery?: boolean;
  readonly success?: Schema.Top;
  readonly status?: number;
  readonly mediaType?: string;
  readonly responseHeaders?: Schema.Top;
  readonly conditional?: boolean;
  readonly middleware?: ReadonlyArray<ServiceLike>;
  readonly metadata?: {
    readonly annotator?: HttpOperationAnnotator;
    readonly operationId?: string;
    readonly commandIdentity?: ExportedFunctionSymbol;
    readonly summary?: string;
    readonly description?: string;
    readonly tags?: ReadonlyArray<string>;
  };
}

/** A named HTTP group is source metadata, independent of its operation declarations. */
export interface HttpGroupOptions {
  /** A legacy name, or an exported concrete HttpApi value with a literal identifier. */
  readonly root: string | { readonly identifier: string };
  readonly group: string;
  readonly title?: string;
  readonly description?: string;
  readonly displayName?: string;
  readonly defaults?: {
    readonly middleware?: ReadonlyArray<ServiceLike>;
    readonly metadata?: { readonly annotator?: HttpOperationAnnotator };
    readonly problems?: { readonly registry?: ProblemRegistry };
    readonly access?: Partial<
      Pick<
        HttpAccessOptions,
        "annotator" | "exposure" | "acceptedCredentials" | "principalKinds" | "concealment"
      >
    >;
  };
}

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

/** Source-only declaration; the application owns evaluation and transaction timing. */
export interface HttpAccessOptions extends Omit<
  HttpAccessAnnotationSpec,
  "exposure" | "acceptedCredentials" | "principalKinds" | "concealment"
> {
  /** Exported function lowered as a SymbolRef, never called by the decorator. */
  readonly annotator?: (spec: HttpAccessAnnotationSpec) => Context.Context<never>;
  readonly exposure?: HttpAccessAnnotationSpec["exposure"];
  readonly acceptedCredentials?: HttpAccessAnnotationSpec["acceptedCredentials"];
  readonly principalKinds?: HttpAccessAnnotationSpec["principalKinds"];
  readonly concealment?: HttpAccessAnnotationSpec["concealment"];
}

export interface HttpProblemsOptions<Code extends string = string> {
  readonly registry?: ProblemRegistry<Code>;
  readonly codes: ReadonlyArray<Code>;
  readonly identifier?: string;
  readonly map?: Readonly<Record<string, string>>;
}

export interface PersistentModelOptions {
  readonly table: string;
  readonly views?: Readonly<Record<string, Schema.Top>>;
  readonly focus?: Readonly<Record<string, Focus | ReadonlyArray<string>>>;
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
