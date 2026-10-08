import { Option, Predicate } from "effect";
import type { Annotation, AnnotationArg, Collected, Declaration } from "../Collected.ts";
import { defaultDecisionTime } from "../decision-time.ts";
import { expandGroupDefaults } from "../group-defaults.ts";
import { expandProblemIdentifier } from "../problem-naming.ts";
import { deriveRequestChannels, isAnnotationOptions, optionsOf } from "../request-channels.ts";
import { sameArg } from "./arg.ts";

/*
 * The dense form of a verbose lift (spec 0019 §4.2, spec 0024 §2-§5, spec 0013). It hoists the fields every
 * operation shares into the group's `defaults`, associates each operation with `.in(Group)` and omits every
 * field the 0013 pre-pass derives: the group's root and group ids, the contract `success`, the request
 * channel the operation `input` implies, the metadata operation id, a default decision time and a
 * pattern-derived problem identifier. Each omission uses the pre-pass's own derivation, and the result is
 * returned only after `expandGroupDefaults` has been shown to rebuild the verbose declarations exactly
 * (law L4), so a dense suggestion is never a guess.
 */

type Fields = Readonly<Record<string, AnnotationArg>>;

const without = (fields: Fields, names: ReadonlyArray<string>): Fields =>
  Object.fromEntries(Object.entries(fields).filter(([name]) => !names.includes(name)));

const annotationOf = (declaration: Declaration, name: string): Annotation | undefined =>
  declaration.annotations.find((annotation) => annotation.name === name);

const fieldsOf = (annotation: Annotation | undefined): Fields | undefined =>
  annotation === undefined ? undefined : optionsOf(annotation);

const nested = (fields: Fields | undefined, name: string): Fields | undefined => {
  const value = fields?.[name];

  return isAnnotationOptions(value) ? value : undefined;
};

const replaceArgs = (
  declaration: Declaration,
  name: string,
  fields: Fields | undefined,
): Declaration => ({
  ...declaration,
  annotations: declaration.annotations.flatMap((annotation): ReadonlyArray<Annotation> =>
    annotation.name !== name
      ? [annotation]
      : fields === undefined
        ? []
        : [{ ...annotation, args: [fields] }],
  ),
});

/** The value every present occurrence shares; none when any differs or nothing carries it. */
const shared = (values: ReadonlyArray<AnnotationArg | undefined>): AnnotationArg | undefined => {
  const [first, ...rest] = values;

  return first !== undefined && rest.every((value) => sameArg(value, first)) ? first : undefined;
};

const accessFields = [
  "annotator",
  "exposure",
  "acceptedCredentials",
  "principalKinds",
  "concealment",
] as const;

/** Group defaults: what every operation that has the construct writes identically. */
const defaultsOf = (operations: ReadonlyArray<Declaration>): Fields | undefined => {
  const contracts = operations.flatMap((operation) =>
    Option.toArray(Option.fromUndefinedOr(fieldsOf(annotationOf(operation, "Http.Contract")))),
  );

  const problems = operations.flatMap((operation) =>
    Option.toArray(Option.fromUndefinedOr(fieldsOf(annotationOf(operation, "Http.Problems")))),
  );

  const accesses = operations.flatMap((operation) =>
    Option.toArray(Option.fromUndefinedOr(fieldsOf(annotationOf(operation, "Http.Access")))),
  );

  const present = (
    values: ReadonlyArray<AnnotationArg | undefined>,
  ): ReadonlyArray<AnnotationArg> =>
    values.flatMap((value) => (value === undefined ? [] : [value]));

  const everyHas = (values: ReadonlyArray<AnnotationArg | undefined>, count: number) =>
    present(values).length === count && count > 0;

  const middleware = everyHas(
    contracts.map((contract) => contract.middleware),
    operations.length,
  )
    ? shared(contracts.map((contract) => contract.middleware))
    : undefined;

  const annotators = contracts.map((contract) => nested(contract, "metadata")?.annotator);

  const annotator = everyHas(annotators, operations.length) ? shared(annotators) : undefined;

  const registries = problems.map((fields) => fields.registry);

  const registry = everyHas(registries, problems.length) ? shared(registries) : undefined;

  const access = Object.fromEntries(
    accessFields.flatMap((name) => {
      const values = accesses.map((fields) => fields[name]);
      const value = everyHas(values, accesses.length) ? shared(values) : undefined;

      return value === undefined ? [] : [[name, value] as const];
    }),
  );

  const entries: ReadonlyArray<readonly [string, AnnotationArg | undefined]> = [
    ["middleware", middleware],
    ["metadata", annotator === undefined ? undefined : { annotator }],
    ["problems", registry === undefined ? undefined : { registry }],
    ["access", Object.keys(access).length === 0 ? undefined : access],
  ];

  const kept = entries.flatMap(([name, value]) =>
    value === undefined ? [] : [[name, value] as const],
  );

  return kept.length === 0 ? undefined : Object.fromEntries(kept);
};

/** Removes one contract channel when the pre-pass derives exactly it back from the operation input. */
const withoutDerivedChannel = (declaration: Declaration): Declaration => {
  const contract = fieldsOf(annotationOf(declaration, "Http.Contract"));

  if (contract === undefined) return declaration;

  const derivable = (["params", "query", "headers", "payload"] as const).find((channel) => {
    const explicit = contract[channel];

    if (explicit === undefined) return false;

    const stripped = replaceArgs(declaration, "Http.Contract", without(contract, [channel]));

    const derived = fieldsOf(
      annotationOf(deriveRequestChannels(stripped).declaration, "Http.Contract"),
    );

    return sameArg(derived?.[channel], explicit);
  });

  return derivable === undefined
    ? declaration
    : replaceArgs(declaration, "Http.Contract", without(contract, [derivable]));
};

const withoutDefaultDecisionTime = (declaration: Declaration): Declaration => {
  const access = fieldsOf(annotationOf(declaration, "Http.Access"));
  const explicit = access?.decisionTime;

  if (access === undefined || explicit === undefined) return declaration;

  const stripped = replaceArgs(declaration, "Http.Access", without(access, ["decisionTime"]));
  const restored = fieldsOf(annotationOf(defaultDecisionTime(stripped).declaration, "Http.Access"));

  return sameArg(restored?.decisionTime, explicit) ? stripped : declaration;
};

/** The identifier the configured pattern derives for this operation, when it is the one written. */
const withoutPatternIdentifier = (
  declaration: Declaration,
  group: string,
  pattern: string | undefined,
): Declaration => {
  const problems = fieldsOf(annotationOf(declaration, "Http.Problems"));
  const metadata = nested(fieldsOf(annotationOf(declaration, "Http.Contract")), "metadata");
  const operationId = metadata?.operationId;

  if (
    pattern === undefined ||
    problems === undefined ||
    !Predicate.isString(operationId) ||
    !Predicate.isString(problems.identifier)
  )
    return declaration;

  const derived = expandProblemIdentifier(pattern, group, operationId.slice(group.length + 1));

  return derived === problems.identifier
    ? replaceArgs(declaration, "Http.Problems", without(problems, ["identifier"]))
    : declaration;
};

/** The operation as written under `.in(Group)`: shared fields and every derivable field omitted. */
const denseOperation = (
  declaration: Declaration,
  group: Declaration,
  groupId: string,
  defaults: Fields | undefined,
  pattern: string | undefined,
): Declaration => {
  const contract = fieldsOf(annotationOf(declaration, "Http.Contract"));
  const metadata = nested(contract, "metadata");

  const operationName = fieldsOf(
    annotationOf(declaration, "Query") ?? annotationOf(declaration, "Command"),
  )?.name;

  const derivedId = nested(contract, "metadata")?.operationId;

  const contractFields: Fields = without(contract ?? {}, [
    "root",
    "group",
    "success",
    ...(defaults?.middleware === undefined ? [] : ["middleware"]),
    "metadata",
  ]);

  const metadataFields = without(metadata ?? {}, [
    ...(nested(defaults, "metadata")?.annotator === undefined ? [] : ["annotator"]),
    ...(Predicate.isString(derivedId) && derivedId === operationName ? ["operationId"] : []),
  ]);

  const contractWithMetadata: Fields =
    Object.keys(metadataFields).length === 0
      ? contractFields
      : Object.fromEntries([...Object.entries(contractFields), ["metadata", metadataFields]]);

  const withContract = replaceArgs(declaration, "Http.Contract", contractWithMetadata);

  const withProblems = replaceArgs(
    withContract,
    "Http.Problems",
    ((): Fields | undefined => {
      const problems = fieldsOf(annotationOf(withContract, "Http.Problems"));

      return problems === undefined
        ? undefined
        : without(
            problems,
            nested(defaults, "problems")?.registry === undefined ? [] : ["registry"],
          );
    })(),
  );

  const withAccess = replaceArgs(
    withProblems,
    "Http.Access",
    ((): Fields | undefined => {
      const access = fieldsOf(annotationOf(withProblems, "Http.Access"));
      const hoisted = Object.keys(nested(defaults, "access") ?? {});

      return access === undefined ? undefined : without(access, hoisted);
    })(),
  );

  const associated: Declaration = {
    ...withAccess,
    annotations: withAccess.annotations.flatMap((annotation) =>
      annotation.name === "Query" || annotation.name === "Command"
        ? [
            annotation,
            {
              name: "Http.In",
              args: [{ _tag: "Symbol", ref: { module: group.module, export: group.export } }],
            } satisfies Annotation,
          ]
        : [annotation],
    ),
  };

  return withoutPatternIdentifier(
    withoutDefaultDecisionTime(withoutDerivedChannel(associated)),
    groupId,
    pattern,
  );
};

const isOperation = (declaration: Declaration): boolean =>
  declaration.annotations.some(
    (annotation) => annotation.name === "Query" || annotation.name === "Command",
  );

const isGroup = (declaration: Declaration): boolean =>
  declaration.annotations.some((annotation) => annotation.name === "Http.Group");

/** Does re-expanding the dense declarations give back the verbose ones, without diagnostics? */
const rebuilds = (verbose: Collected, candidate: Collected): boolean => {
  const expanded = expandGroupDefaults(candidate);

  if (expanded.diagnostics.length > 0) return false;

  return (
    expanded.declarations.length === verbose.declarations.length &&
    verbose.declarations.every((declaration, index) => {
      const rebuilt = expanded.declarations[index];

      if (rebuilt === undefined || rebuilt.id !== declaration.id) return false;

      const stripped = isGroup(rebuilt)
        ? {
            ...rebuilt,
            annotations: rebuilt.annotations.map((annotation) =>
              annotation.name === "Http.Group"
                ? {
                    ...annotation,
                    args: annotation.args.map((arg) =>
                      isAnnotationOptions(arg) ? without(arg, ["defaults"]) : arg,
                    ),
                  }
                : annotation,
            ),
          }
        : rebuilt;

      return (
        stripped.annotations.length === declaration.annotations.length &&
        declaration.annotations.every((annotation, position) => {
          const other = stripped.annotations[position];

          return (
            other !== undefined &&
            other.name === annotation.name &&
            sameArg([...annotation.args], [...other.args])
          );
        })
      );
    })
  );
};

/**
 * The dense `Collected` of a verbose one, or none when no group declaration exists or the pre-pass does not
 * rebuild the verbose declarations exactly (the verbose form is then the only suggestion).
 */
export const dense = (verbose: Collected): Option.Option<Collected> => {
  const group = verbose.declarations.find(isGroup);
  const operations = verbose.declarations.filter(isOperation);
  const groupFields = fieldsOf(group === undefined ? undefined : annotationOf(group, "Http.Group"));
  const groupId = groupFields?.group;

  if (
    group === undefined ||
    groupFields === undefined ||
    !Predicate.isString(groupId) ||
    operations.length === 0
  )
    return Option.none();

  const defaults = defaultsOf(operations);
  const pattern = verbose.project?.naming?.problemIdentifier;

  const declarations = verbose.declarations.map((declaration) =>
    declaration === group
      ? replaceArgs(
          declaration,
          "Http.Group",
          defaults === undefined ? groupFields : { ...groupFields, defaults },
        )
      : isOperation(declaration)
        ? denseOperation(declaration, group, groupId, defaults, pattern)
        : declaration,
  );

  const candidate: Collected = { ...verbose, declarations };

  return rebuilds(verbose, candidate) ? Option.some(candidate) : Option.none();
};
