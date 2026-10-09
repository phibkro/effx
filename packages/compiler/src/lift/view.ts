import { Option, Predicate, Schema } from "effect";
import type { RefLike, Term } from "../generate/term.ts";
import type { SourceRange, TermPath, TermSlot } from "./source.ts";

/*
 * Read-only views over `Term` for the recognizers. A term may be spelled several equivalent ways (a call
 * `a.b(c)` is `Call(Member(a, b), [c])` or `Chain(a, [b(c)])`; a literal subtree is one `Lit` or `Arr`/`Obj`
 * of literals); every reader accepts all spellings, so the core does not depend on one frontend's choices.
 * Nothing here rewrites a term or invents one.
 */

export type LoweredSlot = Extract<TermSlot, { readonly _tag: "Lowered" }>;

/** A position inside one lowered slot: the term there and its path, so a cause can find its source range. */
export interface Cursor {
  readonly slot: LoweredSlot;
  readonly term: Term;
  readonly path: TermPath;
  readonly sourceRange?: SourceRange;
  readonly exactRange?: boolean;
  readonly jsonPath?: boolean;
}

/** The cursor at the root of a lowered slot. */
export const rootOf = (slot: LoweredSlot): Cursor => ({ slot, term: slot.term, path: [] });

/** A cursor for `term`, reached from `parent` through `segments`. */
export const descend = (
  parent: Cursor,
  term: Term,
  ...segments: ReadonlyArray<string | number>
): Cursor => ({ slot: parent.slot, term, path: [...parent.path, ...segments] });

const isPrefix = (prefix: TermPath, path: TermPath): boolean =>
  prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);

/** The range of the deepest span that contains the cursor's path, else the slot's own range. */
export const rangeOf = (cursor: Cursor): SourceRange =>
  cursor.sourceRange ??
  cursor.slot.spans.reduce<{ readonly length: number; readonly range: SourceRange }>(
    (best, span) =>
      isPrefix(span.path, cursor.path) && span.path.length >= best.length
        ? { length: span.path.length, range: span.range }
        : best,
    { length: -1, range: cursor.slot.range },
  ).range;

const jsonString = Schema.fromJsonString(Schema.String);

/** The property name an object entry key spells: an identifier, or the JSON string literal `printTerm` prints. */
export const keyName = (key: string): string =>
  key.startsWith('"') ? Option.getOrElse(Schema.decodeOption(jsonString)(key), () => key) : key;

/** Removes redundant parentheses; TypeScript-only wrappers never reach a term. */
export const unwrap = (term: Term): Term => (term._tag === "Paren" ? unwrap(term.term) : term);

/** A JSON object: neither `null` nor an array. */
export const isJsonObject = (json: Schema.Json): json is Schema.JsonObject =>
  Predicate.isObject(json);

/** The JSON a term spells when it consists only of literals (`Lit`, or arrays and objects of literals). */
export const literalOf = (term: Term): Option.Option<Schema.Json> => {
  const inner = unwrap(term);

  switch (inner._tag) {
    case "Lit":
      return Option.some(inner.json);
    case "Arr":
      return Option.all(inner.items.map(literalOf));
    case "Obj":
      return Option.map(
        Option.all(
          inner.entries.map((entry) =>
            Option.map(literalOf(entry.value), (value) => [keyName(entry.key), value] as const),
          ),
        ),
        (pairs) => Object.fromEntries(pairs),
      );
    default:
      return Option.none();
  }
};

/** A string literal. */
export const stringOf = (term: Term): Option.Option<string> =>
  Option.filter(literalOf(term), Predicate.isString);

/** A literal array of string literals. */
export const stringsOf = (term: Term): Option.Option<ReadonlyArray<string>> =>
  Option.flatMap(literalOf(term), (json) =>
    Array.isArray(json) && json.every(Predicate.isString) ? Option.some(json) : Option.none(),
  );

/** A literal object. */
export const objectOf = (term: Term): Option.Option<Schema.JsonObject> =>
  Option.filter(literalOf(term), isJsonObject);

/** A string field of a literal object. */
export const stringField = (object: Schema.JsonObject, key: string): Option.Option<string> =>
  Option.filter(Option.fromUndefinedOr(object[key]), Predicate.isString);

/** The reference a term is, if it is exactly `Ref`. */
export const refOf = (term: Term): Option.Option<RefLike> => {
  const inner = unwrap(term);

  return inner._tag === "Ref" ? Option.some(inner.ref) : Option.none();
};

/** A call with its callee and arguments, for both spellings of a method call. */
export interface CallView {
  readonly callee: Term;
  readonly args: ReadonlyArray<Term>;
  /** Where each argument sits below the call, for `descend`. */
  readonly argPath: (index: number) => ReadonlyArray<string | number>;
  /** A synthetic Chain prefix ends at the preceding method-call span. */
  readonly receiverEndPath: ReadonlyArray<string | number> | undefined;
  /** The real receiver position, even when the Member callee is synthetic for a Chain. */
  readonly receiverPath: ReadonlyArray<string | number>;
}

/**
 * A call, whichever way it is spelled: `Call(callee, args)` or the last step of `Chain(head, calls)`, whose
 * callee is the member of what precedes it. `undefined` for any other term.
 */
export const callView = (term: Term): CallView | undefined => {
  let inner = term;
  const prefix: Array<string> = [];

  while (inner._tag === "Paren") {
    prefix.push("term");
    inner = inner.term;
  }

  if (inner._tag === "Call")
    return {
      callee: inner.callee,
      args: inner.args,
      argPath: (index) => [...prefix, "args", index],
      receiverPath: [...prefix, "callee", "term"],
      receiverEndPath: undefined,
    };

  if (inner._tag !== "Chain") return undefined;
  const last = inner.calls.length - 1;
  const call = inner.calls[last];

  if (call === undefined) return undefined;

  const receiver: Term =
    last === 0
      ? inner.head
      : { _tag: "Chain", head: inner.head, calls: inner.calls.slice(0, last) };

  return {
    callee: { _tag: "Member", term: receiver, member: call.name },
    args: call.args,
    argPath: (index) => [...prefix, "calls", last, "args", index],
    receiverPath: last === 0 ? [...prefix, "head"] : prefix,
    receiverEndPath: last === 0 ? undefined : [...prefix, "calls", last - 1],
  };
};

/** A method receiver keeps its recorded span; a virtual Chain prefix never authorizes a guessed edit. */
export const receiverOf = (cursor: Cursor, view: CallView): Cursor => {
  if (view.callee._tag !== "Member") return cursor;
  const receiver = descend(cursor, view.callee.term, ...view.receiverPath);

  if (view.receiverEndPath === undefined) return receiver;
  const endPath = [...cursor.path, ...view.receiverEndPath];

  const end = cursor.slot.spans.find(
    (span) => span.path.length === endPath.length && isPrefix(endPath, span.path),
  );

  const chain = unwrap(view.callee.term);

  const start =
    chain._tag === "Chain"
      ? rangeOf(descend(receiver, chain.head, "head")).start
      : rangeOf(receiver).start;

  return end === undefined
    ? { ...receiver, exactRange: false }
    : { ...receiver, sourceRange: { file: end.range.file, start, end: end.range.end } };
};

/** A literal object's field cursor retains the field's own source offset. */
export const fieldOf = (cursor: Cursor, name: string): Cursor => {
  if (cursor.term._tag === "Paren") return fieldOf(descend(cursor, cursor.term.term, "term"), name);

  if (cursor.term._tag === "Lit" && isJsonObject(cursor.term.json)) {
    const value = cursor.term.json[name];

    if (value === undefined) return cursor;
    const base = cursor.jsonPath === true ? cursor.path : [...cursor.path, "json"];

    return {
      slot: cursor.slot,
      term: { _tag: "Lit", json: value },
      path: [...base, name],
      jsonPath: true,
    };
  }

  if (cursor.term._tag !== "Obj") return cursor;
  const index = cursor.term.entries.findIndex((entry) => keyName(entry.key) === name);
  const entry = cursor.term.entries[index];

  return entry === undefined ? cursor : descend(cursor, entry.value, "entries", index, "value");
};
