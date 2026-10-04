import { Effect } from "effect";
import {
  CompilerFault,
  GENERATED_HEADER,
  GeneratedImports,
  generatedIdentifier,
  renderGenerated,
  schemaExpr,
  type GeneratedFile,
  type GenerationContext,
  type Generator,
} from "@effx/compiler";
import { conformanceBody } from "./conformance.ts";
import { portFile, portsOf, type PersistencePort } from "./ports.ts";

const header = (port: PersistencePort): ReadonlyArray<string> => [
  GENERATED_HEADER,
  `// Source: ${Array.from(
    new Set(
      port.methods.flatMap(({ operation }) => [
        operation.input.module,
        operation.success.module,
        ...operation.errors.values.map((ref) => ref.module),
      ]),
    ),
  )
    .sort()
    .join(", ")}`,
  `// IR: ${port.methods.map(({ operation }) => operation.id).join(", ")}`,
];

const filesOf = (
  port: PersistencePort,
  context?: GenerationContext,
): ReadonlyArray<GeneratedFile> => {
  const name = `${generatedIdentifier(port.name)}Port`;
  const filename = portFile(port.name);
  const imports = new GeneratedImports(context);
  imports.reserve(name, "input");
  imports.add("effect", "Context");
  imports.add("effect", "Effect");

  const methods = port.methods.map(({ name: method, operation }) => {
    const input = schemaExpr(imports, operation.input);
    const success = schemaExpr(imports, operation.success);

    const errors =
      operation.errors.values.map((ref) => `typeof ${schemaExpr(imports, ref)}.Type`).join(" | ") ||
      "never";

    return `  readonly ${JSON.stringify(method)}: (input: typeof ${input}.Type) => Effect.Effect<typeof ${success}.Type, ${errors}>;`;
  });

  const portContents = renderGenerated(header(port), imports, [
    "/** Leaf capability: methods hold no adapter requirements; the application Layer owns storage. */",
    `export class ${name} extends Context.Service<${name}, {`,
    ...methods,
    `}>()(${JSON.stringify(`effx/port/${port.name}`)}) {}`,
  ]);

  const suiteImports = new GeneratedImports(context);
  suiteImports.add(`./${filename}-port.ts`, name);

  for (const value of ["Cause", "Effect", "Exit", "Layer", "Schema"])
    suiteImports.add("effect", value);

  for (const value of ["assert", "describe", "it"]) suiteImports.add("@effect/vitest", value);

  return [
    { path: `${filename}-port.ts`, contents: portContents },
    {
      path: `${filename}-conformance.ts`,
      contents: renderGenerated(header(port), suiteImports, conformanceBody(port, suiteImports)),
    },
  ];
};

/** Free generator: no source modules are evaluated and construction performs no work. */
export const persistenceGenerator: Generator = (ir, index, context) =>
  Effect.suspend(() => {
    const result = portsOf(ir, index);

    if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return Effect.fail(
        new CompilerFault({
          stage: "persistence",
          message: "Invalid persistence IR reached the generator",
        }),
      );
    }

    return Effect.succeed(result.ports.flatMap((port) => filesOf(port, context)));
  });
