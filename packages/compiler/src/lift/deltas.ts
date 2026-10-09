import { JsonPatch, Predicate, type Schema } from "effect";
import { OPEN_API_IDENTIFIER_KEY, type EndpointReflection, type Reflection } from "./reflection.ts";

/*
 * The closed set of Δ normalizers (spec 0019 §2.2) and the mechanical comparison they serve. Pure, total
 * and exact: a Δ fires only when its premise holds in the recorded data, any other difference fails with
 * the differing path, and a class is listed on the passing variant only when it actually fired. One
 * comparison variant owns the delta evidence; a mismatch keeps the two reflections unmodified.
 */

/* The Δ1 normalizer's output: a new record and whether anything collapsed at all. */
export interface SuffixCollapse {
  readonly document: Schema.Json;
  readonly collapsed: boolean;
}

/** One JSON object at the leaf of a reflection document: a plain string-keyed record of JSON values. */
export interface JsonObjectNode {
  readonly [key: string]: Schema.Json;
}

/** The endpoint-keyed map Δ3 builds once, with real duplicate-key reports. */
export interface EndpointSegments {
  readonly map: Map<string, EndpointReflection>;
  readonly duplicates: ReadonlyArray<string>;
}

/** One Δ class of the frozen closed set (spec 0019 §2.2). */
export type DeltaClass = "ref-suffix" | "explicit-default-identifier" | "endpoint-order";

/** The comparison's own outcome: a `Pass` owns the applied Δ evidence, a `Mismatch` owns the differences. */
export type CompareOutcome =
  | { readonly _tag: "Pass"; readonly applied: ReadonlyArray<DeltaClass> }
  | { readonly _tag: "Mismatch"; readonly differences: ReadonlyArray<string> };

/* ------------------------------------------------------------------ */
/* Shared record facts                                                 */
/* ------------------------------------------------------------------ */

/** `(group, identifier)` of one endpoint record, the map key Δ3 compares through. */
export const endpointKeyOf = (endpoint: EndpointReflection): string =>
  `${endpoint.group}\u0000${endpoint.identifier}`;

/** The operation id Effect derives when an endpoint carries no explicit identifier annotation. */
export const defaultOperationId = (group: string, identifier: string): string =>
  `${group}.${identifier}`;

const isJsonObject = (value: Schema.Json): value is JsonObjectNode => Predicate.isObject(value);

const objectFieldOf = (container: JsonObjectNode, key: string): JsonObjectNode | undefined => {
  const candidate = container[key];

  if (candidate === undefined) return undefined;

  return isJsonObject(candidate) ? candidate : undefined;
};

const printKey = (key: string): string => key.replaceAll("\u0000", ".");

/* ------------------------------------------------------------------ */
/* Δ2 — explicit-default-identifier                                    */
/* ------------------------------------------------------------------ */

/**
 * Drops the recorded `OpenApi/Identifier` annotation from each endpoint where the actual merged `Context`
 * value (`identifierAnnotation` witness) equals the endpoint's default `<group>.<endpointKey>`. The key
 * and its value leave together; a non-default value is preserved. A record without the key or without the
 * witness never fires: absence is not evidence.
 */
export const dropDefaultIdentifier = (
  endpoints: ReadonlyArray<EndpointReflection>,
): ReadonlyArray<EndpointReflection> =>
  endpoints.map((endpoint) => {
    const witness = endpoint.identifierAnnotation;

    const shouldDrop =
      witness !== undefined &&
      endpoint.annotationKeys.includes(OPEN_API_IDENTIFIER_KEY) &&
      witness.value === defaultOperationId(endpoint.group, endpoint.identifier);

    if (!shouldDrop) return endpoint;

    // The Δ2 drop is key AND value: the optional witness field must leave entirely, so the strict
    // decoder keeps `identifierAnnotation` true-optional instead of present-but-undefined.
    const { identifierAnnotation: _droppedWitness, ...rest } = endpoint;

    return {
      ...rest,
      annotationKeys: rest.annotationKeys.filter((key) => key !== OPEN_API_IDENTIFIER_KEY),
    };
  });

/* ------------------------------------------------------------------ */
/* Δ1 — ref-suffix                                                     */
/* ------------------------------------------------------------------ */

/** Suffix name of one duplicated Effect component: `N_1`, `N_2` … produced by the OpenAPI converter. */
const SUFFIXED = /^(.+)_(\d+)$/u;

/** The plain base under a duplicate name (`Profile_1` → `Profile`) when that base is itself unsuffixed. */
const suffixBase = (name: string): string | undefined => {
  const match = SUFFIXED.exec(name);

  if (match === null || match[1] === undefined || match[1] === "" || SUFFIXED.test(match[1])) {
    return undefined;
  }

  return match[1];
};

const refPointer = (name: string): string => `#/components/schemas/${name}`;

/** Replaces the `$ref` pointer `from` by `to` at every nested location of a JSON document. */
const replaceRefPointers = (value: Schema.Json, from: string, to: string): Schema.Json => {
  if (Array.isArray(value)) {
    return value.map((item) => replaceRefPointers(item, from, to));
  }

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "$ref" && item === from ? to : replaceRefPointers(item, from, to),
    ]),
  );
};

/**
 * One Δ1 pass over the exact frozen premise: `<N>_<k>` collapses onto the plain base `N` only when both
 * exist and their values deep-equal, and `$ref` pointers reaching the suffixed name are rewritten.
 * Chained suffixes (`N_2` onto `N_1`) stay out: Effect's converter names every duplicate from the base
 * directly, and a chain collapse would add a tolerance the frozen Δ list does not own.
 */
export const collapseSuffixPass = (document: Schema.Json): SuffixCollapse => {
  if (!isJsonObject(document)) return { document, collapsed: false };

  const outer: JsonObjectNode = document;
  const components = objectFieldOf(outer, "components");
  const schemas = components === undefined ? undefined : objectFieldOf(components, "schemas");

  if (components === undefined || schemas === undefined) return { document, collapsed: false };

  const rewrites: Array<readonly [from: string, to: string]> = [];
  const dropped = new Set<string>();

  for (const [name, value] of Object.entries(schemas)) {
    const base = suffixBase(name);

    if (base === undefined) continue;

    const baseValue = schemas[base];

    if (
      baseValue === undefined ||
      !isJsonObject(baseValue) ||
      !isJsonObject(value) ||
      JsonPatch.get(baseValue, value).length !== 0
    ) {
      continue;
    }

    rewrites.push([refPointer(name), refPointer(base)]);
    dropped.add(name);
  }

  if (rewrites.length === 0) return { document, collapsed: false };

  const collapsedSchemas: JsonObjectNode = Object.fromEntries(
    Object.entries(schemas).filter(([name]) => !dropped.has(name)),
  );

  const record: JsonObjectNode = {
    ...outer,
    components: { ...components, schemas: collapsedSchemas },
  };

  const rewritten: Schema.Json = rewrites.reduce<Schema.Json>(
    (carry, [from, to]) => replaceRefPointers(carry, from, to),
    record,
  );

  return { document: rewritten, collapsed: true };
};

/* ------------------------------------------------------------------ */
/* Δ3 helper structure and the mechanical comparison                   */
/* ------------------------------------------------------------------ */

/** Splits a reflection's endpoint list into the Δ3 map with real duplicate-key reports. */
const endpointMap = (reflection: Reflection): EndpointSegments => {
  const map = new Map<string, EndpointReflection>();
  const duplicates: Array<string> = [];

  for (const endpoint of reflection.endpoints) {
    const key = endpointKeyOf(endpoint);

    if (map.has(key)) {
      duplicates.push(printKey(key));
      continue;
    }

    map.set(key, endpoint);
  }

  return { map, duplicates };
};

const renderPatch = (patch: JsonPatch.JsonPatch): ReadonlyArray<string> =>
  patch.map((entry) => {
    const value = entry.op === "add" || entry.op === "replace" ? entry.value : "<absent>";

    return `${entry.op} ${entry.path}: ${JSON.stringify(value)}`;
  });

/** Ordered list compare for string sequences rendered from the same mechanical patch. */
const listDiff = (
  name: string,
  left: readonly string[],
  right: readonly string[],
): string | undefined => {
  const patch = JsonPatch.get(left, right);

  return patch.length === 0 ? undefined : `${name}: ${renderPatch(patch).join("; ")}`;
};

/** The status list compared as the set it semantically is; the record's form is unordered. */
const sortedNumbers = (values: ReadonlyArray<number>): ReadonlyArray<number> =>
  values.toSorted((left, right) => left - right);

const numberListDiff = (
  name: string,
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): string | undefined => {
  const patch = JsonPatch.get(sortedNumbers(left), sortedNumbers(right));

  return patch.length === 0 ? undefined : `${name}: ${renderPatch(patch).join("; ")}`;
};

const projectionsDiff = (
  original: Record<string, Schema.Json>,
  generated: Record<string, Schema.Json>,
): string | undefined => {
  const patch = JsonPatch.get(original, generated);

  return patch.length === 0 ? undefined : `projections: ${renderPatch(patch).join("; ")}`;
};

/** One endpoint record's field comparison, after both sides' Δ2 drop was applied. */
const endpointDiff = (
  original: EndpointReflection,
  generated: EndpointReflection,
): ReadonlyArray<string> => {
  const differences: Array<string> = [];

  if (original.method !== generated.method) {
    differences.push(
      `method: ${JSON.stringify(original.method)} vs ${JSON.stringify(generated.method)}`,
    );
  }

  if (original.path !== generated.path) {
    differences.push(`path: ${JSON.stringify(original.path)} vs ${JSON.stringify(generated.path)}`);
  }

  const middlewareDiff = listDiff("middleware", original.middleware, generated.middleware);

  if (middlewareDiff !== undefined) differences.push(middlewareDiff);

  const successDiff = numberListDiff(
    "successStatuses",
    original.successStatuses,
    generated.successStatuses,
  );

  if (successDiff !== undefined) differences.push(successDiff);

  const errorDiff = numberListDiff(
    "errorStatuses",
    original.errorStatuses,
    generated.errorStatuses,
  );

  if (errorDiff !== undefined) differences.push(errorDiff);

  const annotationsDiff = listDiff(
    "annotationKeys",
    original.annotationKeys,
    generated.annotationKeys,
  );

  if (annotationsDiff !== undefined) differences.push(annotationsDiff);

  const registeredDiff = projectionsDiff(original.projections, generated.projections);

  if (registeredDiff !== undefined) differences.push(registeredDiff);

  return differences;
};

/** The whole-document comparison after the Δ1 collapse was already applied to both sides. */
const documentDiff = (original: Schema.Json, generated: Schema.Json): ReadonlyArray<string> =>
  renderPatch(JsonPatch.get(original, generated));

/**
 * The mechanical comparison (spec 0019 §2.2): endpoint sets mapped by `(group, identifier)` (Δ3, always
 * applied; listed only when the raw orders differed), the whole OpenAPI document compared after Δ1's
 * collapse and `$ref` rewrite, and per-endpoint records compared after Δ2's actual-default-identifier
 * drop. Any other difference fails with the differing path.
 */
export const wireCompare = (original: Reflection, generated: Reflection): CompareOutcome => {
  const originalMap = endpointMap(original);
  const generatedMap = endpointMap(generated);

  if (originalMap.duplicates.length > 0 || generatedMap.duplicates.length > 0) {
    return {
      _tag: "Mismatch",
      differences: [
        ...(originalMap.duplicates.length > 0
          ? [`endpoints: duplicate (group, identifier) keys: ${originalMap.duplicates.join(", ")}`]
          : []),
        ...(generatedMap.duplicates.length > 0
          ? [`endpoints: duplicate (group, identifier) keys: ${generatedMap.duplicates.join(", ")}`]
          : []),
      ],
    };
  }

  const applied: Array<DeltaClass> = [];

  const missing: Array<string> = [];
  const extra: Array<string> = [];

  for (const key of originalMap.map.keys()) {
    if (!generatedMap.map.has(key)) missing.push(printKey(key));
  }

  for (const key of generatedMap.map.keys()) {
    if (!originalMap.map.has(key)) extra.push(printKey(key));
  }

  if (missing.length > 0 || extra.length > 0) {
    return {
      _tag: "Mismatch",
      differences: [
        `endpoints: missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`,
      ],
    };
  }

  const originalOrdered = Array.from(originalMap.map.values());

  const generatedOrdered = Array.from(generatedMap.map.values());

  // Δ3 fired when, with equal key sets, the recorded orders still differed.
  const ordersDiffer =
    originalOrdered.length !== generatedOrdered.length ||
    originalOrdered.some((endpoint, index) => {
      const generatedEndpoint = generatedOrdered[index];

      return (
        generatedEndpoint === undefined || generatedEndpoint.identifier !== endpoint.identifier
      );
    });

  if (ordersDiffer) applied.push("endpoint-order");

  const collapsedOriginal = collapseSuffixPass(original.openapi);

  const collapsedGenerated = collapseSuffixPass(generated.openapi);

  if (collapsedOriginal.collapsed || collapsedGenerated.collapsed) applied.push("ref-suffix");

  const droppedOriginal = dropDefaultIdentifier(originalOrdered);

  const droppedGenerated = dropDefaultIdentifier(generatedOrdered);

  const dropped = (
    before: ReadonlyArray<EndpointReflection>,
    after: ReadonlyArray<EndpointReflection>,
  ): boolean =>
    before.some((endpoint, index) => {
      const rebuilt = after[index];

      return (
        rebuilt === undefined || rebuilt.annotationKeys.length !== endpoint.annotationKeys.length
      );
    });

  if (dropped(originalOrdered, droppedOriginal) || dropped(generatedOrdered, droppedGenerated)) {
    applied.push("explicit-default-identifier");
  }

  const openApiDifferences = documentDiff(collapsedOriginal.document, collapsedGenerated.document);

  const endpointDifferences: Array<string> = [];

  for (const endpoint of droppedOriginal) {
    const key = endpointKeyOf(endpoint);
    const generatedEndpoint = generatedMap.map.get(key);

    if (generatedEndpoint === undefined) continue;

    const generatedDropped = droppedGenerated.find((candidate) => endpointKeyOf(candidate) === key);

    if (generatedDropped === undefined) continue;

    const differences = endpointDiff(endpoint, generatedDropped);

    if (differences.length > 0) {
      endpointDifferences.push(
        ...differences.map((difference) => `endpoints.${printKey(key)}: ${difference}`),
      );
    }
  }

  if (openApiDifferences.length > 0) {
    return {
      _tag: "Mismatch",
      differences: [
        ...openApiDifferences.map((diff) => `openapi: ${diff}`),
        ...endpointDifferences,
      ],
    };
  }

  return endpointDifferences.length === 0
    ? { _tag: "Pass", applied }
    : { _tag: "Mismatch", differences: endpointDifferences };
};
