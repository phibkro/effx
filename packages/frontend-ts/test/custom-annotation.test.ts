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
      assert.isTrue(rejected.every((diagnostic) => diagnostic.location !== undefined));
      assert.isTrue(
        rejected.some((diagnostic) => diagnostic.message.includes("name must be a string literal")),
      );
      assert.isTrue(
        rejected.some((diagnostic) =>
          diagnostic.message.includes("unsupported runtime constructor call"),
        ),
      );
    }).pipe(Effect.provide(Services)),
  );
});
