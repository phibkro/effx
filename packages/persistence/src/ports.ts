import { Option, Order, Result, Schema } from "effect";
import { CoreDiagnostics, type Diagnostic } from "@effx/compiler";
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

/** Total UTF-16 escaping gives deterministic filenames without admitting path traversal. */
export const portFile = (name: string): string =>
  name
    .replace(/[^a-z0-9_-]/gi, (character) => `_${character.charCodeAt(0).toString(16)}_`)
    .toLowerCase();

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
      diagnostics.push(CoreDiagnostics.EFFX3403.emit({ _tag: "Ownership", subject: node.id }));
      continue;
    }

    const port = data.success.port;
    const name = owner.name.startsWith(`${port}.`) ? owner.name.slice(port.length + 1) : "";

    if (name.length === 0) {
      diagnostics.push(
        CoreDiagnostics.EFFX3403.emit({ _tag: "MethodName", subject: owner.name, port }),
      );
      continue;
    }

    if (owner.binding !== "external" || owner.handler !== undefined) {
      diagnostics.push(CoreDiagnostics.EFFX3401.emit({ subject: owner.name }));
    }

    if (
      ir.nodes.some(
        (candidate) => candidate._tag === "Exposure" && candidate.operation === owner.id,
      )
    ) {
      diagnostics.push(CoreDiagnostics.EFFX3402.emit({ subject: owner.name }));
    }

    const methods = ports.get(port) ?? [];

    if (methods.some((method) => method.name === name)) {
      diagnostics.push(
        CoreDiagnostics.EFFX3403.emit({
          _tag: "DuplicateMethod",
          subject: owner.name,
          method: name,
          port,
        }),
      );
    }

    methods.push({ name, operation: owner });
    ports.set(port, methods);
  }

  const filenames = new Map<string, string>();

  const sorted = Array.from(ports, ([name, methods]) => ({
    name,
    methods: methods.toSorted((a, b) => Order.String(a.name, b.name)),
  })).toSorted((a, b) => Order.String(a.name, b.name));

  for (const port of sorted) {
    const file = portFile(port.name);
    const other = filenames.get(file);

    if (other !== undefined && other !== port.name) {
      diagnostics.push(
        CoreDiagnostics.EFFX3403.emit({ _tag: "Filename", port: port.name, otherPort: other }),
      );
    }

    filenames.set(file, port.name);

    if (port.methods.every((method) => method.operation.kind === "Query")) {
      diagnostics.push(CoreDiagnostics.EFFX3404.emit({ port: port.name }));
    }
  }

  return { ports: sorted, diagnostics };
};
