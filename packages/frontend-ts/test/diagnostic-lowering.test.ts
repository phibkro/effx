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
    reason: "unresolved tuple operand",
  },
  { subject: "cycle", operand: "CycleA", source: "...CycleA", reason: "cyclic tuple initializer" },
  {
    subject: "mutable",
    operand: "Mutable",
    source: "...Mutable",
    reason: "operand must resolve to a const tuple initializer",
  },
  {
    subject: "notArray",
    operand: "NotArray",
    source: "...NotArray",
    reason: "operand must resolve to a readonly const tuple of string literals",
  },
  {
    subject: "notReadonly",
    operand: "NotReadonly",
    source: "...NotReadonly",
    reason: "operand is not a readonly const tuple",
  },
  {
    subject: "element",
    operand: "NonString",
    source: "...NonString",
    reason: "tuple element `1` must be a string literal",
  },
  {
    subject: "mismatch",
    operand: "Mismatch",
    source: "...Mismatch",
    reason: "tuple type disagrees with its runtime initializer elements or order",
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
  it.effect("preserves each tuple rejection's message and innermost spread location", () =>
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

      for (const { subject, source: rejectedSource, reason } of cases) {
        const diagnostic = diagnostics.find((item) => item.message.startsWith(`${subject}:`));
        assert.isDefined(diagnostic, subject);
        const start = source.indexOf(rejectedSource);
        assert.isAtLeast(start, 0);
        const preceding = source.slice(0, start).split("\n");
        assert.deepStrictEqual(diagnostic, {
          code: "EFFX1102",
          severity: "error",
          message: `${subject}: cannot lower \`${rejectedSource}\` to an annotation argument: ${reason}`,
          location: { file, line: preceding.length, col: preceding.at(-1)!.length + 1 },
        });
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
