import type { Annotation, Declaration } from "./Collected.ts";
import { type Diagnostic, error } from "./Diagnostic.ts";
import { type Rewrite, optionsOf } from "./request-channels.ts";

/**
 * Fills `Http.Access.decisionTime` from the sibling operation annotation (spec 0024 §4): a Query decides in a
 * read snapshot, a Command inside its transaction. An explicit value is kept, so `EFFX2501`/`EFFX2502` keep
 * checking the resolved value of the IR. The group's `defaults.access` never carries a decision time: it is
 * per operation by nature. An `Http.Access` with nothing to default from is `EFFX2414`.
 */
export const defaultDecisionTime = (declaration: Declaration): Rewrite => {
  const operations = declaration.annotations.filter(
    (annotation) => annotation.name === "Query" || annotation.name === "Command",
  );

  // Exactly one operation annotation says what the declaration is.
  const fallback =
    operations.length !== 1
      ? undefined
      : operations[0]!.name === "Query"
        ? "SnapshotRead"
        : "Transaction";

  const diagnostics: Array<Diagnostic> = [];

  const annotations = declaration.annotations.map((annotation): Annotation => {
    const options = annotation.name === "Http.Access" ? optionsOf(annotation) : undefined;

    // Malformed access arguments are reported by the access interpreter, with their source location.
    if (options === undefined || options.decisionTime !== undefined) return annotation;

    if (fallback === undefined) {
      diagnostics.push(
        error(
          "EFFX2414",
          `${declaration.id}: Http.Access omits decisionTime but the declaration has no single Query or Command to default it from; write decisionTime`,
          declaration.location,
        ),
      );

      return annotation;
    }

    return { ...annotation, args: [{ ...options, decisionTime: fallback }] };
  });

  return { declaration: { ...declaration, annotations }, diagnostics };
};
