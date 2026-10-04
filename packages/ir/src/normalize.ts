import { Array as Arr, Order, Schema } from "effect";
import { ApplicationIR } from "./ApplicationIR.ts";
import type { Edge } from "./Edge.ts";
import { Node, type View } from "./Node.ts";
import type { SchemaRef } from "./Refs.ts";
import { canonicalJson } from "./jcs.ts";

/** Normalized IR nodes are Schema-derived JSON values, so their stable key is canonical JSON. */
const keyOf = <T extends Schema.Json>(value: T): string => canonicalJson(value);

const nodeKey = (value: Node): string => keyOf(value);

const edgeKey = (value: Edge): string => keyOf(value);

const schemaRefKey = (value: SchemaRef): string => keyOf(value);

const viewKey = (value: View): string => keyOf(value);

/** Sorts by `order` and removes elements whose canonical `key` was already seen. */
const sortedSet = <A>(
  items: ReadonlyArray<A>,
  order: Order.Order<A>,
  key: (a: A) => string,
): Array<A> => {
  const seen = new Set<string>();
  const out: Array<A> = [];

  for (const item of Arr.sort(items, order)) {
    const k = key(item);

    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }

  return out;
};

/** Set fields are ordered by their canonical element encoding (spec 0001). */
const byKey = <A>(key: (a: A) => string): Order.Order<A> => Order.mapInput(Order.String, key);

/** Normalizes set-valued fields inside a node; ordered fields are untouched. */
export const normalizeNode = (node: Node): Node =>
  Node.matchOrElse(
    node,
    {
      Model: (model): Node => ({
        ...model,
        views: sortedSet(model.views, byKey(viewKey), viewKey),
      }),
      Operation: (operation): Node => ({
        ...operation,
        errors: {
          ...operation.errors,
          values: sortedSet(operation.errors.values, byKey(schemaRefKey), schemaRefKey),
        },
        requirements: {
          ...operation.requirements,
          values: sortedSet(operation.requirements.values, Order.String, (s) => s),
        },
      }),
    },
    (other) => other,
  );

const byNodeId = Order.mapInput(Order.String, (n: Node) => n.id);

const byNodeKey = Order.mapInput(Order.String, nodeKey);

const byEdgeTuple = Order.mapInput(
  Order.String,
  (e: Edge) => `${e.kind}\u0000${e.from}\u0000${e.to}\u0000${e.qualifier ?? ""}`,
);

const byEdgeKey = Order.mapInput(Order.String, edgeKey);

/** Idempotent: `normalize(normalize(x)) == normalize(x)`. Duplicate ids with differing content are kept. */
export const normalize = (ir: ApplicationIR): ApplicationIR => {
  const nodes = sortedSet(ir.nodes.map(normalizeNode), Order.combine(byNodeId, byNodeKey), nodeKey);
  const edges = sortedSet(ir.edges, Order.combine(byEdgeTuple, byEdgeKey), edgeKey);

  return ApplicationIR.make({ format: ir.format, version: ir.version, nodes, edges });
};
