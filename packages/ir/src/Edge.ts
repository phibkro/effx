import { Schema } from "effect";
import { StableId } from "./StableId.ts";

export const EdgeKind = Schema.Literals([
  "InputOf",
  "SuccessOf",
  "ErrorOf",
  "Requires",
  "AuthorizedBy",
  "Focuses",
  "ExposedAs",
  "PersistsAs",
  "ViewOf",
  "ExtensionOf",
]);

export type EdgeKind = typeof EdgeKind.Type;

export const Edge = Schema.Struct({
  kind: EdgeKind,
  from: StableId,
  to: StableId,
  qualifier: Schema.optionalKey(Schema.String),
});

export type Edge = typeof Edge.Type;
