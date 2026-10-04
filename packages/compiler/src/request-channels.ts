import { Option, Predicate, Schema } from "effect";
import type { Annotation, AnnotationArg, Declaration } from "./Collected.ts";
import { type Diagnostic, error } from "./Diagnostic.ts";
import { SchemaArg } from "./args.ts";
import { OperationArgs } from "./extensions/core.ts";
import { routeParamNames } from "./route-params.ts";

/** The `Http.Contract` option object, as the frontend lowered it. */
type Options = Readonly<Record<string, AnnotationArg>>;

type Input = typeof SchemaArg.Type;

type Verb = "Get" | "Post" | "Put" | "Patch" | "Delete";

/** The four request channels of `Http.Contract` an operation `input` can serve. */
type Channel = "params" | "query" | "headers" | "payload";

const channels: ReadonlyArray<Channel> = ["params", "query", "headers", "payload"];

export const isAnnotationOptions = (value: AnnotationArg | undefined): value is Options =>
  Predicate.isObject(value) &&
  !Predicate.isTagged("Schema")(value) &&
  !Predicate.isTagged("Symbol")(value) &&
  !Predicate.isTagged("Lambda")(value);

const isSchemaArg = Schema.is(SchemaArg);

/** Is `candidate` the very Schema `input` names (same `SchemaRef`)? */
export const mapsInput = (candidate: AnnotationArg | undefined, input: Input): boolean =>
  isSchemaArg(candidate) &&
  candidate.ref.module === input.ref.module &&
  candidate.ref.export === input.ref.export &&
  candidate.ref.symbolId === input.ref.symbolId;

/** The single options object an annotation was written with, when it was. */
export const optionsOf = (annotation: Annotation): Options | undefined => {
  const [options] = annotation.args;

  return annotation.args.length === 1 && isAnnotationOptions(options) ? options : undefined;
};

const verbOf = (name: string): Verb | undefined => {
  switch (name) {
    case "Http.Get":
      return "Get";
    case "Http.Post":
      return "Post";
    case "Http.Put":
      return "Put";
    case "Http.Patch":
      return "Patch";
    case "Http.Delete":
      return "Delete";
    default:
      return undefined;
  }
};

const onlyAnnotation = (
  declaration: Declaration,
  matches: (name: string) => boolean,
): Annotation | undefined => {
  const found = declaration.annotations.filter((annotation) => matches(annotation.name));

  return found.length === 1 ? found[0] : undefined;
};

/** What the derivation reads of a declaration; `undefined` when it is not a complete HTTP contract. */
interface Site {
  readonly contract: Annotation;
  readonly options: Options;
  readonly kind: "Query" | "Command";
  readonly input: Input;
  readonly verb: Verb;
  readonly path: string;
}

const requestOf = (declaration: Declaration): Site | undefined => {
  const contract = onlyAnnotation(declaration, (name) => name === "Http.Contract");

  const operation = onlyAnnotation(declaration, (name) => name === "Query" || name === "Command");

  const method = onlyAnnotation(declaration, (name) => verbOf(name) !== undefined);

  if (contract === undefined || operation === undefined || method === undefined) return undefined;

  const verb = verbOf(method.name);
  const options = optionsOf(contract);
  const [path] = method.args;
  const declared = Schema.decodeOption(OperationArgs)(operation.args);

  if (
    verb === undefined ||
    options === undefined ||
    method.args.length !== 1 ||
    !Predicate.isString(path) ||
    Option.isNone(declared)
  )
    return undefined;

  return {
    contract,
    options,
    kind: operation.name === "Query" ? "Query" : "Command",
    input: declared.value[0].input,
    verb,
    path,
  };
};

/**
 * The outcome of classifying an `input`. `Conflict` is always an error. `Ambiguous` is an error only while none
 * of its `resolvedBy` channels is explicit: writing one of them is the resolution the diagnostic asks for, and
 * an explicit channel always wins.
 */
type Decision =
  | { readonly _tag: "Nothing" }
  | { readonly _tag: "Channel"; readonly channel: Channel }
  | { readonly _tag: "Conflict"; readonly message: string }
  | {
      readonly _tag: "Ambiguous";
      readonly code: "EFFX2410" | "EFFX2411";
      readonly message: string;
      readonly resolvedBy: ReadonlyArray<Channel>;
    };

const nothing: Decision = { _tag: "Nothing" };

const channel = (target: Channel): Decision => ({ _tag: "Channel", channel: target });

/** Spec 0024 §2.1, steps 1 to 6 (step 0, "the input already is an explicit channel", is the caller's). */
const decide = ({ options, kind, input, verb, path }: Site): Decision => {
  // 1. A header-marked input is a headers schema, never a body.
  if (input.marker === "headers")
    return options.headers === undefined
      ? channel("headers")
      : {
          _tag: "Conflict",
          message:
            "the input is a header schema (Http.headers) but Http.Contract.headers names another schema; an input that is a header schema cannot also be a body",
        };

  // ADR 0010: a Query over POST declares its payload explicitly; no other Query verb is allowed.
  if (kind === "Query" && verb !== "Get") return nothing;

  // GET and DELETE carry request data in the query string; the others in the body.
  const body = verb === "Get" || verb === "Delete" ? "query" : "payload";
  const fields = input.fields;

  // An input without fields has no query string to fill. (A body is still a body: the 0013 payload default.)
  if (fields !== undefined && fields.length === 0 && body === "query") return nothing;

  // 6. Path parameters and an input whose keys are unknown: a body is the 0013 default, a query is a guess.
  if (fields === undefined)
    return routeParamNames(path).length === 0 || body === "payload"
      ? channel(body)
      : {
          _tag: "Ambiguous",
          code: "EFFX2411",
          message: `${verb.toUpperCase()} with path parameters needs an input with static field keys to tell params from query; declare params and query explicitly`,
          resolvedBy: ["params", "query"],
        };

  // Which input fields are route parameters? A declared name ends before an action suffix (`:id:publish`).
  const params = new Set(routeParamNames(path, new Set(fields)));

  // 2, 4. No input field is a path parameter.
  if (params.size === 0) return channel(body);

  // 3. Every input field is a path parameter.
  if (params.size === fields.length) return channel("params");

  // 5. Both: no derived split schema is ever invented (it would change OpenAPI identity).
  return {
    _tag: "Ambiguous",
    code: "EFFX2410",
    message: `the input mixes path parameters (${[...params].toSorted().join(", ")}) with other fields (${fields.filter((field) => !params.has(field)).join(", ")}); declare params and ${body} explicitly`,
    resolvedBy: [body],
  };
};

/** What one step of the 0013 pre-pass leaves of a declaration, and the diagnostics it found. */
export interface Rewrite {
  readonly declaration: Declaration;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/**
 * Derives the request channels an operation `input` implies into its `Http.Contract` (spec 0024 §2). Pure
 * source sugar for the 0013 pre-pass: the channel is written into the annotation arguments, so the
 * interpreted contract, IR, hash and generated files equal the explicit spelling. An explicit channel always
 * wins: a derived channel never replaces one, and an ambiguous input is a diagnostic only while nothing that
 * resolves it is explicit.
 */
export const deriveRequestChannels = (declaration: Declaration): Rewrite => {
  const unchanged: Rewrite = { declaration, diagnostics: [] };
  const request = requestOf(declaration);

  if (request === undefined) return unchanged;

  const { contract, options, input } = request;

  // 0. The input already is the schema of an explicit channel: nothing to derive.
  if (channels.some((name) => mapsInput(options[name], input))) return unchanged;

  const decision = decide(request);

  const invalid = (code: string, message: string): Rewrite => ({
    declaration,
    diagnostics: [error(code, `${declaration.id}: ${message}`, declaration.location)],
  });

  switch (decision._tag) {
    case "Nothing":
      return unchanged;
    case "Conflict":
      return invalid("EFFX2410", decision.message);
    case "Ambiguous":
      return decision.resolvedBy.some((name) => options[name] !== undefined)
        ? unchanged
        : invalid(decision.code, decision.message);
    case "Channel": {
      if (options[decision.channel] !== undefined) return unchanged;

      // `params` and `headers` keep their recorded keys; a body or query is the bare reference.
      const arg: AnnotationArg =
        decision.channel === "params" || decision.channel === "headers"
          ? input
          : { _tag: "Schema", ref: input.ref };

      const updated = { ...options, [decision.channel]: arg };

      return {
        declaration: {
          ...declaration,
          annotations: declaration.annotations.map((annotation) =>
            annotation === contract ? { ...annotation, args: [updated] } : annotation,
          ),
        },
        diagnostics: [],
      };
    }
  }
};
