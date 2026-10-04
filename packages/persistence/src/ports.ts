import { Option, Result, Schema } from "effect";
import { error, warning, type Diagnostic } from "@effx/compiler";
import { IRGraph, type ApplicationIR, type GraphIndex, type OperationNode } from "@effx/ir";

export const PortData = Schema.Struct({ port: Schema.String });

export interface PortMethod {
  readonly name: string;
  readonly operation: OperationNode;
}

export interface PersistencePort {
  readonly name: string;
  readonly methods: ReadonlyArray<PortMethod>;
}

/** Deterministic filenames retain punctuation without admitting path traversal. */
export const portFile = (name: string): string => encodeURIComponent(name).toLowerCase();

export interface PortsResult {
  readonly ports: ReadonlyArray<PersistencePort>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** Reads only extension IR; adapter modules and runtime implementations are irrelevant. */
export const portsOf = (ir: ApplicationIR, index: GraphIndex): PortsResult => {
  const diagnostics: Array<Diagnostic> = [];
  const ports = new Map<string, Array<PortMethod>>();

  for (const node of ir.nodes) {
    if (node._tag !== "Extension" || node.extension !== "persistence" || node.tag !== "Port")
      continue;
    const data = Schema.decodeUnknownResult(PortData)(node.data);
    const owners = IRGraph.outgoing(index, node.id, "ExtensionOf");
    const edge = owners[0];

    const owner =
      owners.length === 1 && edge !== undefined
        ? Option.getOrUndefined(IRGraph.nodeOf(index, edge.to))
        : undefined;

    if (Result.isFailure(data) || owner?._tag !== "Operation") {
      diagnostics.push(
        error(
          "EFFX3403",
          `${node.id}: persistence.Port requires one operation owner and { port: string }`,
        ),
      );
      continue;
    }

    const port = data.success.port;
    const name = owner.name.startsWith(`${port}.`) ? owner.name.slice(port.length + 1) : "";

    if (port.length === 0 || name.length === 0) {
      diagnostics.push(
        error("EFFX3403", `${owner.name}: port methods must be named ${port}.<method>`),
      );
      continue;
    }

    if (owner.binding !== "external" || owner.handler !== undefined) {
      diagnostics.push(
        error(
          "EFFX3401",
          `${owner.name}: persistence port methods must be declaration-only, without a local handler`,
        ),
      );
    }

    if (
      ir.nodes.some(
        (candidate) => candidate._tag === "Exposure" && candidate.operation === owner.id,
      )
    ) {
      diagnostics.push(
        error(
          "EFFX3402",
          `${owner.name}: persistence port methods cannot have HTTP, RPC or CLI exposures`,
        ),
      );
    }

    const methods = ports.get(port) ?? [];

    if (methods.some((method) => method.name === name)) {
      diagnostics.push(
        error("EFFX3403", `${owner.name}: duplicate method ${name} in port ${port}`),
      );
    }

    methods.push({ name, operation: owner });
    ports.set(port, methods);
  }

  const filenames = new Map<string, string>();

  const sorted = Array.from(ports, ([name, methods]) => ({
    name,
    methods: methods.toSorted((a, b) => a.name.localeCompare(b.name)),
  })).toSorted((a, b) => a.name.localeCompare(b.name));

  for (const port of sorted) {
    const file = portFile(port.name);
    const other = filenames.get(file);

    if (other !== undefined && other !== port.name) {
      diagnostics.push(
        error("EFFX3403", `${port.name}: generated filename collides with port ${other}`),
      );
    }

    filenames.set(file, port.name);

    if (port.methods.every((method) => method.operation.kind === "Query")) {
      diagnostics.push(
        warning(
          "EFFX3404",
          `${port.name}: only Queries are declared; rollback and atomicity properties are vacuous`,
        ),
      );
    }
  }

  return { ports: sorted, diagnostics };
};
