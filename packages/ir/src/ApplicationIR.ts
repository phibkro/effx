import { Schema } from "effect";
import { Edge } from "./Edge.ts";
import { Node } from "./Node.ts";

export const FORMAT = "effx-ir" as const;

export const VERSION = 2 as const;

export const ApplicationIR = Schema.Struct({
  format: Schema.Literal(FORMAT),
  version: Schema.Literal(VERSION),
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
});

export type ApplicationIR = typeof ApplicationIR.Type;

export const empty: ApplicationIR = { format: FORMAT, version: VERSION, nodes: [], edges: [] };

export const make = (nodes: ReadonlyArray<Node>, edges: ReadonlyArray<Edge>): ApplicationIR => ({
  format: FORMAT,
  version: VERSION,
  nodes,
  edges,
});
