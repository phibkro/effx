import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { SourceFrontend } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { copyUsersFixture } from "../../../tools/testing/projects.ts";

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

const cases = [
  {
    subject: "unresolved",
    operand: "Missing",
    source: "...Missing",
  },
  { subject: "cycle", operand: "CycleA", source: "...CycleA" },
  {
    subject: "mutable",
    operand: "Mutable",
    source: "...Mutable",
  },
  {
    subject: "notArray",
    operand: "NotArray",
    source: "...NotArray",
  },
  {
    subject: "notReadonly",
    operand: "NotReadonly",
    source: "...NotReadonly",
  },
  {
    subject: "element",
    operand: "NonString",
    source: "...NonString",
  },
  {
    subject: "mismatch",
    operand: "Mismatch",
    source: "...Mismatch",
  },
] as const;

const source = `import { Operation } from "@effx/runtime";
const CycleA = [...CycleB] as const;
const CycleB = [...CycleA] as const;
let Mutable = ["mutable"] as const;
const NotArray = "not-array";
const NotReadonly = ["not-readonly"];
const NonString = [1] as const;
const Original = ["original"] as const;
const Mismatch = Original as readonly ["different"];
const Valid = ["first", "second"] as const;
${cases.map(({ subject, operand }) => `export const ${subject} = Operation.query({ name: "${subject}" }).http.problems({ codes: [...${operand}] }).declare();`).join("\n")}
export const healthy = Operation.query({ name: "healthy" }).http.problems({ codes: [...Valid] }).declare();
`;

describe("registered lowering diagnostic routing", () => {
  it.effect("rejects each tuple input at its innermost spread location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* copyUsersFixture();
      const file = path.join(fixtureRoot, "src", "_diagnostic-tuples.ts");
      yield* fs.writeFileString(file, source);

      const collected = yield* SourceFrontend.use((frontend) =>
        frontend.analyze({
          tsconfigPath: path.join(fixtureRoot, "tsconfig.json"),
          entry: ["src/_diagnostic-tuples.ts"],
        }),
      );

      const diagnostics = collected.diagnostics.filter(
        (diagnostic) => diagnostic.code === "EFFX1102",
      );

      assert.strictEqual(diagnostics.length, cases.length);

      for (const { subject, source: rejectedSource } of cases) {
        const start = source.indexOf(rejectedSource);
        assert.isAtLeast(start, 0);
        const preceding = source.slice(0, start).split("\n");
        const location = { file, line: preceding.length, col: preceding.at(-1)!.length + 1 };

        const diagnostic = diagnostics.find(
          (item) =>
            item.location?.file === file &&
            item.location.line === location.line &&
            item.location.col === location.col,
        );

        assert.isDefined(diagnostic, subject);
        assert.strictEqual(diagnostic.code, "EFFX1102");
        assert.strictEqual(diagnostic.severity, "error");
        assert.deepStrictEqual(diagnostic.location, location);
        assert.isFalse(
          collected.declarations
            .find((item) => item.id === subject)
            ?.annotations.some((annotation) => annotation.name === "Http.Problems"),
        );
      }

      assert.deepStrictEqual(
        collected.declarations
          .find((item) => item.id === "healthy")
          ?.annotations.find((annotation) => annotation.name === "Http.Problems")?.args,
        [{ codes: ["first", "second"] }],
      );
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
