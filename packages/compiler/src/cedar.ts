import { Option, Result, Schema } from "effect";
import { type ApplicationIR, type GraphIndex, IRGraph, StableId, type SymbolRef } from "@effx/ir";
import type { Diagnostic } from "./Diagnostic.ts";
import { AccessContractData } from "./extensions/access-contract.ts";

/*
 * Spec 0017: a pure projection of the IR's authorization facts onto a Cedar schema and policy
 * text. It reads only the IR (`Capability`, `Focus`, `AuthorizedBy`, `Extension{access-contract}`),
 * never evaluates a request, resolves a credential or links a template. The Cedar validator is a
 * separate seam (`packages/cli/src/cedar-validate.ts`); this module never imports it.
 */

export const DEFAULT_CEDAR_NAMESPACE = "Effx";

/** Generic principal type for an operation that declares a capability but no `AccessContract`. */
const GENERIC_PRINCIPAL = "Principal";

export interface CedarFiles {
  readonly schema: string;
  readonly policies: string;
}

export interface CedarProjection {
  /** `None` when an error diagnostic or an empty projection means no file may be written. */
  readonly files: Option.Option<CedarFiles>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export interface CedarOptions {
  readonly namespace?: string;
}

/**
 * What the projection does with each `AccessContractData` field. The `satisfies` clause makes a new
 * contract field a typecheck error until it is classified, and `annotators` is typed from it, so an
 * annotated field cannot lack an emitter.
 */
export type FieldDisposition = "mapped" | "annotated" | "both" | "omitted";

export const AccessContractProjection = {
  annotator: "omitted",
  exposure: "annotated",
  acceptedCredentials: "annotated",
  principalKinds: "mapped",
  capabilities: "mapped",
  requirements: "mapped",
  canonicalScopeResolver: "both",
  concealment: "annotated",
  decisionTime: "annotated",
  snapshotDecisionForCommand: "annotated",
} as const satisfies { readonly [K in keyof AccessContractData]-?: FieldDisposition };

type FieldsWith<D extends FieldDisposition> = {
  readonly [
    K in keyof typeof AccessContractProjection
  ]: (typeof AccessContractProjection)[K] extends D ? K : never;
}[keyof typeof AccessContractProjection];

const symbolText = (symbol: SymbolRef): string =>
  symbol.member === undefined
    ? `${symbol.module}#${symbol.export}`
    : `${symbol.module}#${symbol.export}.${symbol.member}`;

type Annotators = {
  readonly [K in FieldsWith<"annotated" | "both">]: (
    data: AccessContractData,
  ) => string | undefined;
};

/** Annotation value per annotated field; `undefined` omits the annotation. Insertion order is output order. */
const annotators: Annotators = {
  exposure: (data) => data.exposure,
  acceptedCredentials: (data) => data.acceptedCredentials.join(","),
  canonicalScopeResolver: (data) => symbolText(data.canonicalScopeResolver),
  concealment: (data) =>
    data.concealment._tag === "Reveal" ? "Reveal" : `NotFound:${data.concealment.stages.join(",")}`,
  decisionTime: (data) => data.decisionTime,
  snapshotDecisionForCommand: (data) =>
    data.snapshotDecisionForCommand === true ? "true" : undefined,
};

// Reserved words and the `Action` entity type are not valid entity-type or namespace names; probed
// against the Cedar 4.13.0 schema parser (spec 0017 §3).
const RESERVED = /^(?:true|false|if|then|else|in|is|like|has)$/;

const isCedarIdentifier = (name: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.test(name) && !name.startsWith("__cedar");

const isCedarNamespace = (name: string): boolean => name.split("::").every(isCedarIdentifier);

const isEntityTypeName = (name: string): boolean => isCedarIdentifier(name) && name !== "Action";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortedUnique = (values: Iterable<string>): ReadonlyArray<string> =>
  [...new Set(values)].toSorted(byCodeUnit);

const cedarString = (text: string): string =>
  `"${Array.from(text, (char) => {
    const code = char.codePointAt(0)!;

    if (char === "\\") return "\\\\";

    if (char === '"') return '\\"';

    if (char === "\n") return "\\n";

    if (char === "\r") return "\\r";

    if (char === "\t") return "\\t";

    if (code < 0x20 || code === 0x7f) return `\\u{${code.toString(16)}}`;

    return char;
  }).join("")}"`;

const info = (code: string, message: string): Diagnostic => ({ code, severity: "info", message });

const failure = (code: string, message: string): Diagnostic => ({
  code,
  severity: "error",
  message,
});

const caution = (code: string, message: string): Diagnostic => ({
  code,
  severity: "warning",
  message,
});

type CapabilityExpression = AccessContractData["capabilities"];

interface OperationProjection {
  readonly name: string;
  readonly kind: string;
  readonly expression: CapabilityExpression;
  readonly principals: ReadonlyArray<string>;
  /** (entity type name, the distinct source that introduced it), for collision checks. */
  readonly resources: ReadonlyArray<readonly [string, string]>;
  readonly requirements: ReadonlyArray<string>;
  readonly annotations: ReadonlyArray<readonly [string, string]>;
}

const memberCapabilities = (expression: CapabilityExpression): ReadonlyArray<string> => {
  switch (expression._tag) {
    case "None":
      return [];
    case "One":
      return [expression.capability];
    case "Any":
    case "All":
      return expression.capabilities;
  }
};

/** Cedar group membership is disjunctive: only `One` and `Any` can name group parents (spec 0017 §2.1). */
const parentCapabilities = (expression: CapabilityExpression): ReadonlyArray<string> =>
  expression._tag === "All" ? [] : memberCapabilities(expression);

export const cedarOf = (
  ir: ApplicationIR,
  index: GraphIndex,
  semanticHash: string,
  options: CedarOptions = {},
): CedarProjection => {
  const namespace = options.namespace ?? DEFAULT_CEDAR_NAMESPACE;

  if (!isCedarNamespace(namespace)) {
    return {
      files: Option.none(),
      diagnostics: [
        failure(
          "EFFX4101",
          `--namespace ${JSON.stringify(namespace)} is not a Cedar namespace (unreserved identifiers joined by "::")`,
        ),
      ],
    };
  }

  const diagnostics: Array<Diagnostic> = [];
  const operations: Array<OperationProjection> = [];

  const capabilityFocus = new Map<string, string | undefined>();

  for (const node of ir.nodes) {
    if (node._tag !== "Capability") continue;

    const focus =
      node.focus === undefined
        ? undefined
        : Option.getOrUndefined(IRGraph.nodeOf(index, node.focus));

    capabilityFocus.set(node.name, focus?._tag === "Focus" ? focus.path.join(".") : undefined);
  }

  for (const node of ir.nodes.toSorted((a, b) => byCodeUnit(a.id, b.id))) {
    if (node._tag !== "Operation") continue;

    const contract = IRGraph.incoming(index, node.id, "ExtensionOf")
      .filter((edge) => edge.qualifier === "AccessContract")
      .flatMap((edge) => {
        const found = Option.getOrUndefined(IRGraph.nodeOf(index, edge.from));

        return found?._tag === "Extension" &&
          found.extension === "access-contract" &&
          found.tag === "AccessContract"
          ? [found]
          : [];
      })
      .flatMap((found) => {
        const decoded = Schema.decodeUnknownResult(AccessContractData)(found.data);

        return Result.isSuccess(decoded) ? [decoded.success] : [];
      })[0];

    const linked = IRGraph.outgoing(index, node.id, "AuthorizedBy").flatMap((edge) => {
      const found = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return found?._tag === "Capability" ? [found] : [];
    });

    if (contract === undefined && linked.length === 0) continue;

    const resources: Array<readonly [string, string]> = linked.map((capability) => {
      const model = StableId.nameOf(capability.resource);

      return [model, `model:${model}`] as const;
    });

    let expression: CapabilityExpression;
    let principals: ReadonlyArray<string>;
    let requirements: ReadonlyArray<string> = [];
    let annotations: ReadonlyArray<readonly [string, string]> = [];

    if (contract !== undefined) {
      expression = contract.capabilities;
      principals = sortedUnique(contract.principalKinds);
      resources.push([
        contract.canonicalScopeResolver.export,
        `resolver:${symbolText(contract.canonicalScopeResolver)}`,
      ]);
      requirements = sortedUnique(contract.requirements.map((requirement) => requirement.id));

      for (const requirement of contract.requirements) {
        if (requirement.parameters !== undefined) {
          diagnostics.push(
            caution(
              "EFFX4103",
              `${node.name}: requirement ${JSON.stringify(requirement.id)} has parameters; projected id-only, the Cedar model does not enforce them`,
            ),
          );
        }
      }

      annotations = Object.entries(annotators).flatMap(([field, annotate]) => {
        const value = annotate(contract);

        return value === undefined ? [] : [[field, value] as const];
      });
    } else {
      const names = sortedUnique(linked.map((capability) => capability.name));

      expression =
        names.length === 1
          ? { _tag: "One", capability: names[0]! }
          : { _tag: "All", capabilities: names };
      principals = [GENERIC_PRINCIPAL];

      diagnostics.push(
        info(
          "EFFX4105",
          `${node.name}: capability without an AccessContract; principal type is the generic ${GENERIC_PRINCIPAL}`,
        ),
      );
    }

    if (expression._tag === "All") {
      diagnostics.push(
        caution(
          "EFFX4104",
          contract === undefined
            ? `${node.name}: ${expression.capabilities.length} capabilities are all required, which one Cedar request cannot express; the operation action has no capability group parent`
            : `${node.name}: capabilities All cannot be one Cedar request; the operation action has no capability group parent`,
        ),
      );
    }

    operations.push({
      name: node.name,
      kind: node.kind,
      expression,
      principals,
      resources,
      requirements,
      annotations,
    });
  }

  if (operations.length === 0) {
    return {
      files: Option.none(),
      diagnostics: [
        ...diagnostics,
        info("EFFX4107", "nothing to project: no operation has a capability or an AccessContract"),
      ],
    };
  }

  const operationNames = operations.toSorted((a, b) => byCodeUnit(a.name, b.name));

  // Capability groups: every Capability node, plus every name an AccessContract expression uses.
  const capabilityNames = sortedUnique([
    ...capabilityFocus.keys(),
    ...operationNames.flatMap((operation) => memberCapabilities(operation.expression)),
  ]);

  const grantable = new Set(operationNames.flatMap((o) => parentCapabilities(o.expression)));

  // Entity types: each name must come from one source and be a valid identifier.
  const entitySources = new Map<string, Set<string>>();

  const addEntity = (name: string, source: string): void => {
    const sources = entitySources.get(name) ?? new Set<string>();

    sources.add(source);
    entitySources.set(name, sources);
  };

  for (const operation of operationNames) {
    for (const principal of operation.principals) addEntity(principal, `principal:${principal}`);

    for (const [resource, source] of operation.resources) addEntity(resource, source);
  }

  for (const [name, sources] of entitySources) {
    if (!isEntityTypeName(name)) {
      diagnostics.push(
        failure(
          "EFFX4101",
          `${JSON.stringify(name)} (${[...sources].toSorted(byCodeUnit).join(", ")}) is not a valid Cedar entity type name`,
        ),
      );
    } else if (sources.size > 1) {
      diagnostics.push(
        failure(
          "EFFX4101",
          `entity type ${name} would name distinct sources: ${[...sources].toSorted(byCodeUnit).join(", ")}`,
        ),
      );
    }
  }

  // Policy ids must be unique inside the emitted set.
  const grantIds = [...grantable].map((capability) => `effx:grant:${capability}`);

  const requireIds = operationNames.flatMap((operation) =>
    operation.requirements.map((id) => `effx:require:${operation.name}:${id}`),
  );

  const seenIds = new Set<string>();

  for (const id of [...grantIds, ...requireIds]) {
    if (seenIds.has(id)) {
      diagnostics.push(failure("EFFX4101", `policy id ${JSON.stringify(id)} is not unique`));
    }

    seenIds.add(id);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { files: Option.none(), diagnostics };
  }

  const header = `// effx cedar projection of semanticHash ${semanticHash}`;
  const actionRef = (id: string): string => `${namespace}::Action::${cedarString(id)}`;

  const entityLines = [...entitySources.keys()]
    .toSorted(byCodeUnit)
    .map((name) => `  entity ${name};`);

  const capabilityBlocks = capabilityNames.map((name) => {
    const focus = capabilityFocus.get(name);

    return [
      `  @capability(${cedarString(name)})${focus === undefined ? "" : ` @focus(${cedarString(focus)})`}`,
      `  action ${cedarString(`capability/${name}`)};`,
    ];
  });

  const operationBlocks = operationNames.map((operation) => {
    const parents = sortedUnique(parentCapabilities(operation.expression));

    const annotations = [
      ["operation", operation.name],
      ["kind", operation.kind],
      ...operation.annotations,
    ];

    const context =
      operation.requirements.length === 0
        ? "{}"
        : `{ ${operation.requirements.map((id) => `${cedarString(id)}: Bool`).join(", ")} }`;

    const resources = sortedUnique(operation.resources.map(([name]) => name));

    return [
      `  ${annotations.map(([key, value]) => `@${key}(${cedarString(value)})`).join(" ")}`,
      `  action ${cedarString(`operation/${operation.name}`)}${
        parents.length === 0
          ? ""
          : ` in [${parents.map((parent) => cedarString(`capability/${parent}`)).join(", ")}]`
      }`,
      `    appliesTo { principal: [${operation.principals.join(", ")}], resource: [${resources.join(", ")}], context: ${context} };`,
    ];
  });

  // Entity types, capability groups, then one block per operation action; groups are blank-separated.
  const schemaLines: Array<string> = [header, "", `namespace ${namespace} {`];

  const groups = [entityLines, capabilityBlocks.flat(), ...operationBlocks].filter(
    (group) => group.length > 0,
  );

  groups.forEach((group, position) => {
    if (position > 0) schemaLines.push("");

    schemaLines.push(...group);
  });

  schemaLines.push("}");

  const policyBlocks: Array<string> = [];

  for (const capability of [...grantable].toSorted(byCodeUnit)) {
    policyBlocks.push(
      [
        `@id(${cedarString(`effx:grant:${capability}`)})`,
        `permit (principal == ?principal, action in ${actionRef(`capability/${capability}`)}, resource == ?resource);`,
      ].join("\n"),
    );
  }

  for (const operation of operationNames) {
    for (const id of operation.requirements) {
      policyBlocks.push(
        [
          `@id(${cedarString(`effx:require:${operation.name}:${id}`)})`,
          `forbid (principal, action == ${actionRef(`operation/${operation.name}`)}, resource)`,
          `unless { context[${cedarString(id)}] };`,
        ].join("\n"),
      );
    }
  }

  return {
    files: Option.some({
      schema: `${schemaLines.join("\n")}\n`,
      policies: `${[header, ...policyBlocks].join("\n\n")}\n`,
    }),
    diagnostics,
  };
};
