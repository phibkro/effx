import { Option, Predicate, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import type { ApplicationIR, SymbolRef } from "@effx/ir";
import { decodeSchemaOf } from "./annotation.ts";
import type { Collected, GroupBinding } from "./Collected.ts";
import type { Diagnostic } from "./Diagnostic.ts";
import { HttpDiagnostics } from "./diagnostics/http.ts";
import { httpGroups, toHttpItems } from "./generate/http-contracts.ts";
import type { Exposed } from "./generate/emit.ts";

export interface HttpGroupBinding {
  readonly binding: GroupBinding;
  readonly root: string;
  readonly group: string;
}

const GroupOptions = decodeSchemaOf(Builtins.HttpGroup);

export const sameSymbol = (left: SymbolRef, right: SymbolRef): boolean =>
  left.module === right.module && left.export === right.export && left.member === right.member;

/** Resolve source symbol identity to emitted root/group identity without changing the IR. */
export const resolveBindings = (collected: Collected, ir: ApplicationIR) => {
  const diagnostics: Array<Diagnostic> = [];
  const bindings: Array<HttpGroupBinding> = [];

  const operations = new Map(
    ir.nodes.flatMap((node) => (node._tag === "Operation" ? [[node.id, node] as const] : [])),
  );

  const exposures: Array<Exposed> = [];

  for (const node of ir.nodes) {
    if (node._tag !== "Exposure") continue;
    const operation = operations.get(node.operation);

    if (operation !== undefined)
      exposures.push({ exposure: node, transport: node.transport, operation });
  }

  const groups = httpGroups(toHttpItems(ir, exposures), ir);
  const seen: Array<SymbolRef> = [];

  for (const binding of collected.bindings ?? []) {
    const subject = `${binding.group.export} binding`;

    if (seen.some((ref) => sameSymbol(ref, binding.group))) {
      diagnostics.push(HttpDiagnostics.EFFX2422.emit({ subject }));
      continue;
    }

    seen.push(binding.group);

    const declarations = collected.declarations.filter(
      (declaration) =>
        declaration.module === binding.group.module &&
        declaration.export === binding.group.export &&
        declaration.member === binding.group.member,
    );

    const annotations = declarations.flatMap((declaration) =>
      declaration.annotations.filter((annotation) => annotation.name === "Http.Group"),
    );

    const decoded =
      annotations.length === 1
        ? Schema.decodeOption(GroupOptions)(annotations[0]!.args)
        : Option.none();

    if (Option.isNone(decoded)) {
      diagnostics.push(HttpDiagnostics.EFFX2420.emit({ subject }));
      continue;
    }

    if ((binding.guards === undefined) === (binding.guardFor === undefined)) {
      diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }));
      continue;
    }

    const [options] = decoded.value;
    const root = Predicate.isString(options.root) ? options.root : options.root.identifier;
    const group = groups.find((group) => group.root === root && group.group === options.group);

    if (
      group === undefined ||
      group.items.length === 0 ||
      group.items.some((item) => item.operation.handler !== undefined)
    ) {
      diagnostics.push(HttpDiagnostics.EFFX2424.emit({ subject }));
      continue;
    }

    if (bindings.some((entry) => entry.root === root && entry.group === options.group)) {
      diagnostics.push(HttpDiagnostics.EFFX2422.emit({ subject }));
      continue;
    }

    bindings.push({ binding, root, group: options.group });
  }

  return { bindings, diagnostics };
};
