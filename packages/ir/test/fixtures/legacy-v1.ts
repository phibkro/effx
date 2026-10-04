import { type ApplicationIRV1, StableId } from "@effx/ir";

const operation = StableId.make("operation", "Legacy.Get");

const schema = StableId.make("schema", "legacy/GetInput");

const extension = StableId.make("ext", "legacy/orphan");

/** A persisted v1 envelope: its extension has no ownership edge by design. */
export const legacyV1: ApplicationIRV1 = {
  format: "effx-ir",
  version: 1,
  nodes: [
    {
      _tag: "Operation",
      id: operation,
      name: "Legacy.Get",
      kind: "Query",
      input: { module: "legacy", export: "GetInput", symbolId: schema },
      success: { module: "legacy", export: "GetInput", symbolId: schema },
      errors: { values: [], inferred: true },
      requirements: { values: [], inferred: true },
      handler: { module: "legacy", export: "Legacy", member: "get" },
    },
    {
      _tag: "Extension",
      id: extension,
      extension: "legacy",
      tag: "LegacyMetadata",
      data: { enabled: true, nested: ["retained"] },
    },
  ],
  edges: [
    { kind: "InputOf", from: schema, to: operation },
    { kind: "SuccessOf", from: schema, to: operation },
  ],
};
