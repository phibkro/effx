import { assert, describe, it } from "@effect/vitest";
import {
  type Analysis,
  type Annotation as CollectedAnnotation,
  CompilerFault,
  Contribution,
  Diagnostic,
  type EndpointFragment,
  type Expand,
  type Extension,
  Extensions,
  type GeneratedFile,
  type Generator,
  type ImplementOptions,
  type Implementation,
  type Interpreter,
  type Law,
  LawViolation,
  Location,
  type ProjectConfig,
  type ReadArgs,
  Severity,
  SourceFrontend,
  compile,
  dataOf,
  extension,
  hasErrors,
  implement,
  laws,
} from "@effx/compiler";
import { A, Annotation, type DefinitionData } from "@effx/runtime";
import { Effect, Option, Schema } from "effect";
import { expectTypeOf } from "vitest";
import { decoratorStyle, getUser } from "./fixtures/users.ts";
import { annotation, failure, analysis, note as noteFinding } from "./fixtures/diagnostics.ts";

describe("public compiler extension index", () => {
  it.effect(
    "authors can compile with a custom extension without importing a private frontend",
    () =>
      Effect.gen(function* () {
        const location: Location = { file: "src/example.ts", line: 1, col: 1 };
        const severity: Severity = "warning";
        const finding: Diagnostic = annotation.emit({}, { location });
        assert.deepStrictEqual(yield* Schema.decodeEffect(Diagnostic)(finding), finding);
        assert.strictEqual(yield* Schema.decodeEffect(Severity)(severity), "warning");
        assert.deepStrictEqual(yield* Schema.decodeEffect(Location)(location), location);
        assert.isFalse(hasErrors([finding]));
        assert.isTrue(hasErrors([failure.emit({})]));

        const interpret: Interpreter = () => Contribution.diagnostics(finding);
        const analyze: Analysis = () => [analysis.emit({})];
        const file: GeneratedFile = { path: "plugin.txt", contents: "from custom generator" };
        const generate: Generator = () => Effect.succeed([file]);

        const extension: Extension = {
          name: "plugin",
          diagnosticEntries: [annotation.entry, failure.entry, analysis.entry],
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
          [annotation.entry.code, analysis.entry.code],
        );
        assert.deepStrictEqual(Option.getOrThrow(result.files.value), [file]);
      }),
  );

  it.effect("authors can derive an extension from a typed definition through the same index", () =>
    Effect.gen(function* () {
      const Note = Annotation.define({
        name: "plugin.Note",
        target: "operation",
        args: { text: A.string },
      });

      const options: ImplementOptions<ReadArgs<typeof Note>> = {
        diagnosticEntries: [noteFinding.entry],
        analyze: (ir) =>
          ir.nodes.flatMap((node) =>
            node._tag === "Operation"
              ? Option.match(dataOf(Note, ir, node.id), {
                  onNone: () => [],
                  onSome: ([note]) => [noteFinding.emit({ subject: node.name, text: note.text })],
                })
              : [],
          ),
      };

      const implementation: Implementation<typeof Note> = implement(Note, options);
      const derived: Extension = extension("plugin", [implementation]);

      const expand: Expand = (collected) => ({
        declarations: collected.declarations,
        diagnostics: [],
      });

      const fragments: ReadonlyArray<EndpointFragment> = [];
      const extended: Extension = { ...derived, expand, fragments };

      expectTypeOf(derived.annotations).toEqualTypeOf<ReadonlyArray<DefinitionData> | undefined>();

      const noted: CollectedAnnotation = {
        name: "plugin.Note",
        args: [{ text: "from the typed layer" }],
      };

      const result = yield* compile({ tsconfigPath: "tsconfig.json" }, [
        ...Extensions.builtin,
        extended,
      ]).pipe(
        Effect.provide(
          SourceFrontend.fromCollected({
            ...decoratorStyle,
            declarations: decoratorStyle.declarations.map((declaration) =>
              declaration.id === getUser.id
                ? { ...declaration, annotations: [...declaration.annotations, noted] }
                : declaration,
            ),
          }),
        ),
      );

      assert.deepStrictEqual(
        result.diagnostics.filter((diagnostic) => diagnostic.code === noteFinding.entry.code),
        [noteFinding.emit({ subject: "User.Get", text: "from the typed layer" })],
      );

      // The derived laws run from the same index: a violation is the public `LawViolation`.
      const derivedLaws: ReadonlyArray<Law> = laws(Note);

      yield* Effect.forEach(derivedLaws, (law): Effect.Effect<void, LawViolation> =>
        law.check({ runs: 20, seed: 1 }),
      );
    }),
  );
});
