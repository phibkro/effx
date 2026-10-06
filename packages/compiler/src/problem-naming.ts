import { Option, Predicate, Schema } from "effect";
import { StableId } from "@effx/ir";
import type { AnnotationArg, Declaration } from "./Collected.ts";
import type { Diagnostic } from "./Diagnostic.ts";
import { HttpDiagnostics } from "./diagnostics/http.ts";
import { operationIdOf } from "./extensions/core.ts";
import { groupExportPart } from "./generate/http-contracts.ts";
import { isAnnotationOptions, optionsOf } from "./request-channels.ts";

const safeIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const codesSchema = Schema.Array(Schema.String);

/** Pure policy validation, shared by project loading and the source prepass. */
export const problemNamingIssue = (pattern: string): string | undefined => {
  if (!/\{(?:Key|key)\}/u.test(pattern)) return "include {Key} or {key}";
  const literal = pattern.replace(/\{(?:Group|Key|group|key)\}/gu, "X");

  if (!safeIdentifier.test(literal))
    return "use only {Group}, {Key}, {group}, {key} and identifier-safe literal text";

  return undefined;
};

/** Substitution is data-only; raw placeholders are never sanitized silently. */
export const expandProblemIdentifier = (pattern: string, group: string, key: string): string => {
  const values = {
    Group: groupExportPart(group),
    Key: key.charAt(0).toUpperCase() + key.slice(1),
    group,
    key,
  };

  return pattern.replace(
    /\{(Group|Key|group|key)\}/gu,
    (_, placeholder: keyof typeof values) => values[placeholder],
  );
};

/**
 * The prepass owns no resources and performs no IO. Only configured identifiers enter IR; the legacy
 * default remains generator-owned so existing canonical bytes do not change. Collision state is local
 * to this expansion, never retained across compilations. Explicit overrides are not derived names.
 */
export const nameProblems = (
  declarations: ReadonlyArray<Declaration>,
  pattern: string | undefined,
) => {
  const diagnostics: Array<Diagnostic> = [];

  if (pattern !== undefined) {
    const reason = problemNamingIssue(pattern);

    if (reason !== undefined) {
      return { declarations, diagnostics: [HttpDiagnostics.EFFX2412.emit({ pattern, reason })] };
    }
  }

  const derived = new Map<
    string,
    { readonly subject: string; readonly codes: ReadonlyArray<string> }
  >();

  const named = declarations.map((declaration): Declaration => {
    const operation = operationIdOf(declaration);

    if (Option.isNone(operation)) return declaration;

    const contract = declaration.annotations.find(
      (annotation) => annotation.name === "Http.Contract",
    );

    const options = contract === undefined ? undefined : optionsOf(contract);

    if (options === undefined) return declaration;
    const group = Predicate.isString(options.group) ? options.group : "operations";

    const metadata: Readonly<Record<string, AnnotationArg>> | undefined = isAnnotationOptions(
      options.metadata,
    )
      ? options.metadata
      : undefined;

    const operationId = metadata?.operationId;

    const key = Predicate.isString(operationId)
      ? operationId.slice(group.length + 1)
      : StableId.nameOf(operation.value);

    return {
      ...declaration,
      annotations: declaration.annotations.map((annotation) => {
        const args = optionsOf(annotation);

        if (
          annotation.name !== "Http.Problems" ||
          args === undefined ||
          args.identifier !== undefined
        )
          return annotation;
        const codes = Schema.decodeUnknownOption(codesSchema)(args.codes);

        if (Option.isNone(codes)) return annotation;
        const identifier = expandProblemIdentifier(pattern ?? "{key}Problem", group, key);

        if (pattern !== undefined && !safeIdentifier.test(identifier)) {
          diagnostics.push(
            HttpDiagnostics.EFFX2412.emit(
              { pattern, reason: `${declaration.id} expands to unsafe identifier ${identifier}` },
              { location: declaration.location },
            ),
          );

          return annotation;
        }

        const sorted = codes.value.toSorted();
        const previous = derived.get(identifier);

        if (
          previous !== undefined &&
          (previous.codes.length !== sorted.length ||
            previous.codes.some((code, index) => code !== sorted[index]))
        ) {
          diagnostics.push(
            HttpDiagnostics.EFFX2413.emit(
              { identifier, first: previous.subject, second: declaration.id },
              { location: declaration.location },
            ),
          );
        } else if (previous === undefined)
          derived.set(identifier, { subject: declaration.id, codes: sorted });

        return pattern === undefined
          ? annotation
          : { ...annotation, args: [{ ...args, identifier }] };
      }),
    };
  });

  return { declarations: named, diagnostics };
};
