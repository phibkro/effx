import { assert, describe, it } from "@effect/vitest";
import {
  type Analysis,
  CompilerFault,
  Contribution,
  Diagnostic,
  type Extension,
  type GeneratedFile,
  type Generator,
  type Interpreter,
  Location,
  type ProjectConfig,
  Severity,
  SourceFrontend,
  compile,
  error,
  hasErrors,
  warning,
} from "@effx/compiler";
import { Effect, Option, Schema } from "effect";
import { expectTypeOf } from "vitest";

describe("public compiler extension index", () => {
  it.effect(
    "authors can compile with a custom extension without importing a private frontend",
    () =>
      Effect.gen(function* () {
        const location: Location = { file: "src/example.ts", line: 1, col: 1 };
        const severity: Severity = "warning";
        const finding: Diagnostic = warning("EFFX9001", "plugin annotation", location);
        assert.deepStrictEqual(yield* Schema.decodeEffect(Diagnostic)(finding), finding);
        assert.strictEqual(yield* Schema.decodeEffect(Severity)(severity), "warning");
        assert.deepStrictEqual(yield* Schema.decodeEffect(Location)(location), location);
        assert.isFalse(hasErrors([finding]));
        assert.isTrue(hasErrors([error("EFFX9002", "plugin error")]));

        const interpret: Interpreter = () => Contribution.diagnostics(finding);
        const analyze: Analysis = () => [warning("EFFX9003", "plugin analysis")];
        const file: GeneratedFile = { path: "plugin.txt", contents: "from custom generator" };
        const generate: Generator = () => Effect.succeed([file]);

        const extension: Extension = {
          name: "plugin",
          interpreters: { "plugin.note": interpret },
          analyses: [analyze],
          generators: [generate],
        };

        const project: ProjectConfig = { tsconfigPath: "tsconfig.json" };
        const compilation = compile(project, [extension]);
        expectTypeOf<Effect.Success<typeof compilation>["diagnostics"]>().toEqualTypeOf<
          ReadonlyArray<Diagnostic>
        >();
        expectTypeOf<Effect.Error<typeof compilation>>().toEqualTypeOf<CompilerFault>();
        expectTypeOf<Effect.Services<typeof compilation>>().toEqualTypeOf<SourceFrontend>();

        const result = yield* compilation.pipe(
          Effect.provide(
            SourceFrontend.fromCollected({
              diagnostics: [],
              declarations: [
                {
                  id: "Example.note",
                  kind: "staticMethod",
                  module: "src/example.ts",
                  export: "Example",
                  member: "note",
                  annotations: [{ name: "plugin.note", args: [] }],
                },
              ],
            }),
          ),
        );

        assert.deepStrictEqual(
          result.diagnostics.map((diagnostic) => diagnostic.code),
          ["EFFX9001", "EFFX9003"],
        );
        assert.deepStrictEqual(Option.getOrThrow(result.files.value), [file]);
      }),
  );
});
