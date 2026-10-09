import { Option, Predicate, type Schema } from "effect";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import type { Annotation, AnnotationArg, Declaration } from "../Collected.ts";
import type { GroupFacts } from "./group.ts";
import type { AccessUse, Method, Recognized, SchemaUse } from "./types.ts";
import { isJsonObject } from "./view.ts";

/*
 * The verbose `Collected` of a lift (spec 0019 §3.1, §4.2): the exact annotations the TypeScript frontend
 * collects from the builder-form declaration the suggestion prints, every field explicit. It is built only
 * from recognized data, so each argument has the shape the existing built-in definitions decode and the
 * interpreters turn into the IR. The dense form is a verified rewrite of this one (`dense.ts`).
 */

type Entry = readonly [string, AnnotationArg | undefined];

/** An options object: entries without a value are absent, never `undefined`. */
const options = (entries: ReadonlyArray<Entry>): AnnotationArg =>
  Object.fromEntries(
    entries.flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as const])),
  );

const schemaArg = (ref: SchemaRef, fields?: ReadonlyArray<string>): AnnotationArg =>
  fields === undefined ? { _tag: "Schema", ref } : { _tag: "Schema", ref, fields: [...fields] };

const symbolArg = (ref: SymbolRef, security?: boolean): AnnotationArg =>
  security === true ? { _tag: "Symbol", ref, security } : { _tag: "Symbol", ref };

/** JSON as an annotation argument; `null` has no argument form. */
const jsonArg = (json: Schema.Json): Option.Option<AnnotationArg> => {
  if (json === null) return Option.none();

  if (Predicate.isString(json) || Predicate.isNumber(json) || Predicate.isBoolean(json))
    return Option.some(json);

  if (isJsonObject(json))
    return Option.map(
      Option.all(
        Object.entries(json).map(([key, value]) =>
          Option.map(jsonArg(value), (arg) => [key, arg] as const),
        ),
      ),
      (pairs) => Object.fromEntries(pairs),
    );

  return Option.all(json.map(jsonArg));
};

/** The access arguments in the order the human declaration writes them. */
const accessArg = (access: AccessUse): Option.Option<AnnotationArg> =>
  Option.map(
    Option.all({
      capabilities: jsonArg(access.capabilities),
      requirements: jsonArg(access.requirements),
      concealment: jsonArg(access.concealment),
    }),
    ({ capabilities, requirements, concealment }) =>
      options([
        ["annotator", symbolArg(access.annotator)],
        ["exposure", access.exposure],
        ["acceptedCredentials", [...access.acceptedCredentials]],
        ["principalKinds", [...access.principalKinds]],
        ["capabilities", capabilities],
        ["requirements", requirements],
        ["canonicalScopeResolver", symbolArg(access.canonicalScopeResolver)],
        ["concealment", concealment],
        ["decisionTime", access.decisionTime],
        [
          "snapshotDecisionForCommand",
          access.snapshotDecisionForCommand === true ? true : undefined,
        ],
      ]),
  );

/** The request channel that serves as `Operation.input` (spec 0019 §2.3): payload, query, headers, params. */
export type InputChannel = "payload" | "query" | "headers" | "params" | "emptyInput";

export interface ChosenInput {
  readonly channel: InputChannel;
  readonly ref: SchemaRef;
  /** Static field keys of the input schema, when the model records them. */
  readonly fields: ReadonlyArray<string> | undefined;
  /** The other request channels the endpoint declares. */
  readonly others: ReadonlyArray<string>;
}

const channelOrder = ["payload", "query", "headers", "params"] as const;

/** The one request schema; with several the priority order decides; none uses the configured `emptyInput`. */
export const chooseInput = (
  recognized: Recognized,
  emptyInput: SchemaUse | undefined,
): Option.Option<ChosenInput> => {
  const present = channelOrder.flatMap((channel) => {
    const use = recognized[channel];

    return use === undefined ? [] : [{ channel, use }];
  });

  const [first, ...rest] = present;

  if (first !== undefined)
    return Option.some({
      channel: first.channel,
      ref: first.use.ref,
      fields: first.use.allKeys,
      others: rest.map((other) => other.channel),
    });

  return Option.map(Option.fromUndefinedOr(emptyInput), (use) => ({
    channel: "emptyInput",
    ref: use.ref,
    // An empty input has no keys by definition, so no request channel is ever derived from it.
    fields: use.allKeys ?? [],
    others: [],
  }));
};

const verbName: Readonly<Record<Method, string>> = {
  GET: "Get",
  POST: "Post",
  PUT: "Put",
  PATCH: "Patch",
  DELETE: "Delete",
};

export const isQuery = (recognized: Recognized): boolean => recognized.method === "GET";

const contractArg = (recognized: Recognized, rootId: string, groupId: string): AnnotationArg => {
  const { params, query, headers, payload } = recognized;
  const metadata = recognized.metadata;

  return options([
    ["root", rootId],
    ["group", groupId],
    ["params", params === undefined ? undefined : schemaArg(params.ref, params.allKeys)],
    ["query", query === undefined ? undefined : schemaArg(query.ref)],
    ["headers", headers === undefined ? undefined : schemaArg(headers.ref, headers.requiredKeys)],
    ["payload", payload === undefined ? undefined : schemaArg(payload.ref)],
    ["mediaType", recognized.mediaType],
    ["success", schemaArg(recognized.success.ref)],
    ["status", recognized.status],
    [
      "responseHeaders",
      recognized.responseHeaders === undefined ? undefined : schemaArg(recognized.responseHeaders),
    ],
    ["conditional", recognized.conditional ? true : undefined],
    [
      "middleware",
      recognized.middleware.length === 0
        ? undefined
        : recognized.middleware.map((marker) => symbolArg(marker.ref, marker.security)),
    ],
    [
      "metadata",
      options([
        ["annotator", metadata.annotator === undefined ? undefined : symbolArg(metadata.annotator)],
        ["operationId", metadata.operationId],
        ["summary", metadata.summary],
        ["description", metadata.description],
        ["tags", metadata.tags === undefined ? undefined : [...metadata.tags]],
      ]),
    ],
  ]);
};

const annotation = (name: string, arg: AnnotationArg): Annotation => ({ name, args: [arg] });

export interface OperationParts {
  readonly module: string;
  readonly exportName: string;
  readonly rootId: string;
  readonly groupId: string;
  readonly recognized: Recognized;
  readonly input: ChosenInput;
}

/** The annotations of one endpoint, or none when its access data has no argument form (a JSON `null`). */
export const operationDeclaration = (parts: OperationParts): Option.Option<Declaration> => {
  const { recognized, input } = parts;
  const problems = recognized.problems;
  const access = recognized.access === undefined ? Option.none() : accessArg(recognized.access);

  if (recognized.access !== undefined && Option.isNone(access)) return Option.none();

  const annotations: ReadonlyArray<Annotation> = [
    annotation(
      isQuery(recognized) ? "Query" : "Command",
      options([
        ["name", recognized.subject],
        ["input", schemaArg(input.ref, input.fields)],
        ["success", schemaArg(recognized.success.ref)],
      ]),
    ),
    annotation(`Http.${verbName[recognized.method]}`, recognized.path),
    annotation("Http.Contract", contractArg(recognized, parts.rootId, parts.groupId)),
    ...(problems === undefined
      ? []
      : [
          annotation(
            "Http.Problems",
            options([
              ["registry", symbolArg(problems.registry)],
              ["codes", [...problems.codes]],
              ["identifier", problems.identifier],
            ]),
          ),
        ]),
    ...recognized.annotations.map((entry): Annotation => entry),
    ...Option.match(access, {
      onNone: () => [],
      onSome: (arg) => [annotation("Http.Access", arg)],
    }),
  ];

  return Option.some({
    id: parts.exportName,
    kind: "builder",
    module: parts.module,
    export: parts.exportName,
    binding: "external",
    annotations,
  });
};

export interface GroupParts {
  readonly module: string;
  readonly exportName: string;
  readonly facts: GroupFacts;
}

/** `Http.group({ root, group, title, description, displayName })`. */
export const groupDeclaration = (parts: GroupParts): Declaration => {
  const { facts } = parts;

  return {
    id: parts.exportName,
    kind: "builder",
    module: parts.module,
    export: parts.exportName,
    annotations: [
      annotation(
        "Http.Group",
        options([
          ["root", { _tag: "Symbol", ref: facts.root.symbol, identifier: facts.rootId }],
          ["group", facts.groupId],
          ["title", facts.info.title],
          ["description", facts.info.description],
          ["displayName", facts.info.displayName],
        ]),
      ),
    ],
  };
};
