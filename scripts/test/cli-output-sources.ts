/*
 * The authored application bytes of the CLI output regressions: a project of plain builder operations with
 * long names, so that every printing command writes more than any pipe or socket buffer holds from a project
 * that compiles in a few seconds. Plain text only, no imports, so the suite and the fixtures share one
 * source. Every operation is an exported builder chain with an HTTP exposure and no access declaration; the
 * compiler reports two warnings per operation and each line carries the operation name, so `effx check`
 * prints about `2 * (nameLength + 90)` bytes per operation and `effx graph` about twice that.
 */

export const schemas = `import { Schema } from "effect";
export const In = Schema.Struct({ id: Schema.String });
export const Out = Schema.Struct({ id: Schema.String, name: Schema.String });
`;

const operation = (identifier: string, name: string, path: string): string =>
  `export const ${identifier} = Operation.query({ name: "${name}", input: In, success: Out }).http.get("${path}").handler((input: typeof In.Type) => Effect.succeed({ id: input.id, name: "n" }));`;

export interface ManyOperations {
  /** Plain operations `op0` to `op<count - 1>`. */
  readonly count: number;
  /** Characters appended to every operation name; a name is `Big.op<i>.` followed by them. */
  readonly nameLength: number;
  /** One more operation that reuses the name of `op0`: the compiler reports an error and `check` exits 1. */
  readonly duplicate?: boolean;
  /** One more operation `long` whose HTTP path has this many characters: `inspect` prints them on one line. */
  readonly longPath?: number;
}

const nameOf = (index: number, nameLength: number): string =>
  `Big.op${index}.${"n".repeat(nameLength)}`;

/** The project files, relative to the project directory. `src/ops.ts` declares every operation. */
export const manyOperations = (options: ManyOperations) => {
  const operations = Array.from({ length: options.count }, (_, index) =>
    operation(`op${index}`, nameOf(index, options.nameLength), `/p${index}`),
  );

  if (options.duplicate === true)
    operations.push(operation("dup", nameOf(0, options.nameLength), "/dup"));

  if (options.longPath !== undefined)
    operations.push(operation("long", "Big.long", `/long/${"x".repeat(options.longPath)}`));

  const declarations = `import { Operation } from "@effx/runtime";
import { Effect } from "effect";
import { In, Out } from "./schemas.ts";

${operations.join("\n")}
`;

  return { "src/schemas.ts": schemas, "src/ops.ts": declarations, "src/worker.ts": "export {};\n" };
};

/**
 * A configuration with one extension whose one diagnostic entry has an explanation of `length` characters:
 * `effx explain` prints all of it on stdout. A trusted static fixture, not a boundary decoder.
 */
export const explanationConfig = (code: string, length: number): string =>
  `export default { project: "missing-tsconfig.json", outDir: "must-not-write", extensions: [{ name: "@fixture/big", interpreters: {}, analyses: [], generators: [], diagnosticEntries: [{
  code: "${code}", owner: "@fixture/big", title: "A very long explanation",
  severity: "warning", severityPolicy: { kind: "fixed" },
  explanation: "${"e".repeat(length)}",
  examples: [{ before: "invalid()", after: "valid()", explanation: "Use a valid declaration." }]
}] }] };
`;
