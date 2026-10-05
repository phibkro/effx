import { Schema } from "effect";
import { defineDiagnostic } from "@effx/diagnostics";

/** Definition-time data only; importing this module never evaluates an application. */
export const annotationSchemaLowering = defineDiagnostic(
  {
    code: "EFFX1301",
    owner: "annotation",
    title: "Schema argument cannot be lowered from source",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "A.fromSchema encountered an unsupported Schema AST node. Each invalid leaf is reported with its path in the annotation argument list, including object fields, arrays, records and union cases. Definition construction remains total; the compiler reports these recorded problems before interpreting uses. Replace the unsupported node with an argument-algebra description or a Schema shape the frontend can lower; a runtime transformation cannot be evaluated during source collection.",
    examples: [
      {
        before: "args: { value: A.fromSchema(Schema.DateTimeUtcFromString) }",
        after: "args: { value: A.string }",
        explanation:
          "Keep the source argument a string and perform the date conversion in the interpreter, rather than asking source lowering to run a Schema transformation.",
        language: "ts",
      },
    ],
  },
  Schema.Struct({ annotation: Schema.String, path: Schema.String, nodeKind: Schema.String }),
  ({ annotation, path, nodeKind }) =>
    `annotation ${annotation}: args ${path}: Schema node ${nodeKind} cannot be lowered from source (A.fromSchema)`,
);

export const RuntimeDiagnostics = {
  [annotationSchemaLowering.entry.code]: annotationSchemaLowering,
};

/** Definition-owned defaults for symbol checks; custom expectations remain authored facts. */
export const SymbolExpectations = {
  callable: "metadata.annotator must be an exported callable symbol",
  "exported-function": "commandIdentity must be an exported callable function",
  "exported-value": "access symbol must be an exported value",
  registry: "registry must be an exported value symbol",
} as const;
