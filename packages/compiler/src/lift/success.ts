import { Option, Predicate } from "effect";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Term } from "../generate/term.ts";
import { nameOfSymbol, type SuccessRule } from "./context.ts";
import { exportInline } from "./inline-export.ts";
import { nativeName } from "./native.ts";
import { structTerm } from "./plan.ts";
import { refIdentity, sameRef } from "./refs.ts";
import { isSchemaRef, schemaUseOf } from "./schema-use.ts";
import { derivedName, fail, failUnrecognized, nativeOf, open, type Scope } from "./scope.ts";
import type { TermSlot } from "./source.ts";
import type { SchemaUse } from "./types.ts";
import {
  callView,
  descend,
  isJsonObject,
  literalOf,
  rangeOf,
  receiverOf,
  refOf,
  unwrap,
  type CallView,
  type Cursor,
} from "./view.ts";

/*
 * The success of an endpoint (spec 0019 §3.3, §0.5). It is read from the generator's own spellings (the
 * native `WithHeaders`, `status`, the S5 status-200 conditional and the conditional pair), from registered
 * application wrappers (`SuccessWrapper` rules), and from a named or inline schema. Every explicit status,
 * including 200, is preserved under the 2026-10-09 amendment. An outer status overrides the inner one.
 */

export interface SuccessRead {
  readonly schema: SchemaUse;
  readonly status: number | undefined;
  readonly responseHeaders: SchemaRef | undefined;
  readonly conditional: boolean;
  /** The registered wrapper the success is written through, when it is. */
  readonly wrapper: SymbolRef | undefined;
}

const plain = (schema: SchemaUse): SuccessRead => ({
  schema,
  status: undefined,
  responseHeaders: undefined,
  conditional: false,
  wrapper: undefined,
});

/** `HttpApiSchema.status(n)` applied to nothing yet: the status it carries. */
const statusOf = (scope: Scope, term: Term): Option.Option<number> => {
  const view = callView(term);
  const callee = view === undefined ? undefined : nativeOf(scope, view.callee);
  const [argument] = view?.args ?? [];

  return callee?.kind === "HttpApiSchema" &&
    nativeName(callee) === "status" &&
    view?.args.length === 1 &&
    argument !== undefined
    ? Option.flatMap(literalOf(argument), (json) =>
        Predicate.isNumber(json) && Number.isInteger(json) ? Option.some(json) : Option.none(),
      )
    : Option.none();
};

/** Native Schema construction, or the exact annotation of a resolved named schema value. */
const isInlineSchema = (scope: Scope, term: Term): boolean => {
  const inner = unwrap(term);

  if (inner._tag === "Ref" || inner._tag === "Member")
    return (
      nativeOf(scope, inner)?.kind === "Schema" ||
      (inner._tag === "Member" && isInlineSchema(scope, inner.term))
    );

  const view = callView(inner);
  const receiver = view?.callee._tag === "Member" ? refOf(view.callee.term) : Option.none();

  if (
    view?.callee._tag === "Member" &&
    view.callee.member === "annotate" &&
    view.args.length === 1 &&
    Option.exists(receiver, isSchemaRef)
  )
    return true;

  return view !== undefined && isInlineSchema(scope, view.callee);
};

/** Exactly the bodyless 304 branch emitted by the generator, not an arbitrary second response. */
const isNotModified = (scope: Scope, term: Term | undefined): boolean => {
  const view = term === undefined ? undefined : callView(term);

  if (
    view === undefined ||
    view.callee._tag !== "Member" ||
    view.callee.member !== "pipe" ||
    view.args.length !== 1
  )
    return false;
  const body = nativeOf(scope, view.callee.term);

  return (
    body?.kind === "HttpApiSchema" &&
    nativeName(body) === "NoContent" &&
    Option.exists(statusOf(scope, view.args[0] ?? view.callee.term), (status) => status === 304)
  );
};

const isHeadersSchema = (term: Term): boolean => {
  const json = literalOf(term);

  return term._tag === "Obj" || (Option.isSome(json) && isJsonObject(json.value));
};

/** Is `term` the S5 status-200 expression of the generator for exactly the schema `schema`? */
const isStatus200 = (scope: Scope, term: Term, schema: SchemaRef): boolean => {
  const inner = unwrap(term);

  if (inner._tag !== "Cond") return false;

  const consequent = refOf(inner.consequent);
  const test = unwrap(inner.test);
  const fallback = callView(inner.alternate);

  if (
    test._tag !== "StrictEqual" ||
    Option.isNone(consequent) ||
    !sameRef(consequent.value, schema) ||
    fallback === undefined
  )
    return false;

  const observed = unwrap(test.left);
  const equals200 = Option.exists(literalOf(test.right), (json) => json === 200);
  const fallbackStatus = statusOf(scope, fallback.callee);
  const wrapped = fallback.args[0] === undefined ? Option.none() : refOf(fallback.args[0]);

  if (
    observed._tag !== "Nullish" ||
    observed.tail.length !== 1 ||
    !Option.exists(literalOf(observed.tail[0] ?? observed.head), (value) => value === 200)
  )
    return false;

  const access = unwrap(observed.head);

  if (access._tag !== "OptionalMember" || access.member !== "httpApiStatus") return false;
  const resolved = callView(access.term);
  const resolvedNative = resolved === undefined ? undefined : nativeOf(scope, resolved.callee);

  if (
    resolved === undefined ||
    resolved.args.length !== 1 ||
    resolvedNative?.kind !== "SchemaAST" ||
    nativeName(resolvedNative) !== "resolve"
  )
    return false;

  const ast = resolved.args[0] === undefined ? undefined : unwrap(resolved.args[0]);

  const observedSchema =
    ast?._tag === "Member" && ast.member === "ast" ? refOf(ast.term) : Option.none();

  return (
    equals200 &&
    fallback.args.length === 1 &&
    Option.exists(observedSchema, (reference) => sameRef(reference, schema)) &&
    observed._tag === "Nullish" &&
    observed.tail.length === 1 &&
    Option.exists(fallbackStatus, (status) => status === 200) &&
    Option.exists(wrapped, (reference) => sameRef(reference, schema))
  );
};

/** The same supported schema shapes as readWrapped, without planning an export. */
const isWrappedSchema = (scope: Scope, term: Term): boolean => {
  const inner = unwrap(term);

  if (inner._tag === "Ref" && isSchemaRef(inner.ref)) return true;

  const view = callView(term);
  const [step] = view?.args ?? [];

  if (
    view !== undefined &&
    view.callee._tag === "Member" &&
    view.callee.member === "pipe" &&
    view.args.length === 1 &&
    step !== undefined &&
    Option.isSome(statusOf(scope, step))
  )
    return isWrappedSchema(scope, view.callee.term);

  return isInlineSchema(scope, term);
};

/** A wrapper argument: a named schema, `S.pipe(status(n))`, or an inline expression a refactor can export. */
const readWrapped = (
  scope: Scope,
  cursor: Cursor,
  preserveStatus: boolean = false,
): Option.Option<{ readonly schema: SchemaUse; readonly status: number | undefined }> => {
  const term = unwrap(cursor.term);
  const at = rangeOf(cursor);

  if (term._tag === "Ref") {
    if (isSchemaRef(term.ref))
      return Option.some({ schema: schemaUseOf(scope.ctx, term.ref), status: undefined });
    failUnrecognized(scope, at, `non-schema reference ${nameOfSymbol(term.ref)}`);

    return Option.none();
  }

  const view = callView(cursor.term);
  const [step] = view?.args ?? [];

  if (
    view !== undefined &&
    view.callee._tag === "Member" &&
    view.callee.member === "pipe" &&
    step !== undefined &&
    view.args.length === 1
  ) {
    const status = statusOf(scope, step);

    if (Option.isSome(status)) {
      if (preserveStatus && !isWrappedSchema(scope, view.callee.term)) {
        failUnrecognized(
          scope,
          rangeOf(receiverOf(cursor, view)),
          "a wrapper argument that is not a schema",
        );

        return Option.none();
      }

      if (preserveStatus)
        return Option.map(
          exportInline(scope, {
            cursor,
            role: "success",
            code: "EFFX3002",
            describe: (planned) =>
              LiftDiagnostics.EFFX3002.emit({
                subject: scope.subject,
                channel: "success",
                form: "schema-call",
                planned,
              }),
            initializer: cursor.term,
            derived: derivedName(scope, "Response"),
          }),
          (ref) => ({ schema: schemaUseOf(scope.ctx, ref), status: status.value }),
        );

      return Option.map(readWrapped(scope, receiverOf(cursor, view)), (wrapped) => ({
        schema: wrapped.schema,
        status: status.value,
      }));
    }
  }

  if (isInlineSchema(scope, term))
    return Option.map(
      exportInline(scope, {
        cursor,
        role: "success",
        code: "EFFX3002",
        describe: (planned) =>
          LiftDiagnostics.EFFX3002.emit({
            subject: scope.subject,
            channel: "success",
            form: "schema-call",
            planned,
          }),
        initializer: term,
        derived: derivedName(scope, "Response"),
      }),
      (ref) => ({ schema: schemaUseOf(scope.ctx, ref), status: undefined }),
    );

  failUnrecognized(scope, at, "success schema expression");

  return Option.none();
};

/** Response headers of a native `WithHeaders(S, H)`: a named schema, or an inline form a refactor exports. */
const readHeaders = (scope: Scope, cursor: Cursor, wrapper: string): Option.Option<SchemaRef> => {
  const term = unwrap(cursor.term);
  const at = rangeOf(cursor);

  if (term._tag === "Ref") {
    if (isSchemaRef(term.ref)) return Option.some(term.ref);
    failUnrecognized(scope, at, `non-schema reference ${nameOfSymbol(term.ref)}`);

    return Option.none();
  }

  return exportInline(scope, {
    cursor,
    role: "responseHeaders",
    code: "EFFX3003",
    describe: (planned) =>
      LiftDiagnostics.EFFX3003.emit({ subject: scope.subject, wrapper, planned }),
    initializer: isHeadersSchema(term) ? structTerm(scope.ctx, term) : term,
    derived: derivedName(scope, "ResponseHeaders"),
  });
};

/** A registered wrapper: `callee(S)` stands for `S`, the helper's headers, status and conditional flag. */
const readRule = (
  scope: Scope,
  cursor: Cursor,
  view: CallView,
  rule: SuccessRule,
  wrapper: string,
): Option.Option<SuccessRead> => {
  const at = rangeOf(cursor);

  const arguments_ = (): void =>
    fail(
      scope,
      at,
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnsupportedOption",
        subject: scope.subject,
        callee: wrapper,
        option: "arguments",
      }),
    );

  if (rule.schema !== undefined) {
    if (view.args.length !== 0) {
      arguments_();

      return Option.none();
    }

    return Option.some({
      schema: schemaUseOf(scope.ctx, rule.schema),
      status: rule.status,
      responseHeaders: rule.responseHeaders,
      conditional: rule.conditional === true,
      wrapper: rule.callee,
    });
  }

  const [argument] = view.args;

  if (view.args.length !== 1 || argument === undefined) {
    arguments_();

    return Option.none();
  }

  return Option.map(
    readWrapped(scope, descend(cursor, argument, ...view.argPath(0)), rule.status !== undefined),
    (wrapped) => ({
      schema: wrapped.schema,
      status: rule.status ?? wrapped.status,
      responseHeaders: rule.responseHeaders,
      conditional: rule.conditional === true,
      wrapper: rule.callee,
    }),
  );
};

const read = (scope: Scope, cursor: Cursor): Option.Option<SuccessRead> => {
  const term = unwrap(cursor.term);
  const at = rangeOf(cursor);

  // The generator's conditional pair `[ok, WithHeaders(NoContent.pipe(status(304)), headers)]`.
  if (term._tag === "Arr" && term.items.length === 2) {
    const [ok, notModified] = term.items;
    const first = ok === undefined ? Option.none() : read(scope, descend(cursor, ok, "items", 0));
    const second = notModified === undefined ? undefined : callView(notModified);
    const secondCallee = second === undefined ? undefined : nativeOf(scope, second.callee);
    const secondHeaders = second?.args[1] === undefined ? Option.none() : refOf(second.args[1]);

    return Option.flatMap(first, (value) => {
      const headers = value.responseHeaders;

      if (
        secondCallee?.kind === "HttpApiSchema" &&
        nativeName(secondCallee) === "WithHeaders" &&
        second?.args.length === 2 &&
        isNotModified(scope, second?.args[0]) &&
        headers !== undefined &&
        Option.exists(secondHeaders, (reference) => sameRef(reference, headers))
      )
        return Option.some({ ...value, conditional: true });

      failUnrecognized(scope, at, "conditional success pair");

      return Option.none();
    });
  }

  // The generator's status-200 expression, for the schema in its consequent.
  if (term._tag === "Cond") {
    const consequent = refOf(term.consequent);

    if (
      Option.isSome(consequent) &&
      isSchemaRef(consequent.value) &&
      isStatus200(scope, term, consequent.value)
    )
      return Option.some({ ...plain(schemaUseOf(scope.ctx, consequent.value)), status: 200 });
  }

  const view = callView(cursor.term);

  if (view !== undefined) {
    const callee = nativeOf(scope, view.callee);
    const [step] = view.args;

    if (
      view.callee._tag === "Member" &&
      view.callee.member === "pipe" &&
      step !== undefined &&
      view.args.length === 1
    ) {
      const status = statusOf(scope, step);

      if (Option.isSome(status))
        return Option.map(read(scope, receiverOf(cursor, view)), (value) => ({
          ...value,
          status: status.value,
        }));
    }

    if (
      callee?.kind === "HttpApiSchema" &&
      nativeName(callee) === "WithHeaders" &&
      view.args.length === 2
    ) {
      const [inner, headers] = view.args;

      if (inner === undefined || headers === undefined) return Option.none();

      return Option.flatMap(read(scope, descend(cursor, inner, ...view.argPath(0))), (value) =>
        Option.map(
          readHeaders(
            scope,
            descend(cursor, headers, ...view.argPath(1)),
            "HttpApiSchema.WithHeaders",
          ),
          (ref) => ({ ...value, responseHeaders: ref }),
        ),
      );
    }

    const calleeRef = refOf(view.callee);

    if (Option.isSome(calleeRef) && !isSchemaRef(calleeRef.value)) {
      const identity = refIdentity(calleeRef.value);
      const rule = scope.ctx.successRules.get(identity);
      const wrapper = nameOfSymbol(calleeRef.value);

      if (scope.ctx.noSchemaRules.has(identity)) {
        fail(
          scope,
          at,
          LiftDiagnostics.EFFX3007.emit({ subject: scope.subject, construct: wrapper }),
        );

        return Option.none();
      }

      if (rule !== undefined) return readRule(scope, cursor, view, rule, wrapper);

      fail(
        scope,
        at,
        LiftDiagnostics.EFFX3006.emit({
          subject: scope.subject,
          position: "success",
          callee: wrapper,
        }),
      );

      return Option.none();
    }
  }

  if (term._tag === "Ref") {
    if (isSchemaRef(term.ref)) return Option.some(plain(schemaUseOf(scope.ctx, term.ref)));
    failUnrecognized(scope, at, `non-schema reference ${nameOfSymbol(term.ref)}`);

    return Option.none();
  }

  if (isInlineSchema(scope, term))
    return Option.map(readWrapped(scope, cursor), (wrapped) => ({
      ...plain(wrapped.schema),
      status: wrapped.status,
    }));

  failUnrecognized(scope, at, "success expression");

  return Option.none();
};

/** Reads the `success` option of an endpoint. */
export const readSuccess = (scope: Scope, slot: TermSlot): Option.Option<SuccessRead> =>
  Option.flatMap(open(scope, slot, "success"), (cursor) => read(scope, cursor));
