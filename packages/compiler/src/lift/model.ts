import { Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import { TargetProfile } from "../Collected.ts";
import { NativeCallee } from "./native.ts";
import { Finding, SourceFileRecord, SourcePosition, SourceRange, TermSlot } from "./source.ts";

/*
 * The frontend → core boundary of spec 0019 (§3.1, §8 S7): a Schema-defined, IR-free inventory of the
 * Effect declarations of one project, built from the ONE existing neutral `Term` (`generate/term.ts`) over
 * resolved `SchemaRef`/`SymbolRef` references. No `ts.*` object crosses it, nothing in it enters the IR, and
 * source locations live here, never in a `Term`.
 *
 * Lowering conventions the frontend follows (the core accepts every equivalent spelling):
 *
 * - An identifier resolving to an exported value is `Ref`: a `SchemaRef` when its static type is an Effect
 *   Schema, otherwise a `SymbolRef`; a static member (`Errors.NotFound`, `X.fields`) is `Member(Ref, name)`.
 *   An identifier that is not an exported value is not a `Ref`: it is a `Finding`.
 * - `f(a, b)` is `Call`; a postfix method chain may be `Chain(head, calls)` or nested `Call(Member(..))`.
 * - A subtree made only of strings, numbers, booleans, null, arrays and objects of those may be one `Lit`
 *   or `Arr`/`Obj` of `Lit`s. TypeScript-only wrappers (`as`, `satisfies`, `!`) and parentheses are transparent.
 * - `.pipe((e) => W(e, a, b))`, where the body calls `W` with the arrow's only parameter first and nowhere
 *   else, is `Apply { form: "pipe", callee: W, args: [a, b] }`; `W(endpoint, a, b)` around a whole declaration
 *   is `Apply { form: "wrapper" }`. Any other arrow is a `closure` finding.
 * - A construct that cannot be lowered is never approximated: its slot is `Unlowered` with `Finding`s, so no
 *   partial term exists, and the other slots of the same declaration stay available so every applicable
 *   cause of an unsupported declaration is still found.
 * - Native Effect references are claimed in `natives` by typed identity (kind, target profile, resolved
 *   reference, member); the core validates each claim against the target profile's module table.
 */

/** An entry of an options object: a statically named property, or an entry no name or value can be read from. */
export const OptionEntry = Schema.TaggedUnion({
  Property: { name: Schema.String, value: TermSlot, range: SourceRange },
  Unsupported: { finding: Finding },
});

export type OptionEntry = typeof OptionEntry.Type;

/** The options argument of a call: not written, an object literal decomposed per entry, or unreadable. */
export const OptionsSlot = Schema.TaggedUnion({
  Absent: {},
  Entries: { entries: Schema.Array(OptionEntry), range: SourceRange },
  Unlowered: { range: SourceRange, findings: Schema.NonEmptyArray(Finding) },
});

export type OptionsSlot = typeof OptionsSlot.Type;

/**
 * One postfix step of a declaration chain. The frontend records every step by name and never judges support:
 * `Method` is `.name(args)`, `Apply` is an application wrapper, `Unsupported` is a step it cannot even name.
 */
export const StepRecord = Schema.TaggedUnion({
  Method: { name: Schema.String, args: Schema.Array(TermSlot), range: SourceRange },
  Apply: {
    form: Schema.Literals(["pipe", "wrapper"]),
    callee: TermSlot,
    args: Schema.Array(TermSlot),
    range: SourceRange,
  },
  Unsupported: { finding: Finding },
});

export type StepRecord = typeof StepRecord.Type;

/** `const X = …` or `class X extends … {}`: the two declaration forms of groups and roots. */
export const DeclarationForm = Schema.Literals(["const", "class"]);

export type DeclarationForm = typeof DeclarationForm.Type;

/**
 * `export const X = HttpApiEndpoint.<verb>(key, path, options)` plus its postfix steps. `range` is the whole
 * declaration statement: its start is where planned exports are inserted. The verb is read by the core from
 * `callee`, never duplicated here.
 */
export const EndpointRecord = Schema.Struct({
  symbol: SymbolRef,
  range: SourceRange,
  callee: TermSlot,
  key: TermSlot,
  path: TermSlot,
  options: OptionsSlot,
  steps: Schema.Array(StepRecord),
});

export type EndpointRecord = typeof EndpointRecord.Type;

/** `HttpApiGroup.make(id[, options]).add(…).annotateMerge(…)` declared as a const or a class heritage. */
export const GroupRecord = Schema.Struct({
  symbol: SymbolRef,
  form: DeclarationForm,
  range: SourceRange,
  callee: TermSlot,
  id: TermSlot,
  options: OptionsSlot,
  steps: Schema.Array(StepRecord),
});

export type GroupRecord = typeof GroupRecord.Type;

/** `HttpApi.make(id).add(…)` declared as a const or a class heritage: the hash-bearing root identity. */
export const RootRecord = Schema.Struct({
  symbol: SymbolRef,
  form: DeclarationForm,
  range: SourceRange,
  callee: TermSlot,
  id: TermSlot,
  steps: Schema.Array(StepRecord),
});

export type RootRecord = typeof RootRecord.Type;

/** What a handler registration refers to: an exported function, a closure written inline, or nothing resolvable. */
export const HandlerSource = Schema.TaggedUnion({
  Exported: { ref: SymbolRef },
  Inline: { range: SourceRange },
  Unavailable: { finding: Finding },
});

export type HandlerSource = typeof HandlerSource.Type;

/** One `h.handleRaw("key", fn)` / `h.handle("key", fn)` registration of an `HttpApiBuilder.group` chain. */
export const HandlerRegistration = Schema.TaggedUnion({
  Registered: {
    kind: Schema.Literals(["raw", "normal"]),
    key: TermSlot,
    handler: HandlerSource,
    range: SourceRange,
  },
  Unsupported: { finding: Finding },
});

export type HandlerRegistration = typeof HandlerRegistration.Type;

/**
 * An application's `HttpApiBuilder.group(root, "group", h => …)` binding. The key set is always recordable;
 * a handler or guard reference exists only where the frontend resolved an exported symbol, so the core never
 * invents one. `authorizeCalls` lists the calls of the application's authorization function it located.
 */
export const BindingRecord = Schema.Struct({
  symbol: Schema.optionalKey(SymbolRef),
  range: SourceRange,
  root: TermSlot,
  group: TermSlot,
  registrations: Schema.Array(HandlerRegistration),
  authorizeCalls: Schema.Array(SourceRange),
});

export type BindingRecord = typeof BindingRecord.Type;

/**
 * Type-derived facts about a schema reference that the IR records but source text does not state: its static
 * field keys (all, and the required ones for header schemas) and whether `Http.headers` marks it.
 */
export const SchemaFact = Schema.Struct({
  ref: SchemaRef,
  allKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  requiredKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  headers: Schema.optionalKey(Schema.Literal(true)),
});

export type SchemaFact = typeof SchemaFact.Type;

/** Whether an exported middleware marker carries the HttpApi security brand (either installed brand). */
export const MiddlewareFact = Schema.Struct({ ref: SymbolRef, security: Schema.Boolean });

export type MiddlewareFact = typeof MiddlewareFact.Type;

/** An exported constant the declarations reference (a problem union): its declaration range and initializer. */
export const ValueRecord = Schema.Struct({ symbol: SymbolRef, range: SourceRange, init: TermSlot });

export type ValueRecord = typeof ValueRecord.Type;

/** Source-only identity of a top-level local declaration; it is never an importable SymbolRef. */
export const LocalDeclarationId = Schema.Struct({
  file: Schema.String,
  offset: SourcePosition.fields.offset,
  name: Schema.String,
});

export type LocalDeclarationId = typeof LocalDeclarationId.Type;

/** One immutable const declaration and its exact source initializer, without inventing an export. */
export const LocalValueRecord = Schema.Struct({
  kind: Schema.Literal("const"),
  id: LocalDeclarationId,
  range: SourceRange,
  init: TermSlot,
}).check(
  Schema.makeFilter((record) =>
    record.id.file === record.range.file &&
    record.init.range.file === record.range.file &&
    record.id.offset >= record.range.start.offset &&
    record.id.offset < record.range.end.offset &&
    record.init.range.start.offset >= record.range.start.offset &&
    record.init.range.end.offset <= record.range.end.offset
      ? true
      : "Expected a const identity and initializer inside its source declaration",
  ),
);

export type LocalValueRecord = typeof LocalValueRecord.Type;

/**
 * Atomic source fact for exactly one unary exported-callee call whose only argument directly names a
 * top-level const in the same file. The ordinary slot remains Unlowered; this is not a partial Term.
 * Only the registered problem-response reader consumes this fact. Other private references stay unsupported.
 */
export const LocalValueCall = Schema.Struct({
  range: SourceRange,
  callee: SymbolRef,
  argument: LocalDeclarationId,
}).check(
  Schema.makeFilter((call) =>
    call.range.file === call.argument.file
      ? true
      : "Expected a local const call in its declaration file",
  ),
);

export type LocalValueCall = typeof LocalValueCall.Type;

/** How an application success wrapper obtains its response headers. */
export const WrapperHeaders = Schema.TaggedUnion({
  Named: { ref: SchemaRef },
  Inline: { expression: TermSlot },
  Unknown: {},
});

export type WrapperHeaders = typeof WrapperHeaders.Type;

/** What the frontend learned from an application wrapper's own declaration; assist for refactors, never authority. */
export const WrapperFact = Schema.Struct({
  helper: SymbolRef,
  range: SourceRange,
  headers: WrapperHeaders,
});

export type WrapperFact = typeof WrapperFact.Type;

/**
 * One user annotation definition recorded from source (spec 0020, 0019 §3.1 source facts): the export that
 * declares it, the literal annotation `name`, and the Context key of its `effect` clause when the source
 * declares one. `ref` and `key.ref` identity the declaring declarations the same `exportedSymbol`
 * resolution every model reference uses; `key.id` is the key's literal `key` id, which a definition's
 * runtime `effect.key.key` must equal. Inert data keyed by reference identity: no brand object, no
 * evaluated application value and no second declaration inventory ever enters it.
 */
export const DefinitionRecord = Schema.Struct({
  ref: SymbolRef,
  name: Schema.String,
  key: Schema.optionalKey(
    Schema.Struct({
      ref: SymbolRef,
      id: Schema.String,
    }),
  ),
});

export type DefinitionRecord = typeof DefinitionRecord.Type;

/** Everything the frontend knows of one project's Effect declarations. */
export const EffectModel = Schema.Struct({
  target: TargetProfile,
  files: Schema.Array(SourceFileRecord),
  natives: Schema.Array(NativeCallee),
  schemas: Schema.Array(SchemaFact),
  markers: Schema.Array(MiddlewareFact),
  values: Schema.Array(ValueRecord),
  localValues: Schema.Array(LocalValueRecord),
  localCalls: Schema.Array(LocalValueCall),
  wrappers: Schema.Array(WrapperFact),
  roots: Schema.Array(RootRecord),
  groups: Schema.Array(GroupRecord),
  endpoints: Schema.Array(EndpointRecord),
  bindings: Schema.Array(BindingRecord),
  /** Every user annotation definition the frontend resolved, one record per declaring export. */
  definitions: Schema.Array(DefinitionRecord),
});

export type EffectModel = typeof EffectModel.Type;
