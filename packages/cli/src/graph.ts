import { Option } from "effect";
import { type ApplicationIR, type GraphIndex, IRGraph, type StableId } from "@effx/ir";
import { resolveName } from "./inspect.ts";

/*
 * Pure mermaid `flowchart LR` rendering of a normalized IR (spec 0003 §"graph format").
 */

/** Mermaid node ids are identifiers; every other character of the StableId becomes `_`. */
const mermaidId = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, "_");

const flowchart = (ir: ApplicationIR, keep: (id: StableId.StableId) => boolean): string =>
  [
    "flowchart LR",
    ...ir.nodes.flatMap((node) => (keep(node.id) ? [`  ${mermaidId(node.id)}["${node.id}"]`] : [])),
    ...ir.edges.flatMap((edge) => {
      if (keep(edge.from) === false || keep(edge.to) === false) return [];
      const label = edge.qualifier === undefined ? edge.kind : `${edge.kind} ${edge.qualifier}`;

      return [`  ${mermaidId(edge.from)} -->|${label}| ${mermaidId(edge.to)}`];
    }),
  ].join("\n");

/** Whole IR, or `None` when `name` resolves to nothing; `ir` must be the normalized IR behind `index`. */
export const graph = (
  ir: ApplicationIR,
  index: GraphIndex,
  name: Option.Option<string>,
): Option.Option<string> =>
  Option.match(name, {
    onNone: () => Option.some(flowchart(ir, () => true)),
    onSome: (wanted) =>
      Option.map(resolveName(index, wanted), (root) => {
        const incoming = IRGraph.incoming(index, root.id).flatMap((edge) =>
          Option.isSome(IRGraph.nodeOf(index, edge.from)) ? [edge.from] : [],
        );

        const kept = new Set<StableId.StableId>([
          root.id,
          ...IRGraph.reachable(index, root.id),
          ...incoming,
        ]);

        return flowchart(ir, (id) => kept.has(id));
      }),
  });
