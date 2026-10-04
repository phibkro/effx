import { Array as Arr, Graph, HashMap, Option, Trie } from "effect";
import { type ApplicationIR, make } from "./ApplicationIR.ts";
import type { Edge, EdgeKind } from "./Edge.ts";
import type { Node } from "./Node.ts";
import type { StableId } from "./StableId.ts";
import { normalize } from "./normalize.ts";

/**
 * Working indexes over a normalized IR (ADR 0002). Never serialized.
 * Edges whose endpoints are absent are kept in `dangling` so `fromGraph` loses nothing.
 */
export interface GraphIndex {
  readonly graph: Graph.DirectedGraph<Node, Edge>;
  readonly byId: HashMap.HashMap<StableId, Node>;
  readonly indices: HashMap.HashMap<StableId, Graph.NodeIndex>;
  readonly ids: Trie.Trie<StableId>;
  readonly dangling: ReadonlyArray<Edge>;
  readonly duplicates: ReadonlyArray<StableId>;
}

export const toGraph = (ir: ApplicationIR): GraphIndex => {
  const normalized = normalize(ir);
  const indexById = new Map<StableId, Graph.NodeIndex>();
  const duplicates: Array<StableId> = [];
  const dangling: Array<Edge> = [];

  const graph = Graph.directed<Node, Edge>((mutable) => {
    for (const node of normalized.nodes) {
      const index = Graph.addNode(mutable, node);

      if (indexById.has(node.id)) {
        duplicates.push(node.id);
      } else {
        indexById.set(node.id, index);
      }
    }

    for (const edge of normalized.edges) {
      const source = indexById.get(edge.from);
      const target = indexById.get(edge.to);

      if (source === undefined || target === undefined) {
        dangling.push(edge);
      } else {
        Graph.addEdge(mutable, source, target, edge);
      }
    }
  });

  const entries = Array.from(indexById, ([id, index]) => [id, index] as const);

  return {
    graph,
    byId: HashMap.fromIterable(
      entries.map(([id, index]) => [id, Option.getOrThrow(Graph.getNode(graph, index))] as const),
    ),
    indices: HashMap.fromIterable(entries),
    ids: Trie.fromIterable(entries.map(([id]) => [id, id] as const)),
    dangling,
    duplicates,
  };
};

/** Law: `fromGraph(toGraph(x)) == normalize(x)`. */
export const fromGraph = (index: GraphIndex): ApplicationIR =>
  normalize(
    make(Array.from(Graph.values(Graph.nodes(index.graph))), [
      ...Array.from(Graph.values(Graph.edges(index.graph)), (edge) => edge.data),
      ...index.dangling,
    ]),
  );

export const nodeOf = (index: GraphIndex, id: StableId): Option.Option<Node> =>
  HashMap.get(index.byId, id);

/** Outgoing edges of `id` (including dangling ones), optionally filtered by kind. */
export const outgoing = (index: GraphIndex, id: StableId, kind?: EdgeKind): ReadonlyArray<Edge> => {
  const connected = Option.match(HashMap.get(index.indices, id), {
    onNone: (): ReadonlyArray<Edge> => [],
    onSome: (nodeIndex) =>
      Arr.getSomes(
        Graph.outgoingEdges(index.graph, nodeIndex).map((edgeIndex) =>
          Option.map(Graph.getEdge(index.graph, edgeIndex), (edge) => edge.data),
        ),
      ),
  });

  const all = [...connected, ...index.dangling.filter((edge) => edge.from === id)];

  return kind === undefined ? all : all.filter((edge) => edge.kind === kind);
};

/** Incoming edges of `id` (including dangling ones), optionally filtered by kind. */
export const incoming = (index: GraphIndex, id: StableId, kind?: EdgeKind): ReadonlyArray<Edge> => {
  const connected = Option.match(HashMap.get(index.indices, id), {
    onNone: (): ReadonlyArray<Edge> => [],
    onSome: (nodeIndex) =>
      Arr.getSomes(
        Graph.incomingEdges(index.graph, nodeIndex).map((edgeIndex) =>
          Option.map(Graph.getEdge(index.graph, edgeIndex), (edge) => edge.data),
        ),
      ),
  });

  const all = [...connected, ...index.dangling.filter((edge) => edge.to === id)];

  return kind === undefined ? all : all.filter((edge) => edge.kind === kind);
};

/** Ids reachable from `id` following edge direction (excluding `id` itself). */
export const reachable = (index: GraphIndex, id: StableId): ReadonlyArray<StableId> =>
  Option.match(HashMap.get(index.indices, id), {
    onNone: () => [],
    onSome: (start) =>
      Array.from(
        Graph.values(Graph.dfs(index.graph, { start: [start] })),
        (node) => node.id,
      ).filter((reached) => reached !== id),
  });

/** Strongly connected components of size > 1, plus self-loops, as id lists. */
export const cycles = (index: GraphIndex): ReadonlyArray<ReadonlyArray<StableId>> =>
  Graph.stronglyConnectedComponents(index.graph)
    .filter(
      (component) =>
        component.length > 1 ||
        (component.length === 1 &&
          Graph.successors(index.graph, component[0]!).includes(component[0]!)),
    )
    .map((component) =>
      Arr.getSomes(
        component.map((nodeIndex) =>
          Option.map(Graph.getNode(index.graph, nodeIndex), (node) => node.id),
        ),
      ),
    );

export interface MissingTarget {
  readonly edge: Edge;
  readonly missing: ReadonlyArray<StableId>;
}

/** Edges that reference absent nodes — data, not a failure. */
export const missingTargets = (index: GraphIndex): ReadonlyArray<MissingTarget> =>
  index.dangling.map((edge) => ({
    edge,
    missing: [edge.from, edge.to].filter((id) => !HashMap.has(index.byId, id)),
  }));

/** Ids whose text starts with `prefix`, e.g. `operation:User.`. Alphabetical. */
export const withPrefix = (index: GraphIndex, prefix: string): ReadonlyArray<StableId> =>
  Array.from(Trie.valuesWithPrefix(index.ids, prefix));
