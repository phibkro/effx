import { Option, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { AnnotationArg, type Annotation, type Declaration } from "./Collected.ts";
import type { Diagnostic } from "./Diagnostic.ts";
import { HttpDiagnostics } from "./diagnostics/http.ts";
import type { Expand } from "./Extension.ts";
import { SymbolArg } from "./args.ts";
import { decodeSchemaOf } from "./annotation.ts";
import { OperationArgs } from "./extensions/core.ts";
import { defaultDecisionTime } from "./decision-time.ts";
import { deriveRequestChannels, isAnnotationOptions, mapsInput } from "./request-channels.ts";
import { nameProblems } from "./problem-naming.ts";

const GroupOptions = decodeSchemaOf(Builtins.HttpGroup);

const InArgs = Schema.Tuple([SymbolArg]);

const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const isString = Schema.is(Schema.String);

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

  const associate = (declaration: Declaration): Declaration => {
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
      diagnostics.push(
        HttpDiagnostics.EFFX2404.emit(
          { _tag: "NotOperation", subject: declaration.id },
          { location },
        ),
      );

      return { ...declaration, annotations };
    }

    if (explicit.length + enclosing.length !== 1) {
      diagnostics.push(
        HttpDiagnostics.EFFX2404.emit(
          { _tag: "MultipleAssociations", subject: declaration.id },
          { location },
        ),
      );

      return { ...declaration, annotations };
    }

    let group: Declaration | undefined = enclosing[0];

    if (explicit.length === 1) {
      const decoded = Schema.decodeUnknownOption(InArgs)(explicit[0]!.args);

      if (Option.isNone(decoded)) {
        diagnostics.push(
          HttpDiagnostics.EFFX2404.emit(
            { _tag: "MalformedAssociation", subject: declaration.id },
            { location },
          ),
        );

        return { ...declaration, annotations };
      }

      const ref = decoded.value[0].ref;

      const candidates = (symbols.get(symbolKey(ref.module, ref.export)) ?? []).filter(
        (candidate) => candidate.annotations.some((annotation) => annotation.name === "Http.Group"),
      );

      if (ref.member !== undefined || candidates.length !== 1) {
        diagnostics.push(
          HttpDiagnostics.EFFX2404.emit(
            { _tag: "UnresolvedReference", subject: declaration.id },
            { location },
          ),
        );

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
      diagnostics.push(
        HttpDiagnostics.EFFX2404.emit(
          { _tag: "InvalidAssociation", subject: declaration.id },
          { location },
        ),
      );

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
        diagnostics.push(
          HttpDiagnostics.EFFX2405.emit(
            { _tag: "MissingContract", subject: declaration.id },
            { location },
          ),
        );

      return { ...declaration, annotations };
    }

    if (contract.args.length !== 1 || !isAnnotationOptions(contract.args[0])) {
      // The existing contract interpreter diagnoses malformed contract arguments.
      return { ...declaration, annotations };
    }

    const current: Readonly<Record<string, AnnotationArg>> = contract.args[0];

    if (current.root !== undefined && current.root !== root)
      diagnostics.push(
        HttpDiagnostics.EFFX2405.emit(
          { _tag: "RootConflict", subject: declaration.id },
          { location },
        ),
      );

    if (current.group !== undefined && current.group !== options.group)
      diagnostics.push(
        HttpDiagnostics.EFFX2405.emit(
          { _tag: "GroupConflict", subject: declaration.id },
          { location },
        ),
      );

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

    // `query: true` means the declared input; the remaining channels (a Command's payload included) are
    // derived from it by `deriveRequestChannels`, after the group's defaults.
    if (current.query === true) {
      if (
        method !== "Http.Get" ||
        operation?.name !== "Query" ||
        operationArgs === undefined ||
        operationArgs.input.marker === "headers" ||
        mapsInput(current.params, operationArgs.input) ||
        mapsInput(current.headers, operationArgs.input) ||
        current.payload !== undefined
      ) {
        diagnostics.push(
          HttpDiagnostics.EFFX2405.emit(
            { _tag: "QueryDefault", subject: declaration.id },
            { location },
          ),
        );
      } else {
        updated.query = { _tag: "Schema", ref: operationArgs.input.ref };
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
  };

  // After the group's defaults, for associated and bare operations alike: the request channels are derived
  // from `input` (spec 0024 §2), then `decisionTime` from the operation kind (§4).
  const declarations = collected.declarations.map((declaration): Declaration => {
    const reported = diagnostics.length;
    const associated = associate(declaration);

    // An association that already failed is reported once; rewriting it would only add noise.
    if (diagnostics.length !== reported) return associated;
    const derived = deriveRequestChannels(associated);
    const defaulted = defaultDecisionTime(derived.declaration);

    diagnostics.push(...derived.diagnostics, ...defaulted.diagnostics);

    return defaulted.declaration;
  });

  if (
    collected.diagnostics.some(
      (diagnostic) => diagnostic.code === HttpDiagnostics.EFFX2412.entry.code,
    )
  )
    return { declarations, diagnostics };
  const named = nameProblems(declarations, collected.project?.naming?.problemIdentifier);

  return { declarations: named.declarations, diagnostics: [...diagnostics, ...named.diagnostics] };
};
