import { Option, Predicate, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { AnnotationArg, type Annotation, type Declaration } from "./Collected.ts";
import { type Diagnostic, error } from "./Diagnostic.ts";
import type { Expand } from "./Extension.ts";
import { SchemaArg, SymbolArg } from "./args.ts";
import { decodeSchemaOf } from "./annotation.ts";
import { OperationArgs } from "./extensions/core.ts";

const GroupOptions = decodeSchemaOf(Builtins.HttpGroup);

const InArgs = Schema.Tuple([SymbolArg]);

const isAnnotationOptions = (
  value: AnnotationArg | undefined,
): value is Readonly<Record<string, AnnotationArg>> =>
  Predicate.isObject(value) &&
  !Predicate.isTagged("Schema")(value) &&
  !Predicate.isTagged("Symbol")(value) &&
  !Predicate.isTagged("Lambda")(value);

const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const isSchemaArg = Schema.is(SchemaArg);

const isString = Schema.is(Schema.String);

const mapsInput = (candidate: AnnotationArg | undefined, input: typeof SchemaArg.Type): boolean =>
  isSchemaArg(candidate) &&
  candidate.ref.module === input.ref.module &&
  candidate.ref.export === input.ref.export &&
  candidate.ref.symbolId === input.ref.symbolId;

const symbolKey = (module: string, name: string): string => `${module}\0${name}`;

/** Operation fields win even when an override is an empty array. */
const inheritFields = (
  fields: Readonly<Record<string, AnnotationArg>>,
  defaults: Readonly<Record<string, AnnotationArg>>,
) => {
  const merged = { ...fields };

  for (const [field, value] of Object.entries(defaults)) {
    if (value !== undefined && merged[field] === undefined) merged[field] = value;
  }

  return merged;
};

/** Defaults are source syntax only: this returns ordinary annotations for existing interpreters. */
export const expandGroupDefaults: Expand = (collected) => {
  const diagnostics: Array<Diagnostic> = [];
  const symbols = new Map<string, Array<Declaration>>();

  for (const declaration of collected.declarations) {
    const key = symbolKey(declaration.module, declaration.export);
    const candidates = symbols.get(key) ?? [];
    candidates.push(declaration);
    symbols.set(key, candidates);
  }

  const declarations = collected.declarations.map((declaration): Declaration => {
    const explicit = declaration.annotations.filter((annotation) => annotation.name === "Http.In");

    const enclosing =
      declaration.kind === "staticMethod"
        ? (symbols.get(symbolKey(declaration.module, declaration.export)) ?? []).filter(
            (candidate) =>
              candidate.kind === "class" &&
              candidate.annotations.some((annotation) => annotation.name === "Http.Group"),
          )
        : [];

    const location = declaration.location;

    const invalid = (code: string, message: string): void => {
      diagnostics.push(error(code, `${declaration.id}: ${message}`, location));
    };

    // Http.In is never interpreted or persisted, even for an invalid association.
    const annotations = declaration.annotations.filter(
      (annotation) => annotation.name !== "Http.In",
    );

    if (explicit.length === 0 && enclosing.length === 0) return declaration;

    if (
      !annotations.some(
        (annotation) => annotation.name === "Query" || annotation.name === "Command",
      )
    ) {
      invalid("EFFX2404", "HTTP group association requires an operation");

      return { ...declaration, annotations };
    }

    if (explicit.length + enclosing.length !== 1) {
      invalid("EFFX2404", "multiple or repeated HTTP group associations");

      return { ...declaration, annotations };
    }

    let group: Declaration | undefined = enclosing[0];

    if (explicit.length === 1) {
      const decoded = Schema.decodeUnknownOption(InArgs)(explicit[0]!.args);

      if (Option.isNone(decoded)) {
        invalid("EFFX2404", "malformed HTTP group association");

        return { ...declaration, annotations };
      }

      const ref = decoded.value[0].ref;

      const candidates = (symbols.get(symbolKey(ref.module, ref.export)) ?? []).filter(
        (candidate) => candidate.annotations.some((annotation) => annotation.name === "Http.Group"),
      );

      if (ref.member !== undefined || candidates.length !== 1) {
        invalid("EFFX2404", "group reference must resolve to one exported group declaration");

        return { ...declaration, annotations };
      }

      group = candidates[0];
    }

    const groups =
      group?.annotations.filter((annotation) => annotation.name === "Http.Group") ?? [];

    if (
      group === undefined ||
      (group.kind !== "class" && group.kind !== "builder") ||
      groups.length !== 1 ||
      group.member !== undefined ||
      !group.export
    ) {
      invalid("EFFX2404", "association does not identify one exported HTTP group");

      return { ...declaration, annotations };
    }

    const decoded = Schema.decodeOption(GroupOptions)(groups[0]!.args);

    if (Option.isNone(decoded)) {
      // The group interpreter reports the malformed option arguments at their source.
      return { ...declaration, annotations };
    }

    const options = decoded.value[0];
    const root = isString(options.root) ? options.root : options.root.identifier;
    const contract = annotations.find((annotation) => annotation.name === "Http.Contract");

    if (contract === undefined) {
      if (
        annotations.some((annotation) =>
          /^Http\.(Get|Post|Patch|Put|Delete)$/u.test(annotation.name),
        )
      )
        invalid("EFFX2405", "associated HTTP operation requires an explicit Http.Contract");

      return { ...declaration, annotations };
    }

    if (contract.args.length !== 1 || !isAnnotationOptions(contract.args[0])) {
      // The existing contract interpreter diagnoses malformed contract arguments.
      return { ...declaration, annotations };
    }

    const current: Readonly<Record<string, AnnotationArg>> = contract.args[0];

    if (current.root !== undefined && current.root !== root)
      invalid("EFFX2405", "HTTP root conflicts with associated group");

    if (current.group !== undefined && current.group !== options.group)
      invalid("EFFX2405", "HTTP group conflicts with associated group");

    const operation = annotations.find(
      (annotation) => annotation.name === "Query" || annotation.name === "Command",
    );

    const declared =
      operation === undefined ? Option.none() : Schema.decodeOption(OperationArgs)(operation.args);

    const operationArgs = Option.getOrUndefined(declared)?.[0];

    const method = annotations.find((annotation) =>
      /^Http\.(Get|Post|Patch|Put|Delete)$/u.test(annotation.name),
    )?.name;

    const updated = { ...current };
    updated.root ??= root;
    updated.group ??= options.group;

    if (updated.success === undefined && operationArgs !== undefined)
      updated.success = operationArgs.success;

    if (current.query === true) {
      if (
        method !== "Http.Get" ||
        operation?.name !== "Query" ||
        operationArgs === undefined ||
        mapsInput(current.params, operationArgs.input) ||
        mapsInput(current.headers, operationArgs.input) ||
        current.payload !== undefined
      ) {
        invalid("EFFX2405", "query: true requires a GET Query input not assigned elsewhere");
      } else {
        updated.query = operationArgs.input;
      }
    }

    if (
      updated.payload === undefined &&
      (method === "Http.Post" || method === "Http.Patch") &&
      operation?.name === "Command" &&
      operationArgs !== undefined
    ) {
      if (
        mapsInput(current.params, operationArgs.input) ||
        mapsInput(current.query, operationArgs.input) ||
        mapsInput(current.headers, operationArgs.input)
      ) {
        invalid("EFFX2405", "Command input assigned elsewhere requires an explicit payload");
      } else {
        updated.payload = operationArgs.input;
      }
    }

    const defaults = options.defaults;

    if (updated.middleware === undefined && defaults?.middleware !== undefined)
      updated.middleware = defaults.middleware;
    const metadata = current.metadata;

    if (metadata === undefined || isAnnotationOptions(metadata)) {
      const inheritedMetadata: Record<string, AnnotationArg> =
        metadata === undefined ? {} : { ...metadata };

      if (inheritedMetadata.annotator === undefined && defaults?.metadata?.annotator !== undefined)
        inheritedMetadata.annotator = defaults.metadata.annotator;
      const name = operationArgs?.name;

      if (inheritedMetadata.operationId === undefined && name !== undefined) {
        const prefix = `${options.group}.`;

        if (name.startsWith(prefix) && safeKey.test(name.slice(prefix.length)))
          inheritedMetadata.operationId = name;
      }

      if (Object.keys(inheritedMetadata).length > 0) updated.metadata = inheritedMetadata;
    }

    const merge = (annotation: Annotation): Annotation => {
      if (annotation.name === "Http.Contract") return { ...annotation, args: [updated] };

      const additions =
        annotation.name === "Http.Problems"
          ? defaults?.problems
          : annotation.name === "Http.Access"
            ? defaults?.access
            : undefined;

      if (
        additions === undefined ||
        annotation.args.length !== 1 ||
        !isAnnotationOptions(annotation.args[0])
      )
        return annotation;
      const values = inheritFields(annotation.args[0], additions);

      return { ...annotation, args: [values] };
    };

    return { ...declaration, annotations: annotations.map(merge) };
  });

  return { declarations, diagnostics };
};
