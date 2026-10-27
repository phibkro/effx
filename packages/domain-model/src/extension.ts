import { Effect, Result, Schema } from "effect";
import { CompilerFault, Contribution, DomainDiagnostics, type Extension } from "@effx/compiler";
import { StableId, type ApplicationIR, type ExtensionNode } from "@effx/ir";
import { DescriptionFields, DomainDescription } from "./DomainDescription.ts";
import { generateAlloy, type AlloyOptions } from "./Alloy.ts";

const decodeDescription = Schema.decodeUnknownResult(DomainDescription);

const DomainHeader = Schema.Struct({
  name: DescriptionFields.fields.name,
  principals: DescriptionFields.fields.principals,
  orders: DescriptionFields.fields.orders,
  clock: DescriptionFields.fields.clock,
  adminList: DescriptionFields.fields.adminList,
  memberships: DescriptionFields.fields.memberships,
});

const decodeHeader = Schema.decodeUnknownResult(DomainHeader);

const domainPrefix = (name: string): string =>
  "domain-model/" +
  Array.from({ length: name.length }, (_, index) =>
    name.charCodeAt(index).toString(16).padStart(4, "0"),
  ).join("");

type DomainHeaderDraft = {
  -readonly [K in keyof typeof DomainHeader.Type]: (typeof DomainHeader.Type)[K];
};

/** Each semantic declaration is one generic Extension node, with no TypeScript object in the IR. */
export const domainNodes = (domain: DomainDescription): ReadonlyArray<ExtensionNode> => {
  const prefix = domainPrefix(domain.name);

  const header: DomainHeaderDraft = {
    name: domain.name,
    principals: domain.principals,
    orders: domain.orders,
  };

  if (domain.adminList !== undefined) header.adminList = domain.adminList;

  if (domain.clock !== undefined) header.clock = domain.clock;

  if (domain.memberships !== undefined) header.memberships = domain.memberships;

  const node = (kind: string, index: number, data: Schema.Json): ExtensionNode => ({
    _tag: "Extension",
    id: StableId.make("ext", `${prefix}/${kind}/${String(index).padStart(10, "0")}`),
    extension: "domain-model",
    tag: kind,
    data,
  });

  return [
    { ...node("Domain", 0, header), root: true },
    ...domain.commands.map((value, index) => node("Command", index, value)),
    ...domain.reads.map((value, index) => node("Read", index, value)),
    ...domain.subjectSets.map((value, index) => node("SubjectSet", index, value)),
    ...domain.grants.map((value, index) => node("Grant", index, value)),
    ...domain.machines.map((value, index) => node("Machine", index, value)),
  ];
};

/** Decode the domain back from its normalized IR nodes; IR remains the model's source. */
export const domainFromIR = (ir: ApplicationIR, name: string) => {
  const prefix = `ext:${domainPrefix(name)}/`;

  const nodes = ir.nodes.filter(
    (node): node is ExtensionNode =>
      node._tag === "Extension" && node.extension === "domain-model" && node.id.startsWith(prefix),
  );

  const headerNode = nodes.find((node) => node.tag === "Domain");
  const header = decodeHeader(headerNode?.data);

  if (Result.isFailure(header)) return Result.fail(header.failure);

  const data = (tag: string) =>
    nodes
      .filter((node) => node.tag === tag)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((node) => node.data);

  return decodeDescription({
    ...header.success,
    commands: data("Command"),
    reads: data("Read"),
    subjectSets: data("SubjectSet"),
    grants: data("Grant"),
    machines: data("Machine"),
  });
};

/** File basename is reversible and cannot create a directory traversal. */
export const alloyBasename = (name: string): string => {
  let encoded = "";

  for (let index = 0; index < name.length; index++) {
    const character = name[index]!;
    encoded += /^[A-Za-z0-9_-]$/.test(character)
      ? character
      : `%${name.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }

  return `${encoded}.als`;
};

export const alloyStaticBasename = (name: string): string =>
  `${alloyBasename(name).slice(0, -4)}.static.als`;

/**
 * Add a decoded declaration to the normal IR pipeline. Constructing an
 * extension does not execute compilers, write files or start a process.
 */
export const domainModel = (input: Schema.Json, options: AlloyOptions = {}): Extension => {
  const scope = options.scope ?? 1;
  const steps = options.steps ?? 4;

  const boundsValid =
    Number.isSafeInteger(scope) && scope > 0 && Number.isSafeInteger(steps) && steps > 0;

  return {
    name: "domain-model",
    interpreters: {},
    analyses: [],
    contribute: () => {
      const result = decodeDescription(input);

      if (Result.isFailure(result)) {
        return Contribution.diagnostics(
          DomainDiagnostics.EFFX4301.emit({
            domain: "<domain>",
            detail: result.failure.message,
            scope: boundsValid ? scope : 1,
            steps: boundsValid ? steps : 1,
          }),
        );
      }

      const domain = result.success;

      if (!boundsValid) {
        return Contribution.diagnostics(
          DomainDiagnostics.EFFX4301.emit({
            domain: domain.name,
            detail: "scope and steps must be positive safe integers",
            scope: 1,
            steps: 1,
          }),
        );
      }

      const model = generateAlloy(domain, options);
      const nodes = domainNodes(domain);
      const root = nodes[0]!;

      const edges = nodes.slice(1).map((child) => ({
        kind: "ExtensionOf" as const,
        from: child.id,
        to: root.id,
        qualifier: child.tag,
      }));

      return Contribution.make(nodes, edges, [
        ...model.unknownGuards.map((id) =>
          DomainDiagnostics.EFFX4302.emit({ domain: domain.name, detail: id, scope, steps }),
        ),
        ...model.symbols.nondeterministic.map((detail) =>
          DomainDiagnostics.EFFX4311.emit({ domain: domain.name, detail, scope, steps }),
        ),
        ...domain.commands.flatMap((command) =>
          (command.writes ?? []).map((write) =>
            DomainDiagnostics.EFFX4313.emit({
              domain: domain.name,
              detail: `${command.name}: effect on ${write.machine}.${write.path.join(".")} not modelled precisely`,
              scope,
              steps,
            }),
          ),
        ),
      ]);
    },
    generators: [
      (ir, _index, context) => {
        if (context?.models?.alloy !== true) return Effect.succeed([]);
        const original = decodeDescription(input);

        if (Result.isFailure(original) || !boundsValid) {
          return Effect.fail(
            new CompilerFault({
              stage: "generate",
              message: "invalid accepted domain description",
            }),
          );
        }

        const domain = domainFromIR(ir, original.success.name);

        if (Result.isFailure(domain)) {
          return Effect.fail(
            new CompilerFault({
              stage: "generate",
              message: "invalid domain-model IR",
              cause: domain.failure,
            }),
          );
        }

        const model = generateAlloy(domain.success, options);

        return Effect.succeed([
          {
            path: `alloy/${alloyBasename(domain.success.name)}`,
            contents: model.source,
            destination: "model" as const,
          },
          {
            path: `alloy/${alloyStaticBasename(domain.success.name)}`,
            contents: model.staticSource,
            destination: "model" as const,
          },
        ]);
      },
    ],
  };
};
