import { Option } from "effect";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Term } from "../generate/term.ts";
import { nameOfSymbol, upperFirst } from "./context.ts";
import { exportInline } from "./inline-export.ts";
import type { OptionEntry } from "./model.ts";
import { nativeName } from "./native.ts";
import { structTerm } from "./plan.ts";
import { refIdentity } from "./refs.ts";
import { isSchemaRef, schemaUseOf } from "./schema-use.ts";
import { derivedName, fail, failUnrecognized, nativeOf, open, type Scope } from "./scope.ts";
import type { SourceRange } from "./source.ts";
import type { SchemaUse } from "./types.ts";
import {
  callView,
  isJsonObject,
  keyName,
  literalOf,
  objectOf,
  rangeOf,
  stringField,
  unwrap,
  descend,
  type Cursor,
} from "./view.ts";

/*
 * Request channels (spec 0019 §3.3): a named schema is read as is; inline fields, bare `X.fields` and an
 * inline `Schema.Struct(...)` have no exported name, so a wire-preserving EFFX3002 refactor plans one; an
 * inline payload is form encoded by Effect and has no effx media type, so it is EFFX3001.
 */

export type Channel = "params" | "query" | "headers" | "payload";

export type ChannelRead =
  | { readonly _tag: "Used"; readonly use: SchemaUse; readonly mediaType: string | undefined }
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Failed" };

const used = (use: SchemaUse, mediaType?: string): ChannelRead => ({
  _tag: "Used",
  use,
  mediaType,
});

const failed: ChannelRead = { _tag: "Failed" };

/** The IR records static keys for params (all) and headers (required); a schema without them is unliftable. */
const withFacts = (
  scope: Scope,
  channel: Channel,
  use: SchemaUse,
  at: SourceRange,
): ChannelRead => {
  if (channel === "params" && use.allKeys === undefined) {
    failUnrecognized(scope, at, `params schema ${use.ref.export} has no static field keys`);

    return failed;
  }

  if (channel === "headers" && use.requiredKeys === undefined) {
    failUnrecognized(scope, at, `headers schema ${use.ref.export} has no static field keys`);

    return failed;
  }

  return used(use);
};

/** The static keys of an inline field object. */
const keysOf = (term: Term): ReadonlyArray<string> | undefined => {
  const inner = unwrap(term);

  return inner._tag === "Obj"
    ? inner.entries.map((entry) => keyName(entry.key))
    : Option.getOrUndefined(Option.map(objectOf(inner), (object) => Object.keys(object)));
};

/** The required keys of an inline field object: those whose schema is not a native `Schema.optional*`. */
const requiredKeysOf = (
  scope: Scope,
  term: Term | undefined,
): ReadonlyArray<string> | undefined => {
  const inner = term === undefined ? undefined : unwrap(term);

  return inner?._tag === "Obj"
    ? inner.entries.flatMap((entry) => {
        const view = callView(entry.value);
        const callee = view === undefined ? undefined : nativeOf(scope, view.callee);

        return callee?.kind === "Schema" && nativeName(callee).startsWith("optional")
          ? []
          : [keyName(entry.key)];
      })
    : undefined;
};

const describe =
  (scope: Scope, channel: Channel, form: "inline-fields" | "fields-access" | "schema-call") =>
  (planned: string) =>
    LiftDiagnostics.EFFX3002.emit({ subject: scope.subject, channel, form, planned });

/** A schema position: a named export, or an inline form a refactor can export. */
const readSchema = (scope: Scope, channel: Channel, cursor: Cursor): ChannelRead => {
  const term = unwrap(cursor.term);
  const at = rangeOf(cursor);
  const suffix = upperFirst(channel);

  if (term._tag === "Ref") {
    if (isSchemaRef(term.ref))
      return withFacts(scope, channel, schemaUseOf(scope.ctx, term.ref), at);
    failUnrecognized(scope, at, `non-schema reference ${nameOfSymbol(term.ref)}`);

    return failed;
  }

  // `X.fields` is not `X`: the named schema carries an identifier annotation (spec 0019 §3.4).
  if (term._tag === "Member" && term.member === "fields" && term.term._tag === "Ref") {
    const base = term.term.ref;

    if (!isSchemaRef(base)) {
      failUnrecognized(scope, at, `non-schema reference ${nameOfSymbol(base)}`);

      return failed;
    }

    const planned = exportInline(scope, {
      cursor,
      role: channel,
      code: "EFFX3002",
      describe: describe(scope, channel, "fields-access"),
      initializer: structTerm(scope.ctx, term),
      derived: `${base.export}${suffix}`,
    });

    const fact = scope.ctx.schemaFacts.get(refIdentity(base));

    return Option.match(planned, {
      onNone: () => failed,
      onSome: (ref) =>
        withFacts(
          scope,
          channel,
          { ref, allKeys: fact?.allKeys, requiredKeys: fact?.requiredKeys, headers: false },
          at,
        ),
    });
  }

  const call = callView(term);
  const callee = call === undefined ? undefined : nativeOf(scope, call.callee);

  if (call !== undefined && callee?.kind === "Schema" && nativeName(callee) === "Struct") {
    const fields = call.args[0];

    const planned = exportInline(scope, {
      cursor,
      role: channel,
      code: "EFFX3002",
      describe: describe(scope, channel, "schema-call"),
      initializer: term,
      derived: derivedName(scope, suffix),
    });

    return Option.match(planned, {
      onNone: () => failed,
      onSome: (ref) =>
        withFacts(
          scope,
          channel,
          {
            ref,
            allKeys: fields === undefined ? undefined : keysOf(fields),
            requiredKeys: requiredKeysOf(scope, fields),
            headers: false,
          },
          at,
        ),
    });
  }

  const literal = literalOf(term);

  if (term._tag === "Obj" || (Option.isSome(literal) && isJsonObject(literal.value))) {
    const keys = keysOf(term) ?? [];

    // `params: {}` states nothing; the compile step confirms there are no path parameters.
    if (keys.length === 0) return { _tag: "Absent" };

    const planned = exportInline(scope, {
      cursor,
      role: channel,
      code: "EFFX3002",
      describe: describe(scope, channel, "inline-fields"),
      initializer: structTerm(scope.ctx, term),
      derived: derivedName(scope, suffix),
    });

    return Option.match(planned, {
      onNone: () => failed,
      onSome: (ref) =>
        withFacts(
          scope,
          channel,
          { ref, allKeys: keys, requiredKeys: requiredKeysOf(scope, term), headers: false },
          at,
        ),
    });
  }

  failUnrecognized(scope, at, `${channel} schema expression`);

  return failed;
};

/** `payload: X.pipe(HttpApiSchema.asJson({ contentType }))`: the payload `X` and its media type. */
const readPayload = (scope: Scope, cursor: Cursor): ChannelRead => {
  const term = unwrap(cursor.term);
  const at = rangeOf(cursor);
  const view = callView(term);

  if (view !== undefined && view.callee._tag === "Member" && view.callee.member === "pipe") {
    const [step] = view.args;
    const asJson = step === undefined ? undefined : callView(step);
    const asJsonCallee = asJson === undefined ? undefined : nativeOf(scope, asJson.callee);
    const options = asJson?.args[0];

    const media = Option.flatMap(
      options === undefined ? Option.none() : objectOf(options),
      (object) => stringField(object, "contentType"),
    );

    if (
      asJsonCallee?.kind === "HttpApiSchema" &&
      nativeName(asJsonCallee) === "asJson" &&
      Option.isSome(media)
    ) {
      const inner = readSchema(
        scope,
        "payload",
        descend(cursor, view.callee.term, ...view.calleePath, "term"),
      );

      return inner._tag === "Used" ? used(inner.use, media.value) : inner;
    }

    fail(
      scope,
      at,
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnknownPipeStep",
        subject: scope.subject,
        construct: "payload.pipe(...)",
      }),
    );

    return failed;
  }

  const literal = literalOf(term);

  if (term._tag === "Obj" || (Option.isSome(literal) && isJsonObject(literal.value))) {
    fail(
      scope,
      at,
      LiftDiagnostics.EFFX3001.emit({ _tag: "FormEncodedPayload", subject: scope.subject }),
    );

    return failed;
  }

  return readSchema(scope, "payload", cursor);
};

/** Reads one request-channel entry of the endpoint options. */
export const readChannel = (
  scope: Scope,
  channel: Channel,
  entry: Extract<OptionEntry, { readonly _tag: "Property" }>,
): ChannelRead => {
  const opened = open(scope, entry.value, "channel");

  if (Option.isNone(opened)) return failed;

  return channel === "payload"
    ? readPayload(scope, opened.value)
    : readSchema(scope, channel, opened.value);
};
