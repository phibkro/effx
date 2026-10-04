import type { SchemaAST } from "effect";

/**
 * The lowering plan of an annotation's arguments (spec 0020 §2.2): plain data derived from `args`.
 * The runtime holds no Schema: the compiler derives its decode Schema from a plan and the frontend
 * walks a plan together with the TypeScript expression. One plan, three consumers. The two variants
 * only `A.fromSchema` produces (`Refine`, `Invalid`) are the exceptions: `Refine` carries Schema
 * checks (closures), so a plan is serializable only when it has none.
 */

/**
 * The closed set of named frontend checks for a `SymbolRef` position. Each reproduces one lowering
 * context of the pre-0020 frontend, so lowering stays byte-identical.
 */
export type SymbolCheck =
  /** Generic: a service class (or a const holding a plain runtime value); the pre-0020 default. */
  | "generic"
  /** Any exported value, or an exported top-level function (`Http.Access.annotator`, resolver). */
  | "exported-value"
  /** An exported callable (`Http.Contract.metadata.annotator`). */
  | "callable"
  /** An exported top-level function or any exported callable (`metadata.commandIdentity`). */
  | "exported-function"
  /** An exported value used as a derivation registry (`Http.Problems.registry`). */
  | "registry"
  /** A service class; flags the installed `HttpApiMiddleware` security type stamp. */
  | "security-marker"
  /** An exported concrete `HttpApi` value with a literal identifier (`Http.Group.root`). */
  | "httpapi-root"
  /** An exported `Http.group` value or `@Http.Group` class (`Http.In`). */
  | "exported-group";

/**
 * What `fields` a Schema position records statically (the `header-fields` enrichment): every key of a
 * struct (`"all"`) or only its required keys (`"required"`).
 */
export type FieldKeys = "all" | "required";

export type Plan =
  | { readonly _tag: "String"; readonly nonEmpty?: true }
  | { readonly _tag: "Number" }
  | { readonly _tag: "Int" }
  | { readonly _tag: "Boolean" }
  | { readonly _tag: "Literal"; readonly values: ReadonlyArray<string | number | boolean> }
  | {
      readonly _tag: "Struct";
      readonly fields: Readonly<Record<string, Plan>>;
      /** Keys that may be absent in the lowered value. */
      readonly optional: ReadonlyArray<string>;
      /** Keys whose duplicate declaration in one object literal is a lowering error. */
      readonly rejectDuplicate?: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Array";
      readonly item: Plan;
      readonly nonEmpty?: true;
      readonly unique?: true;
    }
  | { readonly _tag: "Record"; readonly value: Plan }
  | { readonly _tag: "Json" }
  | { readonly _tag: "JsonObject" }
  | {
      readonly _tag: "TaggedUnion";
      readonly cases: Readonly<Record<string, Readonly<Record<string, Plan>>>>;
    }
  | { readonly _tag: "Union"; readonly members: ReadonlyArray<Plan> }
  | {
      readonly _tag: "Schema";
      readonly fieldKeys?: FieldKeys;
      /**
       * With `fieldKeys`: a Schema without static `fields` lowers without them instead of being rejected
       * (`Query.input`: the 0024 pre-pass classifies such an input as "keys unknown").
       */
      readonly fieldsOptional?: true;
      /** The Schema's `Type` must have a literal-union `_tag` (`Foldkit.Command` Messages, EFFX2601). */
      readonly taggedMessage?: true;
    }
  | {
      readonly _tag: "Symbol";
      readonly check: SymbolCheck;
      /** Overrides the diagnostic text of a failed check; absent keeps the check's default. */
      readonly message?: string;
    }
  /** `Capability.make(name, { resource, focus? })` or a const holding it (the `Authorize` argument). */
  | { readonly _tag: "Capability" }
  /** Supplied by the collector, never written in source (`PersistentModel.schema`). */
  | { readonly _tag: "Injected"; readonly plan: Plan }
  /**
   * `A.fromSchema` only: `plan` plus the Schema refinement checks the algebra has no name for
   * (`isMaxLength`, `makeFilter`, …). The frontend lowers by `plan`; the derived decode Schema runs
   * `checks` after lowering, in compiler code, never in the application (spec 0020 §2.2).
   */
  | {
      readonly _tag: "Refine";
      readonly plan: Plan;
      readonly checks: readonly [SchemaAST.Check<unknown>, ...Array<SchemaAST.Check<unknown>>];
    }
  /**
   * `A.fromSchema` only: a Schema node the frontend cannot lower, named by its kind. `define` stays total and
   * records each as an `EFFX1301` diagnostic in `DefinitionData.diagnostics`, with its path in `args`.
   */
  | { readonly _tag: "Invalid"; readonly kind: string };

/** The positional argument list of one annotation. `rest` absorbs trailing arguments. */
export interface ArgsPlan {
  readonly items: ReadonlyArray<Plan>;
  readonly rest?: Plan;
}
