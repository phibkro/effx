import { Option, Result } from "effect";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import { nameOfSymbol } from "./context.ts";
import {
  mergeMetadata,
  readAnnotate,
  readAnnotateMerge,
  readApply,
  type StepRead,
} from "./annotations.ts";
import { readChannel } from "./channels.ts";
import type { StepRecord } from "./model.ts";
import { nativeName } from "./native.ts";
import { readProblems } from "./problems.ts";
import { refIdentity } from "./refs.ts";
import {
  fail,
  failFindings,
  failUnrecognized,
  makeScope,
  nativeOf,
  open,
  type Scope,
} from "./scope.ts";
import type { SourceRange } from "./source.ts";
import { readSuccess } from "./success.ts";
import type { Annotation } from "../Collected.ts";
import type {
  AccessUse,
  MetadataUse,
  Method,
  MiddlewareUse,
  Outcome,
  ProblemsUse,
  Recognized,
  SchemaUse,
} from "./types.ts";
import { refOf, stringOf } from "./view.ts";
import type { Context } from "./context.ts";
import type { EndpointRecord } from "./model.ts";
import type { SchemaRef, SymbolRef } from "@effx/ir";

/*
 * Recognition of one endpoint: the exact inverse of `generate/http.ts` `endpointTerm` (spec 0019 §3.4) plus
 * the registered application forms of the data rules. It reads only the model and rules, collects EVERY
 * applicable cause instead of stopping at the first, and plans the wire-preserving refactors that would make
 * a refactorable construct liftable. A recognized endpoint exists only when no blocking cause was found.
 */

const methods: ReadonlyMap<string, Method> = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["del", "DELETE"],
]);

/** Endpoint keys are identifier-safe (EFFX2403): the generator and the contract analysis both rely on it. */
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/** Mutable working state of one recognition; frozen into `Recognized` when no cause was found. */
interface Draft {
  method: Method | undefined;
  key: string | undefined;
  path: string | undefined;
  params: SchemaUse | undefined;
  query: SchemaUse | undefined;
  headers: SchemaUse | undefined;
  payload: SchemaUse | undefined;
  mediaType: string | undefined;
  success: SchemaUse | undefined;
  status: number | undefined;
  responseHeaders: SchemaRef | undefined;
  conditional: boolean;
  wrapper: SymbolRef | undefined;
  middleware: Array<MiddlewareUse>;
  metadata: MetadataUse | undefined;
  problems: ProblemsUse | undefined;
  access: AccessUse | undefined;
  /** The definition annotations the `.annotate` steps produced, in step order (spec 0019 §5, S1). */
  definitionAnnotations: Array<Annotation>;
}

/** `.middleware(M)`: an exported marker with a recorded security fact. */
const readMiddleware = (
  scope: Scope,
  step: Extract<StepRecord, { readonly _tag: "Method" }>,
): Option.Option<MiddlewareUse> => {
  const [slot] = step.args;

  if (step.args.length !== 1 || slot === undefined) {
    failUnrecognized(scope, step.range, ".middleware without exactly one argument");

    return Option.none();
  }

  const opened = open(scope, slot, "structure");

  if (Option.isNone(opened)) return Option.none();

  const marker = refOf(opened.value.term);

  if (Option.isNone(marker) || "symbolId" in marker.value) {
    failUnrecognized(scope, step.range, ".middleware argument");

    return Option.none();
  }

  const fact = scope.ctx.markers.get(refIdentity(marker.value));

  if (fact === undefined) {
    failUnrecognized(
      scope,
      step.range,
      `middleware marker ${nameOfSymbol(marker.value)} has no recorded security fact`,
    );

    return Option.none();
  }

  return Option.some({ ref: fact.ref, security: fact.security });
};

const applyStepRead = (scope: Scope, draft: Draft, read: StepRead, at: SourceRange): void => {
  if (read._tag === "Metadata") {
    const merged = mergeMetadata(draft.metadata, read.patch);
    const expected = Option.map(scope.key, (key) => `${scope.groupId}.${key}`);

    if (Result.isFailure(merged)) failUnrecognized(scope, at, merged.failure);
    else if (
      read.patch.operationId !== undefined &&
      Option.exists(expected, (id) => id !== read.patch.operationId)
    )
      fail(
        scope,
        at,
        LiftDiagnostics.EFFX3001.emit({
          _tag: "UnsupportedOption",
          subject: scope.subject,
          callee: "OpenApi.annotations",
          option: `identifier ${JSON.stringify(read.patch.operationId)} (an effx operation id is always ${scope.groupId}.<endpoint key>)`,
        }),
      );
    else draft.metadata = merged.success;
  } else if (read._tag === "Access") {
    if (draft.access !== undefined) failUnrecognized(scope, at, "a second access declaration");
    else draft.access = read.use;
  }
};

export const recognizeEndpoint = (
  ctx: Context,
  groupId: string,
  endpoint: EndpointRecord,
): Outcome => {
  const scope = makeScope(ctx, groupId, endpoint);

  const draft: Draft = {
    method: undefined,
    key: undefined,
    path: undefined,
    params: undefined,
    query: undefined,
    headers: undefined,
    payload: undefined,
    mediaType: undefined,
    success: undefined,
    status: undefined,
    responseHeaders: undefined,
    conditional: false,
    wrapper: undefined,
    middleware: [],
    metadata: undefined,
    problems: undefined,
    access: undefined,
    definitionAnnotations: [],
  };

  const callee = open(scope, endpoint.callee, "structure", "endpoint callee");

  if (Option.isSome(callee)) {
    const native = nativeOf(scope, callee.value.term);
    const method = native?.kind === "HttpApiEndpoint" ? methods.get(nativeName(native)) : undefined;

    if (method === undefined)
      failUnrecognized(
        scope,
        endpoint.callee.range,
        "an endpoint constructor that is not a native HttpApiEndpoint verb",
      );
    else draft.method = method;
  }

  const key = open(scope, endpoint.key, "structure", "key");

  if (Option.isSome(key)) {
    const text = stringOf(key.value.term);

    if (Option.isNone(text)) {
      fail(
        scope,
        endpoint.key.range,
        LiftDiagnostics.EFFX3001.emit({
          _tag: "ComputedKey",
          subject: scope.subject,
          construct: "key",
        }),
      );
    } else if (identifierPattern.test(text.value)) draft.key = text.value;
    else
      failUnrecognized(
        scope,
        endpoint.key.range,
        `endpoint key ${JSON.stringify(text.value)} is not an identifier`,
      );
  }

  const path = open(scope, endpoint.path, "structure", "path");

  if (Option.isSome(path)) {
    const text = stringOf(path.value.term);

    if (Option.isSome(text)) draft.path = text.value;
    else
      fail(
        scope,
        endpoint.path.range,
        LiftDiagnostics.EFFX3001.emit({
          _tag: "ComputedKey",
          subject: scope.subject,
          construct: "path",
        }),
      );
  }

  const options = endpoint.options;
  const optionsRange = options._tag === "Absent" ? endpoint.range : options.range;
  let channelsReadable = options._tag !== "Unlowered";

  const missingSuccess = LiftDiagnostics.EFFX3007.emit({
    subject: scope.subject,
    construct: "a missing success",
  });

  if (options._tag === "Unlowered") failFindings(scope, "structure", options.findings, "options");
  else if (options._tag === "Absent") fail(scope, optionsRange, missingSuccess);
  else {
    const entries = options.entries;

    for (const entry of entries) {
      if (entry._tag === "Unsupported") {
        channelsReadable = false;
        fail(
          scope,
          entry.finding.range,
          entry.finding.kind === "spread"
            ? LiftDiagnostics.EFFX3001.emit({
                _tag: "Spread",
                subject: scope.subject,
                construct: "options",
              })
            : LiftDiagnostics.EFFX3001.emit({
                _tag: "ComputedKey",
                subject: scope.subject,
                construct: "options key",
              }),
        );
        continue;
      }

      switch (entry.name) {
        case "params":
        case "query":
        case "headers":
        case "payload": {
          const read = readChannel(scope, entry.name, entry);

          if (read._tag === "Failed") channelsReadable = false;

          if (read._tag === "Used") {
            draft[entry.name] = read.use;

            if (read.mediaType !== undefined) draft.mediaType = read.mediaType;
          }

          break;
        }

        case "success": {
          const read = readSuccess(scope, entry.value);

          if (Option.isSome(read)) {
            draft.success = read.value.schema;
            draft.status = read.value.status;
            draft.responseHeaders = read.value.responseHeaders;
            draft.conditional = read.value.conditional;
            draft.wrapper = read.value.wrapper;
          }

          break;
        }

        case "error": {
          const read = readProblems(scope, entry);

          if (Option.isSome(read)) draft.problems = read.value;

          break;
        }

        default:
          fail(
            scope,
            entry.range,
            LiftDiagnostics.EFFX3001.emit({
              _tag: "UnsupportedOption",
              subject: scope.subject,
              callee: "HttpApiEndpoint",
              option: entry.name,
            }),
          );
      }
    }

    if (!entries.some((entry) => entry._tag === "Property" && entry.name === "success"))
      fail(scope, optionsRange, missingSuccess);

    if (
      entries.every((entry) => entry._tag === "Property") &&
      !entries.some((entry) => entry._tag === "Property" && entry.name === "error")
    )
      failUnrecognized(
        scope,
        optionsRange,
        "an endpoint without an explicit error schema (effx emits Schema.Never)",
      );
  }

  for (const step of endpoint.steps) {
    switch (step._tag) {
      case "Unsupported":
        failFindings(scope, "structure", [step.finding]);
        break;
      case "Apply":
        applyStepRead(scope, draft, readApply(scope, step), step.range);
        break;
      case "Method":
        switch (step.name) {
          case "middleware": {
            const read = readMiddleware(scope, step);

            if (Option.isSome(read)) draft.middleware.push(read.value);

            break;
          }

          case "annotateMerge":
            applyStepRead(scope, draft, readAnnotateMerge(scope, step), step.range);
            break;
          case "annotate": {
            const annotation = readAnnotate(scope, step, draft.definitionAnnotations);

            if (Option.isSome(annotation)) draft.definitionAnnotations.push(annotation.value);

            break;
          }

          default:
            fail(
              scope,
              step.range,
              LiftDiagnostics.EFFX3001.emit({
                _tag: "UnknownStep",
                subject: scope.subject,
                step: step.name,
              }),
            );
        }
    }
  }

  const hasChannel = [draft.payload, draft.query, draft.headers, draft.params].some(
    (channel) => channel !== undefined,
  );

  if (!hasChannel && channelsReadable) {
    if (ctx.input.emptyInput === undefined)
      fail(scope, optionsRange, LiftDiagnostics.EFFX3009.emit({ subject: scope.subject }));
    else if (draft.method === "POST" || draft.method === "PUT" || draft.method === "PATCH")
      // The 0013 pre-pass gives every such Command a payload from its input, so no declaration can say "no body".
      failUnrecognized(
        scope,
        optionsRange,
        `a ${draft.method} endpoint without a request channel (effx derives its payload from the operation input)`,
      );
  }

  const { method, key: keyText, path: pathText, success } = draft;

  const recognized: Recognized | undefined =
    scope.causes.length === 0 &&
    method !== undefined &&
    keyText !== undefined &&
    pathText !== undefined &&
    success !== undefined
      ? {
          subject: scope.subject,
          key: keyText,
          method,
          path: pathText,
          params: draft.params,
          query: draft.query,
          headers: draft.headers,
          payload: draft.payload,
          mediaType: draft.mediaType,
          success,
          status: draft.status,
          responseHeaders: draft.responseHeaders,
          conditional: draft.conditional,
          wrapper: draft.wrapper,
          middleware: draft.middleware,
          metadata: {
            annotator: draft.metadata?.annotator,
            operationId: `${groupId}.${keyText}`,
            summary: draft.metadata?.summary,
            description: draft.metadata?.description,
            tags: draft.metadata?.tags,
          },
          problems: draft.problems,
          access: draft.access,
          annotations: draft.definitionAnnotations,
        }
      : undefined;

  return {
    subject: scope.subject,
    recognized,
    causes: scope.causes,
    refactors: scope.causes.length === 0 ? scope.refactors : [],
    codeReferences: scope.causes.length === 0 ? scope.codeReferences : [],
  };
};
