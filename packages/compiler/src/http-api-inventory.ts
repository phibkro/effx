import type { ApplicationIR, OperationNode, SymbolRef } from "@effx/ir";
import { type Diagnostic, error } from "./Diagnostic.ts";
import type { GenerationContext } from "./Extension.ts";
import type { Exposed } from "./generate/emit.ts";
import { endpointKey, httpGroups, toHttpItems } from "./generate/http-contracts.ts";
import type { HttpApiGroupInventory } from "./Collected.ts";

/** Exactly one canonical root/group inventory is required; absence is never completeness. */
export const findHttpApiGroupInventory = (
  root: SymbolRef,
  group: string,
  inventories: ReadonlyArray<HttpApiGroupInventory> | undefined,
): HttpApiGroupInventory | undefined => {
  const matches =
    inventories?.filter(
      (entry) =>
        entry.root.module === root.module &&
        entry.root.export === root.export &&
        entry.root.member === root.member &&
        entry.group === group,
    ) ?? [];

  return matches.length === 1 ? matches[0] : undefined;
};

/** Validates concrete roots without adding inventory to semantic IR or evaluating source modules. */
export const httpApiInventoryDiagnostics = (
  ir: ApplicationIR,
  context: GenerationContext,
): ReadonlyArray<Diagnostic> => {
  const operations = new Map<string, OperationNode>(
    ir.nodes.flatMap((node) => (node._tag === "Operation" ? [[node.id, node] as const] : [])),
  );

  const exposures: Array<Exposed> = [];

  for (const node of ir.nodes) {
    if (node._tag !== "Exposure") continue;
    const operation = operations.get(node.operation);

    if (operation !== undefined)
      exposures.push({ exposure: node, transport: node.transport, operation });
  }

  const diagnostics: Array<Diagnostic> = [];

  for (const group of httpGroups(toHttpItems(ir, exposures), ir)) {
    const root = group.metadata?.rootSymbol;

    if (root === undefined) continue;
    const inventory = findHttpApiGroupInventory(root, group.group, context.httpApiGroups);

    if (inventory === undefined) {
      diagnostics.push(
        error(
          "EFFX2415",
          `HTTP group ${group.root}/${group.group}: concrete root endpoint inventory is missing or ambiguous`,
        ),
      );
      continue;
    }

    const keys = new Set(inventory.endpoints);

    for (const item of group.items) {
      const key = endpointKey(item);

      if (!keys.has(key))
        diagnostics.push(
          error(
            "EFFX2415",
            `${item.operation.name}: concrete root ${group.root}/${group.group} has no declared endpoint ${key}`,
          ),
        );
    }
  }

  return diagnostics;
};
