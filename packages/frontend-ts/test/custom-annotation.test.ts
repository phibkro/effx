import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { type Collected, Extensions, SourceFrontend, interpret } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { Effect, Layer } from "effect";

const tsconfigPath = new URL("./fixtures/users/tsconfig.json", import.meta.url).pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const collectFixture = SourceFrontend.use((frontend) =>
  frontend.analyze({ tsconfigPath, entry: ["custom-annotations.ts"] }),
);

const declarationsById = (collected: Collected, id: string) =>
  collected.declarations.find((declaration) => declaration.id === id);

describe("generic runtime-sourced annotations", () => {
  it.effect(
    "lowers decorator and builder to the same custom annotation without evaluating source",
    () =>
      Effect.gen(function* () {
        const collected = yield* collectFixture;
        const decorated = declarationsById(collected, "Decorated.read");
        const built = declarationsById(collected, "Built");

        if (decorated === undefined || built === undefined)
          return assert.fail("source operations not collected");
        assert.deepStrictEqual(decorated.annotations, built.annotations);
        assert.deepStrictEqual(decorated.annotations, [
          { name: "Query", args: [{ name: "Example.Read" }] },
          {
            name: "example.deprecated",
            args: [{ reason: "Use replacement", details: [1, true] }],
          },
        ]);
        assert.isUndefined(declarationsById(collected, "Lookalike.read"));
        assert.isUndefined(declarationsById(collected, "FakeBuilder"));

        const unknown = interpret(
          { declarations: [decorated], diagnostics: [] },
          Extensions.builtin,
        );

        assert.deepStrictEqual(
          unknown.diagnostics
            .filter((diagnostic) => diagnostic.code === "EFFX1101")
            .map((diagnostic) => diagnostic.message),
          ["@example.deprecated on Decorated.read: no extension interprets this annotation"],
        );
      }).pipe(Effect.provide(Services)),
  );

  it.effect("rejects nonliteral names and nonstatic arguments at either syntax", () =>
    Effect.gen(function* () {
      const collected = yield* collectFixture;

      const invalid = [
        "Invalid.nonliteral",
        "Invalid.argument",
        "Invalid.missingName",
        "InvalidBuilder",
      ];

      for (const id of invalid) {
        const declaration = declarationsById(collected, id);

        if (declaration === undefined) return assert.fail(`${id} was not collected`);
        assert.isFalse(
          declaration.annotations.some((annotation) => annotation.name === "example.deprecated"),
        );
      }

      const rejected = collected.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX1102");
      assert.strictEqual(rejected.length, 5);
      assert.deepStrictEqual(
        rejected.map(({ code, severity, message, location }) => ({
          code,
          severity,
          message,
          line: location?.line,
          col: location?.col,
        })),
        [
          {
            code: "EFFX1102",
            severity: "error",
            message:
              "Invalid.nonliteral: cannot lower `name` to an annotation argument: annotation name must be a string literal",
            line: 29,
            col: 20,
          },
          {
            code: "EFFX1102",
            severity: "error",
            message:
              "Invalid.argument: cannot lower `reason()` to an annotation argument: unsupported runtime constructor call",
            line: 35,
            col: 52,
          },
          {
            code: "EFFX1102",
            severity: "error",
            message:
              "Invalid.missingName: cannot lower `RuntimeAnnotate()` to an annotation argument: Annotate requires a literal annotation name",
            line: 41,
            col: 4,
          },
          {
            code: "EFFX1102",
            severity: "error",
            message:
              "InvalidBuilder: cannot lower `name` to an annotation argument: annotation name must be a string literal",
            line: 48,
            col: 13,
          },
          {
            code: "EFFX1102",
            severity: "error",
            message:
              "InvalidBuilder: cannot lower `reason()` to an annotation argument: unsupported runtime constructor call",
            line: 49,
            col: 45,
          },
        ],
      );
      assert.isTrue(
        rejected.every((diagnostic) =>
          diagnostic.location?.file.endsWith("/custom-annotations.ts"),
        ),
      );
    }).pipe(Effect.provide(Services)),
  );
});
